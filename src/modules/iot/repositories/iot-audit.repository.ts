import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { maskSensitiveMetadata } from '../../../common/utils/masking.util.js';

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

  async logAssignRoom(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      oldRoomId: string | null;
      newRoomId: string;
    },
  ): Promise<void> {
    const metadata = {
      old_room_id: params.oldRoomId,
      new_room_id: params.newRoomId,
    };

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'assign_room', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify(metadata)],
    );
  }
}
