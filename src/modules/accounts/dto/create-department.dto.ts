import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsUUID,
  Length,
  Matches,
  Validate,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsDepartmentCodeUniqueConstraint } from '../validators/is-department-code-unique.validator.js';
import { IsDepartmentNameUniqueConstraint } from '../validators/is-department-name-unique.validator.js';
import { NoEmojiOrControlConstraint } from '../validators/no-emoji-or-control.validator.js';

export class CreateDepartmentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsNotEmpty({ message: 'Mã phòng ban là bắt buộc' })
  @IsString({ message: 'Mã phòng ban phải là chuỗi ký tự' })
  @Length(2, 50, { message: 'Mã phòng ban phải từ 2 đến 50 ký tự' })
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,49}$/, {
    message:
      'Mã phòng ban chỉ chấp nhận chữ in hoa (A-Z), số (0-9), gạch dưới (_) và gạch ngang (-)',
  })
  @Validate(IsDepartmentCodeUniqueConstraint, {
    message: 'Mã phòng ban này đã được sử dụng',
  })
  departmentCode: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty({ message: 'Tên phòng ban là bắt buộc' })
  @IsString({ message: 'Tên phòng ban phải là chuỗi ký tự' })
  @Length(2, 150, { message: 'Tên phòng ban phải từ 2 đến 150 ký tự' })
  @Validate(NoEmojiOrControlConstraint, {
    message: 'Tên phòng ban chứa ký tự không hợp lệ (emoji, ký tự điều khiển)',
  })
  @Validate(IsDepartmentNameUniqueConstraint, {
    message: 'Tên phòng ban này đã được sử dụng',
  })
  departmentName: string;

  @IsOptional()
  @IsUUID('4', { message: 'ID phòng ban cha phải là định dạng UUID' })
  parentDepartmentId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'ID người quản lý phải là định dạng UUID' })
  managerUserId?: string;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    return value ?? null;
  })
  @IsOptional()
  @IsString({ message: 'Mô tả phòng ban phải là chuỗi ký tự' })
  description?: string | null;
}
