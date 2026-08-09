import { ApiProperty } from '@nestjs/swagger';

export class HourlyBucketDto {
  @ApiProperty({ example: '00:00' })
  hour: string;

  @ApiProperty({ example: 2 })
  count: number;
}

export class AuditActivityHourlyResponseDto {
  @ApiProperty({ example: '2026-08-09' })
  date: string;

  @ApiProperty({ type: [HourlyBucketDto] })
  buckets: HourlyBucketDto[];

  @ApiProperty({ example: 335 })
  totalToday: number;
}
