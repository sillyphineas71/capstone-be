/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { VehicleTrafficStatsController } from './vehicle-traffic-stats.controller.js';

describe('VehicleTrafficStatsController (VTS-001 / UC-114)', () => {
  let controller: VehicleTrafficStatsController;
  let service: any;

  const stats = {
    summary: {
      total_events: 10,
      total_matched: 8,
      total_unmatched: 2,
      total_enter: 5,
      total_leave: 5,
      total_seen: 0,
      unique_vehicles: 6,
    },
    series: [{ bucket: '2026-07-01', enter: 5, leave: 5, seen: 0 }],
  };

  beforeEach(() => {
    service = { getStats: jest.fn().mockResolvedValue(stats) };
    controller = new VehicleTrafficStatsController(service);
  });

  it('class-level JwtAuthGuard + PermissionsGuard (KHÔNG route self-service)', () => {
    const guards =
      Reflect.getMetadata('__guards__', VehicleTrafficStatsController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(PermissionsGuard);
  });

  it('permission = gate_access.stats.read', () => {
    const perms = Reflect.getMetadata(PERMISSIONS_KEY, controller.getStats);
    expect(perms).toEqual(['gate_access.stats.read']);
  });

  it('GET vehicle-traffic-stats → service.getStats(query), envelope KHÔNG có meta', async () => {
    const query = {
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-31T23:59:59Z',
    } as any;
    const r = await controller.getStats(query);
    expect(service.getStats).toHaveBeenCalledWith(query);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(stats);
    expect('meta' in r).toBe(false);
  });
});
