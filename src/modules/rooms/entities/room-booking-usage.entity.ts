import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { RoomEntity } from './room.entity.js';
import { RoomBookingEntity } from './room-booking.entity.js';

export enum RoomUsageStatus {
  NOT_STARTED = 'not_started',
  IN_USE = 'in_use',
  COMPLETED = 'completed',
  NO_SHOW = 'no_show',
  EARLY_EMPTY = 'early_empty',
  RELEASED = 'released',
}

export enum OccupancySource {
  CAMERA = 'camera',
  MANUAL = 'manual',
  SENSOR = 'sensor',
  WEBSOCKET = 'websocket',
  MIXED = 'mixed',
}

@Entity('room_booking_usages')
export class RoomBookingUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', type: 'uuid' })
  bookingId: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'reserved_start_time', type: 'timestamptz' })
  reservedStartTime: Date;

  @Column({ name: 'reserved_end_time', type: 'timestamptz' })
  reservedEndTime: Date;

  @Column({ name: 'actual_start_time', type: 'timestamptz', nullable: true })
  actualStartTime: Date | null;

  @Column({ name: 'actual_end_time', type: 'timestamptz', nullable: true })
  actualEndTime: Date | null;

  @Column({ name: 'first_presence_at', type: 'timestamptz', nullable: true })
  firstPresenceAt: Date | null;

  @Column({ name: 'last_presence_at', type: 'timestamptz', nullable: true })
  lastPresenceAt: Date | null;

  @Column({ name: 'usage_status', type: 'varchar', length: 30, default: RoomUsageStatus.NOT_STARTED })
  usageStatus: RoomUsageStatus;

  @Column({ name: 'occupancy_source', type: 'varchar', length: 40, nullable: true })
  occupancySource: OccupancySource | null;

  @Column({ name: 'occupancy_confidence', type: 'numeric', precision: 5, scale: 2, nullable: true })
  occupancyConfidence: number | null;

  @Column({ name: 'auto_released', type: 'boolean', default: false })
  autoReleased: boolean;

  @Column({ name: 'released_by', type: 'uuid', nullable: true })
  releasedBy: string | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @Column({ name: 'release_reason', type: 'text', nullable: true })
  releaseReason: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

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
  @JoinColumn({ name: 'released_by' })
  releasedByUser: UserEntity | null;
}
