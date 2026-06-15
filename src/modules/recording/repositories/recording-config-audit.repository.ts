import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * RecordingConfigAuditRepository (REC-001) — ghi audit_logs cho recording_configs.
 * Mirror pattern IotAuditRepository (raw insert). Không log secret.
 */
@Injectable()
export class RecordingConfigAuditRepository {
  async logConfigChange(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      configId: string;
      action: 'create' | 'update';
      changes?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, $2, 'recording_configs', $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        params.action,
        params.configId,
        params.changes ? JSON.stringify(params.changes) : null,
      ],
    );
  }
}
