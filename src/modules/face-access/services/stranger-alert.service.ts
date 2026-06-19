import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  StrangerAlertHook,
  StrangerAlertInput,
} from '../../../common/ports/stranger-alert-hook.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { ListStrangerAlertsQueryDto } from '../dto/list-stranger-alerts.query.dto.js';

interface StrangerRow {
  device_id: string;
  stranger_id: string | null;
  last_seen: Date | string;
  hit_count: number;
  room_id: string | null;
  similarity: string | null;
}

/**
 * StrangerAlertService (SAL-001 / #20) — cảnh báo khuôn mặt lạ + read-list admin.
 *
 * onStranger: throttle in-memory (gate ALERT, KHÔNG gate raw — raw đã lưu ở iot) →
 * WS room-scoped (null-room-safe) + in-app notification cho admins + email opt-in.
 * NC-1 không deny. Metadata-only (KHÔNG base64). DATA-01 no migration, SEC-03 raw param.
 */
@Injectable()
export class StrangerAlertService implements StrangerAlertHook {
  private readonly logger = new Logger(StrangerAlertService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  private static readonly DEFAULT_WINDOW_MINUTES = 1440;
  /** ⚠ in-memory: single-instance + reset khi restart (spec §3.1 FR-003). */
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly websocketService: WebsocketService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onStranger(evt: StrangerAlertInput): Promise<void> {
    // Throttle: 1 cảnh báo / device / window (KHÔNG gate raw — raw đã lưu ở iot).
    const throttleMs =
      this.configService.get<number>(
        'STRANGER_ALERT_THROTTLE_SECONDS',
        StrangerAlertService.DEFAULT_THROTTLE_SECONDS,
      ) * 1000;
    const now = Date.now();
    const last = this.lastAlertAt.get(evt.deviceId);
    if (last !== undefined && now - last < throttleMs) {
      return; // trong window → bỏ qua cảnh báo (tránh spam).
    }
    this.lastAlertAt.set(evt.deviceId, now);

    // Metadata-only payload (KHÔNG base64/snapshot).
    const meta = {
      deviceId: evt.deviceId,
      roomId: evt.roomId,
      strangerId: evt.strangerId,
      similarity: evt.similarity,
      capturedAt: evt.capturedAt.toISOString(),
    };

    // WS room-scoped (null-room-safe: bỏ emit room, vẫn notify admins).
    if (evt.roomId) {
      this.websocketService.emitToRoom(
        `room:${evt.roomId}`,
        'face.stranger.alert',
        meta,
      );
    }

    // Resolve admins → in-app notification.
    const admins = await this.resolveAdmins();
    if (admins.ids.length === 0) {
      this.logger.warn(
        'stranger alert: no admin recipient resolved — skip notification.',
      );
      return;
    }
    const content = `Phát hiện khuôn mặt lạ tại thiết bị ${evt.deviceCode}${
      evt.roomId ? ` (room ${evt.roomId})` : ''
    }.`;

    await this.notificationsService.createNotification({
      notificationType: NotificationType.UNKNOWN_FACE_ALERT,
      channel: NotificationChannel.IN_APP,
      subject: 'Cảnh báo khuôn mặt lạ',
      content,
      recipientScope: 'user_list',
      recipientUserIds: admins.ids,
      payloadJson: meta,
    });

    // Email opt-in (default false).
    const emailEnabled = this.configService.get<boolean>(
      'STRANGER_ALERT_EMAIL_ENABLED',
      false,
    );
    if (emailEnabled && admins.emails.length > 0) {
      await this.notificationsService.enqueueEmailNotification({
        notificationType: NotificationType.UNKNOWN_FACE_ALERT,
        channel: NotificationChannel.EMAIL,
        subject: 'Cảnh báo khuôn mặt lạ',
        content,
        toEmails: admins.emails,
        payloadJson: meta,
      });
    }
  }

  /** Admin recipients (id + email) — roles.role_code='admin' (stable), user_roles active. */
  private async resolveAdmins(): Promise<{ ids: string[]; emails: string[] }> {
    const rows: Array<{ id: string; email: string | null }> =
      await this.dataSource.manager.query(
        `SELECT DISTINCT u.id, u.email
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
           JOIN roles r ON r.id = ur.role_id
          WHERE r.role_code = 'admin' AND u.deleted_at IS NULL`,
      );
    return {
      ids: rows.map((r) => r.id),
      emails: rows.map((r) => r.email).filter((e): e is string => !!e),
    };
  }

  async list(query: ListStrangerAlertsQueryDto): Promise<{
    data: Array<{
      deviceId: string;
      strangerId: string | null;
      roomId: string | null;
      similarity: string | null;
      lastSeen: Date | string;
      hitCount: number;
    }>;
    meta: { page: number; limit: number };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const window =
      query.windowMinutes ??
      this.configService.get<number>(
        'STRANGER_ALERT_WINDOW_MINUTES',
        StrangerAlertService.DEFAULT_WINDOW_MINUTES,
      );
    const offset = (page - 1) * limit;

    // SEC-02: KHÔNG select payload_json/raw_payload_sample → không lộ base64/snapshot.
    const rows: StrangerRow[] = await this.dataSource.manager.query(
      `SELECT e.device_id,
              e.payload_json->'extracted_fields'->>'stranger_id'  AS stranger_id,
              MAX(e.created_at)                                    AS last_seen,
              COUNT(*)::int                                        AS hit_count,
              (array_agg(e.room_id ORDER BY e.created_at DESC))[1] AS room_id,
              (array_agg(e.payload_json->'extracted_fields'->>'similarity'
                         ORDER BY e.created_at DESC))[1]           AS similarity
         FROM iot_device_events e
        WHERE e.event_type = 'face_stranger'
          AND e.created_at >= now() - ($1 * interval '1 minute')
        GROUP BY e.device_id, stranger_id
        ORDER BY last_seen DESC
        LIMIT $2 OFFSET $3`,
      [window, limit, offset],
    );

    return {
      data: rows.map((r) => ({
        deviceId: r.device_id,
        strangerId: r.stranger_id,
        roomId: r.room_id,
        similarity: r.similarity,
        lastSeen: r.last_seen,
        hitCount: Number(r.hit_count),
      })),
      meta: { page, limit },
    };
  }
}
