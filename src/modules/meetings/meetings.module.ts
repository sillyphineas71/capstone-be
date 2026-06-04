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
import { AccountsModule } from '../accounts/accounts.module.js';

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
 */
@Module({
  imports: [
    AccountsModule,
    TypeOrmModule.forFeature([
      MeetingRecurrenceRuleEntity,
      MeetingEntity,
      MeetingRequestEntity,
      MeetingParticipantEntity,
      MeetingExternalParticipantEntity,
      MeetingAgendaEntity,
      MeetingEventEntity,
      MeetingNoteEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class MeetingsModule {}
