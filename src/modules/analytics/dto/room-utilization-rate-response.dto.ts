export class MetricPairDto {
  current: number | null;
  comparison: number | null;
  deltaPercent: number | null;
}

export class HoursPairDto {
  current: number;
  comparison: number;
}

export class TrendBucketDetailDto {
  reservationUtilizationRate: number;
  roomOccupancyRate: number | null;
}

export class TrendBucketDto {
  index: string; // e.g. "Ngày 1", "Tuần 1"
  current: TrendBucketDetailDto;
  comparison: TrendBucketDetailDto;
}

export class RoomUtilizationRateSummaryDto {
  reservationUtilizationRate: MetricPairDto;
  roomOccupancyRate: MetricPairDto;
  noShowRate: MetricPairDto;
  bookedHours: HoursPairDto;
  actualHours: HoursPairDto;
  availableHours: HoursPairDto;
}

export class RoomUtilizationRateResponseDto {
  currentPeriod: { from: string; to: string };
  comparisonPeriod: { from: string; to: string };
  comparisonHasNoData: boolean;
  summary: RoomUtilizationRateSummaryDto;
  trend: TrendBucketDto[];
  message?: string;
}
