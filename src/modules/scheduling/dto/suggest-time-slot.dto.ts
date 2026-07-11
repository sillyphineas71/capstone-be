import {
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Request body cho POST /api/v1/scheduling/time-suggestions (UC-SM-02).
 *
 * requiredParticipantUserIds/optionalParticipantUserIds có thể rỗng — organizer
 * (currentUser) luôn được coi là Required ngầm định (FR-001, xử lý ở service).
 */
export class SuggestTimeSlotDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'requiredParticipantUserIds không được trùng lặp' })
  @IsUUID('4', {
    each: true,
    message: 'requiredParticipantUserIds phải là mảng UUID hợp lệ',
  })
  requiredParticipantUserIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'optionalParticipantUserIds không được trùng lặp' })
  @IsUUID('4', {
    each: true,
    message: 'optionalParticipantUserIds phải là mảng UUID hợp lệ',
  })
  optionalParticipantUserIds?: string[];

  @IsOptional()
  @IsArray()
  externalParticipantEmails?: string[];

  @IsNotEmpty({ message: 'searchRangeStart là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'searchRangeStart phải đúng định dạng ISO-8601 có timezone' },
  )
  searchRangeStart: string;

  @IsNotEmpty({ message: 'searchRangeEnd là bắt buộc' })
  @IsISO8601(
    { strict: true },
    { message: 'searchRangeEnd phải đúng định dạng ISO-8601 có timezone' },
  )
  searchRangeEnd: string;

  @Type(() => Number)
  @IsNotEmpty({ message: 'durationMinutes là bắt buộc' })
  @IsInt({ message: 'durationMinutes phải là số nguyên' })
  @Min(15, { message: 'durationMinutes phải >= 15' })
  @Max(480, { message: 'durationMinutes phải <= 480' })
  durationMinutes: number;

  @IsOptional()
  @IsUUID('4', { message: 'excludeMeetingId phải là UUID hợp lệ' })
  excludeMeetingId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxSuggestions phải là số nguyên' })
  @Min(1, { message: 'maxSuggestions phải >= 1' })
  @Max(10, { message: 'maxSuggestions phải <= 10' })
  maxSuggestions?: number;
}
