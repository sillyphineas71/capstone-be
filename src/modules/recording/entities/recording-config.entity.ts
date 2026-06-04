import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { IoTDeviceEntity } from '../../../modules/iot/entities/iot-device.entity.js';
import { MediaFileEntity } from './media-file.entity.js';

export enum RecordingConfigStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  DISABLED = 'disabled',
  ARCHIVED = 'archived',
}

export enum AudioSourceMode {
  ROOM_MIX = 'room_mix',
  CHANNEL_BY_ZONE = 'channel_by_zone',
  SINGLE_MICROPHONE = 'single_microphone',
}

@Entity('recording_configs')
export class RecordingConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'policy_key', type: 'varchar', length: 120, nullable: true })
  policyKey: string | null;

  @Column({ name: 'policy_snapshot_json', type: 'jsonb', nullable: true })
  policySnapshotJson: Record<string, unknown> | null;

  @Column({ name: 'enable_audio', type: 'boolean', default: false })
  enableAudio: boolean;

  @Column({ name: 'enable_video', type: 'boolean', default: false })
  enableVideo: boolean;

  @Column({ name: 'enable_transcription', type: 'boolean', default: false })
  enableTranscription: boolean;

  @Column({ name: 'video_source_device_id', type: 'uuid', nullable: true })
  videoSourceDeviceId: string | null;

  @Column({ name: 'audio_source_mode', type: 'varchar', length: 40, nullable: true })
  audioSourceMode: AudioSourceMode | null;

  @Column({ name: 'auto_start', type: 'boolean', default: false })
  autoStart: boolean;

  @Column({ name: 'consent_required', type: 'boolean', default: true })
  consentRequired: boolean;

  @Column({ name: 'retention_days', type: 'integer', nullable: true })
  retentionDays: number | null;

  @Column({ name: 'configured_by', type: 'uuid', nullable: true })
  configuredBy: string | null;

  @Column({ name: 'configured_at', type: 'timestamptz', default: () => 'now()' })
  configuredAt: Date;

  @Column({ name: 'config_json', type: 'jsonb', nullable: true })
  configJson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 30, default: RecordingConfigStatus.DRAFT })
  status: RecordingConfigStatus;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => IoTDeviceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'video_source_device_id' })
  videoSourceDevice: IoTDeviceEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'configured_by' })
  configuredByUser: UserEntity | null;
}
