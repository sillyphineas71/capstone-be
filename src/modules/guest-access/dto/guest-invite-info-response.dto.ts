import { ApiProperty } from '@nestjs/swagger';

export class GuestInviteInfoResponseDto {
  @ApiProperty({ description: 'Tiêu đề cuộc họp' })
  meetingTitle: string;

  @ApiProperty({ description: 'Thời gian bắt đầu cuộc họp (ISO 8601)' })
  startTime: string;

  @ApiProperty({ description: 'Thời gian kết thúc cuộc họp (ISO 8601)' })
  endTime: string;

  @ApiProperty({ description: 'Tên host tổ chức cuộc họp' })
  hostName: string;

  /** ng***@abc.com — KHÔNG BAO GIỜ trả email đầy đủ (spec FR-GLA-007). */
  @ApiProperty({
    description:
      'Email đã che (ng***@abc.com) — không bao giờ trả email đầy đủ',
    example: 'ng***@abc.com',
  })
  maskedEmail: string;

  @ApiProperty({
    description: 'Hình thức xác minh khách được yêu cầu',
    enum: ['otp', 'magic_click'],
  })
  verificationMode: 'otp' | 'magic_click';

  constructor(data: GuestInviteInfoResponseDto) {
    Object.assign(this, data);
  }
}
