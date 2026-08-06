import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';
import { NoShowConfigService } from './no-show-config.service.js';
import { buildNoShowAlertEmail } from '../../mail/templates/builders.js';

interface CaseRef {
  id: string;
  booking_id: string;
  meeting_id: string;
  room_id: string;
}

interface ReleaseTargetRow {
  booking_id: string;
  meeting_id: string;
  room_id: string;
}

interface IdRow {
  id: string;
}

interface MeetingPartyRow {
  organizer_id: string | null;
  host_id: string | null;
}

interface EmailRow {
  email: string | null;
}

interface CaseStatusRow {
  id: string;
  detection_status: string;
}

export interface ReleaseParams {
  caseId: string;
  actor: string | null; // null = system (auto), uuid = admin (manual)
  reason: string;
  mode: 'auto' | 'manual';
}

export type ReleaseResult = {
  released: boolean;
  skipped?: 'already_released' | 'booking_changed';
};

/**
 * NoShowLifecycleService (NSL-001 #32/#33/#33b) — chuyển trạng thái no-show.
 *
 * reconcilePresence (R1): non-terminal có presence → resolved/kept (KHÔNG release).
 * warnBatch (#32): risk + no presence + đủ grace → warning_sent + notify (idempotent).
 * release (§4 dùng chung auto+manual): 1 transaction, guard rows-affected (case + booking).
 * autoReleaseBatch (#33): warning_sent quá deadline → release(auto).
 * manualRelease (#33b): pre-check 404/400 + map skip → 200/409.
 *
 * SEC-03 bind raw-SQL. ARCH-01 KHÔNG mutate rooms/meetings. SEC-01 notify/audit metadata-only.
 */
@Injectable()
export class NoShowLifecycleService {
  private readonly logger = new Logger(NoShowLifecycleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly websocketService: WebsocketService,
    private readonly notificationsService: NotificationsService,
    private readonly noShowConfigService: NoShowConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  // ── R1: reconcile presence ────────────────────────────────────────────────
  /** Non-terminal (risk|warning_sent) có first_presence_at → resolved/kept. */
  async reconcilePresence(): Promise<{ scanned: number; resolved: number }> {
    const result: unknown = await this.dataSource.manager.query(
      `UPDATE no_show_cases nc
          SET detection_status = 'resolved',
              resolution_status = 'kept',
              note = COALESCE(nc.note, 'presence detected; not a no-show')
         FROM room_booking_usages u
        WHERE u.booking_id = nc.booking_id
          AND u.first_presence_at IS NOT NULL
          AND nc.detection_status IN ('risk','warning_sent')
        RETURNING nc.id`,
    );
    const n = this.rowsOf<IdRow>(result).length;
    return { scanned: n, resolved: n };
  }

  // ── #32: warn ─────────────────────────────────────────────────────────────
  /** risk + no presence + (now ≥ detected_at + warning_grace) → warning_sent + notify. */
  async warnBatch(): Promise<{ scanned: number; warned: number }> {
    // E (chỉnh): fetch config 1 lần lấy cả warning_grace + auto_release_grace.
    const { warningGraceMinutes, autoReleaseGraceMinutes } =
      await this.noShowConfigService.getValues();

    const candidates: CaseRef[] = await this.dataSource.manager.query(
      `SELECT nc.id, nc.booking_id, nc.meeting_id, nc.room_id
         FROM no_show_cases nc
         JOIN room_bookings b ON b.id = nc.booking_id
         LEFT JOIN room_booking_usages u ON u.booking_id = nc.booking_id
        WHERE nc.detection_status = 'risk'
          AND b.status IN ('approved','active')
          AND u.first_presence_at IS NULL
          AND nc.detected_at + ($1::int * interval '1 minute') <= now()`,
      [warningGraceMinutes],
    );

    let warned = 0;
    for (const cand of candidates) {
      try {
        // Idempotent: chỉ chuyển khi vẫn 'risk' (race-safe giữa tick/instance).
        const upd: unknown = await this.dataSource.manager.query(
          `UPDATE no_show_cases
              SET detection_status = 'warning_sent',
                  warning_sent_at = now(),
                  warning_deadline_at = now() + ($2::int * interval '1 minute'),
                  auto_release_eligible_at = now() + ($2::int * interval '1 minute')
            WHERE id = $1 AND detection_status = 'risk'
            RETURNING id`,
          [cand.id, autoReleaseGraceMinutes],
        );
        if (this.rowsOf<IdRow>(upd).length === 0) continue; // đã warn ở tick khác
        warned++;
        await this.notifyNoShow(cand, 'warning');
      } catch (e) {
        this.logger.error(`warn case ${cand.id} failed: ${this.errMsg(e)}`);
      }
    }
    return { scanned: candidates.length, warned };
  }

  // ── §4: release dùng chung (auto + manual) ────────────────────────────────
  async release(params: ReleaseParams): Promise<ReleaseResult> {
    const { caseId, actor, reason, mode } = params;
    const isAuto = mode === 'auto';
    const resolutionStatus = isAuto ? 'released' : 'manual_override';
    // Nguồn hợp lệ: auto chỉ từ warning_sent; manual từ risk|warning_sent.
    const validSources = isAuto ? ['warning_sent'] : ['risk', 'warning_sent'];

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // B (chỉnh): UPDATE ... RETURNING lấy rows-affected + ids trong 1 query.
      const caseUpd: unknown = await queryRunner.manager.query(
        `UPDATE no_show_cases
            SET detection_status = 'released',
                resolution_status = $2,
                released_at = now(),
                resolved_by = $3,
                note = COALESCE($4, note)
          WHERE id = $1 AND detection_status = ANY($5)
          RETURNING booking_id, meeting_id, room_id`,
        [caseId, resolutionStatus, actor, reason, validSources],
      );
      const caseRows = this.rowsOf<ReleaseTargetRow>(caseUpd);
      if (caseRows.length === 0) {
        // R2: 0 row → đã released/transition khác → chống double-release.
        await queryRunner.rollbackTransaction();
        return { released: false, skipped: 'already_released' };
      }
      const { booking_id, meeting_id, room_id } = caseRows[0];

      // OQ-1 guard: chỉ release booking đang approved/active; 0 row → abort.
      const bookingUpd: unknown = await queryRunner.manager.query(
        `UPDATE room_bookings
            SET status = 'released', cancellation_reason = $2
          WHERE id = $1 AND status IN ('approved','active')
          RETURNING id`,
        [booking_id, reason],
      );
      if (this.rowsOf<IdRow>(bookingUpd).length === 0) {
        await queryRunner.rollbackTransaction();
        return { released: false, skipped: 'booking_changed' };
      }

      // OQ-5: mutate-if-exists (booking_id UNIQUE → ≤1 row).
      const usageUpd: unknown = await queryRunner.manager.query(
        `UPDATE room_booking_usages
            SET usage_status = 'released', auto_released = $2, released_by = $3,
                released_at = now(), release_reason = $4
          WHERE booking_id = $1
          RETURNING id`,
        [booking_id, isAuto, actor, reason],
      );
      const usageMutated = this.rowsOf<IdRow>(usageUpd).length > 0;

      // room_events: T0 — cột là description (không 'reason'); source_type NOT NULL.
      await queryRunner.manager.query(
        `INSERT INTO room_events
           (room_id, meeting_id, booking_id, event_type, source_type, actor_user_id, description, metadata_json)
         VALUES ($1, $2, $3, $4, 'system', $5, $6, $7::jsonb)`,
        [
          room_id,
          meeting_id,
          booking_id,
          isAuto ? 'room_auto_released' : 'room_manual_released',
          actor,
          reason,
          JSON.stringify({ noShowCaseId: caseId, usageMutated }),
        ],
      );

      await queryRunner.commitTransaction();

      // Sau commit (best-effort): notify + (manual) audit.
      await this.notifyNoShow(
        { id: caseId, booking_id, meeting_id, room_id },
        'released',
      );
      if (mode === 'manual') {
        await this.auditLogsService.logAction({
          userId: actor ?? undefined,
          actionType: 'no_show_manual_release',
          entityType: 'no_show_case',
          entityId: caseId,
          severity: AuditLogSeverity.WARNING,
          metadataJson: { bookingId: booking_id, roomId: room_id, reason },
        });
      }
      return { released: true };
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  // ── #33: auto-release batch ───────────────────────────────────────────────
  async autoReleaseBatch(): Promise<{
    scanned: number;
    released: number;
    skipped: number;
  }> {
    // F3: đọc flag 1 lần/batch (NC-2 pattern). false → skip toàn bộ, không mutate.
    const { autoReleaseEnabled } = await this.noShowConfigService.getValues();
    if (!autoReleaseEnabled) {
      return { scanned: 0, released: 0, skipped: 0 };
    }

    const candidates: IdRow[] = await this.dataSource.manager.query(
      `SELECT nc.id
         FROM no_show_cases nc
         JOIN room_bookings b ON b.id = nc.booking_id
         LEFT JOIN room_booking_usages u ON u.booking_id = nc.booking_id
        WHERE nc.detection_status = 'warning_sent'
          AND nc.auto_release_eligible_at IS NOT NULL
          AND nc.auto_release_eligible_at <= now()
          AND b.status IN ('approved','active')
          AND u.first_presence_at IS NULL`,
    );

    let released = 0;
    let skipped = 0;
    for (const cand of candidates) {
      try {
        // C (chỉnh): reason='auto_release_no_show'.
        const r = await this.release({
          caseId: cand.id,
          actor: null,
          reason: 'auto_release_no_show',
          mode: 'auto',
        });
        if (r.released) released++;
        else skipped++;
      } catch (e) {
        skipped++;
        this.logger.error(
          `auto-release case ${cand.id} failed: ${this.errMsg(e)}`,
        );
      }
    }
    return { scanned: candidates.length, released, skipped };
  }

  // ── #33b: manual release (pre-check + map skip) ───────────────────────────
  async manualRelease(
    id: string,
    reason: string,
    adminId: string | null,
  ): Promise<Record<string, unknown>> {
    const rows: CaseStatusRow[] = await this.dataSource.manager.query(
      `SELECT id, detection_status FROM no_show_cases WHERE id = $1 LIMIT 1`,
      [id],
    );
    const current = rows[0];
    if (!current) {
      throw new NotFoundException({
        code: 'NO_SHOW_CASE_NOT_FOUND',
        message: 'No-show case not found.',
      });
    }
    // A (chỉnh): đã released → 200 no-op.
    if (current.detection_status === 'released') {
      return { noShowCaseId: id, detectionStatus: 'released', released: false };
    }
    // dismissed|resolved → 400.
    if (
      current.detection_status === 'dismissed' ||
      current.detection_status === 'resolved'
    ) {
      throw new BadRequestException({
        code: 'INVALID_NO_SHOW_TRANSITION',
        message: 'Cannot release a dismissed/resolved case.',
      });
    }

    const r = await this.release({
      caseId: id,
      actor: adminId,
      reason,
      mode: 'manual',
    });
    // A (chỉnh): map giá trị trả về.
    if (r.skipped === 'already_released') {
      return { noShowCaseId: id, detectionStatus: 'released', released: false };
    }
    if (r.skipped === 'booking_changed') {
      throw new ConflictException({
        code: 'BOOKING_NOT_RELEASABLE',
        message: 'Booking is no longer releasable (status changed).',
      });
    }
    return { noShowCaseId: id, detectionStatus: 'released', released: true };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  /** D (chỉnh): recipientScope user_list + dedupe organizer/host + bỏ null. */
  private async notifyNoShow(
    c: CaseRef,
    kind: 'warning' | 'released',
  ): Promise<void> {
    try {
      const meetingRows: MeetingPartyRow[] =
        await this.dataSource.manager.query(
          `SELECT organizer_id, host_id FROM meetings WHERE id = $1 LIMIT 1`,
          [c.meeting_id],
        );
      const m = meetingRows[0];
      if (!m) return;
      const recipientUserIds = Array.from(
        new Set([m.organizer_id, m.host_id].filter((x): x is string => !!x)),
      );
      if (recipientUserIds.length === 0) return;

      const subject =
        kind === 'warning'
          ? 'Cảnh báo no-show'
          : 'Phòng đã giải phóng (no-show)';
      const content =
        kind === 'warning'
          ? `Phòng chưa có người sau giờ bắt đầu — cảnh báo no-show (room ${c.room_id}).`
          : `Phòng đã được giải phóng do no-show (room ${c.room_id}).`;
      const meta = {
        noShowCaseId: c.id,
        bookingId: c.booking_id,
        meetingId: c.meeting_id,
        roomId: c.room_id,
        kind,
      };

      await this.notificationsService.createNotification({
        notificationType: NotificationType.NO_SHOW_ALERT,
        channel: NotificationChannel.IN_APP,
        subject,
        content,
        recipientScope: 'user_list',
        recipientUserIds,
        relatedEntityType: 'no_show_case',
        relatedEntityId: c.id,
        payloadJson: meta,
      });

      try {
        this.websocketService.emitToRoom(
          `room:${c.room_id}`,
          'meeting.noshow.alert',
          meta,
        );
      } catch (e) {
        this.logger.warn(`WS emit noshow failed: ${this.errMsg(e)}`);
      }

      const emailEnabled = this.configService.get<boolean>(
        'NO_SHOW_ALERT_EMAIL_ENABLED',
        false,
      );
      if (emailEnabled) {
        const emailRows: EmailRow[] = await this.dataSource.manager.query(
          `SELECT email FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
          [recipientUserIds],
        );
        const toEmails = emailRows
          .map((r) => r.email)
          .filter((e): e is string => !!e);
        if (toEmails.length > 0) {
          await this.notificationsService.enqueueEmailNotification({
            notificationType: NotificationType.NO_SHOW_ALERT,
            channel: NotificationChannel.EMAIL,
            subject,
            content,
            emailHtml: buildNoShowAlertEmail({ kind, roomId: c.room_id }),
            toEmails,
            payloadJson: meta,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`notifyNoShow ${c.id} failed: ${this.errMsg(e)}`);
    }
  }

  /** UPDATE…RETURNING qua TypeORM trả [rows,count]; SELECT/INSERT trả rows. Chuẩn hoá. */
  private rowsOf<T>(result: unknown): T[] {
    if (Array.isArray(result)) {
      const head: unknown = result[0];
      if (Array.isArray(head)) return head as T[];
      return result as T[];
    }
    return [];
  }

  private errMsg(e: unknown): string {
    return e instanceof Error ? e.message : 'unknown';
  }
}
