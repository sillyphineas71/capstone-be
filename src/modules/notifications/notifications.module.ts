import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { AccountsModule } from '../accounts/accounts.module.js';

/**
 * NotificationsModule — Module quản lý notifications.
 *
 * NotificationsService cung cấp:
 * - createNotification(): tạo row trong bảng notifications
 * - enqueueEmailNotification(): full chain (notification row + background_job + BullMQ job)
 * - markQueued/markSent/markFailed(): lifecycle tracking
 *
 * Phụ thuộc vào (inject qua @Global modules):
 * - QueueService (từ QueueModule @Global)
 * - BackgroundJobsService (từ AdministrationModule @Global)
 */
@Module({
  imports: [
    ConfigModule,
    AccountsModule,
    TypeOrmModule.forFeature([NotificationEntity]),
  ],
  providers: [NotificationsService],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}

