import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * ZoneEntity (SAVP Zone scope) — không gian có kiểm soát (phòng họp, cổng, khu vực).
 *
 * Schema-only: KHÔNG logic nghiệp vụ (CRUD/gán device/đánh giá occupancy = UC sau).
 * - `zone_code` là cột TRAP: partial unique WHERE deleted_at IS NULL (xem migration
 *   20260721000001) → chặn trùng code ĐANG SỐNG, vẫn cho tái sử dụng sau soft-delete.
 * - `zone_type` phân loại: room / gate / area... (giữ varchar, không ràng enum ở DB).
 * - Soft-delete (`deleted_at`) mirror pattern `vehicle_registrations`.
 *
 * Zone song song với `rooms`, KHÔNG thay thế: `iot_devices` giữ cả `room_id` và `zone_id`.
 */
@Entity('zones')
export class ZoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'zone_code', type: 'varchar', length: 80 })
  zoneCode: string;

  @Column({ name: 'zone_name', type: 'varchar', length: 150 })
  zoneName: string;

  @Column({ name: 'zone_type', type: 'varchar', length: 30, default: 'room' })
  zoneType: string;

  @Column({ name: 'building', type: 'varchar', length: 100, nullable: true })
  building: string | null;

  @Column({ name: 'floor', type: 'varchar', length: 30, nullable: true })
  floor: string | null;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @Column({ name: 'status', type: 'varchar', length: 30, default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
