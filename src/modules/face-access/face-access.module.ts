import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module.js';
import { FaceDeviceProviderFactory } from './face-device-provider.factory.js';
import { FaceProvisioningService } from './services/face-provisioning.service.js';
import { FaceAttendanceService } from './services/face-attendance.service.js';
import { UnmappedReviewService } from './services/unmapped-review.service.js';
import { UnmappedReviewController } from './controllers/unmapped-review.controller.js';
import { StrangerAlertService } from './services/stranger-alert.service.js';
import { StrangerAlertController } from './controllers/stranger-alert.controller.js';
import { FACE_VERIFY_HOOK } from '../../common/ports/face-verify-hook.js';
import { STRANGER_ALERT_HOOK } from '../../common/ports/stranger-alert-hook.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { WebsocketModule } from '../websocket/websocket.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

/**
 * FaceAccessModule — adapter thiết bị face (FGC-001/A) + per-meeting provisioning
 * (FMP-001/B) + runtime attendance (FAT-001/C).
 *
 * Export FaceDeviceProviderFactory (A) + FaceProvisioningService (B, scheduler inject).
 * AccountsModule cho FaceProfileService.getPortraitBytes (Ticket D).
 *
 * @Global() (như StorageModule) + provide FACE_VERIFY_HOOK = useExisting
 * FaceAttendanceService → `iot` inject hook mà KHÔNG import module này (NC-4 no-cycle).
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    AccountsModule,
    AuthModule,
    JwtModule.register({}),
    WebsocketModule,
    NotificationsModule,
  ],
  controllers: [UnmappedReviewController, StrangerAlertController],
  providers: [
    FaceDeviceProviderFactory,
    FaceProvisioningService,
    FaceAttendanceService,
    UnmappedReviewService,
    StrangerAlertService,
    { provide: FACE_VERIFY_HOOK, useExisting: FaceAttendanceService },
    { provide: STRANGER_ALERT_HOOK, useExisting: StrangerAlertService },
  ],
  exports: [
    FaceDeviceProviderFactory,
    FaceProvisioningService,
    FaceAttendanceService,
    FACE_VERIFY_HOOK,
    STRANGER_ALERT_HOOK,
  ],
})
export class FaceAccessModule {}
