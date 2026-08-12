import { IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO cho request import tài khoản đối tác/khách hàng tạm thời bằng Excel.
 * File và ảnh nhận qua @UploadedFiles(); DTO chứa cờ điều khiển và tham số mặc định.
 * Feature: PTA-IMPORT-001
 */
export class ImportPartnerAccountsDto {
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean({ message: 'commit phải là boolean' })
  commit?: boolean;

  /**
   * Số ngày hiệu lực mặc định tính từ thời điểm import cho các tài khoản đối tác
   * không điền ngày hết hạn riêng trong file Excel.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Number(value);
  })
  @IsInt({ message: 'defaultExpiresInDays phải là số nguyên' })
  @Min(1, { message: 'defaultExpiresInDays phải lớn hơn hoặc bằng 1' })
  defaultExpiresInDays?: number;
}
