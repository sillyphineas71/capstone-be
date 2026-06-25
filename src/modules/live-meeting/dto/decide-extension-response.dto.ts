/**
 * Response DTO cho UC-IMM-03 Phê duyệt/từ chối yêu cầu gia hạn phiên họp.
 */
export class DecideExtensionResponseDto {
  requestId: string;
  decision: 'approved' | 'rejected';
  status: 'applied' | 'rejected';
  oldEndTime?: string;
  newEndTime?: string;
  extensionMinutes?: number;
  rejectionReason?: string;
  decisionAt: string;
  message: string;

  constructor(data: DecideExtensionResponseDto) {
    Object.assign(this, data);
  }
}
