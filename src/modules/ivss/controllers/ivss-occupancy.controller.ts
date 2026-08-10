import {
  Controller,
  Post,
  Body,
  HttpCode,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Logger,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OccupancyEventDto } from '../dto/occupancy-event.dto.js';
import { IvssInternalTokenGuard } from '../guards/ivss-internal-token.guard.js';
import { IvssOccupancyIngestService } from '../services/ivss-occupancy-ingest.service.js';

/**
 * IvssOccupancyController (IVSS-OCC-001 / A-OCC) — nhận occupancy (People Counting) từ IVSS bridge.
 *
 * SEC: IvssInternalTokenGuard (header X-Internal-Token = IVSS_BRIDGE_TOKEN), KHÔNG JWT user.
 * Ack-always (200): try/catch quanh ingest — lỗi nghiệp vụ (gồm BadRequest từ persist) bị nuốt +
 * log → vẫn ack, KHÔNG để bridge retry. Mirror IvssWebhookController.
 */
@ApiTags('IVSS - Occupancy (internal, bridge)')
@Controller()
export class IvssOccupancyController {
  private readonly logger = new Logger(IvssOccupancyController.name);

  constructor(
    private readonly ivssOccupancyIngestService: IvssOccupancyIngestService,
  ) {}

  @Post('internal/ivss/occupancy-events')
  @HttpCode(200)
  @UseGuards(IvssInternalTokenGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiOperation({
    summary:
      '[NỘI BỘ — chỉ IVSS bridge gọi tới, không phải endpoint public] Nhận sự kiện đếm người (People Counting) theo channel từ camera, xác thực bằng header X-Internal-Token, luôn ack 200 kể cả khi xử lý lỗi',
  })
  async receiveEvent(@Body() dto: OccupancyEventDto) {
    // Ack-always — handler lỗi KHÔNG làm vỡ ack (bridge fire-and-forget).
    try {
      await this.ivssOccupancyIngestService.ingest(dto);
    } catch (e) {
      this.logger.warn(
        `IVSS occupancy handler failed (channel=${dto.channelId} number=${dto.number}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
    return {
      success: true,
      message: 'IVSS occupancy event accepted',
      data: { accepted: true },
    };
  }
}
