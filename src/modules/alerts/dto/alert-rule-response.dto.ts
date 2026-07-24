import { AlertRuleEntity } from '../entities/alert-rule.entity.js';

/**
 * AlertRuleResponseDto (ARL-001 / UC-122) — shape công khai (mirror
 * toVehicleControlListResponse). KHÔNG lộ `deleted_at`.
 */
export class AlertRuleResponseDto {
  id: string;
  alert_type: string;
  zone_id: string | null;
  threshold: number | null;
  channels: string[];
  enabled: boolean;
  restricted_hours_json: Record<string, unknown> | null;
  allowed_person_ids_json: string[] | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
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
