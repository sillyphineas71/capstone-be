import { Injectable, Logger } from '@nestjs/common';
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
  /** Email addresses to send to (overrides recipientEmails nếu cần) */
  toEmails: string[];
}

/**
 * NotificationsService — Service skeleton dùng chung.
 *
 * Entity NotificationEntity đã có sẵn trong DB v3.2 (bảng notifications).
 *
 * enqueueEmailNotification():
 * 1. Tạo notification row (status=draft)
 * 2. Tạo background_job row (type=send_email)
 * 3. Add BullMQ job vào QUEUE_NOTIFICATION
 * 4. Update notification status=queued
 *
 * Worker xử lý generic email — không implement business feature cụ thể ở đây.
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
  ) {
    this.notificationQueueName = this.configService.get<string>(
      'QUEUE_NOTIFICATION',
      'notification',
    );
  }

  /**
   * Tạo notification record với status=draft.
   */
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
      `[Notifications] Created notification ${saved.id} — type: ${saved.notificationType}`,
    );
    return saved;
  }

  /**
   * Enqueue email notification:
   * 1. Tạo notification row (status=draft)
   * 2. Tạo background_job row (type=send_email, status=queued)
   * 3. Add BullMQ job vào notification queue
   * 4. Update notification status=queued
   */
  async enqueueEmailNotification(dto: EnqueueEmailNotificationDto): Promise<{
    notification: NotificationEntity;
    jobId?: string;
  }> {
    // 1. Tạo notification row
    const notification = await this.createNotification({
      ...dto,
      channel: NotificationChannel.EMAIL,
      recipientEmails: dto.toEmails,
    });

    // 2. Tạo background_job row
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
        // Không lưu nội dung email vào input_json nếu quá dài
      },
    });

    // 3. Add BullMQ job
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
          payloadJson: dto.payloadJson,
        },
      );
    } catch (error) {
      // Nếu enqueue thất bại, mark notification và background job là failed
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.markFailed(notification.id, `Failed to enqueue: ${message}`);
      await this.backgroundJobsService.markFailed(
        bgJob.id,
        `Failed to enqueue: ${message}`,
      );
      this.logger.error(
        `[Notifications] Failed to enqueue email notification: ${message}`,
      );
      return { notification };
    }

    // 4. Update notification status=queued
    await this.markQueued(notification.id);

    this.logger.log(
      `[Notifications] Enqueued email notification ${notification.id} → BullMQ job ${bullJobId}`,
    );
    return { notification, jobId: bullJobId };
  }

  /**
   * Cập nhật trạng thái notification → queued.
   */
  async markQueued(id: string): Promise<void> {
    await this.repo.update(id, {
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });
  }

  /**
   * Cập nhật trạng thái notification → sent.
   */
  async markSent(id: string): Promise<void> {
    await this.repo.update(id, {
      deliveryStatus: NotificationDeliveryStatus.SENT,
      sentAt: new Date(),
    });
  }

  /**
   * Cập nhật trạng thái notification → failed.
   */
  async markFailed(id: string, reason: string): Promise<void> {
    await this.repo.update(id, {
      deliveryStatus: NotificationDeliveryStatus.FAILED,
      failureReason: reason,
    });
  }

  /**
   * Tìm notification theo ID.
   */
  async findById(id: string): Promise<NotificationEntity | null> {
    return this.repo.findOne({ where: { id } });
  }
}
