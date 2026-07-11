/**
 * Error codes constants cho UC-IMM-08 Xem trang thai diem danh nguoi tham du.
 * Su dung trong LiveMeetingService de throw NestJS exception voi ma loi chuan hoa.
 */
export const MEETING_ATTENDANCE_ERRORS = {
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_NOT_ACTIVE_OR_COMPLETED: 'MEETING_NOT_ACTIVE_OR_COMPLETED',
  FORBIDDEN_ATTENDANCE_ACCESS: 'FORBIDDEN_ATTENDANCE_ACCESS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type MeetingAttendanceErrorCode =
  (typeof MEETING_ATTENDANCE_ERRORS)[keyof typeof MEETING_ATTENDANCE_ERRORS];
