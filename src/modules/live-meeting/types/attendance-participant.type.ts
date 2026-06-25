/**
 * Types cho UC-IMM-08 Xem trang thai diem danh nguoi tham du.
 */

export enum AttendanceStatus {
  CHECKED_IN = 'checked_in',
  LATE = 'late',
  ABSENT = 'absent',
}

export enum ParticipantState {
  ACTIVE = 'active',
  REMOVED = 'removed',
}

export enum MeetingAttendanceStatusGate {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

export interface AttendanceParticipant {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  departmentId: string | null;
  departmentName: string | null;
  participantRole: string;
  attendanceStatus: AttendanceStatus;
  checkInTime: string | null;
  isProvisional: boolean;
  participantState: ParticipantState;
}

export interface AttendanceMeta {
  page: number;
  pageSize: number;
  currentInvitedCount: number;
  checkedInCount: number;
  lateCount: number;
  absentCount: number;
  removedCount: number;
  totalPages: number;
}

export interface AttendanceResponse {
  meetingId: string;
  meetingStatus: string;
  actualStartTime: string | null;
  lateThresholdMinutes: number;
  participants: AttendanceParticipant[];
}
