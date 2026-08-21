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
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdministrationModule } from '../administration/administration.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
// [FIX 2026-08-13] NoShowLifecycleService cần LiveMeetingService.endMeeting() để tự
// động kết thúc meeting khi phòng bị no-show giải phóng (xem no-show-lifecycle.service.ts).
// KHÔNG tạo vòng phụ thuộc: LiveMeetingModule chỉ import Auth/Websocket/GuestAccess/
// Recording, KHÔNG import RoomsModule — an toàn 1 chiều, KHÔNG cần forwardRef (cấm dùng).
import { LiveMeetingModule } from '../live-meeting/live-meeting.module.js';
import { RoomsController } from './controllers/rooms.controller.js';
import { RoomsService } from './services/rooms.service.js';
import { RoomStatusService } from './services/room-status.service.js';
import { RoomSearchService } from './services/room-search.service.js';
import { RoomDeleteNotificationProcessor } from './services/room-delete-notification.processor.js';
import { NoShowController } from './controllers/no-show.controller.js';
import { NoShowConfirmController } from './controllers/no-show-confirm.controller.js';
import { NoShowConfigController } from './controllers/no-show-config.controller.js';
import { EarlyVacancyConfigController } from './controllers/early-vacancy-config.controller.js';
import { RoomBookingsController } from './controllers/room-bookings.controller.js';
import { RoomBookingsService } from './services/room-bookings.service.js';
import { NoShowService } from './services/no-show.service.js';
import { NoShowDetectionService } from './services/no-show-detection.service.js';
import { NoShowConfigService } from './services/no-show-config.service.js';
import { NoShowLifecycleService } from './services/no-show-lifecycle.service.js';
import { NoShowConfirmTokenService } from './services/no-show-confirm-token.service.js';
import { EarlyVacancyService } from './services/early-vacancy.service.js';
import { EarlyVacancyConfigService } from './services/early-vacancy-config.service.js';

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
    NotificationsModule,
    AdministrationModule,
    SchedulingModule,
    LiveMeetingModule,
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
  controllers: [
    RoomsController,
    NoShowController,
    NoShowConfirmController,
    NoShowConfigController,
    EarlyVacancyConfigController,
    RoomBookingsController,
  ],
  providers: [
    RoomsService,
    RoomStatusService,
    RoomSearchService,
    RoomDeleteNotificationProcessor,
    NoShowService,
    NoShowDetectionService,
    NoShowConfigService,
    NoShowLifecycleService,
    NoShowConfirmTokenService,
    EarlyVacancyService,
    EarlyVacancyConfigService,
    RoomBookingsService,
  ],
  exports: [
    TypeOrmModule,
    NoShowDetectionService,
    NoShowLifecycleService,
    EarlyVacancyService,
    // [FIX 2026-08-09, Phần 3] PresenceModule/OccupancyPersistenceService cần đọc
    // presenceConfirmSeconds/presenceNoiseToleranceSeconds cho streak-confirm.
    NoShowConfigService,
  ],
})
export class RoomsModule {}
