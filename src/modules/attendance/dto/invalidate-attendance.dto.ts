import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Input cho POST /api/v1/meetings/{meetingId}/attendance/{recordId}/invalidate (spec §5 #4).
 * `reason` bắt buộc (FR-006: thiếu → 400 REASON_REQUIRED).
 */
export class InvalidateAttendanceDto {
  @ApiProperty({
    description: 'Reason for invalidation (required), max 1000 chars',
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(1000, { message: 'reason cannot exceed 1000 characters' })
  reason: string;
}
