import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyGuestOtpDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{6}$/, { message: 'Ma OTP chi duoc chua 6 chu so' })
  otp!: string;
}
