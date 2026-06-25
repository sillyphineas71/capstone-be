import { Injectable, Logger } from '@nestjs/common';
import {
  VehicleEventHandlerPort,
  VehicleEvent,
} from '../../../common/ports/vehicle-event-hook.js';

/**
 * DefaultVehicleEventHandler (VWH-001 / UC4) — handler mặc định: log metadata-only.
 *
 * Defer resolve biển→user + persist iot_device_events cho UC5 (override bằng useExisting impl thật).
 * SEC-01: KHÔNG log imageBase64 / dữ liệu nhạy cảm.
 */
@Injectable()
export class DefaultVehicleEventHandler implements VehicleEventHandlerPort {
  private readonly logger = new Logger(DefaultVehicleEventHandler.name);

  onVehicleEvent(evt: VehicleEvent): Promise<void> {
    // Chỉ metadata — KHÔNG imageBase64.
    this.logger.log(
      `Vehicle event: channel=${evt.channelId} plate=${evt.plateNumber} utc=${evt.utc}`,
    );
    return Promise.resolve();
  }
}
