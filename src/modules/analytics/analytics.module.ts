import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { AdministrationModule } from '../administration/administration.module';

import { MeetingEntity } from '../meetings/entities/meeting.entity';
import { UserEntity } from '../accounts/entities/user.entity';
import { DepartmentEntity } from '../accounts/entities/department.entity';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity';
import { RoomBookingEntity } from '../rooms/entities/room-booking.entity';
import { RoomBookingUsageEntity } from '../rooms/entities/room-booking-usage.entity';
import { NoShowCaseEntity } from '../rooms/entities/no-show-case.entity';
import { AttendanceRecordEntity } from '../attendance/entities/attendance-record.entity';
import { RecordingSessionEntity } from '../recording/entities/recording-session.entity';
import { SystemConfigEntity } from '../administration/entities/system-config.entity';

import { DashboardOverviewController } from './controllers/dashboard-overview.controller';
import { DashboardOverviewService } from './services/dashboard-overview.service';
import { DashboardOverviewConfigService } from './services/dashboard-overview-config.service';
import { DashboardOverviewRepository } from './repositories/dashboard-overview.repository';

import { MeetingAverageDurationController } from './controllers/meeting-average-duration.controller';
import { MeetingAverageDurationService } from './services/meeting-average-duration.service';
import { MeetingAverageDurationRepository } from './repositories/meeting-average-duration.repository';

import { MeetingCancelRateController } from './controllers/meeting-cancel-rate.controller';
import { MeetingCancelRateService } from './services/meeting-cancel-rate.service';
import { MeetingCancelRateRepository } from './repositories/meeting-cancel-rate.repository';

import { MeetingCountByPeriodController } from './controllers/meeting-count-by-period.controller';
import { MeetingCountByPeriodService } from './services/meeting-count-by-period.service';
import { MeetingCountByPeriodRepository } from './repositories/meeting-count-by-period.repository';

import { MeetingStatusBreakdownController } from './controllers/meeting-status-breakdown.controller';
import { MeetingStatusBreakdownService } from './services/meeting-status-breakdown.service';
import { MeetingStatusBreakdownRepository } from './repositories/meeting-status-breakdown.repository';

import { NoShowRateController } from './controllers/no-show-rate.controller';
import { NoShowRateService } from './services/no-show-rate.service';
import { NoShowRateRepository } from './repositories/no-show-rate.repository';

import { OnTimeRateController } from './controllers/on-time-rate.controller';
import { OnTimeRateService } from './services/on-time-rate.service';
import { OnTimeRateRepository } from './repositories/on-time-rate.repository';

import { RoomUsageDashboardController } from './controllers/room-usage-dashboard.controller';
import { RoomUsageDashboardService } from './services/room-usage-dashboard.service';
import { RoomUsageDashboardRepository } from './repositories/room-usage-dashboard.repository';
import { RoomUsageConfigService } from './services/room-usage-config.service';

import { RoomUtilizationRateController } from './controllers/room-utilization-rate.controller';
import { RoomUtilizationRateService } from './services/room-utilization-rate.service';
import { RoomUtilizationRateRepository } from './repositories/room-utilization-rate.repository';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    AdministrationModule,
    TypeOrmModule.forFeature([
      MeetingEntity,
      UserEntity,
      DepartmentEntity,
      MeetingParticipantEntity,
      RoomBookingEntity,
      RoomBookingUsageEntity,
      NoShowCaseEntity,
      AttendanceRecordEntity,
      RecordingSessionEntity,
      SystemConfigEntity,
    ]),
  ],
  controllers: [
    DashboardOverviewController,
    MeetingAverageDurationController,
    MeetingCancelRateController,
    MeetingCountByPeriodController,
    MeetingStatusBreakdownController,
    NoShowRateController,
    OnTimeRateController,
    RoomUsageDashboardController,
    RoomUtilizationRateController,
  ],
  providers: [
    DashboardOverviewService,
    DashboardOverviewConfigService,
    DashboardOverviewRepository,
    MeetingAverageDurationService,
    MeetingAverageDurationRepository,
    MeetingCancelRateService,
    MeetingCancelRateRepository,
    MeetingCountByPeriodService,
    MeetingCountByPeriodRepository,
    MeetingStatusBreakdownService,
    MeetingStatusBreakdownRepository,
    NoShowRateService,
    NoShowRateRepository,
    OnTimeRateService,
    OnTimeRateRepository,
    RoomUsageDashboardService,
    RoomUsageDashboardRepository,
    RoomUsageConfigService,
    RoomUtilizationRateService,
    RoomUtilizationRateRepository,
  ],
  exports: [TypeOrmModule, DashboardOverviewConfigService],
})
export class AnalyticsModule {}
