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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IVSS_EVENT_HANDLER } from '../../../common/ports/ivss-event-hook.js';
import type { IvssEventHandlerPort } from '../../../common/ports/ivss-event-hook.js';
import { FaceEventDto } from '../dto/face-event.dto.js';
import { IvssInternalTokenGuard } from '../guards/ivss-internal-token.guard.js';

/**
 * IvssWebhookController (IVS-001 #36) — nhận event từ IVSS bridge (system-to-system).
 *
 * SEC-02: IvssInternalTokenGuard (header X-Internal-Token = IVSS_BRIDGE_TOKEN).
 * R2: LUÔN ack (200) bất kể handler — try/catch quanh onFaceEvent. SEC-01: KHÔNG log imageBase64.
 */
@ApiTags('IVSS - Webhook (internal, bridge)')
@Controller()
export class IvssWebhookController {
  private readonly logger = new Logger(IvssWebhookController.name);

  constructor(
    @Inject(IVSS_EVENT_HANDLER)
    private readonly handler: IvssEventHandlerPort,
  ) {}

  @Post('internal/ivss/events')
  @HttpCode(200)
  @UseGuards(IvssInternalTokenGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      '[NỘI BỘ — chỉ IVSS bridge gọi tới, không phải endpoint public] Nhận event nhận diện khuôn mặt từ camera, xác thực bằng header X-Internal-Token, luôn ack 200 kể cả khi xử lý event lỗi',
  })
  async receiveEvent(@Body() dto: FaceEventDto) {
    // R2: handoff best-effort — handler lỗi KHÔNG làm vỡ ack.
    try {
      await this.handler.onFaceEvent(dto);
    } catch (e) {
      // SEC-01: chỉ log metadata, KHÔNG imageBase64.
      this.logger.warn(
        `IVSS event handler failed (type=${dto.type} channel=${dto.channelId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return {
      success: true,
      message: 'IVSS event accepted',
      data: { accepted: true },
    };
  }
}
