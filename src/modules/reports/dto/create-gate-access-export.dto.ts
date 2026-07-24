import {
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * GateAccessExportScopeDto — lọc theo cổng/phòng ban/cá nhân (UC-127 §5.2).
 */
export class GateAccessExportScopeDto {
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

/**
 * CreateGateAccessExportDto — DTO tạo job xuất báo cáo ra vào khuôn viên (UC-127).
 *
 * FR-015..FR-018: validate from/to bắt buộc, format chỉ pdf/xlsx (BR1 SRS),
 * scope tùy chọn theo zone/department/user.
 */
export class CreateGateAccessExportDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsIn(['pdf', 'xlsx'])
  format: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => GateAccessExportScopeDto)
  scope?: GateAccessExportScopeDto;
}
