import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IotDeviceType {
  DOOR_FACE_TERMINAL = 'door_face_terminal',
  IP_ROOM_CAMERA = 'ip_room_camera',
  ROOM_CAMERA = 'room_camera',
  MICROPHONE = 'microphone',
  CAPTURE_AGENT = 'capture_agent',
  OCCUPANCY_SENSOR = 'occupancy_sensor',
  DISPLAY = 'display',
  OTHER = 'other',
}

@Entity('iot_devices')
export class IotDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_name', type: 'varchar', length: 255 })
  deviceName: string;

  @Column({ name: 'device_code', type: 'varchar' })
  deviceCode: string;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'device_type', type: 'varchar', length: 50 })
  deviceType: IotDeviceType;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ name: 'mac_address', type: 'varchar', nullable: true })
  macAddress: string | null;

  @Column({ type: 'varchar', default: 'offline' })
  status: string;

  @Column({ name: 'health_status', type: 'varchar', default: 'unknown' })
  healthStatus: string;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, any> | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
