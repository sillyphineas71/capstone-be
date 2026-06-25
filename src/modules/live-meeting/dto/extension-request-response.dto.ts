/**
 * Response DTO cho UC-IMM-02 Yêu cầu gia hạn phiên họp.
 * Dùng cho cả auto-apply path và pending conflict path.
 */
export class ExtensionRequestResponseDto {
  requestId: string;
  meetingId: string;
  oldEndTime: string;
  newEndTime?: string;
  requestedNewEndTime?: string;
  extensionMinutes: number;
  approvalMode: 'auto' | 'manual';
  status: 'applied' | 'pending';
  conflictCheckStatus: 'clear' | 'blocked';
  managerNotificationSent?: boolean;

  constructor(data: ExtensionRequestResponseDto) {
    Object.assign(this, data);
  }
}
