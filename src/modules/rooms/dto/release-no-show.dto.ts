import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * NSL-001 (#33b) — body POST no-show-cases/:id/release.
 * reason bắt buộc, ghi vào booking.cancellation_reason + room_event + audit.
 */
export class ReleaseNoShowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
