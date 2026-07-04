import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { maskSensitiveMetadata } from '../../../common/utils/masking.util.js';
import { OccupancyPersistenceService } from './occupancy-persistence.service.js';

interface IngestInput {
  headers: Record<string, unknown>;
  body: Record<string, unknown> | null;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  clientIp?: string;
}

interface DeviceRow {
  id: string;
  device_type: string;
  room_id: string | null;
  status: string;
  metadata_json: Record<string, unknown> | null;
}

/**
 * OccupancyIngestService (OCC-001 / UC-75) — nhận occupancy event từ Python Camera Service.
 *
 * Thứ tự (D-5): AUTH TRƯỚC RAW (sai auth → KHÔNG lưu raw, chống spam nguồn lạ) →
 * raw iot_device_events → validate → transaction(room_events + presence/usage + status) → WS best-effort → 202.
 * SEC: KHÔNG log token/hash. KHÔNG migration (DATA-01).
 */
@Injectable()
export class OccupancyIngestService {
  private readonly logger = new Logger(OccupancyIngestService.name);
  private static readonly TIME_SKEW_MS = 60 * 60 * 1000; // 1h.

  constructor(
    private readonly dataSource: DataSource,
    private readonly occupancyPersistence: OccupancyPersistenceService,
  ) {}

  async ingest(input: IngestInput): Promise<{ accepted: true }> {
    const body = input.body ?? {};

    // ── 1. AUTH (trước raw) ───────────────────────────────────────────────
    const deviceCode = this.extractValue(
      input.headers['x-device-code'],
      body['deviceCode'],
      input.query['device_code'],
      input.params['deviceCode'],
    );
    if (!deviceCode) {
      throw new BadRequestException({
        code: 'INVALID_OCCUPANCY_PAYLOAD',
        message: 'deviceCode is required.',
      });
    }

    const deviceRows: DeviceRow[] = await this.dataSource.manager.query(
      'SELECT id, device_type, room_id, status, metadata_json FROM iot_devices WHERE device_code = $1',
      [deviceCode],
    );
    const device = deviceRows?.[0];
    if (!device) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_FOUND',
        message: 'Device not found.',
      });
    }

    const token = this.extractValue(
      input.headers['x-callback-token'],
      body['callbackToken'],
      input.query['callback_token'],
      input.params['callbackToken'],
    );
    const storedHash = this.readTokenHash(device.metadata_json);
    if (!token || !storedHash) {
      throw new UnauthorizedException({
        code: 'INVALID_CALLBACK_TOKEN',
        message: 'Callback token is required.',
      });
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (tokenHash !== storedHash) {
      throw new UnauthorizedException({
        code: 'INVALID_CALLBACK_TOKEN',
        message: 'Invalid callback token.',
      });
    }

    // Nhận occupancy = bằng chứng device sống → chỉ chặn khi bị vô hiệu hóa chủ động.
    // offline (heartbeat trễ) / maintenance KHÔNG chặn.
    if (device.status === 'disabled') {
      throw new ForbiddenException({
        code: 'DEVICE_INACTIVE',
        message: 'Device is disabled.',
      });
    }

    const roomId = this.extractValue(body['roomId'], input.params['roomId']);
    if (!roomId) {
      throw new BadRequestException({
        code: 'INVALID_OCCUPANCY_PAYLOAD',
        message: 'roomId is required.',
      });
    }
    if (device.room_id !== roomId) {
      throw new ForbiddenException({
        code: 'DEVICE_ROOM_MISMATCH',
        message: 'Device is not assigned to this room.',
      });
    }

    // ── 2. RAW (sau auth) ─────────────────────────────────────────────────
    const meetingId = this.extractValue(body['meetingId']) ?? null;
    const eventType =
      this.extractValue(body['eventType']) ?? 'occupancy_detected';
    const eventTime = this.parseEventTime(body['eventTime']);

    // SEC-01: redact token khỏi raw lưu (mask key chứa token/secret/password).
    const redactedPayload = maskSensitiveMetadata(body) ?? {};
    await this.dataSource.manager.query(
      `INSERT INTO iot_device_events
         (device_id, room_id, meeting_id, event_type, payload_json, event_time)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        device.id,
        roomId,
        meetingId,
        eventType,
        JSON.stringify(redactedPayload),
        eventTime,
      ],
    );

    // ── 3. PARSE occupancyCount + confidence (validate count → persist, LOCKED-A) ──
    const rawCount = body['occupancyCount'];
    const occupancyCount =
      typeof rawCount === 'number' ? rawCount : Number(rawCount);
    const rawConfidence = body['confidence'];
    const confidence = typeof rawConfidence === 'number' ? rawConfidence : null;

    // ── 4. PERSIST (transaction + WS) — dùng chung OccupancyPersistenceService ──
    //    Validate count + room_events/presence/usage/status + WS nằm trong persist (LOCKED-A).
    await this.occupancyPersistence.persist({
      roomId,
      meetingId,
      occupancyCount,
      confidence,
      eventTime,
    });

    return { accepted: true };
  }

  /** Đọc camera_service_config.callback_token_hash (an toàn, KHÔNG cast lỏng). */
  private readTokenHash(
    meta: Record<string, unknown> | null,
  ): string | undefined {
    const cfg = meta?.['camera_service_config'];
    if (cfg && typeof cfg === 'object') {
      const hash = (cfg as Record<string, unknown>)['callback_token_hash'];
      if (typeof hash === 'string') return hash;
    }
    return undefined;
  }

  /** Lấy giá trị string đầu tiên không rỗng. */
  private extractValue(...candidates: unknown[]): string | undefined {
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim() !== '') return c.trim();
    }
    return undefined;
  }

  /** Parse eventTime; thiếu/sai/lệch xa server → now. */
  private parseEventTime(value: unknown): Date {
    if (typeof value === 'string') {
      const d = new Date(value);
      if (
        !Number.isNaN(d.getTime()) &&
        Math.abs(Date.now() - d.getTime()) <=
          OccupancyIngestService.TIME_SKEW_MS
      ) {
        return d;
      }
    }
    return new Date();
  }
}
