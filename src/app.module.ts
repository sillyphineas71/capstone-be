import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
// Infrastructure
import { envValidationSchema } from './config/env.validation.js';
import { RedisModule } from './modules/redis/redis.module.js';
import { MailModule } from './modules/mail/mail.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { QueueModule } from './modules/queue/queue.module.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { WebsocketModule } from './modules/websocket/websocket.module.js';
// Business modules
import { AccountsModule } from './modules/accounts/accounts.module';
import { AdministrationModule } from './modules/administration/administration.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuthModule } from './modules/auth/auth.module';
import { MustChangePasswordGuard } from './modules/auth/guards/must-change-password.guard';
import { DocumentsModule } from './modules/documents/documents.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { IotModule } from './modules/iot/iot.module';
import { LiveMeetingModule } from './modules/live-meeting/live-meeting.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { MinutesModule } from './modules/minutes/minutes.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PresenceModule } from './modules/presence/presence.module';
import { RecordingModule } from './modules/recording/recording.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { TranscriptionModule } from './modules/transcription/transcription.module';
import { UtilizationModule } from './modules/utilization/utilization.module';

/**
 * Dev-only module — chỉ load khi NODE_ENV=development.
 * Tránh import static để không bị tree-shake sai hoặc load ở production.
 */
async function loadDevModule(): Promise<(new () => unknown)[]> {
  if (process.env['NODE_ENV'] === 'development') {
    const { DevModule } = await import('./modules/dev/dev.module.js');
    return [DevModule];
  }
  return [];
}

// Resolve dev modules synchronously at module definition time
const devModules =
  process.env['NODE_ENV'] === 'development'
    ? (() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DevModule } = require('./modules/dev/dev.module');
        return [DevModule];
      })()
    : [];

void loadDevModule; // suppress unused warning

@Module({
  imports: [
    // ─── Config với Joi validation ──────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,  // hiện tất cả lỗi validation cùng lúc
        allowUnknown: true, // cho phép env chưa khai báo
      },
    }),
    // ─── Core infrastructure (global modules) ──────────────────────────────────
    CommonModule,
    DatabaseModule,
    RedisModule,
    MailModule,
    StorageModule,
    AdministrationModule,  // @Global — exports BackgroundJobsService, AuditLogsService
    QueueModule,           // @Global — exports QueueService
    HealthModule,
    SchedulerModule,
    WebsocketModule,
    // ─── Business modules ──────────────────────────────────────────────────────
    AuthModule,
    AccountsModule,
    MeetingsModule,
    ApprovalsModule,
    SchedulingModule,
    RoomsModule,
    EquipmentModule,
    IotModule,
    AttendanceModule,
    PresenceModule,
    UtilizationModule,
    LiveMeetingModule,
    RecordingModule,
    TranscriptionModule,
    MinutesModule,
    DocumentsModule,
    NotificationsModule,
    ReportsModule,
    AnalyticsModule,
    // ─── Dev-only (conditionally loaded) ───────────────────────────────────────
    ...devModules,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    /**
     * Global guard order matters: NestJS applies APP_GUARD in the order they are listed.
     * MustChangePasswordGuard runs AFTER JwtAuthGuard (which is applied per-endpoint via
     * @UseGuards(JwtAuthGuard)) so request.user will already be populated when
     * MustChangePasswordGuard.canActivate() is invoked.
     *
     * Routes in ALLOWED_ROUTE_PREFIXES (/auth/me, /auth/change-password, /auth/logout)
     * are whitelisted and bypass the must_change_password check.
     */
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
  ],
})
export class AppModule {}

