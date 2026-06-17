import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FaceDeviceProviderFactory } from './face-device-provider.factory.js';
import { FaceProvisioningService } from './services/face-provisioning.service.js';
import { FaceAttendanceService } from './services/face-attendance.service.js';
import { FACE_VERIFY_HOOK } from '../../common/ports/face-verify-hook.js';
import { AccountsModule } from '../accounts/accounts.module.js';

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
  imports: [ConfigModule, AccountsModule],
  providers: [
    FaceDeviceProviderFactory,
    FaceProvisioningService,
    FaceAttendanceService,
    { provide: FACE_VERIFY_HOOK, useExisting: FaceAttendanceService },
  ],
  exports: [
    FaceDeviceProviderFactory,
    FaceProvisioningService,
    FaceAttendanceService,
    FACE_VERIFY_HOOK,
  ],
})
export class FaceAccessModule {}
