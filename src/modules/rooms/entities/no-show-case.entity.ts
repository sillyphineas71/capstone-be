import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { RoomEntity } from './room.entity.js';
import { RoomBookingEntity } from './room-booking.entity.js';

export enum NoShowDetectionStatus {
  RISK = 'risk',
  CONFIRMED = 'confirmed',
  WARNING_SENT = 'warning_sent',
  SNOOZED = 'snoozed',
  RELEASED = 'released',
  DISMISSED = 'dismissed',
  RESOLVED = 'resolved',
}

export enum NoShowResolutionStatus {
  RELEASED = 'released',
  KEPT = 'kept',
  FALSE_POSITIVE = 'false_positive',
  MANUAL_OVERRIDE = 'manual_override',
}

@Entity('no_show_cases')
export class NoShowCaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({
    name: 'detection_status',
    type: 'varchar',
    length: 30,
    default: NoShowDetectionStatus.RISK,
  })
  detectionStatus: NoShowDetectionStatus;

  @Column({ name: 'detected_at', type: 'timestamptz', default: () => 'now()' })
  detectedAt: Date;

  @Column({ name: 'warning_sent_at', type: 'timestamptz', nullable: true })
  warningSentAt: Date | null;

  @Column({ name: 'warning_deadline_at', type: 'timestamptz', nullable: true })
  warningDeadlineAt: Date | null;

  @Column({
    name: 'auto_release_eligible_at',
    type: 'timestamptz',
    nullable: true,
  })
  autoReleaseEligibleAt: Date | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({
    name: 'resolution_status',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  resolutionStatus: NoShowResolutionStatus | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'evidence_json', type: 'jsonb', nullable: true })
  evidenceJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => RoomBookingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'booking_id' })
  booking: RoomBookingEntity;

  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => RoomEntity)
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by' })
  resolvedByUser: UserEntity | null;
}
