import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    description:
      'Loại sự kiện kích hoạt cảnh báo — đổi sẽ kích hoạt re-check conflict',
    enum: ALERT_TYPES,
  })
  @Expose({ name: 'alert_type' })
  @IsOptional()
  @IsIn(ALERT_TYPES)
  alertType?: AlertType;

  @ApiPropertyOptional({
    description: 'Khu vực áp dụng quy tắc — đổi sẽ kích hoạt re-check conflict',
  })
  @Expose({ name: 'zone_id' })
  @IsOptional()
  @IsUUID()
  zoneId?: string | null;

  @ApiPropertyOptional({
    description: 'Ngưỡng kích hoạt (áp dụng khi alertType=crowd)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  threshold?: number;

  @ApiPropertyOptional({
    description: 'Danh sách kênh gửi thông báo',
    enum: ALERT_CHANNELS,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ALERT_CHANNELS, { each: true })
  channels?: AlertChannel[];

  @ApiPropertyOptional({ description: 'Bật/tắt quy tắc' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Khung giờ hạn chế áp dụng quy tắc',
    type: RestrictedHoursDto,
  })
  @Expose({ name: 'restricted_hours_json' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RestrictedHoursDto)
  restrictedHoursJson?: RestrictedHoursDto;

  @ApiPropertyOptional({
    description: 'Danh sách person id được phép bỏ qua cảnh báo',
    type: [String],
  })
  @Expose({ name: 'allowed_person_ids_json' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  allowedPersonIdsJson?: string[];
}
