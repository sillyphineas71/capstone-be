import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { RoomEntity } from '../../../modules/rooms/entities/room.entity.js';
import { IoTDeviceEntity } from '../../../modules/iot/entities/iot-device.entity.js';
import { CaptureSessionEntity } from '../../../modules/iot/entities/capture-session.entity.js';
import { RecordingConfigEntity } from './recording-config.entity.js';

export enum RecordingSessionType {
  AUDIO = 'audio',
  VIDEO = 'video',
  MIXED = 'mixed',
}

export enum RecordingSourceType {
  IP_CAMERA = 'ip_camera',
  CAPTURE_AGENT = 'capture_agent',
  MANUAL_UPLOAD = 'manual_upload',
  EXTERNAL = 'external',
}

export enum RecordingSessionStatus {
  STARTING = 'starting',
  RECORDING = 'recording',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  FAILED = 'failed',
  PROCESSING = 'processing',
}

@Entity('recording_sessions')
export class RecordingSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'recording_config_id', type: 'uuid', nullable: true })
  recordingConfigId: string | null;

  @Column({ name: 'session_type', type: 'varchar', length: 30 })
  sessionType: RecordingSessionType;

  @Column({ name: 'source_type', type: 'varchar', length: 40 })
  sourceType: RecordingSourceType;

  @Column({ name: 'capture_session_id', type: 'uuid', nullable: true })
  captureSessionId: string | null;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'stopped_at', type: 'timestamptz', nullable: true })
  stoppedAt: Date | null;

  @Column({ name: 'paused_duration_seconds', type: 'integer', default: 0 })
  pausedDurationSeconds: number;

  @Column({ type: 'varchar', length: 30, default: RecordingSessionStatus.STARTING })
  status: RecordingSessionStatus;

  @Column({ name: 'started_by', type: 'uuid', nullable: true })
  startedBy: string | null;

  @Column({ name: 'stopped_by', type: 'uuid', nullable: true })
  stoppedBy: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'storage_provider', type: 'varchar', length: 50, nullable: true })
  storageProvider: string | null;

  @Column({ name: 'storage_path', type: 'text', nullable: true })
  storagePath: string | null;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: string | null;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  checksum: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity | null;

  @ManyToOne(() => RecordingConfigEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recording_config_id' })
  recordingConfig: RecordingConfigEntity | null;

  @ManyToOne(() => CaptureSessionEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'capture_session_id' })
  captureSession: CaptureSessionEntity | null;

  @ManyToOne(() => IoTDeviceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'device_id' })
  device: IoTDeviceEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'started_by' })
  startedByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'stopped_by' })
  stoppedByUser: UserEntity | null;
}
