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
 * OccupancyEventDto (IVSS-OCC-001 / A-OCC) — body People-Counting webhook từ IVSS bridge.
 *
 * `number` = số người hiện tại trong phòng (→ occupancyCount). `enteredNumber`/`exitedNumber`
 * chỉ lưu raw payload (chưa dùng cho count — spec §3.2). `channelId` → resolve room qua
 * system_configs['ivss.channel_room_map']. `utc` → eventTime.
 */
export class OccupancyEventDto {
  @ApiProperty({ description: 'Loại sự kiện People-Counting do bridge gửi' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description:
      'ID kênh camera — resolve phòng qua system_configs[ivss.channel_room_map]',
  })
  @Type(() => Number)
  @IsInt()
  channelId: number;

  @ApiProperty({
    description: 'Số người hiện tại trong phòng tại thời điểm sự kiện',
  })
  @Type(() => Number)
  @IsInt()
  number: number;

  @ApiProperty({ description: 'Thời điểm sự kiện xảy ra (ISO 8601)' })
  @IsISO8601()
  utc: string;

  @ApiPropertyOptional({
    description: 'Số người vào (raw payload, chưa dùng cho tính count)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  enteredNumber?: number;

  @ApiPropertyOptional({
    description: 'Số người ra (raw payload, chưa dùng cho tính count)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  exitedNumber?: number;

  @ApiPropertyOptional({
    description: 'Hành động sự kiện do bridge gửi (nếu có)',
  })
  @IsOptional()
  @IsString()
  eventAction?: string;
}
