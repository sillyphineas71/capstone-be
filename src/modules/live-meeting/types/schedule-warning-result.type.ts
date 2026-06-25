export interface ScheduleWarningResult {
  skipped: boolean;
  reason?: 'guard_failed' | 'too_close' | 'error';
  warningScheduledAt?: Date;
}
