import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { NoShowConfigService } from './no-show-config.service.js';

interface MeetingPartyRow {
  organizer_id: string | null;
  host_id: string | null;
}

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
  snooze_until: Date | string | null;
}

const RETURN_COLS = `id, booking_id, meeting_id, room_id, detection_status, detected_at,
  warning_sent_at, released_at, resolved_by, resolution_status, note, evidence_json, snooze_until`;

const TERMINAL_STATUSES = ['resolved', 'dismissed', 'released'];
const ALLOWED_UPDATE_TARGETS = ['confirmed', 'dismissed', 'resolved'];
const SYSTEM_OWNED_STATUSES = ['warning_sent', 'released'];
/** [Việc B, tái đánh giá 2026-08-21] Nguồn hợp lệ để chuyển 'snoozed' — mirror dismissed cũ. */
const SNOOZE_SOURCE_STATUSES = ['risk', 'warning_sent'];

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
    private readonly authzRepo: AuthzReadRepository,
    private readonly noShowConfigService: NoShowConfigService,
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
          `meeting:${input.meetingId}`,
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

  /**
   * UC-42: cập nhật case (transition hợp lệ, không re-open terminal).
   *
   * [FIX 2026-08-09, Phần 5] Authorization CHUYỂN vào đây (route đã bỏ
   * PermissionsGuard/@RequirePermissions — xem no-show.controller.ts). Thứ tự BẮT BUỘC:
   * NOT_FOUND → TERMINAL (business rule, ĐỘC LẬP với authorization — case đã chốt thì
   * BẤT KỲ ai, kể cả organizer/host hợp lệ, đều bị chặn 400 y hệt nhau) → AUTHORIZATION
   * (permission cũ HOẶC dismiss+ownership mới) → validate detectionStatus → UPDATE.
   */
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

    // Không re-open case đã terminal (#31 không cho mở lại) — CHẠY TRƯỚC authorization,
    // KHÔNG bị nhánh dismiss-owner mới nhảy qua (R5.1 test case 6).
    if (TERMINAL_STATUSES.includes(current.detection_status)) {
      throw new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'No-show case is already finalized.',
      });
    }

    await this.assertAuthorized(current, dto, userId);

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
   * [Việc B, tái đánh giá 2026-08-21] "Tôi vẫn đến" — case chuyển 'snoozed' (KHÔNG
   * terminal, khác 'dismissed' cũ), gia hạn `snooze_until = now() + confirmExtensionMinutes`.
   * Dùng chung 1 đường (không tách route riêng) cho cả 3 nơi gọi: `InMeetingRoom.jsx`,
   * `NotificationBell.jsx` (qua PATCH /no-show-cases/:id — xem no-show.controller.ts),
   * và `NoShowConfirmController` (Việc B Hướng 2, in-process).
   *
   * Race 2 request gần như đồng thời (app + email cùng lúc): atomic
   * `UPDATE ... WHERE detection_status IN ('risk','warning_sent') RETURNING` — Postgres khoá
   * row trong lúc UPDATE, request thứ 2 chờ request thứ 1 commit rồi mới re-evaluate WHERE
   * trên row ĐÃ 'snoozed' → 0 row → tự nhiên rơi vào nhánh idempotent bên dưới, KHÔNG gia
   * hạn thêm lần 2.
   */
  async snooze(
    id: string,
    userId: string | null,
    note?: string,
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

    // Terminal thật (dismissed/released/resolved) → chặn y hệt update() — KHÔNG cho
    // "hồi sinh" case đã chốt bằng đường snooze. 'snoozed' KHÔNG nằm trong danh sách
    // này (không terminal) nên case đang snoozed lọt qua tới nhánh idempotent dưới.
    if (TERMINAL_STATUSES.includes(current.detection_status)) {
      throw new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'No-show case is already finalized.',
      });
    }

    await this.assertAuthorized(
      current,
      { detectionStatus: 'snoozed' },
      userId,
    );

    // Idempotent: đã snoozed từ trước (bấm lại trong app/email trong lúc còn hạn, hoặc
    // vừa thua race ở nhánh dưới) → trả nguyên trạng, KHÔNG gia hạn thêm.
    if (current.detection_status === 'snoozed') {
      return this.toResponse(current, { alreadySnoozed: true });
    }

    if (!SNOOZE_SOURCE_STATUSES.includes(current.detection_status)) {
      throw new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'No-show case is not eligible for snooze.',
      });
    }

    const { confirmExtensionMinutes } =
      await this.noShowConfigService.getValues();

    const updated: unknown = await this.dataSource.manager.query(
      `UPDATE no_show_cases SET
         detection_status = 'snoozed',
         snooze_until = now() + ($2::int * interval '1 minute'),
         note = COALESCE($3, note),
         resolved_by = COALESCE($4, resolved_by)
       WHERE id = $1 AND detection_status = ANY($5)
       RETURNING ${RETURN_COLS}`,
      [
        id,
        confirmExtensionMinutes,
        note ?? null,
        userId,
        SNOOZE_SOURCE_STATUSES,
      ],
    );
    const updatedRows = this.rowsOf(updated);
    if (updatedRows.length === 0) {
      // Thua race: trạng thái đổi giữa SELECT và UPDATE — đọc lại để trả đúng nhánh.
      const freshRows: NoShowRow[] = await this.dataSource.manager.query(
        `SELECT ${RETURN_COLS} FROM no_show_cases WHERE id = $1 LIMIT 1`,
        [id],
      );
      const fresh = freshRows[0];
      if (fresh?.detection_status === 'snoozed') {
        return this.toResponse(fresh, { alreadySnoozed: true });
      }
      throw new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'No-show case is already finalized.',
      });
    }

    return this.toResponse(this.firstRow(updated), {
      alreadySnoozed: false,
      extensionMinutes: confirmExtensionMinutes,
    });
  }

  /**
   * [FIX 2026-08-09, Phần 5] Authorization cho update() — mirror ĐÚNG check
   * PermissionsGuard từng làm (cùng repo `AuthzReadRepository.getEffectiveRolesAndPermissions`,
   * cùng shape ForbiddenException) cho MỌI transition — hành vi cũ giữ nguyên 100% khi user
   * CÓ `room.noshow.update`.
   *
   * CHỈ khi KHÔNG có permission đó, mở thêm 1 lối thoát HẸP: `dto.detectionStatus ===
   * 'dismissed'` (KHÔNG áp dụng cho 'confirmed'/'resolved') VÀ userId khớp organizer_id
   * HOẶC host_id của meeting liên quan (join qua current.meeting_id → meetings, mirror
   * ĐÚNG pattern notifyNoShow() ở no-show-lifecycle.service.ts:352-354).
   *
   * [Việc B, tái đánh giá 2026-08-21] Lối thoát hẹp này MỞ RỘNG thêm 'snoozed' —
   * cùng điều kiện sở hữu (organizer/host), khác 'dismissed' chỉ ở việc case KHÔNG
   * terminal ngay (xem snooze()).
   */
  private async assertAuthorized(
    current: NoShowRow,
    dto: { detectionStatus?: string },
    userId: string | null,
  ): Promise<void> {
    const forbidden = (): ForbiddenException =>
      new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: { code: 'FORBIDDEN', details: {} },
      });

    if (!userId) throw forbidden();

    const { permissions } =
      await this.authzRepo.getEffectiveRolesAndPermissions(userId);
    if (permissions.includes('room.noshow.update')) return;

    if (
      dto.detectionStatus === 'dismissed' ||
      dto.detectionStatus === 'snoozed'
    ) {
      const meetingRows: MeetingPartyRow[] =
        await this.dataSource.manager.query(
          `SELECT organizer_id, host_id FROM meetings WHERE id = $1 LIMIT 1`,
          [current.meeting_id],
        );
      const m = meetingRows?.[0];
      if (m && (m.organizer_id === userId || m.host_id === userId)) {
        return;
      }
    }

    throw forbidden();
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

  /** Mirror NoShowLifecycleService#rowsOf — chuẩn hoá `[rows, affectedCount]` → `rows`. */
  private rowsOf<T>(result: unknown): T[] {
    if (Array.isArray(result)) {
      const head: unknown = result[0];
      if (Array.isArray(head)) return head as T[];
      return result as T[];
    }
    return [];
  }

  private toResponse(
    row: NoShowRow,
    snoozeMeta?: { alreadySnoozed: boolean; extensionMinutes?: number },
  ): Record<string, unknown> {
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
      snoozeUntil: row.snooze_until,
      ...(snoozeMeta ? { alreadySnoozed: snoozeMeta.alreadySnoozed } : {}),
      ...(snoozeMeta?.extensionMinutes !== undefined
        ? { extensionMinutes: snoozeMeta.extensionMinutes }
        : {}),
    };
  }
}
