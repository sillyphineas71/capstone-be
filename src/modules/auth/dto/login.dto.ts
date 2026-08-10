import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Email đăng nhập', example: 'user@example.com' })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Mật khẩu đăng nhập' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
