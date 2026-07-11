import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  RecordingSessionEntity,
  RecordingSessionType,
  RecordingSourceType,
  RecordingSessionStatus,
} from '../entities/recording-session.entity.js';
import { StartVideoDto } from '../dto/start-video.dto.js';
import { CreateAudioSessionDto } from '../dto/create-audio-session.dto.js';
import { RecordingProcessManager } from './recording-process-manager.js';
import { decryptSecret } from '../../../common/utils/secret-crypto.util.js';
import { probeMedia, probeAudioDuration } from '../utils/ffprobe.util.js';
import { StorageService } from '../../storage/storage.service.js';

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
  // REC-007: cửa sổ phát hiện no-data khi start (poll file>0).
  private static readonly START_PROBE_MS = 5000;
  private static readonly POLL_MS = 250;

  private static readonly SUPPORTED_AUDIO_EXTENSIONS = [
    '.wav',
    '.mp3',
    '.m4a',
    '.mp4',
    '.aac',
    '.flac',
    '.ogg',
    '.webm',
  ];

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly processManager: RecordingProcessManager,
    private readonly storageService: StorageService,
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

    // 9. Spawn ffmpeg + probe no-data (REC-007): exit→failed; file>0→recording; hết cửa sổ & file 0→no_data.
    this.processManager.start(sessionId, url, outPath);
    const probe = await this.probeStart(sessionId, outPath);
    if (probe === 'exited') {
      // manager exit-handler đã markFailed; báo lỗi chung (không lộ url/password).
      throw new InternalServerErrorException({
        code: 'RECORDING_START_FAILED',
        message: 'Failed to start recording (ffmpeg exited).',
      });
    }
    if (probe === 'no_data') {
      // Camera tắt/không tới được: ffmpeg sống nhưng 0 byte → kill + failed + 502.
      await this.processManager.stop(sessionId);
      await this.dataSource.manager.query(
        `UPDATE recording_sessions
         SET status = $1, error_message = $2, stopped_at = $3
         WHERE id = $4`,
        [
          RecordingSessionStatus.FAILED,
          'no video data received from camera',
          new Date(),
          sessionId,
        ],
      );
      throw new BadGatewayException({
        code: 'RECORDING_NO_VIDEO',
        message:
          'Camera không gửi dữ liệu video (kiểm tra camera đã bật và tới được).',
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

  /**
   * REC-007 no-data probe: poll trong cửa sổ START_PROBE_MS.
   * - process exit → 'exited'; file output > 0 → 'capturing'; hết cửa sổ → 'no_data'.
   * Cửa sổ có giới hạn ⇒ request không treo.
   */
  private async probeStart(
    sessionId: string,
    outPath: string,
  ): Promise<'capturing' | 'exited' | 'no_data'> {
    const deadline = Date.now() + RecordingSessionService.START_PROBE_MS;
    for (;;) {
      const proc = this.processManager.get(sessionId);
      if (
        !this.processManager.has(sessionId) ||
        (proc && proc.exitCode !== null)
      ) {
        return 'exited';
      }
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        return 'capturing';
      }
      if (Date.now() >= deadline) {
        return 'no_data';
      }
      await this.sleep(RecordingSessionService.POLL_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    captured: boolean;
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
        captured: false,
      };
    }

    // 5b. Có file → finalize (size/checksum/duration + transaction). Dùng chung helper.
    const result = await this.finalizeFileToStopped({
      sessionId,
      meetingId,
      storagePath,
      startedAt,
      paused,
      userId,
      baseMetadata: metadata,
    });

    return {
      recordingSessionId: sessionId,
      status: RecordingSessionStatus.STOPPED,
      stoppedAt: result.stoppedAt,
      durationSeconds: result.durationSeconds,
      fileSizeBytes: result.fileSizeBytes,
      mediaFileId: result.mediaFileId,
      captured: true,
    };
  }

  /**
   * Tạo 1 audio recording_session "rỗng" (chưa có media_file nào) — điểm neo
   * (sessionId) để nhiều participant lần lượt upload audio track riêng của mình
   * qua uploadAudioTrack() (channel_zone mode). Khác uploadAudioForTranscription
   * (luôn kèm sẵn 1 file) — session ở đây chỉ có metadata, KHÔNG có file/process.
   * status=starting là placeholder trung tính (không có ffmpeg/process đứng sau,
   * không bị bất kỳ logic nào ở createTranscriptionJob kiểm tra) — session được
   * coi là "sẵn sàng nhận track" ngay từ khi tạo, không cần bước "start" riêng.
   * Chỉ Host/Organizer của meeting hoặc Business/System Admin được tạo.
   */
  async createAudioSession(
    meetingId: string,
    userId: string | null,
    dto: CreateAudioSessionDto,
  ): Promise<{
    recordingSessionId: string;
    sessionType: string;
    status: string;
    startedAt: Date;
  }> {
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

    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId);
    }

    const sessionId = randomUUID();
    const startedAt = new Date();
    const metadataJson = dto?.notes ? { notes: dto.notes } : null;

    const session = this.dataSource.manager.create(RecordingSessionEntity, {
      id: sessionId,
      meetingId,
      sessionType: RecordingSessionType.AUDIO,
      sourceType: RecordingSourceType.MANUAL_UPLOAD,
      status: RecordingSessionStatus.STARTING,
      startedAt,
      startedBy: userId,
      metadataJson,
    });
    await this.dataSource.manager.save(RecordingSessionEntity, session);

    return {
      recordingSessionId: sessionId,
      sessionType: RecordingSessionType.AUDIO,
      status: RecordingSessionStatus.STARTING,
      startedAt,
    };
  }

  /**
   * Upload audio đã ghi sẵn (ví dụ .m4a) cho 1 meeting, dùng để test/feed pipeline
   * transcription (TRANS-OFFLINE-001) khi không có camera/capture agent thật.
   * Tạo 1 recording_session (sessionType=audio, sourceType=manual_upload, status
   * stopped ngay vì file đã hoàn chỉnh) + 1 media_files (file_type=audio).
   * Chỉ Host/Organizer của meeting hoặc Business/System Admin được upload.
   */
  async uploadAudioForTranscription(
    meetingId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    userId: string | null,
  ): Promise<{
    recordingSessionId: string;
    mediaFileId: string;
    storageKey: string;
    durationSeconds: number | null;
  }> {
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

    if (userId) {
      await this.assertHostOrAdmin(meetingId, userId);
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_AUDIO_FILE',
        message: 'File audio rỗng hoặc không hợp lệ.',
      });
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_FORMAT',
        message: `Định dạng "${ext}" không được hỗ trợ. Chấp nhận: ${RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.join(', ')}`,
      });
    }

    const sessionId = randomUUID();
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const durationSeconds = await this.probeUploadedAudioDuration(
      file.buffer,
      ext,
    );

    const saved = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      folder: `recordings/${meetingId}`,
    });
    const driver = this.storageService.getDriver();
    const bucket = this.storageService.getBucketName();

    const startedAt = new Date();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let mediaFileId: string;
    try {
      const session = queryRunner.manager.create(RecordingSessionEntity, {
        id: sessionId,
        meetingId,
        sessionType: RecordingSessionType.AUDIO,
        sourceType: RecordingSourceType.MANUAL_UPLOAD,
        status: RecordingSessionStatus.STOPPED,
        startedAt,
        stoppedAt: startedAt,
        startedBy: userId,
        stoppedBy: userId,
        storageProvider: driver,
        storagePath: saved.storageKey,
        fileSizeBytes: String(file.size),
        durationSeconds,
        checksum,
      });
      await queryRunner.manager.save(RecordingSessionEntity, session);

      const insert = (await queryRunner.query(
        `INSERT INTO media_files
           (file_name, file_type, mime_type, storage_provider, storage_bucket, storage_key,
            recording_session_id, meeting_id, uploaded_by,
            file_size_bytes, checksum, duration_seconds, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
         RETURNING id`,
        [
          file.originalname,
          'audio',
          file.mimetype || 'application/octet-stream',
          driver,
          bucket,
          saved.storageKey,
          sessionId,
          meetingId,
          userId,
          String(file.size),
          checksum,
          durationSeconds,
        ],
      )) as Array<{ id: string }>;
      mediaFileId = insert[0].id;

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `uploadAudioForTranscription failed for meeting ${meetingId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new InternalServerErrorException({
        code: 'AUDIO_UPLOAD_FAILED',
        message: 'Failed to save uploaded audio.',
      });
    } finally {
      await queryRunner.release();
    }

    return {
      recordingSessionId: sessionId,
      mediaFileId,
      storageKey: saved.storageKey,
      durationSeconds,
    };
  }

  /**
   * Giai đoạn 1 — PLAN-transcription-completion: Participant upload audio track
   * riêng của mình sau khi meeting kết thúc (status=completed). userId lấy từ JWT.
   * Tạo MediaFile với channelUserId = userId để pipeline channel_zone biết ai nói.
   */
  async uploadAudioTrack(
    meetingId: string,
    sessionId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    userId: string,
  ): Promise<{
    mediaFileId: string;
    storageKey: string;
    channelUserId: string;
    durationSeconds: number | null;
  }> {
    const meetingRows: Array<{ id: string; status: string }> =
      await this.dataSource.manager.query(
        'SELECT id, status FROM meetings WHERE id = $1',
        [meetingId],
      );
    if (!meetingRows || meetingRows.length === 0) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: 'Meeting not found.',
      });
    }
    if (meetingRows[0].status !== 'completed') {
      throw new BadRequestException({
        code: 'MEETING_NOT_ENDED',
        message: 'Chi duoc upload audio track sau khi cuoc hop da ket thuc.',
      });
    }

    const participantRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        'SELECT id FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2',
        [meetingId, userId],
      );
    if (!participantRows || participantRows.length === 0) {
      throw new ForbiddenException({
        code: 'NOT_A_PARTICIPANT',
        message: 'Ban khong phai la thanh vien cua cuoc hop nay.',
      });
    }

    const sessionRows: Array<{ id: string; meeting_id: string }> =
      await this.dataSource.manager.query(
        'SELECT id, meeting_id FROM recording_sessions WHERE id = $1',
        [sessionId],
      );
    if (
      !sessionRows ||
      sessionRows.length === 0 ||
      sessionRows[0].meeting_id !== meetingId
    ) {
      throw new NotFoundException({
        code: 'RECORDING_SESSION_NOT_FOUND',
        message:
          'Recording session not found or does not belong to this meeting.',
      });
    }

    const existingRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        `SELECT id FROM media_files
         WHERE recording_session_id = $1
           AND channel_user_id = $2
           AND file_type = 'audio'
           AND is_active = true
           AND deleted_at IS NULL`,
        [sessionId, userId],
      );
    if (existingRows && existingRows.length > 0) {
      throw new ConflictException({
        code: 'AUDIO_TRACK_ALREADY_EXISTS',
        message: 'Ban da upload audio track cho session nay roi.',
      });
    }

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_AUDIO_FILE',
        message: 'File audio rong hoac khong hop le.',
      });
    }
    const ext = path.extname(file.originalname).toLowerCase();
    if (!RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_FORMAT',
        message: `Dinh dang "${ext}" khong duoc ho tro. Chap nhan: ${RecordingSessionService.SUPPORTED_AUDIO_EXTENSIONS.join(', ')}`,
      });
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const durationSeconds = await this.probeUploadedAudioDuration(
      file.buffer,
      ext,
    );

    const saved = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      folder: `meetings/${meetingId}/sessions/${sessionId}/${userId}`,
    });
    const driver = this.storageService.getDriver();
    const bucket = this.storageService.getBucketName();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let mediaFileId: string;
    try {
      const insert = (await queryRunner.query(
        `INSERT INTO media_files
           (file_name, file_type, mime_type, storage_provider, storage_bucket, storage_key,
            recording_session_id, meeting_id, uploaded_by, channel_user_id,
            file_size_bytes, checksum, duration_seconds, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)
         RETURNING id`,
        [
          file.originalname,
          'audio',
          file.mimetype || 'application/octet-stream',
          driver,
          bucket,
          saved.storageKey,
          sessionId,
          meetingId,
          userId,
          userId,
          String(file.size),
          checksum,
          durationSeconds,
        ],
      )) as Array<{ id: string }>;
      mediaFileId = insert[0].id;

      await queryRunner.commitTransaction();
    } catch (e) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `uploadAudioTrack failed for meeting ${meetingId} user ${userId}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
      throw new InternalServerErrorException({
        code: 'AUDIO_TRACK_UPLOAD_FAILED',
        message: 'Failed to save uploaded audio track.',
      });
    } finally {
      await queryRunner.release();
    }

    return {
      mediaFileId,
      storageKey: saved.storageKey,
      channelUserId: userId,
      durationSeconds,
    };
  }

  /** Host/Organizer của meeting hoặc Business/System Admin — ngoài ra từ chối. */
  private async assertHostOrAdmin(
    meetingId: string,
    userId: string,
  ): Promise<void> {
    const hostRows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND participant_role = 'host'`,
      [meetingId, userId],
    );
    if (hostRows && hostRows.length > 0) return;

    const roleRows: Array<{ role_code: string }> =
      await this.dataSource.manager.query(
        `SELECT r.role_code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.is_active = true`,
        [userId],
      );
    const isAdmin = roleRows.some((r) =>
      ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'].includes(r.role_code),
    );
    if (!isAdmin) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message:
          'Chỉ Host/Organizer hoặc Admin được upload audio cho meeting này.',
      });
    }
  }

  /** Ghi buffer ra temp file để ffprobe đo duration (audio-only, best-effort), rồi xoá. */
  private async probeUploadedAudioDuration(
    buffer: Buffer,
    ext: string,
  ): Promise<number | null> {
    const tmpPath = path.join(os.tmpdir(), `audio-probe-${randomUUID()}${ext}`);
    try {
      fs.writeFileSync(tmpPath, buffer);
      return await probeAudioDuration(tmpPath);
    } catch {
      return null;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  /**
   * Chốt file recording → stopped: size + sha256 + duration + transaction
   * (INSERT media_files + UPDATE recording_session). Dùng chung bởi REC-003 (stopVideo)
   * và REC-004 reconcile. `recovered=true` thêm metadata recovered. Ném
   * InternalServerErrorException (RECORDING_STOP_FAILED) nếu transaction lỗi.
   */
  async finalizeFileToStopped(params: {
    sessionId: string;
    meetingId: string;
    storagePath: string;
    startedAt: Date;
    paused: number;
    userId: string | null;
    baseMetadata: Record<string, unknown>;
    recovered?: boolean;
  }): Promise<{
    stoppedAt: Date;
    durationSeconds: number;
    fileSizeBytes: string;
    mediaFileId: string;
  }> {
    const { sessionId, meetingId, storagePath, startedAt, paused, userId } =
      params;
    const stoppedAt = new Date();
    const wallClock = Math.max(
      0,
      Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000) - paused,
    );
    const fileSizeBytes = String(fs.statSync(storagePath).size);
    const checksum = await this.sha256Stream(storagePath);

    // REC-005: ffprobe best-effort → duration thật + metadata kỹ thuật; null → fallback wall-clock.
    const probe = await probeMedia(storagePath);
    const durationSeconds =
      probe?.durationSeconds && probe.durationSeconds > 0
        ? probe.durationSeconds
        : wallClock;

    // session metadata: giữ logic cũ (orphan_stop/recovered) — KHÔNG nhồi probe.
    const metadata = {
      ...params.baseMetadata,
      ...(params.recovered ? { recovered: true } : {}),
    };
    // media_files metadata: thêm probe (kỹ thuật) nếu ffprobe OK.
    const mediaMetadata = probe
      ? { ...metadata, probe: { ...probe, source: 'ffprobe' } }
      : metadata;
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
            file_size_bytes, checksum, duration_seconds, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
          JSON.stringify(mediaMetadata),
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
        `finalize failed for session ${sessionId}: ${
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

    return { stoppedAt, durationSeconds, fileSizeBytes, mediaFileId };
  }

  /**
   * REC-004 Phần A — đọc trạng thái phiên ghi (READ-ONLY, không đụng tiến trình/DB).
   * Live (recording & stopped_at null) → duration wall-clock + fs.stat size hiện tại.
   */
  async getStatus(
    meetingId: string,
    sessionId: string,
  ): Promise<{
    recordingSessionId: string;
    meetingId: string;
    sessionType: string;
    status: string;
    startedAt: string | Date;
    stoppedAt: string | Date | null;
    live: boolean;
    durationSeconds: number | null;
    fileSizeBytes: string | null;
    hasProcessHandle: boolean;
    errorMessage: string | null;
    captured: boolean;
  }> {
    const rows: Array<{
      id: string;
      meeting_id: string;
      session_type: string;
      status: string;
      started_at: string | Date;
      stopped_at: string | Date | null;
      paused_duration_seconds: number | null;
      storage_path: string | null;
      file_size_bytes: string | null;
      duration_seconds: number | null;
      error_message: string | null;
    }> = await this.dataSource.manager.query(
      `SELECT id, meeting_id, session_type, status, started_at, stopped_at,
              paused_duration_seconds, storage_path, file_size_bytes, duration_seconds,
              error_message
       FROM recording_sessions WHERE id = $1`,
      [sessionId],
    );
    const s = rows?.[0];
    if (!s || s.meeting_id !== meetingId) {
      throw new NotFoundException({
        code: 'RECORDING_SESSION_NOT_FOUND',
        message: 'Recording session not found.',
      });
    }

    const live =
      (s.status as RecordingSessionStatus) ===
        RecordingSessionStatus.RECORDING && s.stopped_at == null;

    let durationSeconds: number | null;
    let fileSizeBytes: string | null;
    if (live) {
      const startedAt = new Date(s.started_at);
      const paused = s.paused_duration_seconds ?? 0;
      durationSeconds = Math.max(
        0,
        Math.floor((Date.now() - startedAt.getTime()) / 1000) - paused,
      );
      fileSizeBytes =
        s.storage_path && fs.existsSync(s.storage_path)
          ? String(fs.statSync(s.storage_path).size)
          : null;
    } else {
      durationSeconds = s.duration_seconds ?? null;
      fileSizeBytes = s.file_size_bytes ?? null;
    }

    // REC-007: captured = đã ghi được byte? (live: file hiện>0; else: file_size_bytes>0).
    const captured = Number(fileSizeBytes ?? 0) > 0;

    return {
      recordingSessionId: s.id,
      meetingId: s.meeting_id,
      sessionType: s.session_type,
      status: s.status,
      startedAt: s.started_at,
      stoppedAt: s.stopped_at ?? null,
      live,
      durationSeconds,
      fileSizeBytes,
      hasProcessHandle: this.processManager.has(sessionId),
      errorMessage: s.error_message ?? null,
      captured,
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
