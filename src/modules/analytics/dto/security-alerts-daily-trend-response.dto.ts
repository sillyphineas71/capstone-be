import { ApiProperty } from '@nestjs/swagger';

export class DailyTrendPointDto {
  @ApiProperty({ example: '2026-08-03' })
  date: string;

  @ApiProperty({ example: 3 })
  total: number;

  @ApiProperty({
    example: { intrusion: 1, stranger: 2 },
    description: 'Chi liet ke alert_type co count > 0 trong ngay do',
  })
  byType: Record<string, number>;
}

export class SecurityAlertsDailyTrendResponseDto {
  @ApiProperty({ type: [DailyTrendPointDto] })
  series: DailyTrendPointDto[];

  @ApiProperty({ example: 4 })
  totalInPeriod: number;
}
