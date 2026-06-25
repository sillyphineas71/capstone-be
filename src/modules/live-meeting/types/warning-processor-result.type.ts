export interface WarningProcessorResult {
  skipped: boolean;
  reason?: 'meeting_not_found' | 'meeting_not_in_progress' | 'already_sent' | 'host_not_found';
  branch?: 'A' | 'B';
  warningLevel?: 'standard' | 'overdue' | 'strict' | 'urgent';
  notificationId?: string;
  remainingMinutes?: number;
}
