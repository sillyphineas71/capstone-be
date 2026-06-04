import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';

export enum NotificationType {
  MEETING_INVITE = 'meeting_invite',
  REMINDER = 'reminder',
  CANCELLATION = 'cancellation',
  NO_SHOW_ALERT = 'no_show_alert',
  UNKNOWN_FACE_ALERT = 'unknown_face_alert',
  MINUTES_DISTRIBUTION = 'minutes_distribution',
}

export enum NotificationChannel {
  EMAIL = 'email',
  IN_APP = 'in_app',
  WEBSOCKET = 'websocket',
  SMS = 'sms',
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum NotificationDeliveryStatus {
  DRAFT = 'draft',
  QUEUED = 'queued',
  SENT = 'sent',
  PARTIAL_FAILED = 'partial_failed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('notifications')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'notification_code', type: 'varchar', length: 100, nullable: true })
  notificationCode: string | null;

  @Column({ name: 'notification_type', type: 'varchar', length: 60 })
  notificationType: NotificationType;

  @Column({ type: 'varchar', length: 30 })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'related_entity_type', type: 'varchar', length: 60, nullable: true })
  relatedEntityType: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  @Column({ name: 'recipient_scope', type: 'varchar', length: 40, default: 'user_list' })
  recipientScope: string;

  @Column({ name: 'recipient_user_ids_json', type: 'jsonb', nullable: true })
  recipientUserIdsJson: string[] | null;

  @Column({ name: 'recipient_emails_json', type: 'jsonb', nullable: true })
  recipientEmailsJson: string[] | null;

  @Column({ name: 'recipient_phones_json', type: 'jsonb', nullable: true })
  recipientPhonesJson: string[] | null;

  @Column({ type: 'varchar', length: 20, default: NotificationPriority.NORMAL })
  priority: NotificationPriority;

  @Column({ name: 'scheduled_send_at', type: 'timestamptz', nullable: true })
  scheduledSendAt: Date | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'delivery_status', type: 'varchar', length: 30, default: NotificationDeliveryStatus.DRAFT })
  deliveryStatus: NotificationDeliveryStatus;

  @Column({ name: 'read_count', type: 'integer', default: 0 })
  readCount: number;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'sent_by', type: 'uuid', nullable: true })
  sentBy: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'payload_json', type: 'jsonb', nullable: true })
  payloadJson: Record<string, unknown> | null;

  @Column({ name: 'delivery_result_json', type: 'jsonb', nullable: true })
  deliveryResultJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sent_by' })
  sentByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;
}
