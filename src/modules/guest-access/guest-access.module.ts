import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { RecordingModule } from '../recording/recording.module.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { MeetingExternalParticipantEntity } from '../meetings/entities/meeting-external-participant.entity.js';
import { AttendanceEventEntity } from '../attendance/entities/attendance-event.entity.js';
import { GuestAccessConfigService } from './config/guest-access-config.service.js';
import { GuestAccessCacheService } from './services/guest-access-cache.service.js';
import { GuestSessionService } from './services/guest-session.service.js';
import { GuestInviteService } from './services/guest-invite.service.js';
import { GuestEmailService } from './services/guest-email.service.js';
import { GuestOtpService } from './services/guest-otp.service.js';
import { GuestLobbyService } from './services/guest-lobby.service.js';
import { GuestContentService } from './services/guest-content.service.js';
import { GuestAttendanceService } from './services/guest-attendance.service.js';
import { GuestManagementService } from './services/guest-management.service.js';
import { GuestSessionGuard } from './guards/guest-session.guard.js';
import { GuestMeetingScopeGuard } from './guards/guest-meeting-scope.guard.js';
import { GuestAccessController } from './controllers/guest-access.controller.js';
import { GuestContentController } from './controllers/guest-content.controller.js';
import { GuestManagementController } from './controllers/guest-management.controller.js';

/**
 * GuestAccessModule — khách ngoài công ty truy cập live-meeting qua magic
 * link + OTP, KHÔNG đi qua RBAC nội bộ (spec/features/guest-access/
 * feat-external-guest-live-meeting-access).
 *
 * `JwtModule.register({})` riêng (không dùng chung instance của `AuthModule`)
 * — sign/verify guest token luôn truyền `secret` tường minh theo request
 * (`GUEST_TOKEN_SECRET`), không phụ thuộc default config của module khác.
 */
@Module({
  imports: [
    JwtModule.register({}),
    AuthModule,
    RecordingModule,
    TypeOrmModule.forFeature([
      MeetingEntity,
      MeetingExternalParticipantEntity,
      AttendanceEventEntity,
    ]),
  ],
  controllers: [
    GuestAccessController,
    GuestContentController,
    GuestManagementController,
  ],
  providers: [
    GuestAccessConfigService,
    GuestAccessCacheService,
    GuestSessionService,
    GuestInviteService,
    GuestEmailService,
    GuestLobbyService,
    GuestOtpService,
    GuestContentService,
    GuestAttendanceService,
    GuestManagementService,
    GuestSessionGuard,
    GuestMeetingScopeGuard,
  ],
  exports: [
    GuestAccessConfigService,
    GuestAccessCacheService,
    GuestSessionService,
    GuestInviteService,
    GuestEmailService,
    GuestLobbyService,
    GuestAttendanceService,
  ],
})
export class GuestAccessModule {}
