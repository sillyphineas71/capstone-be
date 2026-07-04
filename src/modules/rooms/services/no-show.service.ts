import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebsocketService } from '../../websocket/websocket.service.js';

export interface CreateNoShowInput {
  bookingId: string;
  meetingId: string;
  roomId: string;
  detectionStatus?: 'risk' | 'confirmed';
  evidenceJson?: Record<string, unknown>;
}

interface NoShowRow {
  id: string;
  booking_id: string;
  meeting_id: string;
  room_id: string;
  detection_status: string;
  detected_at: Date | string;
  warning_sent_at: Date | string | null;
  released_at: Date | string | null;
  resolved_by: string | null;
  resolution_status: string | null;
  note: string | null;
  evidence_json: Record<string, unknown> | null;
}

const RETURN_COLS = `id, booking_id, meeting_id, room_id, detection_status, detected_at,
  warning_sent_at, released_at, resolved_by, resolution_status, note, evidence_json`;

const TERMINAL_STATUSES = ['resolved', 'dismissed', 'released'];
const ALLOWED_UPDATE_TARGETS = ['confirmed', 'dismissed', 'resolved'];
const SYSTEM_OWNED_STATUSES = ['warning_sent', 'released'];

/**
 * NoShowService (NSC-001 / UC-41+42) — tạo (idempotent) + cập nhật no-show case.
 *
 * SEC-03: raw SQL parameterized. SEC-01: evidence_json KHÔNG chứa token/secret.
 * DATA-01: dùng no_show_cases entity as-is; KHÔNG migration. WS best-effort (NC-5).
 */
@Injectable()
export class NoShowService {
  private readonly logger = new Logger(NoShowService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
  ) {}

  /**
   * UC-41: tạo no-show case idempotent per-booking (NC-4).
   * Atomic INSERT ... WHERE NOT EXISTS; 0 row → trả case hiện có (created=false).
   */
  async create(
    input: CreateNoShowInput,
  ): Promise<{ case: NoShowRow; created: boolean }> {
    const detectionStatus = input.detectionStatus ?? 'risk';

    const inserted: NoShowRow[] = await this.dataSource.manager.query(
      `INSERT INTO no_show_cases
         (booking_id, meeting_id, room_id, detection_status, evidence_json, detected_at)
       SELECT $1, $2, $3, $4, $5::jsonb, now()
       WHERE NOT EXISTS (SELECT 1 FROM no_show_cases WHERE booking_id = $1)
       RETURNING ${RETURN_COLS}`,
      [
        input.bookingId,
        input.meetingId,
        input.roomId,
        detectionStatus,
        input.evidenceJson ? JSON.stringify(input.evidenceJson) : null,
      ],
    );

    if (inserted.length > 0) {
      const row = inserted[0];
      // WS best-effort — CHỈ khi thật sự insert (NC-5); lỗi WS KHÔNG fail create.
      try {
        this.websocketService.emitToRoom(
          `room:${input.roomId}`,
          'meeting.noshow.alert',
          {
            meetingId: input.meetingId,
            roomId: input.roomId,
            noShowCaseId: row.id,
            timestamp: new Date().toISOString(),
          },
        );
      } catch (e) {
        this.logger.warn(
          `WS emit meeting.noshow.alert failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
      return { case: row, created: true };
    }

    // Đã tồn tại → trả case cũ (idempotent, KHÔNG emit).
    const existing: NoShowRow[] = await this.dataSource.manager.query(
      `SELECT ${RETURN_COLS} FROM no_show_cases WHERE booking_id = $1 LIMIT 1`,
      [input.bookingId],
    );
    return { case: existing[0], created: false };
  }

  /**
   * GET list no-show cases (phân trang + lọc status/roomId) cho bảng giám sát FE.
   * SEC-03: raw SQL parameterized. LEFT JOIN rooms để lấy room_name (nullable-safe).
   * Chỉ trả field có thật trong entity (no_show_cases KHÔNG có created_at → dùng detected_at).
   */
  async list(filter: {
    status?: string;
    roomId?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    items: Array<Record<string, unknown>>;
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`n.detection_status = $${params.length}`);
    }
    if (filter.roomId) {
      params.push(filter.roomId);
      conditions.push(`n.room_id = $${params.length}`);
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const countRows: Array<{ total: number }> =
      await this.dataSource.manager.query(
        `SELECT COUNT(*)::int AS total FROM no_show_cases n ${whereClause}`,
        params,
      );
    const total = countRows[0]?.total ?? 0;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const rows: Array<{
      id: string;
      room_id: string;
      room_name: string | null;
      meeting_id: string;
      detection_status: string;
      detected_at: Date | string;
      warning_sent_at: Date | string | null;
      released_at: Date | string | null;
    }> = await this.dataSource.manager.query(
      `SELECT n.id, n.room_id, r.room_name, n.meeting_id, n.detection_status,
              n.detected_at, n.warning_sent_at, n.released_at
       FROM no_show_cases n
       LEFT JOIN rooms r ON r.id = n.room_id
       ${whereClause}
       ORDER BY n.detected_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, limit, offset],
    );

    const items = rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      roomName: row.room_name,
      meetingId: row.meeting_id,
      status: row.detection_status,
      detectedAt: row.detected_at,
      warningSentAt: row.warning_sent_at,
      releasedAt: row.released_at,
    }));

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  /** UC-42: cập nhật case (transition hợp lệ, không re-open terminal). */
  async update(
    id: string,
    dto: {
      detectionStatus?: string;
      resolutionStatus?: string;
      note?: string;
    },
    userId: string | null,
  ): Promise<Record<string, unknown>> {
    const rows: NoShowRow[] = await this.dataSource.manager.query(
      `SELECT ${RETURN_COLS} FROM no_show_cases WHERE id = $1 LIMIT 1`,
      [id],
    );
    const current = rows?.[0];
    if (!current) {
      throw new NotFoundException({
        code: 'NO_SHOW_CASE_NOT_FOUND',
        message: 'No-show case not found.',
      });
    }

    // Không re-open case đã terminal (#31 không cho mở lại).
    if (TERMINAL_STATUSES.includes(current.detection_status)) {
      throw new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'No-show case is already finalized.',
      });
    }

    if (dto.detectionStatus !== undefined) {
      if (SYSTEM_OWNED_STATUSES.includes(dto.detectionStatus)) {
        throw new BadRequestException({
          code: 'INVALID_NO_SHOW_TRANSITION',
          message: 'warning_sent/released are set by the system.',
        });
      }
      if (!ALLOWED_UPDATE_TARGETS.includes(dto.detectionStatus)) {
        throw new BadRequestException({
          code: 'INVALID_DETECTION_STATUS',
          message: 'detectionStatus must be confirmed, dismissed, or resolved.',
        });
      }
    }

    const resolving =
      dto.resolutionStatus !== undefined ||
      dto.detectionStatus === 'dismissed' ||
      dto.detectionStatus === 'resolved';
    const resolvedBy = resolving ? userId : null;

    const updated: unknown = await this.dataSource.manager.query(
      `UPDATE no_show_cases SET
         detection_status = COALESCE($2, detection_status),
         resolution_status = COALESCE($3, resolution_status),
         note = COALESCE($4, note),
         resolved_by = COALESCE($5, resolved_by)
       WHERE id = $1
       RETURNING ${RETURN_COLS}`,
      [
        id,
        dto.detectionStatus ?? null,
        dto.resolutionStatus ?? null,
        dto.note ?? null,
        resolvedBy,
      ],
    );

    return this.toResponse(this.firstRow(updated));
  }

  /**
   * Postgres `UPDATE ... RETURNING` qua TypeORM có thể trả `[rows, affectedCount]`
   * thay vì `rows` (khác INSERT). Chuẩn hoá lấy row đầu cho cả 2 shape.
   */
  private firstRow(result: unknown): NoShowRow {
    if (Array.isArray(result)) {
      const head: unknown = result[0];
      if (Array.isArray(head)) return head[0] as NoShowRow;
      return head as NoShowRow;
    }
    return result as NoShowRow;
  }

  private toResponse(row: NoShowRow): Record<string, unknown> {
    return {
      id: row.id,
      bookingId: row.booking_id,
      meetingId: row.meeting_id,
      roomId: row.room_id,
      detectionStatus: row.detection_status,
      detectedAt: row.detected_at,
      warningSentAt: row.warning_sent_at,
      releasedAt: row.released_at,
      resolvedBy: row.resolved_by,
      resolutionStatus: row.resolution_status,
      note: row.note,
      evidenceJson: row.evidence_json,
    };
  }
}
