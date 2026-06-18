import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { MediaFileEntity } from './entities/media-file.entity.js';
import { RecordingConfigEntity } from './entities/recording-config.entity.js';
import { RecordingSessionEntity } from './entities/recording-session.entity.js';
import { RecordingSegmentEntity } from './entities/recording-segment.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { RecordingConfigController } from './controllers/recording-config.controller.js';
import { RecordingConfigService } from './services/recording-config.service.js';
import { RecordingConfigAuditRepository } from './repositories/recording-config-audit.repository.js';
import { RecordingSessionController } from './controllers/recording-session.controller.js';
import { RecordingSessionService } from './services/recording-session.service.js';
import { RecordingProcessManager } from './services/recording-process-manager.js';
import { RecordingReconcileService } from './services/recording-reconcile.service.js';
import { MediaFilesController } from './controllers/media-files.controller.js';
import { MediaFilesService } from './services/media-files.service.js';

/**
 * RecordingModule quản lý các entity recording + CRUD recording-config (REC-001).
 *
 * KHÔNG import MeetingsModule/IotModule (tránh circular) — RecordingConfigService đọc
 * meeting/device/session qua dataSource.manager (raw, read-only). AuthModule + JwtModule +
 * CacheModule import để JwtAuthGuard hoạt động (mirror IotModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      MediaFileEntity,
      RecordingConfigEntity,
      RecordingSessionEntity,
      RecordingSegmentEntity,
    ]),
    AuthModule,
    JwtModule.register({}),
    CacheModule.register(),
  ],
  controllers: [
    RecordingConfigController,
    RecordingSessionController,
    MediaFilesController,
  ],
  providers: [
    RecordingConfigService,
    RecordingConfigAuditRepository,
    RecordingSessionService,
    RecordingProcessManager,
    RecordingReconcileService,
    MediaFilesService,
  ],
  exports: [TypeOrmModule],
})
export class RecordingModule {}
