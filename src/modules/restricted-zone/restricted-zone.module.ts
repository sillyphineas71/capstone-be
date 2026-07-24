import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GateAccessLogEntity } from '../zones/entities/gate-access-log.entity.js';
import { ZonePresenceEventEntity } from '../zones/entities/zone-presence-event.entity.js';
import { AlertsModule } from '../alerts/alerts.module.js';
import { RestrictedZoneIntrusionService } from './services/restricted-zone-intrusion.service.js';

/**
 * RestrictedZoneModule (ARZ-001 / UC-124) — cron xâm nhập khu vực hạn chế.
 *
 * Tách khỏi `alerts` (mirror `gate-access` Bước 2) vì cần import
 * `GateAccessLogEntity`/`ZonePresenceEventEntity` từ `zones`, KHÔNG nhét entity ngoài
 * phạm vi `alerts` vào `AlertsModule`. `GateAccessLogEntity`/`ZonePresenceEventEntity`
 * đã khai/đăng ký ở `zones/entities` — module này CHỈ import class entity để
 * `TypeOrmModule.forFeature`, KHÔNG khai lại.
 *
 * Import `AlertsModule` để đọc `AlertRulesService` (rule intrusion) + gọi
 * `AlertsService.recordAlert()` — chiều `restricted-zone → alerts` một chiều, KHÔNG
 * import ngược. KHÔNG có route HTTP (cron-only, mirror `gate-access` GAP-001).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GateAccessLogEntity, ZonePresenceEventEntity]),
    AlertsModule,
  ],
  providers: [RestrictedZoneIntrusionService],
  exports: [RestrictedZoneIntrusionService],
})
export class RestrictedZoneModule {}
