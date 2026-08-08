import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { IVSS_BRIDGE } from '../ports/ivss-bridge.port.js';
import type { IvssBridgePort } from '../ports/ivss-bridge.port.js';

/**
 * IvssHealthController (IVS-001 #36, OQ-6) — health passive: gọi bridge status().
 * SEC-02: admin-gated. C2: unreachable→down, reachable+connected:false→degraded, ok&&connected→up.
 */
@ApiTags('IVSS - Health')
@Controller('ivss')
export class IvssHealthController {
  constructor(
    @Inject(IVSS_BRIDGE)
    private readonly bridge: IvssBridgePort,
  ) {}

  @Get('health')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('ivss.health.read')
  @ApiOperation({
    summary:
      'Admin kiểm tra tình trạng kết nối tới IVSS bridge (up/degraded/down) — gọi passive tới bridge.status()',
  })
  async health() {
    const r = await this.bridge.status();
    let bridge: 'up' | 'down' | 'degraded';
    let detail: string | undefined;
    if (!r.ok) {
      bridge = 'down';
      detail = r.error.code;
    } else if (r.data.connected === true) {
      bridge = 'up';
    } else {
      bridge = 'degraded';
      detail = 'bridge reachable but SDK not connected';
    }
    return {
      success: true,
      message: 'IVSS health',
      data: { bridge, detail },
    };
  }
}
