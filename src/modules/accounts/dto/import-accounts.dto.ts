import { IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO cho request import tài khoản bằng Excel.
 * File nhận qua @UploadedFile(); DTO chỉ chứa cờ điều khiển.
 * Feature: ACCT-IMPORT-ACCOUNT-001
 */
export class ImportAccountsDto {
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean({ message: 'commit phải là boolean' })
  commit?: boolean;
}
