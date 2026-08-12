import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportPartnerAccountMode } from '../constants/import-partner-accounts.constants.js';

/**
 * Kết quả xử lý từng dòng trong file Excel import tài khoản đối tác.
 */
export class ImportPartnerAccountRowResult {
  @ApiProperty({
    description: 'STT dòng trong file Excel (1-based)',
    example: 2,
  })
  row: number;

  @ApiProperty({
    description: 'Email của đối tác (dùng làm định danh và username)',
    example: 'khach1@doitac-x.com',
  })
  email: string;

  @ApiProperty({
    description:
      'Trạng thái xử lý của dòng: valid/invalid (preview) hoặc success/failed (commit)',
    enum: ['valid', 'invalid', 'success', 'failed'],
    example: 'valid',
  })
  status: 'valid' | 'invalid' | 'success' | 'failed';

  @ApiPropertyOptional({
    description:
      'Mã lý do / nguyên nhân lỗi (nếu status là invalid hoặc failed)',
    example: 'PARTNER_PHOTO_REQUIRED',
  })
  reason?: string;

  @ApiPropertyOptional({
    description: 'ID người dùng mới được tạo (chỉ có khi status=success)',
    example: '7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f',
  })
  userId?: string;

  @ApiPropertyOptional({
    description: 'Thời điểm hết hạn tài khoản đã resolve (ISO 8601 UTC)',
    example: '2026-08-13T17:00:00.000Z',
  })
  accountExpiresAt?: string;

  @ApiPropertyOptional({
    description:
      'Trạng thái gắn biển số xe (nếu dòng có điền license_plate): pending_commit | attached | invalid_plate | duplicate_plate | attach_failed',
    example: 'attached',
  })
  vehiclePlateStatus?: string;
}

/**
 * Báo cáo tổng hợp kết quả import tài khoản đối tác (Preview hoặc Commit).
 */
export class ImportPartnerAccountReportDto {
  @ApiProperty({
    description: 'Chế độ thực thi: preview hoặc commit',
    enum: ImportPartnerAccountMode,
    example: ImportPartnerAccountMode.PREVIEW,
  })
  mode: ImportPartnerAccountMode;

  @ApiProperty({
    description: 'Tổng số dòng dữ liệu đọc được từ file Excel',
    example: 5,
  })
  totalRows: number;

  @ApiPropertyOptional({
    description: 'Số dòng hợp lệ (chỉ có khi mode=preview)',
    example: 3,
  })
  validCount?: number;

  @ApiPropertyOptional({
    description: 'Số dòng không hợp lệ (chỉ có khi mode=preview)',
    example: 2,
  })
  invalidCount?: number;

  @ApiPropertyOptional({
    description: 'Số dòng tạo tài khoản thành công (chỉ có khi mode=commit)',
    example: 3,
  })
  successCount?: number;

  @ApiPropertyOptional({
    description: 'Số dòng tạo thất bại (chỉ có khi mode=commit)',
    example: 2,
  })
  failedCount?: number;

  @ApiProperty({
    type: [ImportPartnerAccountRowResult],
    description: 'Chi tiết kết quả từng dòng',
  })
  results: ImportPartnerAccountRowResult[];
}
