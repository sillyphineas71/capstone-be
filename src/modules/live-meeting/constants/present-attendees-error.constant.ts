/**
 * Error codes constants cho UC-IMM-07 Xem danh sach nguoi tham du dang co mat.
 * Su dung trong LiveMeetingService de throw NestJS exception voi ma loi chuan hoa.
 */
export const PRESENT_ATTENDEES_ERRORS = {
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_NOT_IN_PROGRESS: 'MEETING_NOT_IN_PROGRESS',
  FORBIDDEN_LIVE_PARTICIPANTS_ACCESS: 'FORBIDDEN_LIVE_PARTICIPANTS_ACCESS',
  INVALID_QUERY: 'INVALID_QUERY',
} as const;

export type PresentAttendeesErrorCode = (typeof PRESENT_ATTENDEES_ERRORS)[keyof typeof PRESENT_ATTENDEES_ERRORS];
