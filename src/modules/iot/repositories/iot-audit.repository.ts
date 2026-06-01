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

  async logConfigureFaceServer(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      configMetadata: Record<string, any>;
    },
  ): Promise<void> {
    // metadata must not contain one_time_callback_token or callback_token_hash
    const safeMetadata = { ...params.configMetadata };
    delete safeMetadata.one_time_callback_token;
    delete safeMetadata.callback_token_hash;

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'configure_face_server', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify(safeMetadata)],
    );
  }

  async logConfigureRtsp(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      configMetadata: Record<string, any>;
    },
  ): Promise<void> {
    const safeMetadata = { ...params.configMetadata };
    const hasPassword = !!(
      safeMetadata.rtsp_password || safeMetadata.rtsp_password_encrypted
    );
    safeMetadata.rtsp_password_configured = hasPassword;
    delete safeMetadata.rtsp_password;
    delete safeMetadata.rtsp_password_encrypted;

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'configure_rtsp', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify(safeMetadata)],
    );
  }
}
