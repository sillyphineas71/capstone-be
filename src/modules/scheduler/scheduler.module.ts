import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { SchedulerService } from './scheduler.service.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { IotModule } from '../iot/iot.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { FaceAccessModule } from '../face-access/face-access.module.js';
import { IvssModule } from '../ivss/ivss.module.js';
import { GateAccessModule } from '../gate-access/gate-access.module.js';
import { RestrictedZoneModule } from '../restricted-zone/restricted-zone.module.js';
import { CrowdAlertModule } from '../crowd-alert/crowd-alert.module.js';

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
    GateAccessModule,
    RestrictedZoneModule,
    CrowdAlertModule,
  ],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
