import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomEntity } from '../rooms/entities/room.entity.js';
import { RoomBookingEntity } from '../rooms/entities/room-booking.entity.js';
import { EquipmentEntity } from '../equipment/entities/equipment.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './services/scheduling.service.js';
import { ParticipantConflictService } from './services/participant-conflict.service.js';
import { FreeBusyService } from './services/free-busy.service.js';
import { TimeSuggestionService } from './services/time-suggestion.service.js';

/**
 * SchedulingModule quản lý tính năng gợi ý phòng họp (UC-SM-01/UC-50),
 * kiểm tra xung đột lịch người tham gia (UC-SM-04/UC-53), và chọn khung
 * giờ họp tối ưu (UC-SM-02):
 * - GET /api/v1/scheduling/room-suggestions
 * - POST /api/v1/scheduling/participant-conflicts/check
 * - POST /api/v1/scheduling/time-suggestions
 *
 * Dùng TypeOrmModule.forFeature thay vì import module khác để tránh circular dependency.
 */
@Module({
  imports: [
    AccountsModule,
    AuthModule,
    TypeOrmModule.forFeature([
      RoomEntity,
      RoomBookingEntity,
      EquipmentEntity,
      MeetingEntity,
      MeetingParticipantEntity,
      UserEntity,
    ]),
  ],
  controllers: [SchedulingController],
  providers: [
    SchedulingService,
    ParticipantConflictService,
    FreeBusyService,
    TimeSuggestionService,
  ],
  // SchedulingService duoc export de RoomsModule (UC-ROOM-03 xoa phong) tai dung
  // logic goi y phong thay the — tranh duplicate query engine.
  exports: [TypeOrmModule, SchedulingService],
})
export class SchedulingModule {}
