import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomEntity } from './entities/room.entity.js';
import { RoomBookingEntity } from './entities/room-booking.entity.js';
import { RoomBookingUsageEntity } from './entities/room-booking-usage.entity.js';
import { NoShowCaseEntity } from './entities/no-show-case.entity.js';
import { RoomEventEntity } from './entities/room-event.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RoomsController } from './controllers/rooms.controller.js';
import { RoomsService } from './services/rooms.service.js';

/**
 * RoomsModule quan ly tat ca entities thuoc domain Room & Utilization:
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
    TypeOrmModule.forFeature([
      RoomEntity,
      RoomBookingEntity,
      RoomBookingUsageEntity,
      NoShowCaseEntity,
      RoomEventEntity,
    ]),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [TypeOrmModule, RoomsService],
})
export class RoomsModule {}
