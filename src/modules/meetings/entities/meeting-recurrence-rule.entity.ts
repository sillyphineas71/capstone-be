import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';

export enum RecurrenceType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  CUSTOM_RRULE = 'custom_rrule',
}

@Entity('meeting_recurrence_rules')
export class MeetingRecurrenceRuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recurrence_type', type: 'varchar', length: 30 })
  recurrenceType: RecurrenceType;

  @Column({ name: 'interval_value', type: 'integer', default: 1 })
  intervalValue: number;

  @Column({ name: 'days_of_week', type: 'varchar', length: 50, nullable: true })
  daysOfWeek: string | null;

  @Column({ name: 'day_of_month', type: 'integer', nullable: true })
  dayOfMonth: number | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ name: 'occurrence_count', type: 'integer', nullable: true })
  occurrenceCount: number | null;

  @Column({ name: 'rrule_text', type: 'text', nullable: true })
  rruleText: string | null;

  @Column({ type: 'varchar', length: 60, default: 'Asia/Ho_Chi_Minh' })
  timezone: string;

  @Column({ name: 'exception_dates_json', type: 'jsonb', nullable: true })
  exceptionDatesJson: Record<string, unknown> | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;
}
