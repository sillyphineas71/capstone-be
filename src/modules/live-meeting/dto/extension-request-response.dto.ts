/**
 * Thong tin cuoc hop ke tiep tra ve khi request bi tu choi vi vi pham buffer.
 */
export interface NextMeetingSummaryDto {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  roomName?: string | null;
}

/**
 * Thong tin lien he Host cua cuoc hop ke tiep, de 2 Host tu thoa thuan gia han.
 */
export interface NextMeetingHostSummaryDto {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
}

/**
 * Response DTO cho UC-IMM-02 Yêu cầu gia hạn phiên họp.
 * Dùng cho auto-apply path và path bị tự động từ chối do vi phạm buffer trước cuộc họp kế tiếp.
 */
export class ExtensionRequestResponseDto {
  requestId: string;
  meetingId: string;
  oldEndTime: string;
  newEndTime?: string;
  requestedNewEndTime?: string;
  extensionMinutes: number;
  approvalMode: 'auto' | 'manual';
  status: 'applied' | 'rejected' | 'pending';
  conflictCheckStatus: 'clear' | 'blocked';
  managerNotificationSent?: boolean;
  rejectionReason?: string;
  nextMeeting?: NextMeetingSummaryDto;
  nextMeetingHost?: NextMeetingHostSummaryDto;

  constructor(data: ExtensionRequestResponseDto) {
    Object.assign(this, data);
  }
}
