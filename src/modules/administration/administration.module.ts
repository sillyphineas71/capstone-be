import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { SystemConfigEntity } from './entities/system-config.entity.js';
import { BackgroundJobEntity } from './entities/background-job.entity.js';
import { BackgroundJobsService } from './services/background-jobs.service.js';
import { AuditLogsService } from './services/audit-logs.service.js';

/**
 * AdministrationModule quản lý:
 * - AuditLogEntity (audit_logs)
 * - SystemConfigEntity (system_configs)
 * - BackgroundJobEntity (background_jobs)
 * - BackgroundJobsService — lifecycle tracking cho background jobs
 * - AuditLogsService — ghi audit log dùng chung cho toàn hệ thống
 *
 * Module này KHÔNG import các business module khác (AccountsModule, RecordingModule...)
 * để tránh circular dependency.
 *
 * @Global() — các module khác không cần import AdministrationModule
 * để dùng BackgroundJobsService và AuditLogsService.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      AuditLogEntity,
      SystemConfigEntity,
      BackgroundJobEntity,
    ]),
  ],
  providers: [BackgroundJobsService, AuditLogsService],
  exports: [TypeOrmModule, BackgroundJobsService, AuditLogsService],
})
export class AdministrationModule {}
