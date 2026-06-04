import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { MeetingEntity } from './meeting.entity.js';

@Entity('meeting_external_participants')
export class MeetingExternalParticipantEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 30, nullable: true })
  phoneNumber: string | null;

  @Column({ name: 'organization_name', type: 'varchar', length: 255, nullable: true })
  organizationName: string | null;

  @Column({ name: 'participant_role', type: 'varchar', length: 40, default: 'attendee' })
  participantRole: string;

  @Column({ name: 'invitation_status', type: 'varchar', length: 30, default: 'pending' })
  invitationStatus: string;

  @Column({ name: 'response_at', type: 'timestamptz', nullable: true })
  responseAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;
}
