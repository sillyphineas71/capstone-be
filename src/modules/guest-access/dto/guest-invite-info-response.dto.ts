export class GuestInviteInfoResponseDto {
  meetingTitle: string;
  startTime: string;
  endTime: string;
  hostName: string;
  /** ng***@abc.com — KHÔNG BAO GIỜ trả email đầy đủ (spec FR-GLA-007). */
  maskedEmail: string;
  verificationMode: 'otp' | 'magic_click';

  constructor(data: GuestInviteInfoResponseDto) {
    Object.assign(this, data);
  }
}
