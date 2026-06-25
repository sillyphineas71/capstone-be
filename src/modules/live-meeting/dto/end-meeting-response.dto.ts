export class EndMeetingResponseDto {
  meetingId: string;
  status: string;
  actualEndTime: string;
  duration: number;
  roomReleased: boolean;

  constructor(data: EndMeetingResponseDto) {
    Object.assign(this, data);
  }
}
