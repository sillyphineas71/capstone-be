import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { FaceProfileEntity } from '../../../modules/accounts/entities/face-profile.entity.js';
import { IoTDeviceEntity } from './iot-device.entity.js';

@Entity('device_user_mappings')
export class DeviceUserMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'face_profile_id', type: 'uuid', nullable: true })
  faceProfileId: string | null;

  @Column({ name: 'device_person_id', type: 'varchar', length: 100, nullable: true })
  devicePersonId: string | null;

  @Column({ name: 'device_person_code', type: 'varchar', length: 100, nullable: true })
  devicePersonCode: string | null;

  @Column({ name: 'device_person_name', type: 'varchar', length: 255, nullable: true })
  devicePersonName: string | null;

  @Column({ name: 'face_registered', type: 'boolean', default: false })
  faceRegistered: boolean;

  @Column({ name: 'registered_at', type: 'timestamptz', nullable: true })
  registeredAt: Date | null;

  @Column({ name: 'registered_by', type: 'uuid', nullable: true })
  registeredBy: string | null;

  @Column({ name: 'sync_status', type: 'varchar', length: 30, default: 'pending' })
  syncStatus: string;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'last_sync_error', type: 'text', nullable: true })
  lastSyncError: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => IoTDeviceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: IoTDeviceEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => FaceProfileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'face_profile_id' })
  faceProfile: FaceProfileEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'registered_by' })
  registeredByUser: UserEntity | null;
}
