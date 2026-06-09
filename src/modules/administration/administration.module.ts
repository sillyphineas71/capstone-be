import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { SystemConfigEntity } from './entities/system-config.entity.js';
import { BackgroundJobEntity } from './entities/background-job.entity.js';

/**
 * AdministrationModule quản lý:
 * - AuditLogEntity (audit_logs) — entity định nghĩa để các business module có thể dùng,
 *   nhưng auth module TIẾP TỤC dùng raw SQL cho security-sensitive audit entries.
 * - SystemConfigEntity (system_configs)
 * - BackgroundJobEntity (background_jobs)
 *
 * Module này KHÔNG import các business module khác (AccountsModule, RecordingModule...)
 * để tránh circular dependency. Nó chỉ đăng ký entities và export TypeOrmModule.
 * Các module cần dùng entities từ đây chỉ cần import AdministrationModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      SystemConfigEntity,
      BackgroundJobEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class AdministrationModule {}
