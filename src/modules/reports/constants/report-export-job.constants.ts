/**
 * report-export-job.constants.ts
 * Hằng số cho queue 'report-export' (đã đăng ký sẵn trong QueueModule)
 * và job name 'export:meeting-activity'.
 *
 * ARCH: Dùng đúng tên queue đã đăng ký - KHÔNG tạo queue mới.
 */

/** Khớp đúng tên queue đã đăng ký trong QueueModule (env QUEUE_REPORT_EXPORT) */
export const REPORT_EXPORT_QUEUE_NAME = 'report-export';

/** Job name cho meeting activity export */
export const MEETING_ACTIVITY_EXPORT_JOB_NAME = 'export:meeting-activity';
