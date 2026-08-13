import { ApiProperty } from '@nestjs/swagger';

export class VerifyGuestOtpResponseDto {
  @ApiProperty({
    description:
      'JWT phiên khách (ký bằng GUEST_TOKEN_SECRET, khác secret nhân viên)',
  })
  guestToken: string;

  @ApiProperty({
    description:
      'true nếu khách phải chờ host duyệt vào phòng chờ trước khi vào họp',
  })
  lobbyRequired: boolean;

  @ApiProperty({ description: 'ID cuộc họp khách được cấp quyền truy cập' })
  meetingId: string;

  constructor(data: VerifyGuestOtpResponseDto) {
    Object.assign(this, data);
  }
}
