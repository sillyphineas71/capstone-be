import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingRecurrenceRuleEntity } from './meeting-recurrence-rule.entity.js';

export enum MeetingType {
  NORMAL = 'normal',
  TRAINING = 'training',
  INTERVIEW = 'interview',
  EMERGENCY = 'emergency',
}

export enum MeetingMode {
  OFFLINE = 'offline',
  ONLINE = 'online',
  HYBRID = 'hybrid',
}

export enum MeetingPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum MeetingStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum MeetingVisibilityLevel {
  PRIVATE = 'private',
  INTERNAL = 'internal',
  DEPARTMENT = 'department',
  PUBLIC = 'public',
}

@Entity('meetings')
export class MeetingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_code', type: 'varchar', length: 80 })
  meetingCode: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'organizer_id', type: 'uuid' })
  organizerId: string;

  @Column({ name: 'host_id', type: 'uuid', nullable: true })
  hostId: string | null;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({
    name: 'meeting_type',
    type: 'varchar',
    length: 30,
    default: MeetingType.NORMAL,
  })
  meetingType: MeetingType;

  @Column({
    name: 'meeting_mode',
    type: 'varchar',
    length: 30,
    default: MeetingMode.OFFLINE,
  })
  meetingMode: MeetingMode;

  @Column({ type: 'varchar', length: 20, default: MeetingPriority.NORMAL })
  priority: MeetingPriority;

  @Column({ type: 'varchar', length: 30, default: MeetingStatus.DRAFT })
  status: MeetingStatus;

  @Column({
    name: 'visibility_level',
    type: 'varchar',
    length: 30,
    default: MeetingVisibilityLevel.INTERNAL,
  })
  visibilityLevel: MeetingVisibilityLevel;

  @Column({ name: 'start_time', type: 'timestamptz' })
  startTime: Date;

  @Column({ name: 'end_time', type: 'timestamptz' })
  endTime: Date;

  @Column({ name: 'actual_start_time', type: 'timestamptz', nullable: true })
  actualStartTime: Date | null;

  @Column({ name: 'actual_end_time', type: 'timestamptz', nullable: true })
  actualEndTime: Date | null;

  @Column({ type: 'varchar', length: 60, default: 'Asia/Ho_Chi_Minh' })
  timezone: string;

  @Column({ name: 'expected_attendee_count', type: 'integer', nullable: true })
  expectedAttendeeCount: number | null;

  @Column({ name: 'recurrence_rule_id', type: 'uuid', nullable: true })
  recurrenceRuleId: string | null;

  @Column({ name: 'parent_meeting_id', type: 'uuid', nullable: true })
  parentMeetingId: string | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'organizer_id' })
  organizer: UserEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'host_id' })
  host: UserEntity | null;

  @ManyToOne(() => MeetingRecurrenceRuleEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'recurrence_rule_id' })
  recurrenceRule: MeetingRecurrenceRuleEntity | null;

  @ManyToOne(() => MeetingEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_meeting_id' })
  parentMeeting: MeetingEntity | null;
}
