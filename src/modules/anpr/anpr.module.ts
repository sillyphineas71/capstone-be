import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { VEHICLE_EVENT_HANDLER } from '../../common/ports/vehicle-event-hook.js';
import { VehicleRegistrationEntity } from './entities/vehicle-registration.entity.js';
import { VehicleRegistrationController } from './controllers/vehicle-registration.controller.js';
import { VehicleWebhookController } from './controllers/vehicle-webhook.controller.js';
import { VehicleRegistrationService } from './services/vehicle-registration.service.js';
import { VehicleResolveService } from './services/vehicle-resolve.service.js';
import { VehicleUnknownService } from './services/vehicle-unknown.service.js';
import { VehicleHistoryService } from './services/vehicle-history.service.js';
import { AnprInternalTokenGuard } from './guards/anpr-internal-token.guard.js';
import { DefaultVehicleEventHandler } from './handlers/default-vehicle-event.handler.js';

/**
 * AnprModule (ANPR mini-epic) — biển số xe.
 *
 * VRS-001 (Setup-0): entity `VehicleRegistrationEntity` (forFeature) + export TypeOrmModule.
 * VPR-001 (UC1) + VPM-001 (UC2) + VPL-001 (UC3): đăng ký/sửa/xóa/xem biển — controller + service.
 * VWH-001 (UC4): webhook nhận vehicle event (internal token) + normalize → handoff qua
 *   VEHICLE_EVENT_HANDLER. UC4 bind default log-only.
 * VRE-001 (UC5): override VEHICLE_EVENT_HANDLER sang VehicleResolveService (resolve biển→user
 *   + persist iot_device_events, event_type='ivss_vehicle_event'). DefaultVehicleEventHandler giữ
 *   registered (fallback, mirror face giữ DefaultIvssEventHandler).
 * Import AuthModule để dùng PermissionsGuard thật (gate route admin) — AuthModule export sẵn.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VehicleRegistrationEntity]), AuthModule],
  controllers: [VehicleRegistrationController, VehicleWebhookController],
  providers: [
    VehicleRegistrationService,
    VehicleUnknownService,
    VehicleHistoryService,
    AnprInternalTokenGuard,
    DefaultVehicleEventHandler,
    VehicleResolveService,
    // VRE-001 (UC5): handler thật thay default log-only (UC4).
    { provide: VEHICLE_EVENT_HANDLER, useExisting: VehicleResolveService },
  ],
  exports: [TypeOrmModule],
})
export class AnprModule {}
