import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  NotificationEntity,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationPriority,
  NotificationType,
} from './entities/notification.entity.js';
import { QueueService } from '../queue/queue.service.js';
import { BackgroundJobsService } from '../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../administration/entities/background-job.entity.js';
import { NotificationListItemDto } from './dto/notification-list-item.dto.js';
import { NotificationReadStateService } from './services/notification-read-state.service.js';

export interface CreateNotificationDto {
  notificationType: NotificationType;
  channel: NotificationChannel;
  subject?: string;
  content: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  recipientScope?: string;
  recipientUserIds?: string[];
  recipientEmails?: string[];
  recipientPhones?: string[];
  priority?: NotificationPriority;
  scheduledSendAt?: Date;
  createdBy?: string;
  payloadJson?: Record<string, unknown>;
}

export interface EnqueueEmailNotificationDto extends CreateNotificationDto {
  toEmails: string[];
  /**
   * HTML branded sẵn cho email (xem `mail/templates/`). Khi có, worker dùng
   * field này làm `html` gửi mail thay vì render thô từ `content`.
   * KHÔNG được lưu vào `notifications.content` (giữ content DB là bản plain-text).
   */
  emailHtml?: string;
  /** File đính kèm (VD: PDF biên bản gửi khách ngoài) — chỉ mang storageKey qua queue, worker tự tải bytes. */
  attachment?: {
    storageKey: string;
    fileName: string;
    mimeType: string;
  };
}

/**
 * NotificationsService — Service gốc dùng chung.
 *
 * - createNotification/enqueueEmailNotification: đã có sẵn
 * - listMyNotifications/getMyNotificationDetail: inbox (danh sách/chi tiết thông báo của user hiện tại)
 *
 * [Đính chính 2026-07-27, BE-07] Bảng `notifications` vẫn KHÔNG có cột đã đọc theo user
 * (Product Owner từ chối bảng `notification_reads`, 2026-07-18) — NHƯNG từ BE-07, trạng thái
 * đã đọc ĐƯỢC theo dõi ở Redis (`NotificationReadStateService`), không phải "không tracking"
 * như ghi chú cũ. Xem `spec/features/notifications/feat-notification-inbox/spec.md`.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly notificationQueueName: string;

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly repo: Repository<NotificationEntity>,
    private readonly queueService: QueueService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly configService: ConfigService,
    private readonly readStateService: NotificationReadStateService,
  ) {
    this.notificationQueueName = this.configService.get<string>(
      'QUEUE_NOTIFICATION',
      'notification',
    );
  }

  // ── Existing methods ──

  async createNotification(
    dto: CreateNotificationDto,
  ): Promise<NotificationEntity> {
    const notification = this.repo.create({
      notificationType: dto.notificationType,
      channel: dto.channel,
      subject: dto.subject ?? null,
      content: dto.content,
      relatedEntityType: dto.relatedEntityType ?? null,
      relatedEntityId: dto.relatedEntityId ?? null,
      recipientScope: dto.recipientScope ?? 'user_list',
      recipientUserIdsJson: dto.recipientUserIds ?? null,
      recipientEmailsJson: dto.recipientEmails ?? null,
      recipientPhonesJson: dto.recipientPhones ?? null,
      priority: dto.priority ?? NotificationPriority.NORMAL,
      scheduledSendAt: dto.scheduledSendAt ?? null,
      createdBy: dto.createdBy ?? null,
      payloadJson: dto.payloadJson ?? null,
      deliveryStatus: NotificationDeliveryStatus.DRAFT,
      retryCount: 0,
      readCount: 0,
    });
    const saved = await this.repo.save(notification);
    this.logger.debug(
      '[Notifications] Created notification ' +
        saved.id +
        ' — type: ' +
        saved.notificationType,
    );
    return saved;
  }

  async enqueueEmailNotification(dto: EnqueueEmailNotificationDto): Promise<{
    notification: NotificationEntity;
    jobId?: string;
  }> {
    const notification = await this.createNotification({
      ...dto,
      channel: NotificationChannel.EMAIL,
      recipientEmails: dto.toEmails,
    });

    const bgJob = await this.backgroundJobsService.createQueuedJob({
      jobType: BackgroundJobType.SEND_EMAIL,
      queueName: this.notificationQueueName,
      relatedEntityType: 'notification',
      relatedEntityId: notification.id,
      requestedBy: dto.createdBy,
      inputJson: {
        notificationId: notification.id,
        toEmails: dto.toEmails,
        subject: dto.subject,
      },
    });

    let bullJobId: string | undefined;
    try {
      bullJobId = await this.queueService.addJob(
        this.notificationQueueName,
        'send-email',
        {
          notificationId: notification.id,
          backgroundJobId: bgJob.id,
          toEmails: dto.toEmails,
          subject: dto.subject,
          content: dto.content,
          emailHtml: dto.emailHtml,
          payloadJson: dto.payloadJson,
          attachment: dto.attachment,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.markFailed(notification.id, 'Failed to enqueue: ' + message);
      await this.backgroundJobsService.markFailed(
        bgJob.id,
        'Failed to enqueue: ' + message,
      );
      this.logger.error(
        '[Notifications] Failed to enqueue email notification: ' + message,
      );
      return { notification };
    }

    await this.markQueued(notification.id);

    this.logger.log(
      '[Notifications] Enqueued email notification ' +
        notification.id +
        ' → BullMQ job ' +
        bullJobId,
    );
    return { notification, jobId: bullJobId };
  }

  async markQueued(id: string): Promise<void> {
    await this.repo.update(id, {
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });
  }

  async markSent(id: string): Promise<void> {
    await this.repo.update(id, {
      deliveryStatus: NotificationDeliveryStatus.SENT,
      sentAt: new Date(),
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.repo.update(id, {
      deliveryStatus: NotificationDeliveryStatus.FAILED,
      failureReason: reason,
    });
  }

  async findById(id: string): Promise<NotificationEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  // ── Inbox methods (danh sách/chi tiết thông báo của user hiện tại) ──

  /**
   * List notifications for current user (recipient).
   * Dùng GIN index ix_notifications_recipients cho jsonb containment.
   * Không có trạng thái "đã đọc" theo từng user (xem note đầu file).
   */
  async listMyNotifications(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    data: NotificationListItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const skip = (page - 1) * limit;

    const [items, total] = await this.repo
      .createQueryBuilder('n')
      .where('n.recipient_user_ids_json @> :userIdJsonb', {
        userIdJsonb: JSON.stringify([userId]),
      })
      .andWhere("n.channel IN ('in_app', 'websocket')")
      .orderBy('n.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const readState = await this.readStateService.getReadState(userId);
    const data: NotificationListItemDto[] = items.map((item) => ({
      id: item.id,
      notificationType: item.notificationType,
      subject: item.subject,
      content: item.content,
      relatedEntityType: item.relatedEntityType,
      relatedEntityId: item.relatedEntityId,
      priority: item.priority,
      createdAt: item.createdAt,
      isRead: this.readStateService.computeIsRead(
        readState,
        item.id,
        item.createdAt,
      ),
      payloadJson: item.payloadJson ?? null,
    }));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get notification detail (only if user is recipient).
   */
  async getMyNotificationDetail(
    id: string,
    userId: string,
  ): Promise<NotificationListItemDto> {
    const notification = await this.repo.findOne({ where: { id } });

    if (!notification) {
      throw new NotFoundException({
        success: false,
        message: 'Notification not found',
        error: { code: 'NOTIFICATION_NOT_FOUND', details: {} },
      });
    }

    const recipientIds = notification.recipientUserIdsJson ?? [];
    if (!recipientIds.includes(userId)) {
      throw new ForbiddenException({
        success: false,
        message: 'You do not have access to this notification',
        error: { code: 'NOTIFICATION_ACCESS_DENIED', details: {} },
      });
    }

    return {
      id: notification.id,
      notificationType: notification.notificationType,
      subject: notification.subject,
      content: notification.content,
      relatedEntityType: notification.relatedEntityType,
      relatedEntityId: notification.relatedEntityId,
      priority: notification.priority,
      createdAt: notification.createdAt,
      isRead: await this.readStateService.isRead(
        userId,
        notification.id,
        notification.createdAt,
      ),
      payloadJson: notification.payloadJson ?? null,
    };
  }

  // ── Read-state methods (BE-07, Redis) ──

  /**
   * Đánh dấu 1 notification đã đọc — trả 404/403 trước (dùng lại
   * getMyNotificationDetail để xác nhận user là recipient), sau đó ghi Redis.
   */
  async markNotificationRead(id: string, userId: string): Promise<void> {
    await this.getMyNotificationDetail(id, userId);
    await this.readStateService.markRead(userId, id);
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    await this.readStateService.markAllRead(userId);
  }
}
