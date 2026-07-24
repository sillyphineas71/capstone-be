import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PersonControlListEntity } from '../entities/person-control-list.entity.js';
import { AlertRulesService } from './alert-rules.service.js';
import { AlertsService } from './alerts.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import type { AlertSeverity } from '../dto/record-alert.input.js';

/**
 * PersonWatchlistCheckService (PWL-001 / UC-125) — điểm vào DUY NHẤT cho `face-access`
 * gọi khi có event nhận diện. CHỈ nhận `userId` (chốt qua AskUserQuestion — spec §1 câu 3).
 *
 * Mirror `VehicleControlAlertService` (UC9): throttle in-memory 300s/userId →
 * `AlertRulesService.findEffectiveRule('person_watchlist_match', null)` → suppressed → skip
 * → `AlertsService.recordAlert()` (severity = `match.priority` TRỰC TIẾP, spec §2.1) →
 * notification. NotThrow TOÀN BỘ (R7 crux) — lỗi cảnh báo KHÔNG được phá luồng nhận diện
 * chính của `face-access`.
 *
 * ARCH-02: KHÔNG import `FaceAccessModule` — nhận `userId` qua tham số, KHÔNG tự đi hỏi
 * module khác.
 */
@Injectable()
export class PersonWatchlistCheckService {
  private readonly logger = new Logger(PersonWatchlistCheckService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    @InjectRepository(PersonControlListEntity)
    private readonly repo: Repository<PersonControlListEntity>,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async checkPersonWatchlist(userId: string): Promise<void> {
    try {
      const match = await this.repo.findOne({
        where: { userId, active: true, deletedAt: IsNull() },
      });
      if (!match) return;

      const throttleMs =
        this.configService.get<number>(
          'PERSON_WATCHLIST_ALERT_THROTTLE_SECONDS',
          PersonWatchlistCheckService.DEFAULT_THROTTLE_SECONDS,
        ) * 1000;
      const now = Date.now();
      const last = this.lastAlertAt.get(userId);
      if (last !== undefined && now - last < throttleMs) {
        return; // trong window → bỏ qua (tránh spam), KHÔNG cập nhật mốc gốc.
      }
      this.lastAlertAt.set(userId, now);

      const { suppressed, rule } =
        await this.alertRulesService.findEffectiveRule(
          'person_watchlist_match',
          null,
        );
      if (suppressed) return; // AF1: rule tắt tường minh — dừng cả recordAlert lẫn notification.

      await this.alertsService.recordAlert({
        alertType: 'person_watchlist_match',
        zoneId: null,
        severity: match.priority as AlertSeverity,
        ruleId: rule?.id ?? null,
        payloadJson: {
          personControlListEntryId: match.id,
          displayName: match.displayName,
          listType: match.listType,
          reason: match.reason,
          userId,
        },
      });

      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) {
        this.logger.warn(
          `person watchlist match (userId=${userId}) — không resolve được recipient, skip notification.`,
        );
        return;
      }

      await this.notificationsService.createNotification({
        notificationType: NotificationType.PERSON_WATCHLIST_MATCH,
        channel: NotificationChannel.IN_APP,
        subject: 'Cảnh báo: người trong danh sách theo dõi',
        content:
          `${match.displayName} (${match.listType}) vừa được nhận diện.` +
          (match.reason ? ` Lý do: ${match.reason}.` : ''),
        priority:
          match.priority === 'critical' || match.priority === 'high'
            ? NotificationPriority.HIGH
            : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: {
          userId,
          displayName: match.displayName,
          listType: match.listType,
          priority: match.priority,
        },
      });
    } catch (e) {
      // NotThrow — lỗi cảnh báo KHÔNG được phá luồng nhận diện chính (R7 crux).
      this.logger.error(
        `checkPersonWatchlist failed (userId=${userId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /** Recipient = đúng bộ role vận hành Trung tâm cảnh báo (chốt qua AskUserQuestion). */
  private async resolveRecipients(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
         JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code IN ('MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN')
          AND u.deleted_at IS NULL`,
    );
    return rows.map((r) => r.id);
  }
}
