import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MediaFileEntity } from '../../../modules/recording/entities/media-file.entity.js';

export enum BackgroundJobType {
  IMPORT_ACCOUNTS = 'import_accounts',
  IMPORT_PARTICIPANTS = 'import_participants',
  SEND_EMAIL = 'send_email',
  TRANSCRIPTION = 'transcription',
  EXPORT_REPORT = 'export_report',
  EXPORT_MINUTES = 'export_minutes',
  MEDIA_PROCESSING = 'media_processing',
  // UC-IMM-12: Warning schedule delayed job
  MEETING_TIME_WARNING = 'meeting_time_warning',
  // UC-ROOM-03: xu ly bat dong bo goi y phong thay the + gui notification
  // sau khi xoa phong hop (cot DB la varchar, khong can migration)
  ROOM_DELETE_NOTIFY = 'room_delete_notify',
}

export enum BackgroundJobStatus {
  QUEUED = 'queued',
  SCHEDULED = 'scheduled', // UC-IMM-12: Delayed job waiting to fire at scheduledAt
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
}

@Entity('background_jobs')
export class BackgroundJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'job_type', type: 'varchar', length: 80 })
  jobType: BackgroundJobType;

  @Column({
    name: 'related_entity_type',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  relatedEntityType: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy: string | null;

  @Column({ name: 'queue_name', type: 'varchar', length: 100, nullable: true })
  queueName: string | null;

  @Column({ type: 'varchar', length: 30, default: BackgroundJobStatus.QUEUED })
  status: BackgroundJobStatus;

  @Column({ type: 'integer', default: 0 })
  priority: number;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'input_json', type: 'jsonb', nullable: true })
  inputJson: Record<string, unknown> | null;

  @Column({ name: 'output_json', type: 'jsonb', nullable: true })
  outputJson: Record<string, unknown> | null;

  @Column({ name: 'output_file_id', type: 'uuid', nullable: true })
  outputFileId: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by' })
  requestedByUser: UserEntity | null;

  @ManyToOne(() => MediaFileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'output_file_id' })
  outputFile: MediaFileEntity | null;
}
