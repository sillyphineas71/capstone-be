import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyGuestOtpDto {
  @ApiProperty({
    description: 'Mã OTP 6 số đã gửi tới email lưu trong lời mời',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{6}$/, { message: 'Ma OTP chi duoc chua 6 chu so' })
  otp!: string;
}
