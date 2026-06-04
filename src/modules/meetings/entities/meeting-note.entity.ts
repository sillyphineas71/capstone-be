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
import { MeetingEntity } from './meeting.entity.js';
import { MeetingEventEntity } from './meeting-event.entity.js';

export enum MeetingNoteType {
  IN_MEETING = 'in_meeting',
  PRIVATE = 'private',
  HOST_NOTE = 'host_note',
  SYSTEM_NOTE = 'system_note',
}

@Entity('meeting_notes')
export class MeetingNoteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @Column({ name: 'note_type', type: 'varchar', length: 30, default: MeetingNoteType.IN_MEETING })
  noteType: MeetingNoteType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ name: 'visibility_level', type: 'varchar', length: 30, default: 'participants' })
  visibilityLevel: string;

  @Column({ name: 'source_event_id', type: 'uuid', nullable: true })
  sourceEventId: string | null;

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

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'author_id' })
  author: UserEntity;

  @ManyToOne(() => MeetingEventEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_event_id' })
  sourceEvent: MeetingEventEntity | null;
}
