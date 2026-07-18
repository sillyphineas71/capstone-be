import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { MeetingMinutesEntity } from './meeting-minutes.entity.js';

/**
 * meeting_minutes_shares — bảng ACL cấp quyền xem 1 biên bản cho user cụ thể
 * (feat-share-meeting-minutes). Host/preparedBy/Admin grant cho user nội bộ bất
 * kỳ ngoài danh sách participant. 1 dòng tồn tại = đang được share; xóa (hard
 * delete) = thu hồi. Lịch sử grant/revoke lưu qua audit_logs.
 */
@Entity('meeting_minutes_shares')
@Unique('uq_meeting_minutes_shares_minutes_user', ['minutesId', 'userId'])
export class MeetingMinutesShareEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_meeting_minutes_shares_minutes_id')
  @Column({ name: 'minutes_id', type: 'uuid' })
  minutesId: string;

  @Index('idx_meeting_minutes_shares_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'granted_by', type: 'uuid' })
  grantedBy: string;

  @CreateDateColumn({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  // Relations
  @ManyToOne(() => MeetingMinutesEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'minutes_id' })
  minutes: MeetingMinutesEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'granted_by' })
  grantedByUser: UserEntity;
}
