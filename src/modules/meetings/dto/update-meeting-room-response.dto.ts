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
  // Nghiệp vụ duyệt lại (dev-branch): true khi meeting đang SCHEDULED nên thay
  // đổi được ghi thành MeetingRequest PENDING chờ Manager duyệt, CHƯA áp dụng
  // vào meeting — newRoom/newBookingId ở trên khi đó là giá trị ĐANG YÊU CẦU.
  pendingApproval: boolean;
  requestId?: string;

  constructor(data: UpdateMeetingRoomResponseDto) {
    Object.assign(this, data);
  }
}
