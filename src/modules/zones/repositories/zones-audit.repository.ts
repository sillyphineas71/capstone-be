import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/** Bảng đích của mọi bản ghi audit trong repository này (ZND-001 / UC-92). */
const ZONE_ENTITY_TYPE = 'zones';

/**
 * ZonesAuditRepository (ZND-001 / UC-92) — ghi vết thao tác trên `zones` vào `audit_logs`.
 *
 * Mỗi method nhận `EntityManager` của caller để chạy TRONG transaction của service — thao tác
 * và audit phải cùng sống hoặc cùng chết ("đã xoá nhưng không có audit" là mất dấu vết vĩnh viễn).
 *
 * Mirror `IotAuditRepository` nhưng KHÔNG tái dùng được nó: repo đó hard-code
 * `entity_type = 'iot_devices'` trong từng câu SQL.
 *
 * Đây là nơi DUY NHẤT lưu được ai thao tác trên zone: bảng `zones` không có
 * `created_by`/`updated_by`/`deleted_by` (migration 20260721000001).
 *
 * SEC-01: KHÔNG ghi nội dung `zones.metadata_json` vào audit — xem `logZoneUpdate`.
 */
@Injectable()
export class ZonesAuditRepository {
  async logZoneCreation(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      zoneCode: string;
      zoneType: string;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'create', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({
          zone_code: params.zoneCode,
          zone_type: params.zoneType,
        }),
      ],
    );
  }

  /**
   * SEC-01 (bắt buộc): `zones.metadata_json` là túi tự do — kích thước không giới hạn và có
   * thể bị nhét cấu hình nhạy cảm. Nếu `changes` có khoá `metadataJson`, giá trị của nó được
   * THAY bằng cờ `{ changed: true }`; nội dung thật KHÔNG bao giờ đi vào `audit_logs`.
   * Tiền lệ: `IotAuditRepository.logDeviceUpdate` cũng cố ý không ghi metadata thiết bị.
   */
  async logZoneUpdate(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      changes: Record<string, { old: unknown; new: unknown }>;
    },
  ): Promise<void> {
    const safeChanges: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params.changes)) {
      safeChanges[key] =
        key === 'metadataJson' ? { changed: true } : { ...value };
    }

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'update', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({ changed_fields: safeChanges }),
      ],
    );
  }

  async logZoneDeletion(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      zoneCode: string;
      zoneType: string;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'delete', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({
          zone_code: params.zoneCode,
          zone_type: params.zoneType,
        }),
      ],
    );
  }
}
