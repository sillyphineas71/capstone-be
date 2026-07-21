import {
  IsOptional,
  IsUUID,
  IsString,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';

export class UpdateAgendaItemDto {
  @IsOptional()
  @IsString({
    message: 'Tiêu đề phải là chuỗi ký tự',
  })
  @MaxLength(255, {
    message: 'Tiêu đề tối đa 255 ký tự',
  })
  title?: string;

  @IsOptional()
  @IsString({
    message: 'Mô tả phải là chuỗi ký tự',
  })
  @MaxLength(2000, {
    message: 'Mô tả tối đa 2000 ký tự',
  })
  description?: string | null;

  @IsOptional()
  @IsUUID('4', {
    message: 'ownerId không hợp lệ',
  })
  ownerId?: string | null;

  @IsOptional()
  @IsInt({
    message: 'Thời lượng dự kiến phải là số nguyên',
  })
  @Min(1, {
    message: 'Thời lượng dự kiến phải lớn hơn 0',
  })
  plannedDurationMinutes?: number;

  @IsOptional()
  @IsInt({
    message: 'Vị trí agenda phải là số nguyên',
  })
  @Min(1, {
    message: 'Vị trí agenda phải lớn hơn 0',
  })
  agendaOrder?: number;
}
