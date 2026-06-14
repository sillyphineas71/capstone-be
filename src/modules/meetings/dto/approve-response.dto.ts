export class ApproveResponseDto {
  requestId: string;
  approvalStatus: string;
  meetingId: string;
  bookingId: string;
  appliedAt: Date;

  constructor(data: ApproveResponseDto) {
    Object.assign(this, data);
  }
}
