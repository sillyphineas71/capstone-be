import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from './meeting.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';

export enum MeetingRequestType {
  CREATE_MEETING = 'create_meeting',
  UPDATE_TIME = 'update_time',
  UPDATE_ROOM = 'update_room',
  CANCEL_MEETING = 'cancel_meeting',
  EXTEND_MEETING = 'extend_meeting',
  BOOK_ROOM = 'book_room',
}

export enum ApprovalMode {
  AUTO = 'auto',
  MANUAL = 'manual',
  MIXED = 'mixed',
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  APPLIED = 'applied',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum ConflictCheckStatus {
  NOT_CHECKED = 'not_checked',
  CLEAR = 'clear',
  WARNING = 'warning',
  BLOCKED = 'blocked',
}

@Entity('meeting_requests')
export class MeetingRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_code', type: 'varchar', length: 80 })
  requestCode: string;

  @Column({ name: 'meeting_id', type: 'uuid', nullable: true })
  meetingId: string | null;

  @Column({ name: 'request_type', type: 'varchar', length: 40 })
  requestType: MeetingRequestType;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy: string;

  @Column({ name: 'requested_at', type: 'timestamptz', default: () => 'now()' })
  requestedAt: Date;

  @Column({ name: 'target_room_id', type: 'uuid', nullable: true })
  targetRoomId: string | null;

  @Column({ name: 'requested_start_time', type: 'timestamptz', nullable: true })
  requestedStartTime: Date | null;

  @Column({ name: 'requested_end_time', type: 'timestamptz', nullable: true })
  requestedEndTime: Date | null;

  @Column({
    name: 'approval_mode',
    type: 'varchar',
    length: 30,
    default: ApprovalMode.AUTO,
  })
  approvalMode: ApprovalMode;

  @Column({
    name: 'approval_status',
    type: 'varchar',
    length: 30,
    default: ApprovalStatus.PENDING,
  })
  approvalStatus: ApprovalStatus;

  @Column({
    name: 'conflict_check_status',
    type: 'varchar',
    length: 30,
    default: ConflictCheckStatus.NOT_CHECKED,
  })
  conflictCheckStatus: ConflictCheckStatus;

  @Column({ name: 'conflict_checked_at', type: 'timestamptz', nullable: true })
  conflictCheckedAt: Date | null;

  @Column({ name: 'conflict_summary_json', type: 'jsonb', nullable: true })
  conflictSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'decision_by', type: 'uuid', nullable: true })
  decisionBy: string | null;

  @Column({ name: 'decision_at', type: 'timestamptz', nullable: true })
  decisionAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'request_payload_json', type: 'jsonb', default: '{}' })
  requestPayloadJson: Record<string, unknown>;

  @Column({ name: 'rule_snapshot_json', type: 'jsonb', nullable: true })
  ruleSnapshotJson: Record<string, unknown> | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity | null;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'requested_by' })
  requestedByUser: UserEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decision_by' })
  decisionByUser: UserEntity | null;

  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'target_room_id' })
  targetRoom: RoomEntity | null;
}
