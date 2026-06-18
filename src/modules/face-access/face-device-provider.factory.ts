import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret } from '../../common/utils/secret-crypto.util.js';
import {
  FaceDeviceProviderPort,
  FaceDeviceError,
} from './ports/face-device-provider.port.js';
import { FaceGateClient } from './clients/facegate.client.js';

/** Shape tối thiểu của 1 iot_devices row (device_type='face_server') — B truyền vào. */
export interface FaceDeviceRow {
  ipAddress: string | null;
  metadataJson: Record<string, unknown> | null;
}

interface FaceServerConfig {
  base_url?: string;
  username?: string;
  password_encrypted?: string;
}

/**
 * FaceDeviceProviderFactory (FGC-001 / F1) — tạo FaceDeviceProviderPort PER-DEVICE.
 *
 * Decrypt creds (decryptSecret IOT-015) + dựng FaceGateClient từ row iot_devices.
 * KHÔNG singleton client (mỗi thiết bị baseUrl/creds khác nhau). B gọi factory.create(device).
 */
@Injectable()
export class FaceDeviceProviderFactory {
  constructor(private readonly configService: ConfigService) {}

  create(device: FaceDeviceRow): FaceDeviceProviderPort {
    const cfg = (device.metadataJson?.['face_server_config'] ??
      {}) as FaceServerConfig;

    const baseUrl =
      cfg.base_url ?? (device.ipAddress ? `http://${device.ipAddress}` : '');
    if (!baseUrl) {
      throw new FaceDeviceError(
        'http_error',
        'FaceGate base URL not configured for device.',
      );
    }

    const username = cfg.username ?? '';
    const password = cfg.password_encrypted
      ? decryptSecret(cfg.password_encrypted)
      : '';

    return new FaceGateClient({
      baseUrl,
      username,
      password,
      timeoutMs: this.configService.get<number>('FACEGATE_TIMEOUT_MS', 8000),
      tz: this.configService.get<string>('FACEGATE_TZ', 'Asia/Ho_Chi_Minh'),
      uploadField: this.configService.get<string>(
        'FACEGATE_UPLOAD_FIELD',
        'vfileselector',
      ),
    });
  }
}
