export class RankingItemDto {
  id: string;
  name: string;
  email?: string;
  noShowCount: number;
  totalBookings: number;
  noShowRate: number;
  lowSampleSize: boolean;
}

export class RankingDto {
  rankBy: string;
  items: RankingItemDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export class NoShowRateResponseDto {
  period: { from: string; to: string };
  noShowCount: number;
  totalBookings: number;
  noShowRate: number;
  ranking: RankingDto;
  message?: string;
}
