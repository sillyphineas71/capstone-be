import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';

export enum MediaFileType {
  AUDIO = 'audio',
  VIDEO = 'video',
  IMAGE = 'image',
  DOCUMENT = 'document',
  TRANSCRIPT = 'transcript',
  MINUTES_ATTACHMENT = 'minutes_attachment',
  EXPORT = 'export',
  EVIDENCE = 'evidence',
}

export enum StorageProvider {
  LOCAL = 'local',
  S3 = 's3',
  MINIO = 'minio',
  CLOUD_PROVIDER = 'cloud_provider',
}

export enum MediaVisibilityLevel {
  INTERNAL = 'internal',
  PARTICIPANTS = 'participants',
  DEPARTMENT = 'department',
  PUBLIC = 'public',
}

@Entity('media_files')
export class MediaFileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'file_code', type: 'varchar', length: 100, nullable: true })
  fileCode: string | null;

  @Column({ name: 'meeting_id', type: 'uuid', nullable: true })
  meetingId: string | null;

  @Column({
    name: 'related_entity_type',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  relatedEntityType: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  @Column({ name: 'recording_session_id', type: 'uuid', nullable: true })
  recordingSessionId: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'file_type', type: 'varchar', length: 50 })
  fileType: MediaFileType;

  @Column({ name: 'mime_type', type: 'varchar', length: 120 })
  mimeType: string;

  @Column({ name: 'storage_provider', type: 'varchar', length: 50 })
  storageProvider: StorageProvider;

  @Column({
    name: 'storage_bucket',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  storageBucket: string | null;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey: string;

  @Column({ name: 'file_url', type: 'text', nullable: true })
  fileUrl: string | null;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  checksum: string | null;

  @Column({ name: 'duration_seconds', type: 'integer', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'version_no', type: 'integer', default: 1 })
  versionNo: number;

  @Column({
    name: 'visibility_level',
    type: 'varchar',
    length: 30,
    default: MediaVisibilityLevel.INTERNAL,
  })
  visibilityLevel: MediaVisibilityLevel;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'uploaded_at', type: 'timestamptz', default: () => 'now()' })
  uploadedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedByUser: UserEntity | null;
}
