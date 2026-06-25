import { Injectable, Logger } from '@nestjs/common';
import {
  IvssEventHandlerPort,
  IvssFaceEvent,
} from '../../../common/ports/ivss-event-hook.js';

/**
 * DefaultIvssEventHandler (IVS-001 #36, OQ-3=A) — handler mặc định: log/đếm metadata-only.
 *
 * Defer mapping presence/attendance cho #38–40 (override bằng useExisting impl thật).
 * SEC-01: KHÔNG log imageBase64 / dữ liệu nhạy cảm.
 */
@Injectable()
export class DefaultIvssEventHandler implements IvssEventHandlerPort {
  private readonly logger = new Logger(DefaultIvssEventHandler.name);

  onFaceEvent(evt: IvssFaceEvent): Promise<void> {
    // Chỉ metadata — KHÔNG imageBase64.
    this.logger.log(
      `IVSS face event: type=${evt.type} channel=${evt.channelId} person=${evt.personUid} utc=${evt.utc}`,
    );
    return Promise.resolve();
  }
}
