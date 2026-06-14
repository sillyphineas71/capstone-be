import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { MediaFileEntity } from '../../../modules/recording/entities/media-file.entity.js';
import { RecordingSessionEntity } from '../../../modules/recording/entities/recording-session.entity.js';

export enum TranscriptSecurityStatus {
  PENDING_SCAN = 'pending_scan',
  SAFE = 'safe',
  RESTRICTED = 'restricted',
  BLOCKED = 'blocked',
}

export enum TranscriptStatus {
  PROCESSING = 'processing',
  DRAFT = 'draft',
  REVIEWED = 'reviewed',
  APPROVED = 'approved',
  FAILED = 'failed',
  HIDDEN = 'hidden',
}

@Entity('transcripts')
export class TranscriptEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'source_media_file_id', type: 'uuid', nullable: true })
  sourceMediaFileId: string | null;

  @Column({ name: 'recording_session_id', type: 'uuid', nullable: true })
  recordingSessionId: string | null;

  @Column({ name: 'background_job_id', type: 'uuid', nullable: true })
  backgroundJobId: string | null;

  @Column({ name: 'version_no', type: 'integer', default: 1 })
  versionNo: number;

  @Column({
    name: 'language_code',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  languageCode: string | null;

  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText: string | null;

  @Column({ name: 'cleaned_text', type: 'text', nullable: true })
  cleanedText: string | null;

  @Column({ name: 'speaker_segments_json', type: 'jsonb', nullable: true })
  speakerSegmentsJson: Record<string, unknown> | null;

  @Column({ name: 'detected_speakers_json', type: 'jsonb', nullable: true })
  detectedSpeakersJson: Record<string, unknown> | null;

  @Column({
    name: 'security_status',
    type: 'varchar',
    length: 30,
    default: TranscriptSecurityStatus.PENDING_SCAN,
  })
  securityStatus: TranscriptSecurityStatus;

  @Column({
    name: 'confidence_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  confidenceScore: number | null;

  @Column({ type: 'varchar', length: 30, default: TranscriptStatus.PROCESSING })
  status: TranscriptStatus;

  @Column({ name: 'edited_by', type: 'uuid', nullable: true })
  editedBy: string | null;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'search_keywords', type: 'text', nullable: true })
  searchKeywords: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => MediaFileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_media_file_id' })
  sourceMediaFile: MediaFileEntity | null;

  @ManyToOne(() => RecordingSessionEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'recording_session_id' })
  recordingSession: RecordingSessionEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'edited_by' })
  editedByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approvedByUser: UserEntity | null;
}
