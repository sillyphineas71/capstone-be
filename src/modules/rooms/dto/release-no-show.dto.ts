import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * NSL-001 (#33b) — body POST no-show-cases/:id/release.
 * reason bắt buộc, ghi vào booking.cancellation_reason + room_event + audit.
 */
export class ReleaseNoShowDto {
  @ApiProperty({
    description: 'Lý do giải phóng phòng thủ công (bắt buộc)',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
