import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZoneEntity } from './entities/zone.entity.js';
import { GateAccessLogEntity } from './entities/gate-access-log.entity.js';
import { ZonePresenceEventEntity } from './entities/zone-presence-event.entity.js';

/**
 * ZonesModule (SAVP Zone scope) — SCHEMA-ONLY.
 *
 * Mục đích duy nhất ở bước này: đăng ký entity của scope Zone qua `TypeOrmModule.forFeature`
 * để runtime (`autoLoadEntities: true` trong DatabaseModule) nhận metadata.
 * CỐ Ý KHÔNG có controller/service/DTO — nghiệp vụ (CRUD zone, ingestion gate/presence)
 * sẽ được bổ sung ở các UC sau theo flow riêng.
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
  ],
  exports: [TypeOrmModule],
})
export class ZonesModule {}
