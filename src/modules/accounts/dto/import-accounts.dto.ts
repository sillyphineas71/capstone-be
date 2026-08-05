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

  /**
   * Xác nhận đã có sự đồng ý của (các) nhân viên cho việc dùng ảnh đính kèm vào
   * mục đích sinh trắc học FaceGate. Chỉ bắt buộc khi request có gửi kèm ảnh
   * (field `photos`) và commit=true.
   */
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean({ message: 'biometricConsentConfirmed phải là boolean' })
  biometricConsentConfirmed?: boolean;
}
