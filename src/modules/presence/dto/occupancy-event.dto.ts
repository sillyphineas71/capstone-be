import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ description: 'Mã thiết bị camera gửi sự kiện' })
  @IsOptional()
  @IsString()
  deviceCode?: string;

  @ApiProperty({ description: 'ID phòng đang ghi nhận số người hiện diện' })
  @IsUUID()
  roomId: string;

  @ApiPropertyOptional({
    description: 'ID cuộc họp đang diễn ra tại phòng (nếu có)',
  })
  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @ApiPropertyOptional({ description: 'Loại sự kiện hiện diện' })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiProperty({
    description: 'Số người đếm được trong phòng tại thời điểm sự kiện',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  occupancyCount: number;

  @ApiPropertyOptional({
    description: 'Độ tin cậy của kết quả đếm người (model AI)',
  })
  @IsOptional()
  @IsNumber()
  confidence?: number;

  @ApiPropertyOptional({ description: 'Thời điểm sự kiện xảy ra (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  eventTime?: string;

  @ApiPropertyOptional({ description: 'Metadata tự do đi kèm sự kiện (JSON)' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
