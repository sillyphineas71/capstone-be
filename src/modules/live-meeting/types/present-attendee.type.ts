/**
 * Types cho UC-IMM-07 Xem danh sach nguoi tham du dang co mat.
 */

export enum PresenceStatus {
  PRESENT = 'present',
  MAYBE_PRESENT = 'maybe_present',
  LEFT = 'left',
  ABSENT = 'absent',
  UNKNOWN = 'unknown',
}

export interface PresentAttendeeItem {
  userId: string;
  fullName: string;
  email?: string;
  departmentId?: string;
  departmentName?: string;
  avatarUrl?: string;
  participantRole: string;
  presenceStatus: PresenceStatus;
  presenceSource?: string;
  confidenceScore?: number;
  checkInTime?: string;
  joinedAt?: string;
  lastSeenAt?: string;
}

export interface PresentAttendeesResponse {
  meetingId: string;
  occupancyCount: number;
  presentUsers: PresentAttendeeItem[];
  updatedAt: string;
}

export interface PresentAttendeesQueryDto {
  search?: string;
  departmentId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
