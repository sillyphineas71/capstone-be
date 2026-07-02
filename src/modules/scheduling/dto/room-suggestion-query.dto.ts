import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { RoomType } from '../../rooms/entities/room.entity.js';

/**
 * Query parameters cho GET /api/v1/scheduling/room-suggestions.
 * startTime, endTime, attendeeCount là bắt buộc; còn lại là optional.
 */
export class RoomSuggestionQueryDto {
  @IsNotEmpty({ message: 'startTime là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'startTime phải đúng định dạng ISO-8601 có timezone' },
  )
  startTime: string;

  @IsNotEmpty({ message: 'endTime là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'endTime phải đúng định dạng ISO-8601 có timezone' },
  )
  endTime: string;

  @Type(() => Number)
  @IsNotEmpty({ message: 'attendeeCount là bắt buộc' })
  @IsInt({ message: 'attendeeCount phải là số nguyên' })
  @Min(1, { message: 'attendeeCount phải lớn hơn hoặc bằng 1' })
  attendeeCount: number;

  @IsOptional()
  @IsEnum(RoomType, { message: 'roomType không hợp lệ' })
  roomType?: RoomType;

  @IsOptional()
  @IsString()
  siteName?: string;

  @IsOptional()
  @IsString()
  areaName?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  allowRecording?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  hasCamera?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  hasMicrophone?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  hasDisplay?: boolean;
}
