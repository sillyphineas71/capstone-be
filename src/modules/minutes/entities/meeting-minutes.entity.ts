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
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { MediaFileEntity } from '../../../modules/recording/entities/media-file.entity.js';
import { TranscriptEntity } from '../../../modules/transcription/entities/transcript.entity.js';

export enum MeetingMinutesStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
  DELETED = 'deleted',
}

export enum MeetingMinutesVisibilityLevel {
  PRIVATE = 'private',
  PARTICIPANTS = 'participants',
  DEPARTMENT = 'department',
  PUBLIC_INTERNAL = 'public_internal',
}

@Entity('meeting_minutes')
export class MeetingMinutesEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ name: 'version_no', type: 'integer', default: 1 })
  versionNo: number;

  @Column({ type: 'varchar', length: 30, default: MeetingMinutesStatus.DRAFT })
  status: MeetingMinutesStatus;

  @Column({
    name: 'visibility_level',
    type: 'varchar',
    length: 30,
    default: MeetingMinutesVisibilityLevel.PARTICIPANTS,
  })
  visibilityLevel: MeetingMinutesVisibilityLevel;

  @Column({ name: 'minutes_content', type: 'text' })
  minutesContent: string;

  @Column({ name: 'attendees_snapshot_json', type: 'jsonb', nullable: true })
  attendeesSnapshotJson: Record<string, unknown> | null;

  @Column({ name: 'decisions_json', type: 'jsonb', nullable: true })
  decisionsJson: Record<string, unknown> | null;

  @Column({ name: 'action_items_json', type: 'jsonb', nullable: true })
  actionItemsJson: Record<string, unknown> | null;

  /**
   * MKM-AI-01: NULL = biên bản soạn thủ công; khác NULL = bản nháp có nguồn
   * gốc AI (keyPoints/risks/openQuestions/uncertainParts + meta). Dùng để
   * phân biệt khi forceRerun — chỉ được ghi đè bản nháp AI (FR-016/FR-020).
   */
  @Column({ name: 'ai_summary_json', type: 'jsonb', nullable: true })
  aiSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'linked_transcript_id', type: 'uuid', nullable: true })
  linkedTranscriptId: string | null;

  @Column({ name: 'linked_recording_file_id', type: 'uuid', nullable: true })
  linkedRecordingFileId: string | null;

  @Column({ name: 'issued_by', type: 'uuid', nullable: true })
  issuedBy: string | null;

  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  issuedAt: Date | null;

  @Column({ name: 'prepared_by', type: 'uuid', nullable: true })
  preparedBy: string | null;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'file_id', type: 'uuid', nullable: true })
  fileId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => TranscriptEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'linked_transcript_id' })
  linkedTranscript: TranscriptEntity | null;

  @ManyToOne(() => MediaFileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'linked_recording_file_id' })
  linkedRecordingFile: MediaFileEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'issued_by' })
  issuedByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'approved_by' })
  approvedByUser: UserEntity | null;

  @ManyToOne(() => MediaFileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'file_id' })
  file: MediaFileEntity | null;
}
