import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { IVSS_EVENT_HANDLER } from '../../common/ports/ivss-event-hook.js';
import { IVSS_BRIDGE } from './ports/ivss-bridge.port.js';
import { ivssBridgeProvider } from './ivss-bridge.factory.js';
import { IvssInternalTokenGuard } from './guards/ivss-internal-token.guard.js';
import { DefaultIvssEventHandler } from './handlers/default-ivss-event.handler.js';
import { IvssWebhookController } from './controllers/ivss-webhook.controller.js';
import { IvssHealthController } from './controllers/ivss-health.controller.js';

/**
 * IvssModule (IVS-001 #36) — lớp tích hợp IVSS bridge: client (outbound) + webhook (inbound)
 * + health + config. KHÔNG nghiệp vụ (enroll #37; map presence #38–40).
 *
 * ConfigModule global → ConfigService inject sẵn. AuthModule cho JwtAuthGuard (health).
 * IVSS_EVENT_HANDLER bind DefaultIvssEventHandler (log-only); #38–40 override.
 */
@Module({
  imports: [AuthModule],
  controllers: [IvssWebhookController, IvssHealthController],
  providers: [
    ivssBridgeProvider,
    IvssInternalTokenGuard,
    DefaultIvssEventHandler,
    { provide: IVSS_EVENT_HANDLER, useExisting: DefaultIvssEventHandler },
  ],
  exports: [IVSS_BRIDGE],
})
export class IvssModule {}
