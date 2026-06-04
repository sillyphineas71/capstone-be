import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IoTDeviceEntity } from './entities/iot-device.entity.js';
import { DeviceUserMappingEntity } from './entities/device-user-mapping.entity.js';
import { IoTDeviceEventEntity } from './entities/iot-device-event.entity.js';
import { CaptureSessionEntity } from './entities/capture-session.entity.js';
import { CaptureSessionChannelEntity } from './entities/capture-session-channel.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { EquipmentModule } from '../equipment/equipment.module.js';

/**
 * IotModule quản lý tất cả entities thuộc domain Equipment/IoT/Capture Agent:
 * - IoTDeviceEntity (iot_devices)
 * - DeviceUserMappingEntity (device_user_mappings)
 * - IoTDeviceEventEntity (iot_device_events)
 * - CaptureSessionEntity (capture_sessions)
 * - CaptureSessionChannelEntity (capture_session_channels)
 */
@Module({
  imports: [
    AccountsModule,
    RoomsModule,
    MeetingsModule,
    EquipmentModule,
    TypeOrmModule.forFeature([
      IoTDeviceEntity,
      DeviceUserMappingEntity,
      IoTDeviceEventEntity,
      CaptureSessionEntity,
      CaptureSessionChannelEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class IotModule {}
