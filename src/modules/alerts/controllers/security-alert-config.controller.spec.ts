/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { SecurityAlertConfigController } from './security-alert-config.controller.js';

describe('SecurityAlertConfigController (ASC-001 auto-resolve timeout)', () => {
  let controller: SecurityAlertConfigController;
  let svcMock: any;

  beforeEach(() => {
    svcMock = { getAll: jest.fn(), update: jest.fn() };
    controller = new SecurityAlertConfigController(svcMock);
  });

  it('GET: trả key autoResolveTimeoutMinutes + source trong envelope', async () => {
    svcMock.getAll.mockResolvedValue({
      autoResolveTimeoutMinutes: { value: 15, source: 'default' },
    });
    const r = await controller.get();
    expect(r.success).toBe(true);
    expect(r.data.autoResolveTimeoutMinutes).toEqual({
      value: 15,
      source: 'default',
    });
  });

  it('PUT: nhận field whitelist → gọi service.update với userId từ token', async () => {
    svcMock.update.mockResolvedValue({
      autoResolveTimeoutMinutes: { value: 20, source: 'system_configs' },
    });
    const r = await controller.update(
      { autoResolveTimeoutMinutes: 20 },
      { userId: 'admin1' },
    );
    expect(svcMock.update).toHaveBeenCalledWith(
      { autoResolveTimeoutMinutes: 20 },
      'admin1',
    );
    expect(r.data.autoResolveTimeoutMinutes.value).toBe(20);
  });

  it('PUT: value ≤ 0 (service ném) → 400 propagate', async () => {
    svcMock.update.mockRejectedValue(
      new BadRequestException({ code: 'INVALID_CONFIG_VALUE' }),
    );
    await expect(
      controller.update({ autoResolveTimeoutMinutes: 0 }, { userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('PUT: không field nào (service ném NO_CONFIG_FIELDS) → 400 propagate', async () => {
    svcMock.update.mockRejectedValue(
      new BadRequestException({ code: 'NO_CONFIG_FIELDS' }),
    );
    await expect(
      controller.update({}, { userId: 'u1' }),
    ).rejects.toThrow(BadRequestException);
  });

  // R2: GET + PUT gated JwtAuthGuard + PermissionsGuard, permission
  // security_alerts.configure — declarative, proof qua metadata.
  it('guard wiring: GET + PUT đều có JwtAuthGuard + PermissionsGuard', () => {
    const classGuards =
      Reflect.getMetadata('__guards__', SecurityAlertConfigController) ?? [];
    expect(classGuards).toContain(JwtAuthGuard);
    expect(classGuards).toContain(PermissionsGuard);
  });

  it('permission wiring: GET + PUT đều require security_alerts.configure', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.get)).toEqual([
      'security_alerts.configure',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.update)).toEqual([
      'security_alerts.configure',
    ]);
  });
});
