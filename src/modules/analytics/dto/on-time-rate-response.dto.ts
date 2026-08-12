export class TrendPointDto {
  period: string; // ISO week start date split('T')[0]
  onTimeCount: number;
  lateCount: number;
  absentCount: number;
  totalRequiredParticipants: number;
  onTimeRate: number;
}

export class HourBucketDto {
  hourOfDay: number; // 0-23
  lateCount: number;
  totalRequiredParticipants: number;
  lateRate: number;
}

export class DepartmentLateItemDto {
  departmentId: string;
  departmentName: string;
  lateCount: number;
  totalRequiredParticipants: number;
  lateRate: number;
}

export class OnTimeRateResponseDto {
  period: { from: string; to: string };
  graceMinutes: number;
  onTimeCount: number;
  lateCount: number;
  absentCount: number;
  totalRequiredParticipants: number;
  onTimeRate: number;
  trend: TrendPointDto[];
  lateByHourOfDay: HourBucketDto[];
  lateByDepartment: DepartmentLateItemDto[];
  message?: string;
}

export class LateMeetingItemDto {
  meetingId: string;
  meetingTitle: string;
  scheduledStartTime: Date;
  checkInTime: Date;
  lateMinutes: number;
}

export class LateHistoryResponseDto {
  user: {
    userId: string;
    fullName: string;
    email: string;
  };
  period: { from: string; to: string };
  lateMeetings: LateMeetingItemDto[];
}

export class UserLateStatsItemDto {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  employeeCode: string | null;
  departmentId: string | null;
  departmentName: string | null;
  lateCount: number;
  onTimeCount: number;
  absentCount: number;
  totalRequired: number;
  lateRate: number;
}

export class UserLateStatsResponseDto {
  items: UserLateStatsItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  period: { from: string; to: string };
  graceMinutes: number;
  message?: string;
}
