import { AttendanceStatus, ParticipantState } from '../types/attendance-participant.type.js';

export class AttendanceParticipantDto {
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

  constructor(data: AttendanceParticipantDto) {
    Object.assign(this, data);
  }
}

export class AttendanceMetaDto {
  page: number;
  pageSize: number;
  currentInvitedCount: number;
  checkedInCount: number;
  lateCount: number;
  absentCount: number;
  removedCount: number;
  totalPages: number;

  constructor(data: AttendanceMetaDto) {
    Object.assign(this, data);
  }
}

export class MeetingAttendanceResponseDto {
  meetingId: string;
  meetingStatus: string;
  actualStartTime: string | null;
  lateThresholdMinutes: number;
  participants: AttendanceParticipantDto[];
  meta: AttendanceMetaDto;

  constructor(data: MeetingAttendanceResponseDto) {
    Object.assign(this, data);
  }
}
