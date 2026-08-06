import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { SchedulerService } from './scheduler.service.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { IotModule } from '../iot/iot.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { FaceAccessModule } from '../face-access/face-access.module.js';
import { IvssModule } from '../ivss/ivss.module.js';
import { RestrictedZoneModule } from '../restricted-zone/restricted-zone.module.js';
import { CrowdAlertModule } from '../crowd-alert/crowd-alert.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { LiveMeetingModule } from '../live-meeting/live-meeting.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';

/**
 * SchedulerModule — Skeleton cho các cron job.
 *
 * Hiện tại chỉ tạo skeleton, chưa implement business logic.
 * Các job (no-show check, auto-release, reminder) bị disabled theo env mặc định.
 *
 * SCHEDULER_NO_SHOW_CHECK_ENABLED=false (mặc định)
 * SCHEDULER_AUTO_RELEASE_ENABLED=false (mặc định)
 * SCHEDULER_NOTIFICATION_REMINDER_ENABLED=false (mặc định)
 *
 * TODO: Implement business logic khi có yêu cầu cụ thể.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    AttendanceModule,
    IotModule,
    RoomsModule,
    FaceAccessModule,
    IvssModule,
    RestrictedZoneModule,
    CrowdAlertModule,
    // GAP-001 (UC-106): cron gate-log-pairing inject GateLogPairingService (zones export).
    // Cạnh scheduler → zones MỘT CHIỀU (zones KHÔNG import scheduler) ⇒ không circular.
    ZonesModule,
    // recon B1: cron auto-complete inject LiveMeetingService (endMeeting() reuse).
    // Cạnh scheduler → live-meeting MỘT CHIỀU (live-meeting chỉ import
    // AuthModule + WebsocketModule) ⇒ không circular.
    LiveMeetingModule,
    // F-R4b: cron meeting-request-expire inject MeetingRequestReviewService.
    // Cạnh scheduler → meetings MỘT CHIỀU (meetings không import scheduler,
    // RoomsModule đã import MeetingsModule sẵn nên đây không phải circular mới).
    MeetingsModule,
  ],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
