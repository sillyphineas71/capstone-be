import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { IotDevice } from './iot-device.entity';

@Entity('iot_device_events')
export class IotDeviceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => IotDevice)
  @JoinColumn({ name: 'device_id' })
  device?: IotDevice;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'meeting_id', type: 'uuid', nullable: true })
  meetingId: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType: string;

  @Column({ name: 'event_time', type: 'timestamptz' })
  eventTime: Date;

  @Column({ name: 'source_protocol', type: 'varchar', length: 50 })
  sourceProtocol: string;

  @Column({ name: 'severity', type: 'varchar', length: 50, default: 'info' })
  severity: string;

  @Column({ name: 'payload_json', type: 'jsonb' })
  payloadJson: Record<string, any>;

  @Column({
    name: 'processed_status',
    type: 'varchar',
    length: 50,
    default: 'received',
  })
  processedStatus: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
