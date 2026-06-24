import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { VEHICLE_EVENT_HANDLER } from '../../common/ports/vehicle-event-hook.js';
import { VehicleRegistrationEntity } from './entities/vehicle-registration.entity.js';
import { VehicleRegistrationController } from './controllers/vehicle-registration.controller.js';
import { VehicleWebhookController } from './controllers/vehicle-webhook.controller.js';
import { VehicleRegistrationService } from './services/vehicle-registration.service.js';
import { AnprInternalTokenGuard } from './guards/anpr-internal-token.guard.js';
import { DefaultVehicleEventHandler } from './handlers/default-vehicle-event.handler.js';

/**
 * AnprModule (ANPR mini-epic) — biển số xe.
 *
 * VRS-001 (Setup-0): entity `VehicleRegistrationEntity` (forFeature) + export TypeOrmModule.
 * VPR-001 (UC1) + VPM-001 (UC2) + VPL-001 (UC3): đăng ký/sửa/xóa/xem biển — controller + service.
 * VWH-001 (UC4): webhook nhận vehicle event (internal token) + normalize → handoff qua
 *   VEHICLE_EVENT_HANDLER. UC4 bind default log-only; UC5 override `useExisting` impl thật.
 * Import AuthModule để dùng PermissionsGuard thật (gate route admin) — AuthModule export sẵn.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VehicleRegistrationEntity]), AuthModule],
  controllers: [VehicleRegistrationController, VehicleWebhookController],
  providers: [
    VehicleRegistrationService,
    AnprInternalTokenGuard,
    DefaultVehicleEventHandler,
    { provide: VEHICLE_EVENT_HANDLER, useClass: DefaultVehicleEventHandler },
  ],
  exports: [TypeOrmModule],
})
export class AnprModule {}
