import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ZoneEntity } from '../zones/entities/zone.entity.js';
import { ZonePresenceEventEntity } from '../zones/entities/zone-presence-event.entity.js';
import { GateAccessLogEntity } from '../zones/entities/gate-access-log.entity.js';
import { IoTDeviceEntity } from '../iot/entities/iot-device.entity.js';
import { CampusDashboardRepository } from './repositories/campus-dashboard.repository.js';
import { DashboardOverviewService } from './services/dashboard-overview.service.js';
import { DashboardOverviewController } from './controllers/dashboard-overview.controller.js';
import { ZonePresenceTimelineService } from './services/zone-presence-timeline.service.js';
import { ZonePresenceTimelineController } from './controllers/zone-presence-timeline.controller.js';
import { ZoneTrafficHeatmapService } from './services/zone-traffic-heatmap.service.js';
import { ZoneTrafficHeatmapController } from './controllers/zone-traffic-heatmap.controller.js';

/**
 * CampusDashboardModule (CDB-001 / UC-126, dùng chung cho UC-119/UC-120 — Bước 4 SAVP).
 *
 * 100% READ-ONLY — không entity riêng, tự `forFeature` lại entity của `zones`/`iot` (KHÔNG
 * import `ZonesModule`/`IotModule` — mirror lý do `restricted-zone`/`crowd-alert`: tránh kéo
 * theo provider/controller không cần, tránh rủi ro vòng phụ thuộc).
 *
 * UC-119 (`ZonePresenceTimelineController`) và UC-120 (`ZoneTrafficHeatmapController`) THÊM
 * vào mảng `controllers`/`providers` của module NÀY khi code — KHÔNG tạo module riêng.
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      ZoneEntity,
      ZonePresenceEventEntity,
      GateAccessLogEntity,
      IoTDeviceEntity,
    ]),
  ],
  controllers: [
    DashboardOverviewController,
    ZonePresenceTimelineController,
    ZoneTrafficHeatmapController,
  ],
  providers: [
    CampusDashboardRepository,
    DashboardOverviewService,
    ZonePresenceTimelineService,
    ZoneTrafficHeatmapService,
  ],
  exports: [],
})
export class CampusDashboardModule {}
