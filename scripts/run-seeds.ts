import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AppDataSource } from '../src/database/data-source';

// Load .env từ root project
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Import tất cả seed functions ────────────────────────────────────────────
import { seedDepartmentPermission } from '../src/database/seeds/20260608025436-SeedDepartmentPermission';
import { seedMeetingRequestPermissions } from '../src/database/seeds/20260608025437-SeedMeetingRequestPermissions';
import { seedMeetingUpdateTimePermissions } from '../src/database/seeds/20260609000000-SeedMeetingUpdateTimePermissions';
import { seedMeetingRoomUpdatePermission } from '../src/database/seeds/20260609000001-SeedMeetingRoomUpdatePermission';
import { seedMeetingCancelPermissions } from '../src/database/seeds/20260609000002-SeedMeetingCancelPermissions';
import { seedScheduleReadSelfPermission } from '../src/database/seeds/20260609000003-SeedScheduleReadSelfPermission';
import { seedAddParticipantPermissions } from '../src/database/seeds/20260610000001-SeedAddParticipantPermissions';
import { seedRemoveParticipantPermissions } from '../src/database/seeds/20260611000001-SeedRemoveParticipantPermissions';
import { seedIotDeviceUpdatePermission } from '../src/database/seeds/20260615000001-SeedIotDeviceUpdatePermission';
import { seedIotDeviceDisableEnablePermissions } from '../src/database/seeds/20260615000002-SeedIotDeviceDisableEnablePermissions';
import { seedIotDeviceReadPermission } from '../src/database/seeds/20260615000003-SeedIotDeviceReadPermission';
import { seedIotDeviceProbePermission } from '../src/database/seeds/20260615000004-SeedIotDeviceProbePermission';
import { seedRecordingConfigPermissions } from '../src/database/seeds/20260615000005-SeedRecordingConfigPermissions';
import { seedRecordingVideoStartPermission } from '../src/database/seeds/20260615000006-SeedRecordingVideoStartPermission';
import { seedRecordingVideoStopPermission } from '../src/database/seeds/20260615000007-SeedRecordingVideoStopPermission';
import { seedRecordingVideoStatusPermission } from '../src/database/seeds/20260615000008-SeedRecordingVideoStatusPermission';
import { seedMediaFilesPermissions } from '../src/database/seeds/20260615000009-SeedMediaFilesPermissions';
import { seedMeetingSessionStartPermission } from '../src/database/seeds/20260616000001-SeedMeetingSessionStartPermission';
import { seedParticipantConflictCheckPermission } from '../src/database/seeds/20260616000001-SeedParticipantConflictCheckPermission';
import { seedCheckinAlertConfig } from '../src/database/seeds/20260616000002-SeedCheckinAlertConfig';
import { seedMeetingExtensionRequestPermission } from '../src/database/seeds/20260616000003-SeedMeetingExtensionRequestPermission';
import { seedMeetingExtensionDecidePermission } from '../src/database/seeds/20260617000001-SeedMeetingExtensionDecidePermission';
import { seedMeetingEndPermission } from '../src/database/seeds/20260617000002-SeedMeetingEndPermission';
import { seedMeetingNotePermissions } from '../src/database/seeds/20260618000001-SeedMeetingNotePermissions';
import { seedMeetingWarningConfig } from '../src/database/seeds/20260619000001-SeedMeetingWarningConfig';
import { seedMeetingWarningConflictConfig } from '../src/database/seeds/20260619000002-SeedMeetingWarningConflictConfig';
import { seedMeetingRequestReadPermission } from '../src/database/seeds/20260623000001-SeedMeetingRequestReadPermission';
import { seedUserListPermission } from '../src/database/seeds/20260624000001-SeedUserListPermission';
import { seedAddExternalParticipantPermissions } from '../src/database/seeds/20260625000001-SeedAddExternalParticipantPermissions';
import { seedRemoveExternalParticipantPermissions } from '../src/database/seeds/20260625000002-SeedRemoveExternalParticipantPermissions';
import { seedMeetingMinutesCreatePermission } from '../src/database/seeds/20260702000001-SeedMeetingMinutesCreatePermission';
import { seedAnalyticsOverviewPermission } from '../src/database/seeds/20260702030000-SeedAnalyticsOverviewPermission';
import { seedAnalyticsAttendanceReadPermission } from '../src/database/seeds/20260702060000-SeedAnalyticsAttendanceReadPermission';
import { seedAnalyticsRoomReadPermission } from '../src/database/seeds/20260702070000-SeedAnalyticsRoomReadPermission';
import { seedReportMeetingActivityExportPermission } from '../src/database/seeds/20260703000001-SeedReportMeetingActivityExportPermission';

// ── Danh sách seeds theo thứ tự ─────────────────────────────────────────────
const seeds: Array<{ name: string; fn: (ds: typeof AppDataSource) => Promise<void> }> = [
  { name: '20260608025436 - SeedDepartmentPermission', fn: seedDepartmentPermission },
  { name: '20260608025437 - SeedMeetingRequestPermissions', fn: seedMeetingRequestPermissions },
  { name: '20260609000000 - SeedMeetingUpdateTimePermissions', fn: seedMeetingUpdateTimePermissions },
  { name: '20260609000001 - SeedMeetingRoomUpdatePermission', fn: seedMeetingRoomUpdatePermission },
  { name: '20260609000002 - SeedMeetingCancelPermissions', fn: seedMeetingCancelPermissions },
  { name: '20260609000003 - SeedScheduleReadSelfPermission', fn: seedScheduleReadSelfPermission },
  { name: '20260610000001 - SeedAddParticipantPermissions', fn: seedAddParticipantPermissions },
  { name: '20260611000001 - SeedRemoveParticipantPermissions', fn: seedRemoveParticipantPermissions },
  { name: '20260615000001 - SeedIotDeviceUpdatePermission', fn: seedIotDeviceUpdatePermission },
  { name: '20260615000002 - SeedIotDeviceDisableEnablePermissions', fn: seedIotDeviceDisableEnablePermissions },
  { name: '20260615000003 - SeedIotDeviceReadPermission', fn: seedIotDeviceReadPermission },
  { name: '20260615000004 - SeedIotDeviceProbePermission', fn: seedIotDeviceProbePermission },
  { name: '20260615000005 - SeedRecordingConfigPermissions', fn: seedRecordingConfigPermissions },
  { name: '20260615000006 - SeedRecordingVideoStartPermission', fn: seedRecordingVideoStartPermission },
  { name: '20260615000007 - SeedRecordingVideoStopPermission', fn: seedRecordingVideoStopPermission },
  { name: '20260615000008 - SeedRecordingVideoStatusPermission', fn: seedRecordingVideoStatusPermission },
  { name: '20260615000009 - SeedMediaFilesPermissions', fn: seedMediaFilesPermissions },
  { name: '20260616000001 - SeedMeetingSessionStartPermission', fn: seedMeetingSessionStartPermission },
  { name: '20260616000001 - SeedParticipantConflictCheckPermission', fn: seedParticipantConflictCheckPermission },
  { name: '20260616000002 - SeedCheckinAlertConfig', fn: seedCheckinAlertConfig },
  { name: '20260616000003 - SeedMeetingExtensionRequestPermission', fn: seedMeetingExtensionRequestPermission },
  { name: '20260617000001 - SeedMeetingExtensionDecidePermission', fn: seedMeetingExtensionDecidePermission },
  { name: '20260617000002 - SeedMeetingEndPermission', fn: seedMeetingEndPermission },
  { name: '20260618000001 - SeedMeetingNotePermissions', fn: seedMeetingNotePermissions },
  { name: '20260619000001 - SeedMeetingWarningConfig', fn: seedMeetingWarningConfig },
  { name: '20260619000002 - SeedMeetingWarningConflictConfig', fn: seedMeetingWarningConflictConfig },
  { name: '20260623000001 - SeedMeetingRequestReadPermission', fn: seedMeetingRequestReadPermission },
  { name: '20260624000001 - SeedUserListPermission', fn: seedUserListPermission },
  { name: '20260625000001 - SeedAddExternalParticipantPermissions', fn: seedAddExternalParticipantPermissions },
  { name: '20260625000002 - SeedRemoveExternalParticipantPermissions', fn: seedRemoveExternalParticipantPermissions },
  { name: '20260702000001 - SeedMeetingMinutesCreatePermission', fn: seedMeetingMinutesCreatePermission },
  { name: '20260702030000 - SeedAnalyticsOverviewPermission', fn: seedAnalyticsOverviewPermission },
  { name: '20260702060000 - SeedAnalyticsAttendanceReadPermission', fn: seedAnalyticsAttendanceReadPermission },
  { name: '20260702070000 - SeedAnalyticsRoomReadPermission', fn: seedAnalyticsRoomReadPermission },
  { name: '20260703000001 - SeedReportMeetingActivityExportPermission', fn: seedReportMeetingActivityExportPermission },
];

// ── Main runner ──────────────────────────────────────────────────────────────
async function runAllSeeds(): Promise<void> {
  console.log('🌱 Connecting to database...');
  await AppDataSource.initialize();
  console.log('✅ Connected.\n');

  let successCount = 0;
  let failCount = 0;

  for (const seed of seeds) {
    process.stdout.write(`  ▶ ${seed.name} ... `);
    try {
      await seed.fn(AppDataSource);
      console.log('✅ OK');
      successCount++;
    } catch (err: any) {
      console.log(`❌ FAILED: ${err?.message ?? err}`);
      failCount++;
    }
  }

  console.log(`\n📊 Done: ${successCount} success, ${failCount} failed out of ${seeds.length} seeds.`);
  await AppDataSource.destroy();
  process.exit(failCount > 0 ? 1 : 0);
}

runAllSeeds().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
