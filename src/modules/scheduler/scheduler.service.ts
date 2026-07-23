import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CheckInAlertService } from '../attendance/services/checkin-alert.service.js';
import { IotDevicesService } from '../iot/services/iot-devices.service.js';
import { NoShowDetectionService } from '../rooms/services/no-show-detection.service.js';
import { NoShowLifecycleService } from '../rooms/services/no-show-lifecycle.service.js';
import { EarlyVacancyService } from '../rooms/services/early-vacancy.service.js';
import { FaceProvisioningService } from '../face-access/services/face-provisioning.service.js';
import { IvssPersonSyncService } from '../ivss/services/ivss-person-sync.service.js';
import { GateLogPairingService } from '../zones/services/gate-log-pairing.service.js';

/**
 * SchedulerService — Skeleton cron jobs.
 *
 * Các job chỉ log TODO message nếu được enable.
 * Không implement business logic ở đây.
 *
 * Luồng thực tế (TODO):
 * - checkNoShow() → UtilizationService.detectNoShow()
 * - autoRelease() → UtilizationService.autoReleaseRooms()
 * - sendReminders() → NotificationsService.sendScheduledReminders()
 * - checkCheckinAlerts() → CheckInAlertService.processMeetings()
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  private readonly schedulerEnabled: boolean;
  private readonly noShowEnabled: boolean;
  private readonly autoReleaseEnabled: boolean;
  private readonly reminderEnabled: boolean;
  private readonly deviceOfflineDetectEnabled: boolean;
  private readonly faceSyncEnabled: boolean;
  private readonly earlyVacancyEnabled: boolean;
  private readonly ivssSyncEnabled: boolean;
  private readonly gatePairingEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly checkInAlertService: CheckInAlertService,
    private readonly iotDevicesService: IotDevicesService,
    private readonly noShowDetectionService: NoShowDetectionService,
    private readonly noShowLifecycleService: NoShowLifecycleService,
    private readonly earlyVacancyService: EarlyVacancyService,
    private readonly faceProvisioningService: FaceProvisioningService,
    private readonly ivssPersonSyncService: IvssPersonSyncService,
    private readonly gateLogPairingService: GateLogPairingService,
  ) {
    this.schedulerEnabled = this.configService.get<boolean>(
      'SCHEDULER_ENABLED',
      true,
    );
    this.noShowEnabled = this.configService.get<boolean>(
      'SCHEDULER_NO_SHOW_CHECK_ENABLED',
      false,
    );
    this.autoReleaseEnabled = this.configService.get<boolean>(
      'SCHEDULER_AUTO_RELEASE_ENABLED',
      false,
    );
    this.reminderEnabled = this.configService.get<boolean>(
      'SCHEDULER_NOTIFICATION_REMINDER_ENABLED',
      false,
    );
    this.deviceOfflineDetectEnabled = this.configService.get<boolean>(
      'DEVICE_OFFLINE_DETECT_ENABLED',
      true,
    );
    this.faceSyncEnabled = this.configService.get<boolean>(
      'FACE_SYNC_ENABLED',
      false,
    );
    this.earlyVacancyEnabled = this.configService.get<boolean>(
      'SCHEDULER_EARLY_VACANCY_ENABLED',
      false,
    );
    this.ivssSyncEnabled = this.configService.get<boolean>(
      'SCHEDULER_IVSS_SYNC_ENABLED',
      false,
    );
    this.gatePairingEnabled = this.configService.get<boolean>(
      'SCHEDULER_GATE_PAIRING_ENABLED',
      false,
    );

    this.logger.log(
      `SchedulerService initialized — enabled=${this.schedulerEnabled} | no-show=${this.noShowEnabled} | auto-release=${this.autoReleaseEnabled} | reminder=${this.reminderEnabled} | device-offline-detect=${this.deviceOfflineDetectEnabled} | face-sync=${this.faceSyncEnabled} | early-vacancy=${this.earlyVacancyEnabled} | ivss-sync=${this.ivssSyncEnabled} | gate-pairing=${this.gatePairingEnabled}`,
    );
  }

  /**
   * FMP-001 (#FaceB): provision/deprovision khuôn mặt theo cuộc họp.
   * Gate SCHEDULER_ENABLED && FACE_SYNC_ENABLED (default OFF). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'face-sync' })
  async faceSync(): Promise<void> {
    if (!this.schedulerEnabled || !this.faceSyncEnabled) return;
    try {
      const p = await this.faceProvisioningService.provisionUpcomingMeetings();
      const d = await this.faceProvisioningService.deprovisionEndedMeetings();
      this.logger.log(
        `[Scheduler] face-sync: provisioned-scan=${p.scanned} skipped=${p.skipped} deprovisioned-scan=${d.scanned}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] face-sync failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'face-reconcile' })
  async faceReconcile(): Promise<void> {
    if (!this.schedulerEnabled || !this.faceSyncEnabled) return;
    try {
      const r = await this.faceProvisioningService.reconcile();
      this.logger.log(
        `[Scheduler] face-reconcile: stale=${r.stale} deduped=${r.deduped}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] face-reconcile failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  /**
   * IOT-014 — Active probe phát hiện camera offline.
   * Cron cố định EVERY_MINUTE; gate SCHEDULER_ENABLED && DEVICE_OFFLINE_DETECT_ENABLED.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'device-offline-detect' })
  async detectOfflineDevices(): Promise<void> {
    if (!this.schedulerEnabled || !this.deviceOfflineDetectEnabled) return;

    const r = await this.iotDevicesService.detectOfflineDevices(null);
    this.logger.log(
      `[Scheduler] device-offline-detect: checked=${r.checked} online=${r.online_count} offline=${r.offline_count} transitions=${r.transitions.length}`,
    );
  }

  /**
   * No-show detection job.
   * Cron: SCHEDULER_NO_SHOW_CHECK_CRON (default: every 5 minutes)
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'no-show-check' })
  async checkNoShow(): Promise<void> {
    if (!this.schedulerEnabled || !this.noShowEnabled) return;

    // NSC-001 (#31) + NSL-001 (OQ-4): detect → reconcile-presence → warn.
    // detect() commit case 'risk' trước; reconcile/warn re-query sau. KHÔNG ném ra cron.
    try {
      const d = await this.noShowDetectionService.detect();
      const rec = await this.noShowLifecycleService.reconcilePresence();
      const w = await this.noShowLifecycleService.warnBatch();
      this.logger.log(
        `[Scheduler] no-show-check: detected scanned=${d.scanned} created=${d.created}` +
          ` | reconcile resolved=${rec.resolved} | warn scanned=${w.scanned} warned=${w.warned}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] no-show-check failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * Auto-release room job.
   * Cron: SCHEDULER_AUTO_RELEASE_CRON (default: every 5 minutes)
   *
   * TODO: Gọi UtilizationService.autoReleaseRooms() khi implement.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'auto-release' })
  async autoRelease(): Promise<void> {
    if (!this.schedulerEnabled || !this.autoReleaseEnabled) return;

    // NSL-001 (#33): release case warning_sent quá deadline. KHÔNG ném ra cron (ARCH-02).
    try {
      const r = await this.noShowLifecycleService.autoReleaseBatch();
      this.logger.log(
        `[Scheduler] auto-release: scanned=${r.scanned} released=${r.released} skipped=${r.skipped}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] auto-release failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * EVD-001 (#34) — phát hiện phòng trống sớm (họp đã bắt đầu rồi trống).
   * Gate SCHEDULER_ENABLED && SCHEDULER_EARLY_VACANCY_ENABLED (default OFF). KHÔNG ném ra cron.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'early-vacancy' })
  async earlyVacancy(): Promise<void> {
    if (!this.schedulerEnabled || !this.earlyVacancyEnabled) return;

    try {
      const r = await this.earlyVacancyService.detect();
      this.logger.log(
        `[Scheduler] early-vacancy: scanned=${r.scanned} flagged=${r.flagged}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] early-vacancy failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * IPS-001 (#37) — đồng bộ person IVSS theo cuộc họp (enroll + cleanup).
   * Gate SCHEDULER_ENABLED && SCHEDULER_IVSS_SYNC_ENABLED (default OFF). KHÔNG ném ra cron (ARCH-02).
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'ivss-sync' })
  async ivssSync(): Promise<void> {
    if (!this.schedulerEnabled || !this.ivssSyncEnabled) return;

    try {
      const p = await this.ivssPersonSyncService.provisionUpcoming();
      const c = await this.ivssPersonSyncService.cleanupEnded();
      this.logger.log(
        `[Scheduler] ivss-sync: provision scanned=${p.scanned} enrolled=${p.enrolled} skipped=${p.skipped} failed=${p.failed}` +
          ` | cleanup scanned=${c.scanned} removed=${c.removed} failed=${c.failed}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] ivss-sync failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * GAP-001 (UC-106) — ghép cặp enter/leave ở cổng, ghi paired_log_id + duration_seconds.
   * Gate SCHEDULER_ENABLED && SCHEDULER_GATE_PAIRING_ENABLED (default OFF). KHÔNG ném ra cron
   * (ARCH-02). Bảng gate_access_logs rỗng tới khi UC-105 (writer) hoạt động → scanned=0.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'gate-log-pairing' })
  async gateLogPairing(): Promise<void> {
    if (!this.schedulerEnabled || !this.gatePairingEnabled) return;

    try {
      const r = await this.gateLogPairingService.pairBatch();
      this.logger.log(
        `[Scheduler] gate-log-pairing: scanned=${r.scanned} paired=${r.paired} skipped=${r.skipped}`,
      );
    } catch (e) {
      this.logger.error(
        `[Scheduler] gate-log-pairing failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * Meeting reminder notification job.
   * Cron: SCHEDULER_NOTIFICATION_REMINDER_CRON (default: every hour)
   *
   * TODO: Gọi NotificationsService.sendScheduledReminders() khi implement.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'notification-reminder' })
  async sendReminders(): Promise<void> {
    if (!this.schedulerEnabled || !this.reminderEnabled) return;

    this.logger.log(
      '[Scheduler] sendReminders() triggered — TODO: implement reminder notification logic.',
    );
    // TODO: inject NotificationsService và gọi sendScheduledReminders()
  }

  /**
   * Check-in alert job.
   * Cron: every 1 minute (scan_interval_seconds default=60)
   * Business logic checks config attendance.checkin_alert.enabled internally.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'checkin-alert' })
  async checkCheckinAlerts(): Promise<void> {
    if (!this.schedulerEnabled) return;

    this.logger.debug('[Scheduler] checkCheckinAlerts() triggered');
    try {
      await this.checkInAlertService.processMeetings();
    } catch (error) {
      this.logger.error(
        `[Scheduler] checkCheckinAlerts() failed: ${(error as Error).message}`,
      );
    }
  }
}
