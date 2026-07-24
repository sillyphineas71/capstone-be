import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { GateAccessLogEntity } from '../zones/entities/gate-access-log.entity.js';
import { GateAccessPairingService } from './services/gate-access-pairing.service.js';
import { GateAccessHistoryService } from './services/gate-access-history.service.js';
import { VehicleTrafficStatsService } from './services/vehicle-traffic-stats.service.js';
import { GateAccessHistoryController } from './controllers/gate-access-history.controller.js';
import { VehicleTrafficStatsController } from './controllers/vehicle-traffic-stats.controller.js';

/**
 * GateAccessModule (Bước 2 SAVP: GAP-001/UC-116 + GAH-001/UC-117 + VTS-001/UC-114) — logic
 * đọc + ghép cặp `gate_access_logs`, tra cứu lịch sử, thống kê lưu lượng phương tiện.
 *
 * Tách khỏi module `zones` theo đúng roadmap (`zones` chỉ schema-only cho phần Zone).
 * `GateAccessLogEntity` được khai/đăng ký ở `zones/entities` (Hải) — module này CHỈ import
 * class entity để `TypeOrmModule.forFeature`, KHÔNG khai lại entity.
 *
 * `AuthModule` cần cho `JwtAuthGuard`/`PermissionsGuard` (GAH-001/VTS-001 — GAP-001 tự nó
 * không có route HTTP nên không cần, nhưng module dùng chung nên import 1 lần).
 *
 * `VehicleTrafficStatsService` (VTS-001) đọc raw SQL bảng `iot_device_events` (module `iot`)
 * qua `DataSource` — KHÔNG `forFeature` entity đó (mirror tiền lệ `VehicleHistoryService`,
 * chấp nhận cross-module raw-SQL read qua `DataSource`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([GateAccessLogEntity]), AuthModule],
  controllers: [GateAccessHistoryController, VehicleTrafficStatsController],
  providers: [
    GateAccessPairingService,
    GateAccessHistoryService,
    VehicleTrafficStatsService,
  ],
  // VehicleTrafficStatsService exported cho VehicleReportDataService (UC-128,
  // Bước 5 SAVP) gọi getStats() qua DI — KHÔNG fork logic, chỉ tái sử dụng.
  exports: [GateAccessPairingService, VehicleTrafficStatsService],
})
export class GateAccessModule {}
