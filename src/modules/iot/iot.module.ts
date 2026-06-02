import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { IotDevice } from './entities/iot-device.entity';
import { IotDevicesController } from './controllers/iot-devices.controller';
import { DeviceCallbacksController } from './controllers/device-callbacks.controller';
import { ShortDeviceCallbacksController } from './controllers/short-device-callbacks.controller';
import { VerifyShortDeviceCallbacksController } from './controllers/verify-short-device-callbacks.controller';
import { StrangerShortDeviceCallbacksController } from './controllers/stranger-short-device-callbacks.controller';
import { IotDevicesService } from './services/iot-devices.service';
import { IotDeviceEventsService } from './services/iot-device-events.service';
import { IotAuditRepository } from './repositories/iot-audit.repository';
import { IotDeviceEvent } from './entities/iot-device-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([IotDevice, IotDeviceEvent]),
    AuthModule,
    JwtModule.register({}),
    CacheModule.register(),
  ],
  controllers: [
    IotDevicesController,
    DeviceCallbacksController,
    ShortDeviceCallbacksController,
    VerifyShortDeviceCallbacksController,
    StrangerShortDeviceCallbacksController,
  ],
  providers: [IotDevicesService, IotDeviceEventsService, IotAuditRepository],
  exports: [IotDevicesService, IotDeviceEventsService],
})
export class IotModule {}
