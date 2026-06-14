import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { RoomEntity } from '../../../modules/rooms/entities/room.entity.js';
import { AttendanceRecordEntity } from './attendance-record.entity.js';

@Entity('attendance_events')
export class AttendanceEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'attendance_record_id', type: 'uuid', nullable: true })
  attendanceRecordId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: string;

  @Column({ name: 'event_time', type: 'timestamptz' })
  eventTime: Date;

  @Column({
    name: 'source_type',
    type: 'varchar',
    length: 40,
    default: 'system',
  })
  sourceType: string;

  @Column({
    name: 'confidence_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  confidenceScore: number | null;

  @Column({ name: 'evidence_media_file_id', type: 'uuid', nullable: true })
  evidenceMediaFileId: string | null;

  @Column({
    name: 'review_status',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  reviewStatus: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => AttendanceRecordEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'attendance_record_id' })
  attendanceRecord: AttendanceRecordEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewedByUser: UserEntity | null;
}
