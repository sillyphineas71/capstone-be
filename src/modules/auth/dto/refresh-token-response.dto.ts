import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenResponseDto {
  @ApiProperty({ description: 'Access token JWT mới' })
  accessToken: string;

  @ApiProperty({
    description: 'Refresh token JWT mới (rotation — thay the token cu)',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'Thoi gian song cua access token (giay)',
    example: 10800,
  })
  expiresIn: number;

  constructor(partial: RefreshTokenResponseDto) {
    Object.assign(this, partial);
  }
}
