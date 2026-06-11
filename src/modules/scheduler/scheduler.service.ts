import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

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
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  private readonly schedulerEnabled: boolean;
  private readonly noShowEnabled: boolean;
  private readonly autoReleaseEnabled: boolean;
  private readonly reminderEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.schedulerEnabled = this.configService.get<boolean>('SCHEDULER_ENABLED', true);
    this.noShowEnabled = this.configService.get<boolean>('SCHEDULER_NO_SHOW_CHECK_ENABLED', false);
    this.autoReleaseEnabled = this.configService.get<boolean>('SCHEDULER_AUTO_RELEASE_ENABLED', false);
    this.reminderEnabled = this.configService.get<boolean>('SCHEDULER_NOTIFICATION_REMINDER_ENABLED', false);

    this.logger.log(
      `SchedulerService initialized — enabled=${this.schedulerEnabled} | no-show=${this.noShowEnabled} | auto-release=${this.autoReleaseEnabled} | reminder=${this.reminderEnabled}`,
    );
  }

  /**
   * No-show detection job.
   * Cron: SCHEDULER_NO_SHOW_CHECK_CRON (default: every 5 minutes)
   *
   * TODO: Gọi UtilizationService.detectNoShow() khi implement.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'no-show-check' })
  async checkNoShow(): Promise<void> {
    if (!this.schedulerEnabled || !this.noShowEnabled) return;

    this.logger.log('[Scheduler] checkNoShow() triggered — TODO: implement no-show detection logic.');
    // TODO: inject UtilizationService và gọi detectNoShow()
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

    this.logger.log('[Scheduler] autoRelease() triggered — TODO: implement auto-release room logic.');
    // TODO: inject UtilizationService và gọi autoReleaseRooms()
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

    this.logger.log('[Scheduler] sendReminders() triggered — TODO: implement reminder notification logic.');
    // TODO: inject NotificationsService và gọi sendScheduledReminders()
  }
}
