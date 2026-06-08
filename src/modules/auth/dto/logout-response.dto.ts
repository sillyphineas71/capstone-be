import { ApiProperty } from '@nestjs/swagger';

export class LogoutResponseDto {
  @ApiProperty({
    description:
      'Trạng thái thu hồi token (đưa vào blacklist thành công hoặc đã bị thu hồi trước đó)',
    example: true,
  })
  revoked: boolean;

  @ApiProperty({
    description: 'Thời điểm thu hồi token (ISO 8601)',
    example: '2026-05-27T10:00:00.000Z',
  })
  revokedAt: Date;
}
