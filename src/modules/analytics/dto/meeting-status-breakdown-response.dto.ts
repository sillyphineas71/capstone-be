export class StatusBreakdownItemDto {
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  count: number;
  percentage: number;
}

export class MeetingStatusBreakdownResponseDto {
  period: { from: string; to: string };
  total: number;
  items: StatusBreakdownItemDto[];
  message?: string;
}
