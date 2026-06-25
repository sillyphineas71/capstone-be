import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * VehicleEventDto (VWH-001 / UC4) — body webhook bridge → NestJS (mirror FaceEventDto).
 *
 * Bắt buộc: plateNumber(raw)/channelId/utc. Optional: eventAction/màu/type/imageBase64.
 * channelId → number (R: @Type). SEC-01: imageBase64 KHÔNG log/audit. UC4 normalize plateNumber.
 */
export class VehicleEventDto {
  @IsString()
  @IsNotEmpty()
  plateNumber: string;

  @Type(() => Number)
  @IsInt()
  channelId: number;

  @IsISO8601()
  utc: string;

  @IsOptional()
  @IsString()
  eventAction?: string;

  @IsOptional()
  @IsString()
  plateColor?: string;

  @IsOptional()
  @IsString()
  vehicleColor?: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  imageBase64?: string;
}
