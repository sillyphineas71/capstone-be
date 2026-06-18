import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { RoomEntity } from './entities/room.entity.js';
import { RoomBookingEntity } from './entities/room-booking.entity.js';
import { RoomBookingUsageEntity } from './entities/room-booking-usage.entity.js';
import { NoShowCaseEntity } from './entities/no-show-case.entity.js';
import { RoomEventEntity } from './entities/room-event.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { RoomsController } from './controllers/rooms.controller.js';
import { RoomStatusService } from './services/room-status.service.js';
import { NoShowController } from './controllers/no-show.controller.js';
import { NoShowService } from './services/no-show.service.js';
import { NoShowDetectionService } from './services/no-show-detection.service.js';

/**
 * RoomsModule quản lý tất cả entities thuộc domain Room & Utilization:
 * - RoomEntity (rooms)
 * - RoomBookingEntity (room_bookings)
 * - RoomBookingUsageEntity (room_booking_usages)
 * - NoShowCaseEntity (no_show_cases)
 * - RoomEventEntity (room_events)
 */
@Module({
  imports: [
    AccountsModule,
    MeetingsModule,
    AuthModule,
    WebsocketModule,
    JwtModule.register({}),
    CacheModule.register(),
    TypeOrmModule.forFeature([
      RoomEntity,
      RoomBookingEntity,
      RoomBookingUsageEntity,
      NoShowCaseEntity,
      RoomEventEntity,
    ]),
  ],
  controllers: [RoomsController, NoShowController],
  providers: [RoomStatusService, NoShowService, NoShowDetectionService],
  exports: [TypeOrmModule, NoShowDetectionService],
})
export class RoomsModule {}
