import { ScheduleRoomDto } from './schedule-room.dto.js';

export class MeetingHistoryItemDto {
  meetingId: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  room: ScheduleRoomDto | null;
  organizerName: string;
  durationMinutes: number;

  constructor(data: MeetingHistoryItemDto) {
    this.meetingId = data.meetingId;
    this.title = data.title;
    this.startTime = data.startTime;
    this.endTime = data.endTime;
    this.status = data.status;
    this.room = data.room;
    this.organizerName = data.organizerName;
    this.durationMinutes = data.durationMinutes;
  }
}
