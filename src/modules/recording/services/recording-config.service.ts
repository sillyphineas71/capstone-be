import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  RecordingConfigEntity,
  RecordingConfigStatus,
} from '../entities/recording-config.entity.js';
import { CreateRecordingConfigDto } from '../dto/create-recording-config.dto.js';
import { UpdateRecordingConfigDto } from '../dto/update-recording-config.dto.js';
import {
  toRecordingConfigResponse,
  RecordingConfigResponseDto,
} from '../dto/recording-config-response.dto.js';
import { RecordingConfigAuditRepository } from '../repositories/recording-config-audit.repository.js';

@Injectable()
export class RecordingConfigService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditRepo: RecordingConfigAuditRepository,
  ) {}

  async create(
    meetingId: string,
    dto: CreateRecordingConfigDto,
    userId: string | null,
  ): Promise<RecordingConfigResponseDto> {
    // 1. Meeting tồn tại (read-only raw query, không import MeetingsModule).
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

    // 2. 1:1 — đã có config?
    const existing = await this.dataSource.manager.findOne(
      RecordingConfigEntity,
      { where: { meetingId } },
    );
    if (existing) {
      throw new ConflictException({
        code: 'RECORDING_CONFIG_EXISTS',
        message: 'Recording config already exists for this meeting.',
      });
    }

    // 3. Validate videoSourceDeviceId (nếu có).
    if (dto.videoSourceDeviceId) {
      await this.assertIpCamera(dto.videoSourceDeviceId);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const config = queryRunner.manager.create(RecordingConfigEntity, {
        meetingId,
        enableAudio: dto.enableAudio ?? false,
        enableVideo: dto.enableVideo ?? false,
        enableTranscription: dto.enableTranscription ?? false,
        videoSourceDeviceId: dto.videoSourceDeviceId ?? null,
        audioSourceMode: dto.audioSourceMode ?? null,
        autoStart: dto.autoStart ?? false,
        consentRequired: dto.consentRequired ?? true,
        retentionDays: dto.retentionDays ?? null,
        status: RecordingConfigStatus.DRAFT,
        configuredBy: userId,
        configuredAt: new Date(),
      });

      const saved = await queryRunner.manager.save(
        RecordingConfigEntity,
        config,
      );

      await this.auditRepo.logConfigChange(queryRunner.manager, {
        userId,
        configId: saved.id,
        action: 'create',
      });

      await queryRunner.commitTransaction();
      return toRecordingConfigResponse(saved);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findOne(meetingId: string): Promise<RecordingConfigResponseDto> {
    const config = await this.dataSource.manager.findOne(
      RecordingConfigEntity,
      { where: { meetingId } },
    );
    if (!config) {
      throw new NotFoundException({
        code: 'RECORDING_CONFIG_NOT_FOUND',
        message: 'Recording config not found for this meeting.',
      });
    }
    return toRecordingConfigResponse(config);
  }

  async update(
    meetingId: string,
    dto: UpdateRecordingConfigDto,
    userId: string | null,
  ): Promise<RecordingConfigResponseDto> {
    const config = await this.dataSource.manager.findOne(
      RecordingConfigEntity,
      { where: { meetingId } },
    );
    if (!config) {
      throw new NotFoundException({
        code: 'RECORDING_CONFIG_NOT_FOUND',
        message: 'Recording config not found for this meeting.',
      });
    }

    // Guard "đang ghi": có recording_session active cho meeting?
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
        code: 'RECORDING_IN_PROGRESS',
        message: 'Cannot update config while recording is in progress.',
      });
    }

    if (dto.videoSourceDeviceId) {
      await this.assertIpCamera(dto.videoSourceDeviceId);
    }

    // Build updates: chỉ field hiện diện (!== undefined).
    const FIELDS = [
      'enableAudio',
      'enableVideo',
      'enableTranscription',
      'videoSourceDeviceId',
      'audioSourceMode',
      'autoStart',
      'consentRequired',
      'retentionDays',
    ] as const;
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const updates: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const newVal = dto[f];
      if (newVal === undefined) continue;
      const oldVal = config[f];
      if (newVal !== oldVal) {
        changes[f] = { old: oldVal ?? null, new: newVal ?? null };
        updates[f] = newVal;
      }
    }

    // Idempotent: không thay đổi thực → 200, không ghi/audit.
    if (Object.keys(changes).length === 0) {
      return toRecordingConfigResponse(config);
    }

    Object.assign(config, updates);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      config.configuredBy = userId;
      config.configuredAt = new Date();
      const saved = await queryRunner.manager.save(
        RecordingConfigEntity,
        config,
      );

      await this.auditRepo.logConfigChange(queryRunner.manager, {
        userId,
        configId: saved.id,
        action: 'update',
        changes,
      });

      await queryRunner.commitTransaction();
      return toRecordingConfigResponse(saved);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /** videoSourceDeviceId phải là ip_camera tồn tại; không thì 400. */
  private async assertIpCamera(deviceId: string): Promise<void> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      "SELECT id FROM iot_devices WHERE id = $1 AND device_type = 'ip_camera'",
      [deviceId],
    );
    if (!rows || rows.length === 0) {
      throw new BadRequestException({
        code: 'INVALID_VIDEO_SOURCE_DEVICE',
        message: 'videoSourceDeviceId must reference an existing ip_camera.',
      });
    }
  }
}
