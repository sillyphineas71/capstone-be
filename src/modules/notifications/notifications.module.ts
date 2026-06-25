import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationWorkerService } from './notification-worker.service.js';
import { BackgroundJobEntity } from '../administration/entities/background-job.entity.js';

/**
 * NotificationsModule — Module quản lý notifications.
 *
 * NotificationsService cung cấp:
 * - createNotification(): tạo row trong bảng notifications
 * - enqueueEmailNotification(): full chain (notification row + background_job + BullMQ job)
 * - markQueued/markSent/markFailed(): lifecycle tracking
 *
 * NotificationWorkerService xử lý job 'send-email' trên queue QUEUE_NOTIFICATION_NAME
 * (gửi email qua MailService, cập nhật delivery status + background job).
 *
 * Phụ thuộc vào (inject qua @Global modules):
 * - QueueService (từ QueueModule @Global)
 * - BackgroundJobsService (từ AdministrationModule @Global)
 * - MailService (từ MailModule @Global)
 *
 * KHÔNG import AccountsModule (tránh circular: AccountsModule -> NotificationsModule).
 * UserEntity relation trong notification.entity chỉ là type cho TypeORM, không cần module.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([NotificationEntity, BackgroundJobEntity]),
  ],
  providers: [NotificationsService, NotificationWorkerService],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
