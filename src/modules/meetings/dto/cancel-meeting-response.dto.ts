export class CancelMeetingResponseDto {
  meetingId: string;
  status: string;
  cancelledAt: Date;
  cancelledBy: string;
  roomReleased: boolean;
  releasedBookingId: string | null;
  notificationStatus: string;

  constructor(data: CancelMeetingResponseDto) {
    Object.assign(this, data);
  }
}
