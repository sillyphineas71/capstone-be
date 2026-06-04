import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { IoTDeviceEntity } from './iot-device.entity.js';
import { CaptureSessionEntity } from './capture-session.entity.js';

export enum AudioSourceType {
  TABLE_MIC = 'table_mic',
  CEILING_MIC = 'ceiling_mic',
  LAPEL_MIC = 'lapel_mic',
  MIXED = 'mixed',
  VIRTUAL = 'virtual',
}

export enum CaptureChannelStatus {
  ACTIVE = 'active',
  MUTED = 'muted',
  NOISY = 'noisy',
  DISCONNECTED = 'disconnected',
  DISABLED = 'disabled',
}

@Entity('capture_session_channels')
export class CaptureSessionChannelEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'capture_session_id', type: 'uuid' })
  captureSessionId: string;

  @Column({ name: 'channel_id', type: 'varchar', length: 80 })
  channelId: string;

  @Column({ name: 'iot_device_id', type: 'uuid', nullable: true })
  iotDeviceId: string | null;

  @Column({ name: 'channel_label', type: 'varchar', length: 100, nullable: true })
  channelLabel: string | null;

  @Column({ name: 'audio_source_type', type: 'varchar', length: 40, default: AudioSourceType.MIXED })
  audioSourceType: AudioSourceType;

  @Column({ name: 'room_zone_label', type: 'varchar', length: 100, nullable: true })
  roomZoneLabel: string | null;

  @Column({ name: 'seat_code_snapshot', type: 'varchar', length: 80, nullable: true })
  seatCodeSnapshot: string | null;

  @Column({ name: 'participant_user_id', type: 'uuid', nullable: true })
  participantUserId: string | null;

  @Column({ name: 'confidence_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  confidenceScore: number | null;

  @Column({ name: 'sample_rate', type: 'integer', nullable: true })
  sampleRate: number | null;

  @Column({ name: 'bit_depth', type: 'integer', nullable: true })
  bitDepth: number | null;

  @Column({ type: 'varchar', length: 30, default: CaptureChannelStatus.ACTIVE })
  status: CaptureChannelStatus;

  @Column({ name: 'calibration_json', type: 'jsonb', nullable: true })
  calibrationJson: Record<string, unknown> | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => CaptureSessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'capture_session_id' })
  captureSession: CaptureSessionEntity;

  @ManyToOne(() => IoTDeviceEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'iot_device_id' })
  iotDevice: IoTDeviceEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'participant_user_id' })
  participantUser: UserEntity | null;
}
