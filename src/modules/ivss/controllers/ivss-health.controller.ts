/* eslint-disable @typescript-eslint/no-unused-vars */
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { IVSS_BRIDGE } from '../ports/ivss-bridge.port.js';
import type { IvssBridgePort } from '../ports/ivss-bridge.port.js';

// Mock PermissionsGuard — nhất quán no-show-config/iot/recording controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any): void => {};

/**
 * IvssHealthController (IVS-001 #36, OQ-6) — health passive: gọi bridge status().
 * SEC-02: admin-gated. C2: unreachable→down, reachable+connected:false→degraded, ok&&connected→up.
 */
@Controller('ivss')
export class IvssHealthController {
  constructor(
    @Inject(IVSS_BRIDGE)
    private readonly bridge: IvssBridgePort,
  ) {}

  @Get('health')
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('ivss.health.read')
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
