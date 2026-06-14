export class UpdateMeetingRoomResponseDto {
  meetingId: string;
  oldRoom: { id: string; name: string };
  newRoom: { id: string; name: string };
  oldBookingId: string;
  newBookingId: string;
  startTime: string;
  endTime: string;
  notificationStatus: string;
  updatedAt: string;

  constructor(data: UpdateMeetingRoomResponseDto) {
    Object.assign(this, data);
  }
}
