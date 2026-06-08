import { IsString, IsNotEmpty, IsEmail, IsOptional } from 'class-validator';

export class ExternalParticipantDto {
  @IsString({ message: 'full_name phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'full_name không được để trống' })
  fullName: string;

  @IsEmail({}, { message: 'email không đúng định dạng' })
  email: string;

  @IsString({ message: 'organization phải là chuỗi ký tự' })
  @IsOptional()
  organization?: string;
}
