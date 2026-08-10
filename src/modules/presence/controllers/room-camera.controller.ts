import { Controller, Post, Req, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OccupancyIngestService } from '../services/occupancy-ingest.service.js';

/**
 * RoomCameraController (OCC-001 / UC-75) — ingest từ Python Camera Service.
 * Path theo CLAUDE §22.7b. System-to-system: KHÔNG JwtAuthGuard user;
 * auth bằng device callback token trong OccupancyIngestService.
 */
@ApiTags('Presence - Room Camera Ingest')
@Controller('room-camera')
export class RoomCameraController {
  constructor(
    private readonly occupancyIngestService: OccupancyIngestService,
  ) {}

  @Post('occupancy-snapshots')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Nhận snapshot số người hiện diện trong phòng từ Python Camera Service (system-to-system, xác thực bằng device callback token)',
  })
  async occupancySnapshot(@Req() req: Request) {
    return this.occupancyIngestService.ingest({
      headers: req.headers,
      body: (req.body as Record<string, unknown>) ?? null,
      query: req.query,
      params: req.params,
      clientIp: req.ip,
    });
  }
}
