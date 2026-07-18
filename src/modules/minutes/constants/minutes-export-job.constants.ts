/**
 * minutes-export-job.constants.ts (UC-147)
 * Hằng số cho queue 'minutes-export' (đã đăng ký sẵn trong QueueModule qua
 * QUEUE_MINUTES_EXPORT_NAME) và job name.
 *
 * ARCH: Dùng đúng tên queue đã đăng ký — KHÔNG registerQueue mới.
 */

/** Khớp env QUEUE_MINUTES_EXPORT (default 'minutes-export'). */
export const MINUTES_EXPORT_QUEUE_NAME = 'minutes-export';

/** Job name cho export biên bản. */
export const MINUTES_EXPORT_JOB_NAME = 'export:meeting-minutes';

/** Audit action khi export thành công. */
export const MINUTES_EXPORT_AUDIT_ACTION = 'meeting_minutes_exported';
