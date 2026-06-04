import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../../modules/meetings/entities/meeting-participant.entity.js';
import { RoomEntity } from '../../../modules/rooms/entities/room.entity.js';

export enum PresenceStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  LEFT = 'left',
  UNKNOWN = 'unknown',
  MAYBE_PRESENT = 'maybe_present',
}

export enum PresenceSourceType {
  CAMERA = 'camera',
  MANUAL = 'manual',
  SENSOR = 'sensor',
  MIXED = 'mixed',
}

@Entity('presence_snapshots')
export class PresenceSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'participant_id', type: 'uuid', nullable: true })
  participantId: string | null;

  @Column({ name: 'presence_status', type: 'varchar', length: 30, default: PresenceStatus.UNKNOWN })
  presenceStatus: PresenceStatus;

  @Column({ name: 'occupancy_count', type: 'integer', nullable: true })
  occupancyCount: number | null;

  @Column({ name: 'snapshot_time', type: 'timestamptz' })
  snapshotTime: Date;

  @Column({ name: 'source_type', type: 'varchar', length: 40, default: PresenceSourceType.MIXED })
  sourceType: PresenceSourceType;

  @Column({ name: 'confidence_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  confidenceScore: number | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => RoomEntity)
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @ManyToOne(() => MeetingParticipantEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'participant_id' })
  participant: MeetingParticipantEntity | null;
}
