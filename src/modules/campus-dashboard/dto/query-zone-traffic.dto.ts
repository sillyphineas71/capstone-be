import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** QueryZoneTrafficDto (ZTH-001 / UC-120) — query cho `GET /campus-dashboard/zones/traffic`. */
export class QueryZoneTrafficDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  floor?: string;
}
