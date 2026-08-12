import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AlertRuleEntity } from '../entities/alert-rule.entity.js';

/**
 * AlertRuleResponseDto (ARL-001 / UC-122) — shape công khai (mirror
 * toVehicleControlListResponse). KHÔNG lộ `deleted_at`.
 */
export class AlertRuleResponseDto {
  @ApiProperty({ description: 'ID quy tắc cảnh báo' })
  id: string;

  @ApiProperty({ description: 'Loại sự kiện kích hoạt cảnh báo' })
  alert_type: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Khu vực áp dụng quy tắc; null = toàn hệ thống',
  })
  zone_id: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Ngưỡng kích hoạt (nếu loại sự kiện cần ngưỡng)',
  })
  threshold: number | null;

  @ApiProperty({
    description: 'Danh sách kênh gửi thông báo (in_app, email, ...)',
  })
  channels: string[];

  @ApiProperty({ description: 'Trạng thái bật/tắt quy tắc' })
  enabled: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Khung giờ hạn chế áp dụng quy tắc; null = 24/7',
  })
  restricted_hours_json: Record<string, unknown> | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Danh sách person id được phép bỏ qua cảnh báo',
  })
  allowed_person_ids_json: string[] | null;

  @ApiPropertyOptional({ nullable: true, description: 'ID user tạo quy tắc' })
  created_by: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ID user cập nhật gần nhất',
  })
  updated_by: string | null;

  @ApiProperty({ description: 'Thời điểm tạo' })
  created_at: Date;

  @ApiProperty({ description: 'Thời điểm cập nhật gần nhất' })
  updated_at: Date;
}

export function toAlertRuleResponse(
  entity: AlertRuleEntity,
): AlertRuleResponseDto {
  return {
    id: entity.id,
    alert_type: entity.alertType,
    zone_id: entity.zoneId,
    threshold: entity.threshold,
    channels: entity.channels,
    enabled: entity.enabled,
    restricted_hours_json: entity.restrictedHoursJson,
    allowed_person_ids_json: entity.allowedPersonIdsJson,
    created_by: entity.createdBy,
    updated_by: entity.updatedBy,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
