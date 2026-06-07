import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsUUID,
  IsArray,
  ArrayNotEmpty,
  IsOptional,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @IsString({ message: 'Họ tên phải là chuỗi ký tự' })
  @MaxLength(255, { message: 'Họ tên không được vượt quá 255 ký tự' })
  fullName: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @MaxLength(255, { message: 'Email không được vượt quá 255 ký tự' })
  email: string;

  @IsNotEmpty({ message: 'ID phòng ban không được để trống' })
  @IsUUID('4', { message: 'ID phòng ban phải là định dạng UUID' })
  departmentId: string;

  @IsNotEmpty({ message: 'Danh sách vai trò không được để trống' })
  @IsArray({ message: 'Danh sách vai trò phải là mảng' })
  @ArrayNotEmpty({ message: 'Danh sách vai trò không được rỗng' })
  @IsUUID('4', {
    each: true,
    message: 'Mỗi vai trò trong danh sách phải là định dạng UUID',
  })
  roleIds: string[];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Mã nhân viên phải là chuỗi ký tự' })
  @MaxLength(50, { message: 'Mã nhân viên không được vượt quá 50 ký tự' })
  employeeCode?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @Matches(/^[\d\s+\-()]*$/, {
    message:
      'Số điện thoại chỉ được chứa chữ số, khoảng trắng, dấu cộng, dấu gạch ngang và dấu ngoặc đơn',
  })
  @MaxLength(30, { message: 'Số điện thoại không được vượt quá 30 ký tự' })
  phoneNumber?: string;

  @IsOptional()
  @IsString({ message: 'Chức danh phải là chuỗi ký tự' })
  @MaxLength(150, { message: 'Chức danh không được vượt quá 150 ký tự' })
  positionTitle?: string;

  @IsOptional()
  @IsUUID('4', { message: 'ID người quản lý phải là định dạng UUID' })
  directManagerId?: string;
}
