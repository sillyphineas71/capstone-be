import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';

/**
 * SecurityAlertResponseDto (ASC-001 / UC-123) — shape công khai cho list/detail.
 */
export class SecurityAlertResponseDto {
  id: string;
  alert_type: string;
  severity: string;
  zone_id: string | null;
  status: string;
  triggered_at: Date;
  last_seen_at: Date | null;
  occurrence_count: number;
  source_event_id: string | null;
  rule_id: string | null;
  payload_json: Record<string, unknown> | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toSecurityAlertResponse(
  entity: SecurityAlertEntity,
): SecurityAlertResponseDto {
  return {
    id: entity.id,
    alert_type: entity.alertType,
    severity: entity.severity,
    zone_id: entity.zoneId,
    status: entity.status,
    triggered_at: entity.triggeredAt,
    last_seen_at: entity.lastSeenAt,
    occurrence_count: entity.occurrenceCount,
    source_event_id: entity.sourceEventId,
    rule_id: entity.ruleId,
    payload_json: entity.payloadJson,
    acknowledged_by: entity.acknowledgedBy,
    acknowledged_at: entity.acknowledgedAt,
    resolved_by: entity.resolvedBy,
    resolved_at: entity.resolvedAt,
    resolution_note: entity.resolutionNote,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}

export interface SecurityAlertZoneSummary {
  id: string;
  zone_code: string;
  zone_name: string;
}

export function toZoneSummary(
  zone: ZoneEntity | null,
): SecurityAlertZoneSummary | null {
  if (!zone) return null;
  return { id: zone.id, zone_code: zone.zoneCode, zone_name: zone.zoneName };
}
