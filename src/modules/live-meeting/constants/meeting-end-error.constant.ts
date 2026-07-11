/**
 * Error codes constants cho UC-IMM-05 Ket thuc phien hop.
 * Su dung trong LiveMeetingService de throw NestJS exception voi ma loi chuan hoa.
 */
export const MEETING_END_ERRORS = {
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_NOT_IN_PROGRESS: 'MEETING_NOT_IN_PROGRESS',
  MEETING_ALREADY_COMPLETED: 'MEETING_ALREADY_COMPLETED',
  MEETING_NOT_STARTED: 'MEETING_NOT_STARTED',
  MEETING_CANCELLED: 'MEETING_CANCELLED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

export type MeetingEndErrorCode =
  (typeof MEETING_END_ERRORS)[keyof typeof MEETING_END_ERRORS];
