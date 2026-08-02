import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { VehicleControlListService } from './vehicle-control-list.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { AlertSeverity } from '../../alerts/dto/record-alert.input.js';

export interface VehicleControlAlertContext {
  channelId: number;
  direction: string;
}

/**
 * VehicleControlAlertService (VCC-001 / UC9) — "đích cảnh báo" khi biển số khớp
 * `vehicle_control_list`. Tách biệt khỏi `checkControlList` (pure lookup) theo chủ đích.
 *
 * ASM-001 (Bước 3 / 3d): trước khi gửi notification (giữ nguyên 100%), gọi
 * `AlertRulesService.findEffectiveRule('vehicle_control_match', null)` — `suppressed` (rule
 * tắt tường minh) → dừng CẢ recordAlert lẫn notification (AF1). Không suppressed →
 * `AlertsService.recordAlert()` TRƯỚC (severity theo `listType`, bọc try/catch NotThrow
 * RIÊNG — lỗi ghi `security_alerts` KHÔNG được chặn notification cũ), rồi mới notification
 * như cũ. `zoneId: null` cố định (residual: `VehicleResolveService` chưa ghi `zone_id`).
 *
 * NotThrow toàn bộ `evaluate()`: lỗi cảnh báo KHÔNG được phá luồng ingest event chính
 * (mirror `VehicleResolveService`/`StrangerAlertService`). Throttle in-memory theo plate
 * (⚠ single-instance, reset khi restart — mirror `StrangerAlertService`).
 */
@Injectable()
export class VehicleControlAlertService {
  private readonly logger = new Logger(VehicleControlAlertService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly vehicleControlListService: VehicleControlListService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
  ) {}

  async evaluate(
    plateNumber: string,
    context: VehicleControlAlertContext,
    eventId?: string,
  ): Promise<void> {
    try {
      // --- Step 1: Throttle check ---
      const throttleMs =
        this.configService.get<number>(
          'VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS',
          VehicleControlAlertService.DEFAULT_THROTTLE_SECONDS,
        ) * 1000;
      const now = Date.now();
      const last = this.lastAlertAt.get(plateNumber);
      if (last !== undefined && now - last < throttleMs) {
        return;
      }
      this.lastAlertAt.set(plateNumber, now);

      // --- Step 2: Resolve zone_id from channelId (FR-020) ---
      let zoneId: string | null = null;
      try {
        const rows: Array<{ zone_id: string | null }> =
          await this.dataSource.manager.query(
            `SELECT i.zone_id FROM iot_devices i WHERE i.channel_id = $1 AND i.deleted_at IS NULL LIMIT 1`,
            [context.channelId],
          );
        zoneId = rows[0]?.zone_id ?? null;
      } catch (e) {
        this.logger.warn(
          `Zone resolution failed (channel=${context.channelId}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      // --- Step 3: Priority chain (B>C>A>D) ---
      let alertType: string | null = null;
      let severity: AlertSeverity = 'medium';
      let subject = '';
      let notificationType: NotificationType =
        NotificationType.VEHICLE_CONTROL_LIST_MATCH;
      let payload: Record<string, unknown> = {
        plateNumber,
        channelId: context.channelId,
        direction: context.direction,
      };
      let ruleId: string | null = null;

      const controlListMatch =
        await this.vehicleControlListService.checkControlList(plateNumber);
      if (controlListMatch) {
        payload = {
          ...payload,
          listType: controlListMatch.listType,
          reason: controlListMatch.reason,
          controlListEntryId: controlListMatch.id,
        };
        if (controlListMatch.listType === 'blocklist') {
          alertType = 'vehicle_control_match';
          severity = 'high';
          subject = 'C\\u1ea3nh b\\u00e1o: xe trong danh s\\u00e1ch ch\\u1eb7n';
          notificationType = NotificationType.VEHICLE_CONTROL_LIST_MATCH;
        } else {
          alertType = 'vehicle_control_match';
          severity = 'medium';
          subject = 'C\\u1ea3nh b\\u00e1o: xe c\\u1ea7n theo d\\u00f5i';
          notificationType = NotificationType.VEHICLE_CONTROL_LIST_MATCH;
        }
      }

      if (!alertType) {
        try {
          const regRows: Array<{ status: string }> =
            await this.dataSource.manager.query(
              `SELECT status FROM vehicle_registrations WHERE plate_number = $1 AND deleted_at IS NULL LIMIT 1`,
              [plateNumber],
            );
          if (regRows.length === 0) {
            alertType = 'unknown_vehicle';
            severity = 'medium';
            subject =
              'C\\u1ea3nh b\\u00e1o: bi\\u1ec3n s\\u1ed1 kh\\u00f4ng x\\u00e1c \\u0111\\u1ecbnh';
            notificationType = NotificationType.UNKNOWN_VEHICLE_ALERT;
          } else if (
            regRows[0].status === 'pending' ||
            regRows[0].status === 'rejected'
          ) {
            alertType = 'vehicle_unauthorized';
            severity = 'low';
            subject =
              'Th\\u00f4ng b\\u00e1o: xe \\u0111ang ch\\u1edd duy\\u1ec7t/b\\u1ecb t\\u1eeb ch\\u1ed1i';
            notificationType = NotificationType.VEHICLE_UNAUTHORIZED_ALERT;
          }
        } catch (e) {
          this.logger.warn(
            `Vehicle registration check failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`,
          );
          return;
        }
      }

      if (!alertType) return;

      // --- Step 4: Check alert_rules ---
      try {
        const { suppressed, rule } =
          await this.alertRulesService.findEffectiveRule(alertType, zoneId);
        if (suppressed) {
          this.logger.debug(
            `Alert suppressed by rule (type=${alertType} plate=${plateNumber})`,
          );
          return;
        }
        ruleId = rule?.id ?? null;
      } catch (e) {
        this.logger.warn(
          `Alert rules check failed (type=${alertType}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      // --- Step 5: recordAlert ---
      try {
        await this.alertsService.recordAlert({
          alertType,
          zoneId,
          severity,
          ruleId,
          sourceEventId: eventId ?? null,
          payloadJson: payload,
        });
      } catch (e) {
        this.logger.error(
          `recordAlert failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`,
        );
      }

      // --- Step 6: createNotification ---
      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) {
        this.logger.warn(
          `Alert match (plate=${plateNumber}) - no recipients, skip notification.`,
        );
        return;
      }
      const alertContent =
        `Bi\\u1ec3n s\\u1ed1 ${plateNumber} v\\u1eeba qua c\\u1ed5ng ` +
        `(channel ${context.channelId}, direction ${context.direction}).` +
        (payload.listType ? ` Lo\\u1ea1i: ${payload.listType}.` : '') +
        (payload.reason ? ` L\\u00fd do: ${payload.reason}.` : '');
      await this.notificationsService.createNotification({
        notificationType,
        channel: NotificationChannel.IN_APP,
        subject,
        content: alertContent,
        priority:
          severity === 'high'
            ? NotificationPriority.HIGH
            : severity === 'low'
              ? NotificationPriority.LOW
              : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: payload,
      });
    } catch (e) {
      this.logger.error(
        `Alert evaluation failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }
  /** Recipient = đúng bộ role đã gán quyền `vehicle_control.read` (UC8 migration 20260722000001). */
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
