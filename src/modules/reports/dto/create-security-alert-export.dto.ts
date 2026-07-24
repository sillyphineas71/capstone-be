import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const SECURITY_ALERT_STATUS_VALUES = [
  'new',
  'acknowledged',
  'resolved',
] as const;

/**
 * SecurityAlertExportFiltersDto — lọc theo loại cảnh báo/khu vực/trạng thái (UC-129 §5.2).
 */
export class SecurityAlertExportFiltersDto {
  @IsOptional()
  @IsString()
  alertType?: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsIn(SECURITY_ALERT_STATUS_VALUES)
  status?: string;
}

/**
 * CreateSecurityAlertExportDto — DTO tạo job xuất báo cáo sự kiện an ninh (UC-129).
 */
export class CreateSecurityAlertExportDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsIn(['pdf', 'xlsx'])
  format: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SecurityAlertExportFiltersDto)
  filters?: SecurityAlertExportFiltersDto;
}
