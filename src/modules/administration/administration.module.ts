import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { SystemConfigEntity } from './entities/system-config.entity.js';
import { BackgroundJobEntity } from './entities/background-job.entity.js';
import { BackgroundJobsService } from './services/background-jobs.service.js';
import { AuditLogsService } from './services/audit-logs.service.js';
import { BackgroundJobsController } from './controllers/background-jobs.controller.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * AdministrationModule quản lý:
 * - AuditLogEntity (audit_logs)
 * - SystemConfigEntity (system_configs)
 * - BackgroundJobEntity (background_jobs)
 * - BackgroundJobsService — lifecycle tracking cho background jobs
 * - AuditLogsService — ghi audit log dùng chung cho toàn hệ thống
 * - BackgroundJobsController — GET /api/v1/background-jobs/:id (T007, poll status)
 *
 * Module này KHÔNG import các business module (AccountsModule, RecordingModule...)
 * để tránh circular dependency. AuthModule là ngoại lệ AN TOÀN: chỉ import để
 * BackgroundJobsController dùng JwtAuthGuard (cần JwtService/AuthConfigService/
 * RedisService) — AuthModule KHÔNG import ngược AdministrationModule và KHÔNG
 * inject BackgroundJobsService/AuditLogsService, nên không tạo vòng phụ thuộc.
 *
 * @Global() — các module khác không cần import AdministrationModule
 * để dùng BackgroundJobsService và AuditLogsService.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([
      AuditLogEntity,
      SystemConfigEntity,
      BackgroundJobEntity,
    ]),
  ],
  controllers: [BackgroundJobsController],
  providers: [BackgroundJobsService, AuditLogsService],
  exports: [TypeOrmModule, BackgroundJobsService, AuditLogsService],
})
export class AdministrationModule {}
