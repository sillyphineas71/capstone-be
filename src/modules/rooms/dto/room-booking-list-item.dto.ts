import { Expose, Type } from 'class-transformer';
import { UserSummaryDto } from './user-summary.dto.js';
import { RoomSummaryDto } from './room-summary.dto.js';
import { MeetingSummaryDto } from './meeting-summary.dto.js';

export class RoomBookingListItemDto {
  @Expose()
  id: string;

  @Expose()
  bookingCode: string;

  @Expose()
  bookingType: string;

  @Expose()
  status: string;

  @Expose()
  roomId: string;

  @Expose()
  meetingId: string;

  @Expose()
  bookedBy: string;

  @Expose()
  reservedStartTime: Date;

  @Expose()
  reservedEndTime: Date;

  @Expose()
  approvedBy: string | null;

  @Expose()
  approvedAt: Date | null;

  @Expose()
  cancellationReason: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  @Type(() => RoomSummaryDto)
  room: RoomSummaryDto;

  @Expose()
  @Type(() => MeetingSummaryDto)
  meeting: MeetingSummaryDto | null;

  @Expose()
  @Type(() => UserSummaryDto)
  bookedByUser: UserSummaryDto;

  @Expose()
  @Type(() => UserSummaryDto)
  approvedByUser: UserSummaryDto | null;
}
