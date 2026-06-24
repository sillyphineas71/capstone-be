import {
  Controller,
  Post,
  Body,
  Inject,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import { VEHICLE_EVENT_HANDLER } from '../../../common/ports/vehicle-event-hook.js';
import type {
  VehicleEventHandlerPort,
  VehicleEvent,
} from '../../../common/ports/vehicle-event-hook.js';
import { VehicleEventDto } from '../dto/vehicle-event.dto.js';
import { AnprInternalTokenGuard } from '../guards/anpr-internal-token.guard.js';
import { normalizePlate } from '../utils/normalize-plate.js';

/**
 * VehicleWebhookController (VWH-001 / UC4) — nhận vehicle event từ IVSS bridge (system-to-system).
 *
 * SEC-01: AnprInternalTokenGuard (header X-Internal-Token = IVSS_BRIDGE_TOKEN), KHÔNG JWT.
 * ARCH-01: LUÔN ack 200 (try/catch quanh onVehicleEvent). DATA-01: normalize plateNumber qua
 * normalizePlate (UC1, single-source). UC4 KHÔNG resolve user / KHÔNG persist (UC5). KHÔNG log imageBase64.
 */
@Controller()
export class VehicleWebhookController {
  private readonly logger = new Logger(VehicleWebhookController.name);

  constructor(
    @Inject(VEHICLE_EVENT_HANDLER)
    private readonly handler: VehicleEventHandlerPort,
  ) {}

  @Post('internal/ivss/vehicle-events')
  @HttpCode(200)
  @UseGuards(AnprInternalTokenGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async receiveEvent(@Body() dto: VehicleEventDto) {
    // DATA-01: normalize single-source (UC1). Event mang cả plateRaw (gốc) + plateNumber (chuẩn).
    const event: VehicleEvent = {
      plateRaw: dto.plateNumber,
      plateNumber: normalizePlate(dto.plateNumber),
      channelId: dto.channelId,
      utc: dto.utc,
      eventAction: dto.eventAction,
      plateColor: dto.plateColor,
      vehicleColor: dto.vehicleColor,
      vehicleType: dto.vehicleType,
      imageBase64: dto.imageBase64,
    };

    // ARCH-01: handoff best-effort — handler lỗi KHÔNG làm vỡ ack.
    try {
      await this.handler.onVehicleEvent(event);
    } catch (e) {
      // SEC-01: chỉ log metadata, KHÔNG imageBase64.
      this.logger.warn(
        `Vehicle event handler failed (channel=${event.channelId} plate=${event.plateNumber}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return {
      success: true,
      message: 'Vehicle event accepted',
      data: { accepted: true },
    };
  }
}
