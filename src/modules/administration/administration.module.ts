import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { SystemConfigEntity } from './entities/system-config.entity.js';
import { BackgroundJobEntity } from './entities/background-job.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RecordingModule } from '../recording/recording.module.js';

/**
 * AdministrationModule quản lý:
 * - AuditLogEntity (audit_logs) — entity định nghĩa để các business module có thể dùng,
 *   nhưng auth module TIẾP TỤC dùng raw SQL cho security-sensitive audit entries.
 * - SystemConfigEntity (system_configs)
 * - BackgroundJobEntity (background_jobs)
 */
@Module({
  imports: [
    AccountsModule,
    RecordingModule,
    TypeOrmModule.forFeature([AuditLogEntity, SystemConfigEntity, BackgroundJobEntity]),
  ],
  exports: [TypeOrmModule],
})
export class AdministrationModule {}
