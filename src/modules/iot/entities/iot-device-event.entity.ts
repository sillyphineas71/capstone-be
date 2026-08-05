import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { MeetingEntity } from '../../../modules/meetings/entities/meeting.entity.js';
import { RoomEntity } from '../../../modules/rooms/entities/room.entity.js';
import { IoTDeviceEntity } from './iot-device.entity.js';

export enum IoTDeviceEventType {
  HEARTBEAT = 'heartbeat',
  DEVICE_ERROR = 'device_error',
  STREAM_STARTED = 'stream_started',
  STREAM_STOPPED = 'stream_stopped',
  MQTT_MESSAGE = 'mqtt_message',
  FACE_DETECTED = 'face_detected',
  FACE_VERIFY = 'face_verify',
  FACE_STRANGER = 'face_stranger',
}

export enum IoTEventSourceProtocol {
  MQTT = 'mqtt',
  RTSP = 'rtsp',
  HTTP = 'http',
  WEBSOCKET = 'websocket',
  MANUAL = 'manual',
}

export enum IoTEventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export enum IoTEventProcessedStatus {
  RECEIVED = 'received',
  PROCESSED = 'processed',
  IGNORED = 'ignored',
  FAILED = 'failed',
}

@Entity('iot_device_events')
export class IoTDeviceEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  /**
   * SAVP Zone scope (migration 20260721000003) — zone phát sinh event.
   * Song song với `room_id`, KHÔNG thay thế. Cột-only (không khai @ManyToOne)
   * để tránh circular import giữa module `iot` và module `zones`.
   */
  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ name: 'meeting_id', type: 'uuid', nullable: true })
  meetingId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 60 })
  eventType: IoTDeviceEventType;

  @Column({ name: 'event_time', type: 'timestamptz', default: () => 'now()' })
  eventTime: Date;

  @Column({
    name: 'source_protocol',
    type: 'varchar',
    length: 30,
    default: IoTEventSourceProtocol.MQTT,
  })
  sourceProtocol: IoTEventSourceProtocol;

  @Column({ type: 'varchar', length: 20, default: IoTEventSeverity.INFO })
  severity: IoTEventSeverity;

  @Column({ name: 'payload_json', type: 'jsonb', nullable: true })
  payloadJson: Record<string, unknown> | null;

  @Column({
    name: 'processed_status',
    type: 'varchar',
    length: 30,
    default: IoTEventProcessedStatus.RECEIVED,
  })
  processedStatus: IoTEventProcessedStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  /**
   * F-E — ảnh snapshot của event (nếu có), FK → media_files(id). Dùng chung cho
   * IVSS unmatched (F-B), zone appear khả năng vi phạm (F-C), ANPR (F-D).
   */
  @Column({ name: 'snapshot_file_id', type: 'uuid', nullable: true })
  snapshotFileId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Relations
  @ManyToOne(() => IoTDeviceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device: IoTDeviceEntity;

  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity | null;

  @ManyToOne(() => MeetingEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: MeetingEntity | null;
}
