import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  IsArray,
  ArrayNotEmpty,
  IsBoolean,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type, Expose } from 'class-transformer';
import {
  ALERT_TYPES,
  ALERT_CHANNELS,
  RestrictedHoursDto,
  type AlertType,
  type AlertChannel,
} from './create-alert-rule.dto.js';

/**
 * UpdateAlertRuleDto (ARL-001 / UC-122) — body PATCH /api/v1/alert-rules/:id.
 *
 * TẤT CẢ field optional (mirror UpdateVehicleControlListDto). Đổi `alertType`/`zoneId`
 * → service re-check conflict (2 nhánh); đổi field khác → KHÔNG re-check (spec §4).
 */
export class UpdateAlertRuleDto {
  @Expose({ name: 'alert_type' })
  @IsOptional()
  @IsIn(ALERT_TYPES)
  alertType?: AlertType;

  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID()
  zoneId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  threshold?: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ALERT_CHANNELS, { each: true })
  channels?: AlertChannel[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Expose({ name: 'restricted_hours_json' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RestrictedHoursDto)
  restrictedHoursJson?: RestrictedHoursDto;

  @Expose({ name: 'allowed_person_ids_json' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  allowedPersonIdsJson?: string[];
}
