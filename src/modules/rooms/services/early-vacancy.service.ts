import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { EarlyVacancyConfigService } from './early-vacancy-config.service.js';
import { buildEarlyVacancyAlertEmail } from '../../mail/templates/builders.js';

interface CandidateRow {
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

interface RoomNameRow {
  room_name: string | null;
}

interface EmailRow {
  email: string | null;
}

/**
 * EarlyVacancyService (EVD-001 #34) — phát hiện phòng trống sớm khi họp ĐÃ bắt đầu.
 *
 * Hướng A (flag-only): usage_status='early_empty' + room_event + notify.
 * KHÔNG đụng room_bookings / rooms / meetings (ARCH-01).
 *
 * R-EVD-1 "trống" = có reading FRESH (≤ empty_minutes) + reading mới nhất=0 + không count>0
 * trong empty_minutes. Reading cũ (camera chết/mất tín hiệu) → KHÔNG flag.
 * N1: empty_minutes vừa là ngưỡng trống vừa là freshness bound; nên ≥ nhịp snapshot camera
 *     (camera gửi thưa hơn empty_minutes → false-negative an toàn, KHÔNG false-positive).
 * N2 (known-gap): KHÔNG un-flag khi người quay lại sau early_empty (occupancy-ingest không revert).
 *
 * SEC-03 bind raw-SQL. ARCH-02: cron gọi detect() try/catch mỗi booking, không throw ra cron.
 */
@Injectable()
export class EarlyVacancyService {
  private readonly logger = new Logger(EarlyVacancyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly websocketService: WebsocketService,
    private readonly notificationsService: NotificationsService,
    private readonly earlyVacancyConfigService: EarlyVacancyConfigService,
  ) {}

  /** Quét booking đang-họp + phòng trống sớm → flag. Trả số liệu cho cron log. */
  async detect(): Promise<{ scanned: number; flagged: number }> {
    const { emptyMinutes, minRemainingMinutes, minElapsedMinutes } =
      await this.earlyVacancyConfigService.getValues();

    // OQ-7 disjoint no-show: first_presence_at IS NOT NULL (đã từng có người).
    // R-EVD-1: nguồn trống = time-series presence_snapshots.occupancy_count.
    const candidates: CandidateRow[] = await this.dataSource.manager.query(
      `SELECT u.booking_id, u.meeting_id, u.room_id
         FROM room_booking_usages u
         JOIN room_bookings b ON b.id = u.booking_id
         LEFT JOIN LATERAL (
           SELECT MAX(ps.snapshot_time) FILTER (WHERE ps.occupancy_count > 0) AS last_pos,
                  MAX(ps.snapshot_time)                                       AS last_any,
                  (ARRAY_AGG(ps.occupancy_count ORDER BY ps.snapshot_time DESC))[1] AS latest_count
             FROM presence_snapshots ps
            WHERE ps.meeting_id = u.meeting_id
         ) s ON true
        WHERE u.usage_status = 'in_use'
          AND u.first_presence_at IS NOT NULL
          AND b.status IN ('approved','active')
          AND u.reserved_end_time - now() >= ($1 * interval '1 minute')
          AND now() - u.first_presence_at >= ($2 * interval '1 minute')
          AND s.last_any IS NOT NULL
          AND s.last_any >= now() - ($3 * interval '1 minute')
          AND s.latest_count = 0
          AND (s.last_pos IS NULL OR s.last_pos <= now() - ($3 * interval '1 minute'))`,
      [minRemainingMinutes, minElapsedMinutes, emptyMinutes],
    );

    let flagged = 0;
    for (const cand of candidates) {
      try {
        const done = await this.flagBooking(cand, emptyMinutes);
        if (done) flagged++;
      } catch (e) {
        // ARCH-02: 1 booking lỗi KHÔNG chặn batch.
        this.logger.error(
          `early-vacancy flag failed for booking ${cand.booking_id}: ${this.errMsg(e)}`,
        );
      }
    }
    return { scanned: candidates.length, flagged };
  }

  /**
   * Hướng A: usage in_use→early_empty (guard idempotent) + room_event. 1 transaction.
   * Trả false nếu 0 row (đã xử lý / không còn in_use).
   */
  private async flagBooking(
    cand: CandidateRow,
    emptyMinutes: number,
  ): Promise<boolean> {
    const detectedAt = new Date().toISOString();
    const usageMeta = JSON.stringify({
      early_vacancy: { detected_at: detectedAt, empty_minutes: emptyMinutes },
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // R-EVD-2: chỉ từ in_use → early_empty (idempotent guard).
      const usageUpd: unknown = await queryRunner.manager.query(
        `UPDATE room_booking_usages
            SET usage_status = 'early_empty',
                metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb
          WHERE booking_id = $1 AND usage_status = 'in_use'
          RETURNING id`,
        [cand.booking_id, usageMeta],
      );
      if (this.rowsOf<IdRow>(usageUpd).length === 0) {
        await queryRunner.rollbackTransaction();
        return false;
      }

      // room_events: cột description (KHÔNG 'reason'); source_type NOT NULL.
      await queryRunner.manager.query(
        `INSERT INTO room_events
           (room_id, meeting_id, booking_id, event_type, source_type, actor_user_id, description, occupancy_count, metadata_json)
         VALUES ($1, $2, $3, 'room_early_vacancy', 'system', NULL, $4, 0, $5::jsonb)`,
        [
          cand.room_id,
          cand.meeting_id,
          cand.booking_id,
          `Room empty for >= ${emptyMinutes} min while meeting in progress.`,
          JSON.stringify({ bookingId: cand.booking_id, emptyMinutes }),
        ],
      );

      await queryRunner.commitTransaction();

      // Sau commit (best-effort).
      await this.notify(cand, emptyMinutes);
      return true;
    } catch (e) {
      await queryRunner.rollbackTransaction();
      throw e;
    } finally {
      await queryRunner.release();
    }
  }

  /** OQ-5: organizer + host (dedupe, bỏ null) — in-app ROOM_EARLY_VACANCY + email gated. */
  private async notify(
    cand: CandidateRow,
    emptyMinutes: number,
  ): Promise<void> {
    try {
      const meetingRows: MeetingPartyRow[] =
        await this.dataSource.manager.query(
          `SELECT organizer_id, host_id FROM meetings WHERE id = $1 LIMIT 1`,
          [cand.meeting_id],
        );
      const m = meetingRows[0];
      if (!m) return;
      const recipientUserIds = Array.from(
        new Set([m.organizer_id, m.host_id].filter((x): x is string => !!x)),
      );
      if (recipientUserIds.length === 0) return;

      const roomRows: RoomNameRow[] = await this.dataSource.manager.query(
        `SELECT room_name FROM rooms WHERE id = $1 LIMIT 1`,
        [cand.room_id],
      );
      const roomLabel = roomRows[0]?.room_name ?? cand.room_id;

      const subject = 'Cảnh báo phòng trống sớm';
      const content = `Phòng ${roomLabel} trống ≥ ${emptyMinutes} phút khi cuộc họp đang diễn ra.`;
      const meta = {
        bookingId: cand.booking_id,
        meetingId: cand.meeting_id,
        roomId: cand.room_id,
        emptyMinutes,
      };

      await this.notificationsService.createNotification({
        notificationType: NotificationType.ROOM_EARLY_VACANCY,
        channel: NotificationChannel.IN_APP,
        subject,
        content,
        recipientScope: 'user_list',
        recipientUserIds,
        relatedEntityType: 'room_booking',
        relatedEntityId: cand.booking_id,
        payloadJson: meta,
      });

      try {
        this.websocketService.emitToRoom(
          `room:${cand.room_id}`,
          'room.early_vacancy.alert',
          meta,
        );
      } catch (e) {
        this.logger.warn(`WS emit early-vacancy failed: ${this.errMsg(e)}`);
      }

      const emailEnabled = this.configService.get<boolean>(
        'EARLY_VACANCY_ALERT_EMAIL_ENABLED',
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
            notificationType: NotificationType.ROOM_EARLY_VACANCY,
            channel: NotificationChannel.EMAIL,
            subject,
            content,
            emailHtml: buildEarlyVacancyAlertEmail({
              roomId: cand.room_id,
              emptyMinutes,
            }),
            toEmails,
            payloadJson: meta,
          });
        }
      }
    } catch (e) {
      this.logger.warn(
        `early-vacancy notify ${cand.booking_id} failed: ${this.errMsg(e)}`,
      );
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
