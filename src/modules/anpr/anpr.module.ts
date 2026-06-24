import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { VehicleRegistrationEntity } from './entities/vehicle-registration.entity.js';
import { VehicleRegistrationController } from './controllers/vehicle-registration.controller.js';
import { VehicleRegistrationService } from './services/vehicle-registration.service.js';

/**
 * AnprModule (ANPR mini-epic) — biển số xe.
 *
 * VRS-001 (Setup-0): entity `VehicleRegistrationEntity` (forFeature) + export TypeOrmModule.
 * VPR-001 (UC1): đăng ký biển — controller (2 route user/admin) + service.
 * Import AuthModule để dùng PermissionsGuard thật (gate route admin) — AuthModule export sẵn.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VehicleRegistrationEntity]), AuthModule],
  controllers: [VehicleRegistrationController],
  providers: [VehicleRegistrationService],
  exports: [TypeOrmModule],
})
export class AnprModule {}
