import {
  IsUUID,
  IsInt,
  IsOptional,
  IsString,
  IsNumber,
  IsISO8601,
  Min,
} from 'class-validator';

/**
 * Occupancy event từ Python Camera Service (UC-75).
 * Raw body vẫn nhận tại boundary; DTO validate field chính khi normalize.
 */
export class OccupancyEventDto {
  @IsOptional()
  @IsString()
  deviceCode?: string;

  @IsUUID()
  roomId: string;

  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsInt()
  @Min(0)
  occupancyCount: number;

  @IsOptional()
  @IsNumber()
  confidence?: number;

  @IsOptional()
  @IsISO8601()
  eventTime?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
