import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { Type, Transform, Expose } from 'class-transformer';
import { ALERT_TYPES, type AlertType } from './create-alert-rule.dto.js';

const SORT_FIELDS = ['createdAt', 'alertType'] as const;

/**
 * QueryAlertRulesDto (ARL-001 / UC-122) — query GET /api/v1/alert-rules.
 *
 * Mirror pagination UC8 (page/limit, limit max 100). `active`-style boolean query param
 * dùng `@Transform` tay (KHÔNG `@Type(()=>Boolean)`, coi mọi string non-empty là true).
 */
export class QueryAlertRulesDto {
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

  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true',
  )
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Expose({ name: 'sort_by' })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy: (typeof SORT_FIELDS)[number] = 'createdAt';

  @Expose({ name: 'sort_order' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
