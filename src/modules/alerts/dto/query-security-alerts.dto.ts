import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsDateString,
} from 'class-validator';
import { Type, Expose } from 'class-transformer';
import { ALERT_TYPES, type AlertType } from './create-alert-rule.dto.js';

const SECURITY_ALERT_STATUSES = ['new', 'acknowledged', 'resolved'] as const;
const SORT_FIELDS = ['triggeredAt', 'severity', 'status'] as const;

/**
 * QuerySecurityAlertsDto (ASC-001 / UC-123) — query GET /api/v1/security-alerts.
 *
 * KHÔNG lọc `status` mặc định (BR1: cảnh báo không tự ẩn) — client tự chọn nếu muốn.
 * Sort mặc định `triggeredAt DESC` (đúng SRS "sort giảm dần theo thời gian").
 */
export class QuerySecurityAlertsDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @Expose({ name: 'alert_type' })
  @IsOptional()
  @IsIn(ALERT_TYPES)
  alertType?: AlertType;

  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @IsOptional()
  @IsIn(SECURITY_ALERT_STATUSES)
  status?: (typeof SECURITY_ALERT_STATUSES)[number];

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @Expose({ name: 'sort_by' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: (typeof SORT_FIELDS)[number] = 'triggeredAt';

  @Expose({ name: 'sort_order' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
