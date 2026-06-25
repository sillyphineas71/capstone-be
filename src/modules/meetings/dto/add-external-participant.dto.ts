import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEmail,
  IsOptional,
  IsBoolean,
  Matches,
} from 'class-validator';

export class AddExternalParticipantDto {
  @IsString({ message: 'fullName phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'fullName không được để trống' })
  @Matches(/\S/, { message: 'fullName không được chỉ chứa khoảng trắng' })
  @MaxLength(255, { message: 'fullName tối đa 255 ký tự' })
  fullName: string;

  @IsEmail({}, { message: 'email không đúng định dạng' })
  email: string;

  @IsOptional()
  @IsString({ message: 'organizationName phải là chuỗi ký tự' })
  @MaxLength(255, { message: 'organizationName tối đa 255 ký tự' })
  organizationName?: string;

  @IsOptional()
  @IsString({ message: 'phoneNumber phải là chuỗi ký tự' })
  @MaxLength(30, { message: 'phoneNumber tối đa 30 ký tự' })
  phoneNumber?: string;

  @IsOptional()
  @IsBoolean({ message: 'overrideWarnings phải là boolean' })
  overrideWarnings?: boolean;

  @IsOptional()
  @IsString({ message: 'warningToken phải là chuỗi ký tự' })
  warningToken?: string;
}
