import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceRecordEntity } from './entities/attendance-record.entity.js';
import { AttendanceEventEntity } from './entities/attendance-event.entity.js';
import { AttendanceController } from './controllers/attendance.controller.js';
import { CheckInAlertController } from './controllers/checkin-alert.controller.js';
import { ManualAttendanceController } from './controllers/manual-attendance.controller.js';
import { AttendanceService } from './services/attendance.service.js';
import { CheckInAlertService } from './services/checkin-alert.service.js';
import { ManualAttendanceService } from './services/manual-attendance.service.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AccountsModule,
    AuthModule,
    MeetingsModule,
    RoomsModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      AttendanceRecordEntity,
      AttendanceEventEntity,
      MeetingEntity,
      MeetingParticipantEntity,
      UserEntity,
    ]),
  ],
  controllers: [
    AttendanceController,
    CheckInAlertController,
    ManualAttendanceController,
  ],
  providers: [AttendanceService, CheckInAlertService, ManualAttendanceService],
  exports: [TypeOrmModule, AttendanceService, CheckInAlertService],
})
export class AttendanceModule {}
