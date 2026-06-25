import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IVSS_BRIDGE } from './ports/ivss-bridge.port.js';
import { IvssBridgeClient } from './clients/ivss-bridge.client.js';

/**
 * IVS-001 #36 — provider dựng IvssBridgeClient từ env (OQ-5). C3: bind token IVSS_BRIDGE.
 * R1: 1 secret IVSS_BRIDGE_TOKEN (client gửi làm X-Internal-Token).
 */
export const ivssBridgeProvider: Provider = {
  provide: IVSS_BRIDGE,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    new IvssBridgeClient({
      baseUrl: config.get<string>('IVSS_BRIDGE_BASE_URL', ''),
      token: config.get<string>('IVSS_BRIDGE_TOKEN', ''),
      timeoutMs: config.get<number>('IVSS_BRIDGE_TIMEOUT_MS', 8000),
    }),
};
