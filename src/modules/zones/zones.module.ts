import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ZoneEntity } from './entities/zone.entity.js';
import { GateAccessLogEntity } from './entities/gate-access-log.entity.js';
import { ZonePresenceEventEntity } from './entities/zone-presence-event.entity.js';
import { ZonesController } from './controllers/zones.controller.js';
import { ZonesService } from './services/zones.service.js';

/**
 * ZonesModule (SAVP Zone scope).
 *
 * `TypeOrmModule.forFeature` đăng ký entity của scope Zone để runtime
 * (`autoLoadEntities: true` trong DatabaseModule) nhận metadata.
 * `GateAccessLogEntity` / `ZonePresenceEventEntity` vẫn SCHEMA-ONLY — ingestion gate/presence
 * làm ở UC sau.
 *
 * ZNC-001 (UC-90): thêm nghiệp vụ tạo khu vực — `ZonesController` + `ZonesService`.
 * Import `AuthModule` để dùng guard THẬT: `PermissionsGuard` inject `AuthzReadRepository`,
 * `JwtAuthGuard` cần `JwtService` + `CACHE_MANAGER` — cả ba do AuthModule export. THIẾU import
 * này là crash lúc boot (`UnknownDependenciesException`), KHÔNG phải lỗi 403. Mirror
 * `anpr.module.ts`.
 *
 * CLI DataSource (`src/database/data-source.ts`) đã glob `modules/**\/*.entity.{ts,js}`
 * nên KHÔNG cần khai thêm ở đó.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ZoneEntity,
      GateAccessLogEntity,
      ZonePresenceEventEntity,
    ]),
    AuthModule,
  ],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [TypeOrmModule],
})
export class ZonesModule {}
