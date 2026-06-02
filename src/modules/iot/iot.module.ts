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
import { IotAuditRepository } from './repositories/iot-audit.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([IotDevice]),
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
  providers: [IotDevicesService, IotAuditRepository],
})
export class IotModule {}
