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

@Entity('room_events')
export class RoomEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'meeting_id', type: 'uuid', nullable: true })
  meetingId: string | null;

  @Column({ name: 'booking_id', type: 'uuid', nullable: true })
  bookingId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 60 })
  eventType: string;

  @Column({ name: 'event_time', type: 'timestamptz', default: () => 'now()' })
  eventTime: Date;

  @Column({
    name: 'source_type',
    type: 'varchar',
    length: 30,
    default: 'system',
  })
  sourceType: string;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ name: 'old_status', type: 'varchar', length: 30, nullable: true })
  oldStatus: string | null;

  @Column({ name: 'new_status', type: 'varchar', length: 30, nullable: true })
  newStatus: string | null;

  @Column({ name: 'occupancy_count', type: 'integer', nullable: true })
  occupancyCount: number | null;

  @Column({
    name: 'confidence_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  confidenceScore: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => RoomEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;

  @ManyToOne(() => MeetingEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity | null;

  @ManyToOne(() => RoomBookingEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'booking_id' })
  booking: RoomBookingEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: UserEntity | null;
}
