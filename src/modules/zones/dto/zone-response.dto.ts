import type { ZoneEntity } from '../entities/zone.entity.js';

/**
 * ZoneResponse (ZNC-001 / UC-90) — shape trả ra client, field snake_case.
 *
 * KHÔNG trả `deleted_at` (chi tiết nội bộ của soft-delete).
 */
export interface ZoneResponse {
  id: string;
  zone_code: string;
  zone_name: string;
  zone_type: string;
  building: string | null;
  floor: string | null;
  description: string | null;
  metadata_json: Record<string, unknown> | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export function toZoneResponse(entity: ZoneEntity): ZoneResponse {
  return {
    id: entity.id,
    zone_code: entity.zoneCode,
    zone_name: entity.zoneName,
    zone_type: entity.zoneType,
    building: entity.building,
    floor: entity.floor,
    description: entity.description,
    metadata_json: entity.metadataJson,
    status: entity.status,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
