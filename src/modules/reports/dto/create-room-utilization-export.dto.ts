import { IsIn, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsDateString } from 'class-validator';

/**
 * ExportScopeDto — lọc theo 1 phòng cụ thể (§0.5 spec.md: không có departmentId
 * cho feature này, khác UC-AA-12 — UC-RUM-16 chỉ cho Business/System Admin,
 * không có logic scope theo phòng ban Manager).
 */
export class RoomUtilizationExportScopeDto {
  @IsOptional()
  @IsUUID()
  roomId?: string;
}

/**
 * CreateRoomUtilizationExportDto — DTO tạo job xuất báo cáo sử dụng phòng họp (UC-RUM-16).
 *
 * - `from`/`to`: kỳ báo cáo (bắt buộc, ISO date string).
 * - `format`: 'pdf' | 'xlsx' | 'csv'.
 * - `scope.roomId`: lọc theo 1 phòng cụ thể (tùy chọn).
 * - `delivery`: chỉ hỗ trợ 'download' (nhất quán UC-AA-12).
 */
export class CreateRoomUtilizationExportDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsIn(['pdf', 'xlsx', 'csv'])
  format: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RoomUtilizationExportScopeDto)
  scope?: RoomUtilizationExportScopeDto;

  @IsOptional()
  @IsIn(['download'])
  delivery?: string;
}
