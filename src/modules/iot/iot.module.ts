import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { IotDevice } from './entities/iot-device.entity';
import { IotDevicesController } from './controllers/iot-devices.controller';
import { IotDevicesService } from './services/iot-devices.service';
import { IotAuditRepository } from './repositories/iot-audit.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([IotDevice]),
    AuthModule,
    JwtModule.register({}),
    CacheModule.register(),
  ],
  controllers: [IotDevicesController],
  providers: [IotDevicesService, IotAuditRepository],
})
export class IotModule {}
