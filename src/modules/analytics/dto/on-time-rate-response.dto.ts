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
  // [FIX 2026-08-13] Tính riêng qua COUNT FILTER(status_bucket='on_time'), KHÔNG suy từ
  // 100-lateRate (sẽ gộp nhầm absentCount vào phần "đúng giờ" — xem on-time-rate.repository.ts).
  onTimeRate: number;
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
  // Alias tương thích FE (be_required_endpoints.md 13/08/2026):
  // totalMeetings = totalRequired; onTimeRate = onTimeCount/totalRequired*100 (làm tròn 1 chữ số).
  totalMeetings: number;
  onTimeRate: number;
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

// ── GET /analytics/attendance/on-time-rate/me (UC-AA-10 / thống kê chuyên cần cá nhân) ──

export class DepartmentAvgDto {
  departmentId: string;
  departmentName: string;
  onTimeRate: number;
}

export class PersonalStatsSummaryDto {
  totalRequired: number;
  onTimeCount: number;
  lateCount: number;
  absentCount: number;
  // null khi totalRequired=0 (chưa có dữ liệu điểm danh trong kỳ, phân biệt với "0% đúng giờ").
  onTimeRate: number | null;
  lateRate: number | null;
}

export class PersonalStatsResponseDto {
  userId: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  departmentName: string | null;
  avatarUrl: string | null;
  period: { from: string; to: string };
  graceMinutes: number;
  summary: PersonalStatsSummaryDto;
  departmentAvg: DepartmentAvgDto | null;
  trend: TrendPointDto[];
  recentLate: LateMeetingItemDto[];
  message?: string;
}
