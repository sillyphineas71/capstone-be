import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { SystemConfigEntity } from './entities/system-config.entity.js';
import { BackgroundJobEntity } from './entities/background-job.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { BackgroundJobsService } from './services/background-jobs.service.js';
import { AuditLogsService } from './services/audit-logs.service.js';
import { AuditLogQueryService } from './services/audit-log-query.service.js';
import { AuditLogQueryRepository } from './repositories/audit-log-query.repository.js';
import { BackgroundJobsController } from './controllers/background-jobs.controller.js';
import { AuditLogsController } from './controllers/audit-logs.controller.js';
import { SystemConfigController } from './controllers/system-config.controller.js';
import { SystemConfigService } from './services/system-config.service.js';
import { AuthModule } from '../auth/auth.module.js';

/**
 * AdministrationModule quản lý:
 * - AuditLogEntity (audit_logs)
 * - SystemConfigEntity (system_configs)
 * - BackgroundJobEntity (background_jobs)
 * - UserEntity (users) — cần thiết để AuditLogQueryRepository thực hiện LEFT JOIN
 * - BackgroundJobsService — lifecycle tracking cho background jobs
 * - AuditLogsService — ghi audit log dùng chung cho toàn hệ thống
 * - AuditLogQueryService — orchestrator ĐỌC cho UC-AA-11 (tách biệt hoàn toàn)
 * - AuditLogQueryRepository — raw SQL query ĐỌC, LEFT JOIN audit_logs + users
 * - BackgroundJobsController — GET /api/v1/background-jobs/:id (T007, poll status)
 * - AuditLogsController — GET /api/v1/audit-logs (UC-AA-11, chỉ SYSTEM_ADMIN)
 * - SystemConfigController — GET/PATCH /api/v1/system-configurations (BE-09, 2026-07-27)
 * - SystemConfigService — allowlist 9 key phẳng FE quản trị, xem
 *   constants/system-config-allowlist.ts
 *
 * Module này KHÔNG import các business module (AccountsModule, RecordingModule...)
 * để tránh circular dependency. AuthModule là ngoại lệ AN TOÀN: chỉ import để
 * BackgroundJobsController/AuditLogsController dùng JwtAuthGuard + PermissionsGuard
 * (cần JwtService/AuthConfigService/RedisService) — AuthModule KHÔNG import ngược
 * AdministrationModule và KHÔNG inject BackgroundJobsService/AuditLogsService,
 * nên không tạo vòng phụ thuộc.
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
      UserEntity,
    ]),
  ],
  controllers: [
    BackgroundJobsController,
    AuditLogsController,
    SystemConfigController,
  ],
  providers: [
    BackgroundJobsService,
    AuditLogsService,
    AuditLogQueryService,
    AuditLogQueryRepository,
    SystemConfigService,
  ],
  exports: [TypeOrmModule, BackgroundJobsService, AuditLogsService],
})
export class AdministrationModule {}
