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

export interface VehicleControlAlertContext {
  channelId: number;
  direction: string;
}

/**
 * VehicleControlAlertService (VCC-001 / UC9) — "đích cảnh báo" khi biển số khớp
 * `vehicle_control_list`. Tách biệt khỏi `checkControlList` (pure lookup) theo chủ đích:
 * Bước 3 (owed) chỉ cần sửa NỘI BỘ service này để trỏ sang bảng `security_alerts` — chỗ
 * gọi (`VehicleResolveService`) và `checkControlList` KHÔNG cần đổi.
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
  ) {}

  async evaluate(
    plateNumber: string,
    context: VehicleControlAlertContext,
  ): Promise<void> {
    try {
      const match =
        await this.vehicleControlListService.checkControlList(plateNumber);
      if (!match) return;

      const throttleMs =
        this.configService.get<number>(
          'VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS',
          VehicleControlAlertService.DEFAULT_THROTTLE_SECONDS,
        ) * 1000;
      const now = Date.now();
      const last = this.lastAlertAt.get(plateNumber);
      if (last !== undefined && now - last < throttleMs) {
        return; // trong window → bỏ qua (tránh spam), KHÔNG cập nhật mốc gốc.
      }
      this.lastAlertAt.set(plateNumber, now);

      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) {
        this.logger.warn(
          `control-list match (plate=${plateNumber}) — không resolve được recipient, skip notification.`,
        );
        return;
      }

      const isBlocklist = match.listType === 'blocklist';
      const subject = isBlocklist
        ? 'Cảnh báo: xe trong danh sách chặn'
        : 'Cảnh báo: xe cần theo dõi';
      const content =
        `Biển số ${match.plateNumber} (${match.listType}) vừa qua cổng ` +
        `(channel ${context.channelId}, direction ${context.direction}).` +
        (match.reason ? ` Lý do: ${match.reason}.` : '');

      await this.notificationsService.createNotification({
        notificationType: NotificationType.VEHICLE_CONTROL_LIST_MATCH,
        channel: NotificationChannel.IN_APP,
        subject,
        content,
        priority: isBlocklist
          ? NotificationPriority.HIGH
          : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: {
          plateNumber: match.plateNumber,
          listType: match.listType,
          reason: match.reason,
          channelId: context.channelId,
          direction: context.direction,
          controlListEntryId: match.id,
        },
      });
    } catch (e) {
      // NotThrow — lỗi cảnh báo KHÔNG được phá luồng ingest event chính (VehicleResolveService).
      this.logger.error(
        `Control list alert failed (plate=${plateNumber}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
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
