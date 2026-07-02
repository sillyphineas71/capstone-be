import { Expose, Type } from 'class-transformer';
import { RoomSummaryDto } from '../../meetings/dto/room-summary.dto.js';
import { MeetingMode } from '../../meetings/entities/meeting.entity.js';

export class MinutesMeetingSummaryDto {
  @Expose()
  id: string;

  @Expose()
  title: string;

  @Expose()
  actualStartTime: Date | null;

  @Expose()
  actualEndTime: Date | null;

  @Expose()
  meetingMode: MeetingMode;

  @Expose()
  @Type(() => RoomSummaryDto)
  room: RoomSummaryDto | null;

  constructor(
    id: string,
    title: string,
    actualStartTime: Date | null,
    actualEndTime: Date | null,
    meetingMode: MeetingMode,
    room: RoomSummaryDto | null,
  ) {
    this.id = id;
    this.title = title;
    this.actualStartTime = actualStartTime;
    this.actualEndTime = actualEndTime;
    this.meetingMode = meetingMode;
    this.room = room;
  }
}
