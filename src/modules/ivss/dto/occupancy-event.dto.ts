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
  @IsString()
  @IsNotEmpty()
  type: string;

  @Type(() => Number)
  @IsInt()
  channelId: number;

  @Type(() => Number)
  @IsInt()
  number: number;

  @IsISO8601()
  utc: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  enteredNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  exitedNumber?: number;

  @IsOptional()
  @IsString()
  eventAction?: string;
}
