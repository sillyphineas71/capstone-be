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

/**
 * SchedulingModule quản lý tính năng gợi ý phòng họp (UC-SM-01/UC-50)
 * và kiểm tra xung đột lịch người tham gia (UC-SM-04/UC-53):
 * - GET /api/v1/scheduling/room-suggestions
 * - POST /api/v1/scheduling/participant-conflicts/check
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
  providers: [SchedulingService, ParticipantConflictService],
  exports: [TypeOrmModule],
})
export class SchedulingModule {}
