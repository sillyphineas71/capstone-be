import { IsOptional, IsString, MaxLength } from 'class-validator';

/** QueryDashboardOverviewDto (CDB-001 / UC-126) — query cho `GET /api/v1/campus-dashboard/overview`. */
export class QueryDashboardOverviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;
}
