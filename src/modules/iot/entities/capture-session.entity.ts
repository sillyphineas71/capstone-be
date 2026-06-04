import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { RoomEntity } from '../../../modules/rooms/entities/room.entity.js';
import { IoTDeviceEntity } from './iot-device.entity.js';

export enum CaptureSessionStatus {
  STARTING = 'starting',
  ACTIVE = 'active',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  FAILED = 'failed',
}

@Entity('capture_sessions')
export class CaptureSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'capture_agent_device_id', type: 'uuid' })
  captureAgentDeviceId: string;

  @Column({ name: 'recording_session_id', type: 'uuid', nullable: true })
  recordingSessionId: string | null;

  @Column({ name: 'session_status', type: 'varchar', length: 30, default: CaptureSessionStatus.STARTING })
  sessionStatus: CaptureSessionStatus;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ name: 'stopped_at', type: 'timestamptz', nullable: true })
  stoppedAt: Date | null;

  @Column({ name: 'started_by', type: 'uuid', nullable: true })
  startedBy: string | null;

  @Column({ name: 'stopped_by', type: 'uuid', nullable: true })
  stoppedBy: string | null;

  @Column({ name: 'clock_sync_offset_ms', type: 'integer', nullable: true })
  clockSyncOffsetMs: number | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  // Relations
  @ManyToOne(() => MeetingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity;

  @ManyToOne(() => RoomEntity)
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity;

  @ManyToOne(() => IoTDeviceEntity)
  @JoinColumn({ name: 'capture_agent_device_id' })
  captureAgentDevice: IoTDeviceEntity;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'started_by' })
  startedByUser: UserEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'stopped_by' })
  stoppedByUser: UserEntity | null;
}
