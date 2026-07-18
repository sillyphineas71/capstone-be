import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationWorkerService } from './notification-worker.service.js';
import { MeetingNotificationsService } from './services/meeting-notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { BackgroundJobEntity } from '../administration/entities/background-job.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../meetings/entities/meeting-external-participant.entity.js';
import { MeetingAgendaEntity } from '../meetings/entities/meeting-agenda.entity.js';
import { MeetingMinutesEntity } from '../minutes/entities/meeting-minutes.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { AuthzReadRepository } from '../auth/repositories/authz-read.repository.js';

/**
 * NotificationsModule — Module quản lý notifications.
 *
 * Gồm:
 * - NotificationsService: service gốc (create/enqueue/lifecycle + inbox list/detail)
 * - NotificationWorkerService: BullMQ worker xử lý send-email
 * - MeetingNotificationsService: service cho UC-143..146 (invite/reminder/cancel/distribute)
 * - NotificationsController: REST endpoints cho cả meeting notifications và inbox
 *
 * Không tracking trạng thái đã đọc theo từng user (Product Owner quyết định 2026-07-18:
 * không tạo bảng notification_reads, không cần theo dõi "ai đã đọc" — xem
 * spec/features/notifications/feat-notification-inbox/spec.md mục 1.2).
 *
 * KHÔNG import MeetingsModule/AccountsModule/MinutesModule (tránh circular).
 * TypeOrmModule.forFeature chỉ inject entity để đọc, không ghi.
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
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationWorkerService,
    MeetingNotificationsService,
    AuthzReadRepository,
  ],
  exports: [TypeOrmModule, NotificationsService],
})
export class NotificationsModule {}
