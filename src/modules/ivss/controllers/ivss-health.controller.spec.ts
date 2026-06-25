/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { IvssHealthController } from './ivss-health.controller.js';

describe('IvssHealthController (IVS-001 #36, OQ-6 / C2)', () => {
  let controller: IvssHealthController;
  let bridgeMock: any;

  beforeEach(() => {
    bridgeMock = { status: jest.fn() };
    controller = new IvssHealthController(bridgeMock);
  });

  it('ok && connected:true → bridge=up', async () => {
    bridgeMock.status.mockResolvedValue({
      ok: true,
      data: { connected: true },
    });
    const r = await controller.health();
    expect(r.data).toMatchObject({ bridge: 'up' });
  });

  it('C2: ok nhưng connected:false → bridge=degraded', async () => {
    bridgeMock.status.mockResolvedValue({
      ok: true,
      data: { connected: false },
    });
    const r = await controller.health();
    expect(r.data.bridge).toBe('degraded');
    expect(r.data.detail).toBeDefined();
  });

  it('C2: bridge-down (ok:false) → bridge=down + detail=error code', async () => {
    bridgeMock.status.mockResolvedValue({
      ok: false,
      error: { code: 'BRIDGE_UNREACHABLE', message: 'x' },
    });
    const r = await controller.health();
    expect(r.data.bridge).toBe('down');
    expect(r.data.detail).toBe('BRIDGE_UNREACHABLE');
  });

  it('guard wiring: health có JwtAuthGuard (SEC-02 admin)', () => {
    const guards = Reflect.getMetadata('__guards__', controller.health) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });
});
