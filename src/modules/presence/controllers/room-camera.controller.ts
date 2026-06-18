import { Controller, Post, Req, HttpCode } from '@nestjs/common';
import type { Request } from 'express';
import { OccupancyIngestService } from '../services/occupancy-ingest.service.js';

/**
 * RoomCameraController (OCC-001 / UC-75) — ingest từ Python Camera Service.
 * Path theo CLAUDE §22.7b. System-to-system: KHÔNG JwtAuthGuard user;
 * auth bằng device callback token trong OccupancyIngestService.
 */
@Controller('room-camera')
export class RoomCameraController {
  constructor(
    private readonly occupancyIngestService: OccupancyIngestService,
  ) {}

  @Post('occupancy-snapshots')
  @HttpCode(202)
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
