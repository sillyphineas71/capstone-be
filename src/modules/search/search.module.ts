import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { ZoneEntity } from '../zones/entities/zone.entity.js';
import { IoTDeviceEntity } from '../iot/entities/iot-device.entity.js';
import { VehicleRegistrationEntity } from '../anpr/entities/vehicle-registration.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { SearchService } from './services/search.service.js';
import { SearchController } from './controllers/search.controller.js';

/**
 * SearchModule (SRCH-01) — tìm kiếm tổng hợp đa nguồn.
 *
 * 100% READ-ONLY — không entity riêng, tự `forFeature` lại entity của `zones`/`iot`/`anpr`/
 * `accounts`/`meetings` (KHÔNG import `ZonesModule`/`IotModule`/`AnprModule`/`AccountsModule`/
 * `MeetingsModule` — mirror lý do đã dùng ở `CampusDashboardModule`: tránh kéo theo provider/
 * controller không cần, tránh rủi ro vòng phụ thuộc). Import `AuthModule` để inject
 * `AuthzReadRepository` (đã export sẵn, dùng để lọc permission theo từng `type` ở tầng service).
 */
@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      ZoneEntity,
      IoTDeviceEntity,
      VehicleRegistrationEntity,
      UserEntity,
      MeetingEntity,
    ]),
  ],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [],
})
export class SearchModule {}
