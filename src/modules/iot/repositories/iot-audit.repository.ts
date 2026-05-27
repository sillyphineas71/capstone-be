import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { maskSensitiveMetadata } from '../../../common/utils/masking.util';

@Injectable()
export class IotAuditRepository {
  async logDeviceCreation(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      metadataJson?: Record<string, any> | null;
    },
  ): Promise<void> {
    const maskedMetadata = maskSensitiveMetadata(params.metadataJson);

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'create', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [
        params.userId,
        params.deviceId,
        maskedMetadata ? JSON.stringify(maskedMetadata) : null,
      ],
    );
  }
}
