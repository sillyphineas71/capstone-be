import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from './meeting.entity.js';

export enum AgendaStatus {
  PLANNED = 'planned',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  SKIPPED = 'skipped',
}

@Entity('meeting_agendas')
export class MeetingAgendaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'agenda_order', type: 'integer' })
  agendaOrder: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ name: 'planned_duration_minutes', type: 'integer', nullable: true })
  plannedDurationMinutes: number | null;

  @Column({ name: 'actual_duration_minutes', type: 'integer', nullable: true })
  actualDurationMinutes: number | null;

  @Column({ name: 'result_note', type: 'text', nullable: true })
  resultNote: string | null;

  @Column({ type: 'varchar', length: 30, default: AgendaStatus.PLANNED })
  status: AgendaStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'owner_id' })
  owner: UserEntity | null;
}
