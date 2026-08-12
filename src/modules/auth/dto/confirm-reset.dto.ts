import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class ConfirmResetDto {
  @ApiProperty({
    description: 'Email tài khoản đã yêu cầu OTP đặt lại mật khẩu',
    example: 'user@example.com',
  })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({
    description: 'Mã OTP 6 số đã gửi qua email',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'Mã OTP phải có độ dài đúng 6 số' })
  @Matches(/^[0-9]{6}$/, { message: 'Mã OTP chỉ được chứa các chữ số' })
  otp!: string;

  @ApiProperty({
    description:
      'Mật khẩu mới — tối thiểu 8 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/,
    {
      message:
        'Mật khẩu mới phải có tối thiểu 8 ký tự, bao gồm ít nhất 1 chữ cái viết hoa, 1 chữ cái viết thường, 1 chữ số và 1 ký tự đặc biệt (!@#$%^&*(),.?":{}|<>)',
    },
  )
  newPassword!: string;
}
