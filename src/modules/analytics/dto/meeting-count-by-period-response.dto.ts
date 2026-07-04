export class SeriesPointDto {
  period: string;
  count: number;
}

export class MeetingCountByPeriodResponseDto {
  total: number;
  series: SeriesPointDto[];
  message?: string;
}
