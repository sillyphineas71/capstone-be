import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationWorkerService } from './notification-worker.service.js';
import { MeetingNotificationsService } from './services/meeting-notifications.service.js';
import { NotificationReadStateService } from './services/notification-read-state.service.js';
import { NotificationsController } from './notifications.controller.js';
import { BackgroundJobEntity } from '../administration/entities/background-job.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../meetings/entities/meeting-external-participant.entity.js';
import { MeetingAgendaEntity } from '../meetings/entities/meeting-agenda.entity.js';
import { MeetingMinutesEntity } from '../minutes/entities/meeting-minutes.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * NotificationsModule — Module quản lý notifications.
 *
 * Gồm:
 * - NotificationsService: service gốc (create/enqueue/lifecycle + inbox list/detail)
 * - NotificationWorkerService: BullMQ worker xử lý send-email
 * - MeetingNotificationsService: service cho UC-143..146 (invite/reminder/cancel/distribute)
 * - NotificationReadStateService (BE-07): trạng thái đã đọc theo user, lưu ở Redis
 * - NotificationsController: REST endpoints cho cả meeting notifications và inbox
 *
 * [Đính chính 2026-07-27, BE-07] Bảng `notifications` KHÔNG có cột đã đọc theo user
 * (Product Owner từ chối bảng `notification_reads`, 2026-07-18) — NHƯNG trạng thái đã đọc
 * NAY ĐƯỢC theo dõi ở Redis qua NotificationReadStateService, không phải "không tracking"
 * như ghi chú cũ. Xem spec/features/notifications/feat-notification-inbox/spec.md.
 * RedisService là @Global() (RedisModule) nên không cần import RedisModule ở đây.
 *
 * KHÔNG import MeetingsModule/AccountsModule/MinutesModule (tránh circular).
 * TypeOrmModule.forFeature chỉ inject entity để đọc, không ghi.
 *
 * CÓ import AuthModule: NotificationsController dùng JwtAuthGuard/PermissionsGuard
 * (cần JwtService/AuthConfigService), và MeetingNotificationsService dùng
 * AuthzReadRepository (export từ AuthModule). AuthModule không import ngược lại
 * NotificationsModule/AccountsModule nên không có circular dependency.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      NotificationEntity,
      BackgroundJobEntity,
      MeetingEntity,
      MeetingParticipantEntity,
      MeetingExternalParticipantEntity,
      MeetingAgendaEntity,
      MeetingMinutesEntity,
      UserEntity,
    ]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationWorkerService,
    MeetingNotificationsService,
    NotificationReadStateService,
  ],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
