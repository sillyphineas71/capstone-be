import { APP_GUARD } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CommonModule,
    DatabaseModule,
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
    AdministrationModule,
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
