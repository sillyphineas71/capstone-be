import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { IVSS_EVENT_HANDLER } from '../../common/ports/ivss-event-hook.js';
import { IVSS_BRIDGE } from './ports/ivss-bridge.port.js';
import { ivssBridgeProvider } from './ivss-bridge.factory.js';
import { IvssInternalTokenGuard } from './guards/ivss-internal-token.guard.js';
import { DefaultIvssEventHandler } from './handlers/default-ivss-event.handler.js';
import { IvssPresenceIngestionService } from './services/ivss-presence-ingestion.service.js';
import { IvssPresenceQueryService } from './services/ivss-presence-query.service.js';
import { IvssPersonSyncService } from './services/ivss-person-sync.service.js';
import { IvssWebhookController } from './controllers/ivss-webhook.controller.js';
import { IvssHealthController } from './controllers/ivss-health.controller.js';
import { IvssPresenceController } from './controllers/ivss-presence.controller.js';

/**
 * IvssModule (IVS-001 #36) — lớp tích hợp IVSS bridge: client (outbound) + webhook (inbound)
 * + health + config. KHÔNG nghiệp vụ (enroll #37; map presence #38–40).
 *
 * ConfigModule global → ConfigService inject sẵn. AuthModule cho JwtAuthGuard (health).
 * IVSS_EVENT_HANDLER bind DefaultIvssEventHandler (log-only); #38–40 override.
 */
@Module({
  imports: [AuthModule, AccountsModule],
  controllers: [
    IvssWebhookController,
    IvssHealthController,
    IvssPresenceController,
  ],
  providers: [
    ivssBridgeProvider,
    IvssInternalTokenGuard,
    // DefaultIvssEventHandler giữ registered (fallback/log), KHÔNG bind token.
    DefaultIvssEventHandler,
    IvssPresenceIngestionService,
    // IPI-001 (#38+#39): handler thật thay log-only.
    { provide: IVSS_EVENT_HANDLER, useExisting: IvssPresenceIngestionService },
    IvssPersonSyncService,
    IvssPresenceQueryService,
  ],
  exports: [IVSS_BRIDGE, IvssPersonSyncService],
})
export class IvssModule {}
