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
import { RoomEntity } from '../../../modules/rooms/entities/room.entity.js';

export enum EquipmentType {
  CAMERA = 'camera',
  MICROPHONE = 'microphone',
  DISPLAY = 'display',
  SPEAKER = 'speaker',
  CAPTURE_AGENT = 'capture_agent',
  SENSOR = 'sensor',
  OTHER = 'other',
}

export enum AssetStatus {
  AVAILABLE = 'available',
  ASSIGNED = 'assigned',
  RETIRED = 'retired',
  LOST = 'lost',
  MAINTENANCE = 'maintenance',
}

export enum HealthStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  FAULTY = 'faulty',
  OFFLINE = 'offline',
  UNKNOWN = 'unknown',
}

@Entity('equipments')
export class EquipmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'equipment_code', type: 'varchar', length: 80 })
  equipmentCode: string;

  @Column({ name: 'equipment_name', type: 'varchar', length: 150 })
  equipmentName: string;

  @Column({ name: 'equipment_type', type: 'varchar', length: 50 })
  equipmentType: EquipmentType;

  @Column({ name: 'serial_number', type: 'varchar', length: 120, nullable: true })
  serialNumber: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ name: 'purchase_date', type: 'date', nullable: true })
  purchaseDate: string | null;

  @Column({ name: 'asset_status', type: 'varchar', length: 30, default: AssetStatus.AVAILABLE })
  assetStatus: AssetStatus;

  @Column({ name: 'health_status', type: 'varchar', length: 30, default: HealthStatus.UNKNOWN })
  healthStatus: HealthStatus;

  @Column({ name: 'current_room_id', type: 'uuid', nullable: true })
  currentRoomId: string | null;

  @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
  assignedBy: string | null;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({ name: 'installed_at', type: 'timestamptz', nullable: true })
  installedAt: Date | null;

  @Column({ name: 'assignment_note', type: 'text', nullable: true })
  assignmentNote: string | null;

  @Column({ name: 'iot_device_id', type: 'uuid', nullable: true })
  iotDeviceId: string | null;

  @Column({ name: 'last_maintenance_at', type: 'timestamptz', nullable: true })
  lastMaintenanceAt: Date | null;

  @Column({ name: 'last_issue_reported_at', type: 'timestamptz', nullable: true })
  lastIssueReportedAt: Date | null;

  @Column({ name: 'last_issue_note', type: 'text', nullable: true })
  lastIssueNote: string | null;

  @Column({ name: 'specification_json', type: 'jsonb', nullable: true })
  specificationJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'current_room_id' })
  currentRoom: RoomEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by' })
  assignedByUser: UserEntity | null;
}
