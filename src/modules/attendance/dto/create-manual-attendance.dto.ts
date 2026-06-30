import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Input cho POST /api/v1/meetings/{meetingId}/attendance (UC-B21, spec §5 #1).
 * `checkInTime` default = now xử lý ở service (KHÔNG default trong DTO — tasks T-01).
 */
export class CreateManualAttendanceDto {
  @ApiProperty({ format: 'uuid', description: 'Internal participant user id' })
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Check-in time (ISO 8601); default now resolved in service',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'checkInTime must be a valid ISO 8601 datetime' })
  checkInTime?: string;

  @ApiPropertyOptional({
    description: 'Reason/note, max 1000 chars',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'note cannot exceed 1000 characters' })
  note?: string;
}
