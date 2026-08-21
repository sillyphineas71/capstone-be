import { IsOptional, IsString, IsBoolean, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class ListUsersQueryDto {
  @Type(() => Number)
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được vượt quá 100' })
  @IsOptional()
  limit?: number = 20;

  @IsOptional()
  @IsString({ message: 'search phải là chuỗi ký tự' })
  search?: string;

  /**
   * Khi true: loại các tài khoản role BUSINESS_ADMIN/SYSTEM_ADMIN khỏi kết quả.
   * Dùng bởi các UI chọn người tham dự cuộc họp (BA/SA không được mời họp) —
   * KHÔNG áp dụng mặc định vì endpoint này còn dùng chung cho nhiều autocomplete
   * khác (quản lý phòng ban, ANPR, nhật ký ra vào...).
   */
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true'))
  @IsOptional()
  @IsBoolean({ message: 'meetingEligibleOnly phải là boolean' })
  meetingEligibleOnly?: boolean;
}
