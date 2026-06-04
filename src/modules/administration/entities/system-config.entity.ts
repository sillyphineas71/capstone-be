import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, UpdateDateColumn } from 'typeorm';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';

export enum SystemConfigValueType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  JSON = 'json',
  SECRET_REF = 'secret_ref',
}

@Entity('system_configs')
export class SystemConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'config_key', type: 'varchar', length: 120 })
  configKey: string;

  @Column({ name: 'config_value', type: 'text', nullable: true })
  configValue: string | null;

  @Column({ name: 'config_json', type: 'jsonb', nullable: true })
  configJson: Record<string, unknown> | null;

  @Column({ name: 'value_type', type: 'varchar', length: 30, default: SystemConfigValueType.STRING })
  valueType: SystemConfigValueType;

  @Column({ name: 'config_group', type: 'varchar', length: 80 })
  configGroup: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'version_no', type: 'integer', default: 1 })
  versionNo: number;

  @Column({ name: 'is_sensitive', type: 'boolean', default: false })
  isSensitive: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by' })
  updatedByUser: UserEntity | null;
}
