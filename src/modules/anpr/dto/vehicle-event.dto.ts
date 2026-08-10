import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: 'Biển số xe do bridge đọc được (dạng thô, sẽ được chuẩn hoá ở UC4)' })
  @IsString()
  @IsNotEmpty()
  plateNumber: string;

  @ApiProperty({ description: 'ID kênh camera ANPR đã ghi nhận sự kiện' })
  @Type(() => Number)
  @IsInt()
  channelId: number;

  @ApiProperty({ description: 'Thời điểm sự kiện xảy ra (ISO 8601)' })
  @IsISO8601()
  utc: string;

  @ApiPropertyOptional({ description: 'Hành động sự kiện (vd: enter/leave/seen)' })
  @IsOptional()
  @IsString()
  eventAction?: string;

  @ApiPropertyOptional({ description: 'Màu biển số nhận diện được' })
  @IsOptional()
  @IsString()
  plateColor?: string;

  @ApiPropertyOptional({ description: 'Màu xe nhận diện được' })
  @IsOptional()
  @IsString()
  vehicleColor?: string;

  @ApiPropertyOptional({ description: 'Loại phương tiện nhận diện được' })
  @IsOptional()
  @IsString()
  vehicleType?: string;

  /** SEC-01: KHÔNG log/audit trường này — chỉ dùng để lưu snapshot. */
  @ApiPropertyOptional({
    description: 'Ảnh snapshot dạng base64 (nếu bridge gửi) — KHÔNG được log/audit',
  })
  @IsOptional()
  @IsString()
  imageBase64?: string;
}
