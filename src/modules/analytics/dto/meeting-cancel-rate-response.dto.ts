export class CancelRatePointDto {
  period: string;
  totalCount: number;
  cancelledCount: number;
  cancelRate: number;
}

export class TopOrganizerDto {
  userId: string;
  email: string;
  fullName: string;
  organizedCount: number;
  cancelledCount: number;
  cancelRate: number;
}

export class TopDepartmentDto {
  departmentId: string;
  departmentName: string;
  organizedCount: number;
  cancelledCount: number;
  cancelRate: number;
}

export class MeetingCancelRateResponseDto {
  period: { from: string; to: string };
  totalMeetingCount: number;
  cancelledCount: number;
  cancelRate: number;
  series: CancelRatePointDto[];
  topOrganizers: TopOrganizerDto[];
  topDepartments: TopDepartmentDto[];
  message?: string;
}
