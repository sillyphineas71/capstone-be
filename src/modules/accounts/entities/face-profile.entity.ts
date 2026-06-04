import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, DeleteDateColumn } from 'typeorm';
import { UserEntity } from './user.entity.js';

export enum FaceProfileStatus {
  ACTIVE = 'active',
  PENDING_REVIEW = 'pending_review',
  DISABLED = 'disabled',
  REVOKED = 'revoked',
}

@Entity('face_profiles')
export class FaceProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'profile_code', type: 'varchar', length: 80 })
  profileCode: string;

  @Column({ type: 'varchar', length: 30, default: FaceProfileStatus.PENDING_REVIEW })
  status: FaceProfileStatus;

  @Column({ name: 'consent_at', type: 'timestamptz', nullable: true })
  consentAt: Date | null;

  @Column({ name: 'model_version', type: 'varchar', length: 80, nullable: true })
  modelVersion: string | null;

  @Column({ name: 'primary_image_file_id', type: 'uuid', nullable: true })
  primaryImageFileId: string | null;

  @Column({ name: 'embedding_storage_key', type: 'text', nullable: true })
  embeddingStorageKey: string | null;

  @Column({ name: 'quality_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  qualityScore: number | null;

  @Column({ name: 'sample_count', type: 'integer', default: 0 })
  sampleCount: number;

  @Column({ name: 'enrolled_by', type: 'uuid', nullable: true })
  enrolledBy: string | null;

  @Column({ name: 'enrolled_at', type: 'timestamptz', nullable: true })
  enrolledAt: Date | null;

  @Column({ name: 'last_updated_at', type: 'timestamptz', nullable: true })
  lastUpdatedAt: Date | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'enrolled_by' })
  enrolledByUser: UserEntity | null;
}
