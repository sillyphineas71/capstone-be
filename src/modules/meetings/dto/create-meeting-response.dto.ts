export class CreateMeetingResponseDto {
  id: string;
  meetingCode: string;
  title: string;
  status: string;
  approvalStatus: string;
  startTime: Date;
  endTime: Date;
  roomId: string;
  roomName: string;
  organizerId: string;
  hostId: string;
  participantCount: number;
  bookingStatus: string;
  bookingCode: string;
  createdAt: Date;

  constructor(data: CreateMeetingResponseDto) {
    Object.assign(this, data);
  }
}
