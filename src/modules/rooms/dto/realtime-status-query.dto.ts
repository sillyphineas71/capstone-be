import { IsOptional, IsString } from 'class-validator';

/** Query lọc realtime room status (UC-36). */
export class RealtimeStatusQueryDto {
  @IsOptional()
  @IsString()
  siteName?: string;

  @IsOptional()
  @IsString()
  areaName?: string;
}
