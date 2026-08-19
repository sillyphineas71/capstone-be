import { Expose, Type } from 'class-transformer';
import { RoomSummaryDto } from '../../meetings/dto/room-summary.dto.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';
import {
  MeetingMode,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';

export class MinutesMeetingSummaryDto {
  @Expose()
  id: string;

  @Expose()
  title: string;

  @Expose()
  status: MeetingStatus;

  /** = actualStartTime nếu đã có, fallback về startTime dự kiến (BE_REQUIREMENT). */
  @Expose()
  startTime: Date | null;

  /** = actualEndTime nếu đã có, fallback về endTime dự kiến (BE_REQUIREMENT). */
  @Expose()
  endTime: Date | null;

  @Expose()
  actualStartTime: Date | null;

  @Expose()
  actualEndTime: Date | null;

  @Expose()
  meetingMode: MeetingMode;

  @Expose()
  @Type(() => RoomSummaryDto)
  room: RoomSummaryDto | null;

  @Expose()
  @Type(() => UserSummaryDto)
  organizer: UserSummaryDto | null;

  constructor(data: MinutesMeetingSummaryDto) {
    Object.assign(this, data);
  }
}
