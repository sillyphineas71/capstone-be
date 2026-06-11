import { ScheduleRoomDto } from './schedule-room.dto.js';

export class ScheduleEventDto {
  meetingId: string;
  meetingCode: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  userRole: 'organizer' | 'host' | 'attendee';
  room: ScheduleRoomDto | null;
  colorKey: string;
  isCurrent: boolean;
  isPast: boolean;

  constructor(data: ScheduleEventDto) {
    this.meetingId = data.meetingId;
    this.meetingCode = data.meetingCode;
    this.title = data.title;
    this.startTime = data.startTime;
    this.endTime = data.endTime;
    this.timezone = data.timezone;
    this.status = data.status;
    this.userRole = data.userRole;
    this.room = data.room;
    this.colorKey = data.colorKey;
    this.isCurrent = data.isCurrent;
    this.isPast = data.isPast;
  }
}
