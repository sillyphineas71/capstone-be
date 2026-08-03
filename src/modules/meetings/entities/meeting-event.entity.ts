import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from './meeting.entity.js';

export enum MeetingEventType {
  MEETING_STARTED = 'meeting_started',
  MEETING_ENDED = 'meeting_ended',
  EXTENSION_REQUESTED = 'extension_requested',
  EXTENSION_APPROVED = 'extension_approved',
  EXTENSION_REJECTED = 'extension_rejected',
  WARNING_SENT = 'warning_sent',
  STATUS_CHANGED = 'status_changed',
  MEETING_REQUEST_CREATED = 'meeting_request_created',
  MEETING_REQUEST_APPROVED = 'meeting_request_approved',
  MEETING_REQUEST_REJECTED = 'meeting_request_rejected',
  MEETING_TIME_UPDATED = 'meeting_time_updated',
  ROOM_CHANGED = 'room_changed',
  PARTICIPANT_REMOVED = 'participant_removed',
  EXTERNAL_PARTICIPANT_ADDED = 'external_participant_added',
  ATTENDANCE_CHECKIN_ALERT_SENT = 'attendance_checkin_alert_sent',
  WARNING_SCHEDULED = 'warning_scheduled',
  WARNING_SCHEDULING_SKIPPED = 'warning_scheduling_skipped',
  EXTERNAL_PARTICIPANT_REMOVED = 'external_participant_removed',
  // BE-03 (2026-07-26): PATCH /meetings/:meetingId — chi title/description.
  METADATA_UPDATED = 'metadata_updated',
  // feat-speaker-tagging-post-meeting (2026-08-02): Host/Admin gan ten that
  // cho cum giong Speaker_N. metadata_json = { recordingSessionId,
  // speakerUserId?, externalParticipantId?, displayName, tagSource: 'live'|'post' }.
  SPEAKER_TAG = 'speaker_tag',
  // feat-speaker-tagging-live (2026-08-02): Host bam "Bat dau ghi am" trong
  // luc hop (hoac nhap tay bu, xem SetManualRecordingStartDto) de danh dau
  // moc t=0 - recording_sessions CHUA ton tai luc nay (chi tao khi upload),
  // nen phai neo qua event nay thay vi recording_sessions.started_at.
  RECORDING_START_MARKER = 'recording_start_marker',
}

export enum MeetingEventSourceType {
  MANUAL = 'manual',
  SYSTEM = 'system',
  WEBSOCKET = 'websocket',
  MQTT = 'mqtt',
  SCHEDULER = 'scheduler',
  DEVICE = 'device',
}

@Entity('meeting_events')
export class MeetingEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 60 })
  eventType: MeetingEventType;

  @Column({ name: 'event_time', type: 'timestamptz', default: () => 'now()' })
  eventTime: Date;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({
    name: 'source_type',
    type: 'varchar',
    length: 30,
    default: MeetingEventSourceType.SYSTEM,
  })
  sourceType: MeetingEventSourceType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'old_value_json', type: 'jsonb', nullable: true })
  oldValueJson: Record<string, unknown> | null;

  @Column({ name: 'new_value_json', type: 'jsonb', nullable: true })
  newValueJson: Record<string, unknown> | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: UserEntity | null;
}
