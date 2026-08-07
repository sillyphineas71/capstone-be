export class VerifyGuestOtpResponseDto {
  guestToken: string;
  lobbyRequired: boolean;
  meetingId: string;

  constructor(data: VerifyGuestOtpResponseDto) {
    Object.assign(this, data);
  }
}
