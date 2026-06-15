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
import { randomUUID, createHash } from 'crypto';
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

  async stopVideo(
    meetingId: string,
    sessionId: string,
    userId: string | null,
  ): Promise<{
    recordingSessionId: string;
    status: string;
    stoppedAt: Date;
    durationSeconds: number;
    fileSizeBytes: string;
    mediaFileId: string | null;
  }> {
    // 1. Load session
    const rows: Array<{
      id: string;
      meeting_id: string;
      status: string;
      storage_path: string | null;
      started_at: string | Date;
      paused_duration_seconds: number | null;
      metadata_json: Record<string, unknown> | null;
    }> = await this.dataSource.manager.query(
      `SELECT id, meeting_id, status, storage_path, started_at,
              paused_duration_seconds, metadata_json
       FROM recording_sessions WHERE id = $1`,
      [sessionId],
    );
    const session = rows?.[0];
    if (!session || session.meeting_id !== meetingId) {
      throw new NotFoundException({
        code: 'RECORDING_SESSION_NOT_FOUND',
        message: 'Recording session not found.',
      });
    }

    // 2. Active?
    const activeStatuses = [
      RecordingSessionStatus.STARTING,
      RecordingSessionStatus.RECORDING,
      RecordingSessionStatus.PAUSED,
    ];
    if (!activeStatuses.includes(session.status as RecordingSessionStatus)) {
      throw new ConflictException({
        code: 'RECORDING_NOT_ACTIVE',
        message: 'Recording session is not active.',
      });
    }

    // 3. Dừng tiến trình (graceful → kill). Không còn handle → orphan.
    const stopResult = this.processManager.has(sessionId)
      ? await this.processManager.stop(sessionId)
      : 'orphan';
    const isOrphan = stopResult === 'orphan';

    // 4. Chốt file (đợi exit ở bước 3 xong mới đọc).
    const stoppedAt = new Date();
    const startedAt = new Date(session.started_at);
    const paused = session.paused_duration_seconds ?? 0;
    const durationSeconds = Math.max(
      0,
      Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000) - paused,
    );
    const storagePath = session.storage_path;
    const exists = !!storagePath && fs.existsSync(storagePath);
    const size = exists ? fs.statSync(storagePath).size : 0;

    const baseMeta = session.metadata_json ?? {};
    const metadata = isOrphan ? { ...baseMeta, orphan_stop: true } : baseMeta;

    // 5a. File thiếu / rỗng → stopped nhưng KHÔNG tạo media_files.
    if (!exists || size === 0) {
      await this.dataSource.manager.query(
        `UPDATE recording_sessions
         SET status = $1, stopped_at = $2, stopped_by = $3,
             duration_seconds = $4, error_message = $5, metadata_json = $6
         WHERE id = $7`,
        [
          RecordingSessionStatus.STOPPED,
          stoppedAt,
          userId,
          durationSeconds,
          'empty file',
          JSON.stringify(metadata),
          sessionId,
        ],
      );
      return {
        recordingSessionId: sessionId,
        status: RecordingSessionStatus.STOPPED,
        stoppedAt,
        durationSeconds,
        fileSizeBytes: '0',
        mediaFileId: null,
      };
    }

    // 5b. Có file → checksum stream + transaction (media_files + session).
    const fileSizeBytes = String(size);
    const checksum = await this.sha256Stream(storagePath);
    const fileName = `${sessionId}.mp4`;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let mediaFileId: string;
    try {
      const insert = (await queryRunner.query(
        `INSERT INTO media_files
           (file_name, file_type, mime_type, storage_provider, storage_key,
            recording_session_id, meeting_id, uploaded_by,
            file_size_bytes, checksum, duration_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          fileName,
          'video',
          'video/mp4',
          'local',
          storagePath,
          sessionId,
          meetingId,
          userId,
          fileSizeBytes,
          checksum,
          durationSeconds,
        ],
      )) as Array<{ id: string }>;
      mediaFileId = insert[0].id;

      await queryRunner.query(
        `UPDATE recording_sessions
         SET status = $1, stopped_at = $2, stopped_by = $3,
             file_size_bytes = $4, duration_seconds = $5, checksum = $6,
             metadata_json = $7
         WHERE id = $8`,
        [
          RecordingSessionStatus.STOPPED,
          stoppedAt,
          userId,
          fileSizeBytes,
          durationSeconds,
          checksum,
          JSON.stringify(metadata),
          sessionId,
        ],
      );

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `stopVideo finalize failed for session ${sessionId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new InternalServerErrorException({
        code: 'RECORDING_STOP_FAILED',
        message: 'Failed to finalize recording.',
      });
    } finally {
      await queryRunner.release();
    }

    return {
      recordingSessionId: sessionId,
      status: RecordingSessionStatus.STOPPED,
      stoppedAt,
      durationSeconds,
      fileSizeBytes,
      mediaFileId,
    };
  }

  /** sha256 hex của file qua stream (không nạp toàn file vào RAM). */
  private sha256Stream(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
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
