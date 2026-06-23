import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingRecurrenceRuleEntity } from './entities/meeting-recurrence-rule.entity.js';
import { MeetingEntity } from './entities/meeting.entity.js';
import { MeetingRequestEntity } from './entities/meeting-request.entity.js';
import { MeetingParticipantEntity } from './entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from './entities/meeting-external-participant.entity.js';
import { MeetingAgendaEntity } from './entities/meeting-agenda.entity.js';
import { MeetingEventEntity } from './entities/meeting-event.entity.js';
import { MeetingNoteEntity } from './entities/meeting-note.entity.js';
import { RoomEntity } from '../rooms/entities/room.entity.js';
import { RoomBookingEntity } from '../rooms/entities/room-booking.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdministrationModule } from '../administration/administration.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MeetingsController } from './controllers/meetings.controller.js';
import { MeetingRequestsController } from './controllers/meeting-requests.controller.js';
import { MeetingsService } from './services/meetings.service.js';
import { MeetingRequestReviewService } from './services/meeting-request-review.service.js';
import { WarningTokenUtil } from './utils/warning-token.util.js';
import { IsFutureDateConstraint } from './validators/is-future-date.validator.js';
import { IsAfterStartTimeConstraint } from './validators/is-after-start-time.validator.js';
import { MediaFileEntity } from '../recording/entities/media-file.entity.js';
import { RecordingConfigEntity } from '../recording/entities/recording-config.entity.js';
import { IsIanaTimezoneConstraint } from './validators/is-iana-timezone.validator.js';
import { FromToConstraint } from './validators/from-to.constraint.js';

/**
 * MeetingsModule quản lý tất cả entities thuộc domain Meeting Core & Scheduling:
 * - MeetingRecurrenceRuleEntity (meeting_recurrence_rules)
 * - MeetingEntity (meetings)
 * - MeetingRequestEntity (meeting_requests)
 * - MeetingParticipantEntity (meeting_participants)
 * - MeetingExternalParticipantEntity (meeting_external_participants)
 * - MeetingAgendaEntity (meeting_agendas)
 * - MeetingEventEntity (meeting_events)
 * - MeetingNoteEntity (meeting_notes)
 *
 * Import AccountsModule để có thể resolve UserEntity trong relations.
 * Dùng TypeOrmModule.forFeature cho RoomEntity/RoomBookingEntity thay vì RoomsModule
 * để tránh circular dependency (RoomsModule đã import MeetingsModule).
 */
@Module({
  imports: [
    AccountsModule,
    NotificationsModule,
    AdministrationModule,
    AuthModule,
    TypeOrmModule.forFeature([
      MeetingRecurrenceRuleEntity,
      MeetingEntity,
      MeetingRequestEntity,
      MeetingParticipantEntity,
      MeetingExternalParticipantEntity,
      MeetingAgendaEntity,
      MeetingEventEntity,
      MeetingNoteEntity,
      RoomEntity,
      RoomBookingEntity,
      MediaFileEntity,
      RecordingConfigEntity,
    ]),
  ],
  controllers: [MeetingsController, MeetingRequestsController],
  providers: [
    MeetingsService,
    MeetingRequestReviewService,
    WarningTokenUtil,
    IsFutureDateConstraint,
    IsAfterStartTimeConstraint,
    IsIanaTimezoneConstraint,
    FromToConstraint,
  ],
  exports: [TypeOrmModule],
})
export class MeetingsModule {}
