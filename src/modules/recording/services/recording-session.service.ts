import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  RecordingSessionEntity,
  RecordingSessionType,
  RecordingSourceType,
  RecordingSessionStatus,
} from '../entities/recording-session.entity.js';
import { StartVideoDto } from '../dto/start-video.dto.js';
import { RecordingProcessManager } from './recording-process-manager.js';
import { decryptSecret } from '../../../common/utils/secret-crypto.util.js';

interface RtspConfig {
  rtsp_protocol?: string;
  rtsp_host?: string;
  rtsp_port?: number;
  rtsp_path?: string;
  rtsp_username?: string | null;
  rtsp_password_encrypted?: string;
}

@Injectable()
export class RecordingSessionService {
  private readonly logger = new Logger(RecordingSessionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly processManager: RecordingProcessManager,
  ) {}

  async startVideo(
    meetingId: string,
    dto: StartVideoDto,
    userId: string | null,
  ): Promise<{
    recordingSessionId: string;
    sessionType: string;
    status: string;
    startedAt: Date;
    cameraDeviceId: string;
  }> {
    // 1. Meeting tồn tại
    const meetingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }

    // 2. Camera (body.cameraDeviceId)
    const deviceRows: Array<{
      id: string;
      device_type: string;
      metadata_json: Record<string, unknown> | null;
    }> = await this.dataSource.manager.query(
      'SELECT id, device_type, metadata_json FROM iot_devices WHERE id = $1',
      [dto.cameraDeviceId],
    );
    if (!deviceRows || deviceRows.length === 0) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'Camera device not found.',
      });
    }
    const device = deviceRows[0];
    if (device.device_type !== 'ip_camera') {
      throw new BadRequestException({
        code: 'INVALID_VIDEO_SOURCE_DEVICE',
        message: 'cameraDeviceId must reference an ip_camera.',
      });
    }

    // 3. rtsp_config
    const metaCfg = device.metadata_json?.['rtsp_config'];
    const cfg = metaCfg ? (metaCfg as RtspConfig) : null;
    if (!cfg || !cfg.rtsp_host || !cfg.rtsp_path) {
      throw new BadRequestException({
        code: 'RTSP_NOT_CONFIGURED',
        message: 'Camera RTSP is not configured.',
      });
    }

    // 4. Active session?
    const activeRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        `SELECT id FROM recording_sessions
         WHERE meeting_id = $1
           AND status IN ('starting','recording','paused')
           AND stopped_at IS NULL
         LIMIT 1`,
        [meetingId],
      );
    if (activeRows && activeRows.length > 0) {
      throw new ConflictException({
        code: 'RECORDING_ALREADY_ACTIVE',
        message: 'A recording session is already active for this meeting.',
      });
    }

    // 5. Link recording_config (best-effort)
    const cfgRows: Array<{ id: string }> = await this.dataSource.manager.query(
      'SELECT id FROM recording_configs WHERE meeting_id = $1 LIMIT 1',
      [meetingId],
    );
    const recordingConfigId = cfgRows?.[0]?.id ?? null;

    // 6. Dựng URL (in-memory; KHÔNG log/lưu). Decrypt password nếu có.
    const url = this.buildRtspUrl(cfg);

    // 7. storage path
    const baseDir = this.configService.get<string>(
      'RECORDING_STORAGE_PATH',
      './storage/recordings',
    );
    const sessionId = randomUUID();
    const outPath = path.join(path.resolve(baseDir), `${sessionId}.mp4`);
    fs.mkdirSync(path.resolve(baseDir), { recursive: true });

    // 8. Tạo recording_session (status=recording)
    const startedAt = new Date();
    const session = this.dataSource.manager.create(RecordingSessionEntity, {
      id: sessionId,
      meetingId,
      recordingConfigId,
      sessionType: RecordingSessionType.VIDEO,
      sourceType: RecordingSourceType.IP_CAMERA,
      deviceId: device.id,
      startedAt,
      status: RecordingSessionStatus.RECORDING,
      startedBy: userId,
      storageProvider: 'local',
      storagePath: outPath,
    });
    await this.dataSource.manager.save(RecordingSessionEntity, session);

    // 9. Spawn ffmpeg + grace-window
    this.processManager.start(sessionId, url, outPath);
    const grace = await this.processManager.waitForGrace(sessionId, 2000);
    if (grace === 'dead') {
      // manager đã/đang markFailed; báo lỗi chung (không lộ url/password).
      throw new InternalServerErrorException({
        code: 'RECORDING_START_FAILED',
        message: 'Failed to start recording (ffmpeg exited).',
      });
    }

    return {
      recordingSessionId: sessionId,
      sessionType: RecordingSessionType.VIDEO,
      status: RecordingSessionStatus.RECORDING,
      startedAt,
      cameraDeviceId: device.id,
    };
  }

  /** rtsp://[user[:pass]@]host:port/path — chỉ dùng nội bộ, không log. */
  private buildRtspUrl(cfg: RtspConfig): string {
    const protocol = cfg.rtsp_protocol || 'rtsp';
    const port = cfg.rtsp_port || 554;
    let auth = '';
    if (cfg.rtsp_username) {
      let pass = '';
      if (cfg.rtsp_password_encrypted) {
        try {
          pass = `:${encodeURIComponent(decryptSecret(cfg.rtsp_password_encrypted))}`;
        } catch {
          // KHÔNG lộ chi tiết giải mã; coi như cấu hình lỗi.
          throw new InternalServerErrorException({
            code: 'RECORDING_START_FAILED',
            message: 'Failed to prepare camera credential.',
          });
        }
      }
      auth = `${encodeURIComponent(cfg.rtsp_username)}${pass}@`;
    }
    return `${protocol}://${auth}${cfg.rtsp_host as string}:${port}${cfg.rtsp_path as string}`;
  }
}
