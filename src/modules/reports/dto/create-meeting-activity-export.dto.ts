import {
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ExportScopeDto — scope lọc báo cáo theo phòng ban, phòng họp, hoặc người tổ chức.
 * MANAGER chỉ được truyền departmentId thuộc phạm vi quản lý.
 */
export class ExportScopeDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  roomId?: string;

  @IsOptional()
  @IsUUID()
  organizerId?: string;
}

/**
 * CreateMeetingActivityExportDto — DTO tạo job xuất báo cáo hoạt động cuộc họp (UC-AA-12).
 *
 * - `from`/`to`: kỳ báo cáo (bắt buộc, ISO date string).
 * - `format`: định dạng xuất ('pdf' hoặc 'xlsx').
 * - `scope`: lọc theo phòng ban/phòng họp/người tổ chức (tùy chọn).
 * - `delivery`: chỉ hỗ trợ 'download' (OOS-001: email/webhook là out-of-scope).
 *
 * FR-013..FR-020, FR-030..FR-031.
 */
export class CreateMeetingActivityExportDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsIn(['pdf', 'xlsx'])
  format: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExportScopeDto)
  scope?: ExportScopeDto;

  /**
   * OOS-001: chỉ hỗ trợ 'download'. Không hỗ trợ 'email'/'webhook'.
   * Mặc định là 'download' nếu không truyền.
   */
  @IsOptional()
  @IsIn(['download'])
  delivery?: string;
}
