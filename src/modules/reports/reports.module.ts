import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

// Entities cần đọc trong MeetingActivityReportDataService
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { RoomBookingEntity } from '../rooms/entities/room-booking.entity.js';
import { RoomBookingUsageEntity } from '../rooms/entities/room-booking-usage.entity.js';
import { NoShowCaseEntity } from '../rooms/entities/no-show-case.entity.js';
import { AttendanceRecordEntity } from '../attendance/entities/attendance-record.entity.js';
import { UserEntity } from '../accounts/entities/user.entity.js';
import { DepartmentEntity } from '../accounts/entities/department.entity.js';

// MediaFileEntity cần cho worker processor để lưu output
import { MediaFileEntity } from '../recording/entities/media-file.entity.js';

// AuthModule cần cho JwtAuthGuard + PermissionsGuard trong controller
import { AuthModule } from '../auth/auth.module.js';

// AnalyticsModule export DashboardOverviewConfigService (getMaxRangeDays)
import { AnalyticsModule } from '../analytics/analytics.module.js';

// StorageModule cung cấp StorageService để lưu file xuất báo cáo
import { StorageModule } from '../storage/storage.module.js';

// Controllers
import { MeetingActivityReportController } from './controllers/meeting-activity-report.controller.js';

// Services
import { MeetingActivityReportService } from './services/meeting-activity-report.service.js';
import { MeetingActivityReportDataService } from './services/meeting-activity-report-data.service.js';

// Processor
import { MeetingActivityReportWorkerProcessor } from './processors/meeting-activity-report-worker.processor.js';

/**
 * ReportsModule — UC-AA-12 / UC-158: Xuất báo cáo tổng hợp hoạt động cuộc họp.
 *
 * Dependency strategy:
 * - AdministrationModule: @Global() → BackgroundJobsService, AuditLogsService auto-available
 * - QueueModule: @Global() → QueueService auto-available
 * - AuthModule: import để JwtAuthGuard + PermissionsGuard + AuthzReadRepository hoạt động
 * - AnalyticsModule: import để lấy DashboardOverviewConfigService (getMaxRangeDays)
 *   KHÔNG import theo cách khác để tránh circular dependency.
 *
 * ARCH: Không sửa BackgroundJobsService/QueueService/MediaFilesService/StorageService
 * — chỉ dùng qua Dependency Injection.
 */
@Module({
  imports: [
    ConfigModule,
    AuthModule,
    AnalyticsModule,
    StorageModule,
    TypeOrmModule.forFeature([
      // Entities cho data aggregation
      MeetingEntity,
      MeetingParticipantEntity,
      RoomBookingEntity,
      RoomBookingUsageEntity,
      NoShowCaseEntity,
      AttendanceRecordEntity,
      UserEntity,
      DepartmentEntity,
      // Entity cho worker processor (lưu media file)
      MediaFileEntity,
    ]),
  ],
  controllers: [MeetingActivityReportController],
  providers: [
    MeetingActivityReportService,
    MeetingActivityReportDataService,
    MeetingActivityReportWorkerProcessor,
  ],
})
export class ReportsModule {}
