import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleRegistrationEntity } from './entities/vehicle-registration.entity.js';

/**
 * AnprModule (VRS-001 / Setup-0) — nền dữ liệu mini-epic ANPR.
 *
 * Schema-only: chỉ đăng ký entity `VehicleRegistrationEntity` vào TypeORM (forFeature)
 * + export TypeOrmModule để UC sau (UC1+) inject repository. KHÔNG controller/service/provider.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VehicleRegistrationEntity])],
  exports: [TypeOrmModule],
})
export class AnprModule {}
