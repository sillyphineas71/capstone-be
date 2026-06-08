import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { CaptureSessionChannelEntity } from '../../../modules/iot/entities/capture-session-channel.entity.js';
import { RecordingSessionEntity } from './recording-session.entity.js';
import { MediaFileEntity } from './media-file.entity.js';

export enum RecordingSegmentStatus {
  CREATED = 'created',
  SYNCED = 'synced',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

@Entity('recording_segments')
export class RecordingSegmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recording_session_id', type: 'uuid' })
  recordingSessionId: string;

  @Column({ name: 'capture_session_channel_id', type: 'uuid', nullable: true })
  captureSessionChannelId: string | null;

  @Column({
    name: 'seat_code_snapshot',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  seatCodeSnapshot: string | null;

  @Column({
    name: 'room_zone_label',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  roomZoneLabel: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'segment_start_time', type: 'timestamptz' })
  segmentStartTime: Date;

  @Column({ name: 'segment_end_time', type: 'timestamptz' })
  segmentEndTime: Date;

  @Column({ name: 'start_offset_ms', type: 'integer' })
  startOffsetMs: number;

  @Column({ name: 'end_offset_ms', type: 'integer' })
  endOffsetMs: number;

  @Column({ name: 'media_file_id', type: 'uuid', nullable: true })
  mediaFileId: string | null;

  @Column({ name: 'transcript_id', type: 'uuid', nullable: true })
  transcriptId: string | null;

  @Column({
    type: 'varchar',
    length: 30,
    default: RecordingSegmentStatus.CREATED,
  })
  status: RecordingSegmentStatus;

  @Column({
    name: 'confidence_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  confidenceScore: number | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => RecordingSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recording_session_id' })
  recordingSession: RecordingSessionEntity;

  @ManyToOne(() => CaptureSessionChannelEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'capture_session_channel_id' })
  captureSessionChannel: CaptureSessionChannelEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @ManyToOne(() => MediaFileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'media_file_id' })
  mediaFile: MediaFileEntity | null;
}
