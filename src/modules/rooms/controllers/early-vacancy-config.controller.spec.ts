/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { EarlyVacancyConfigController } from './early-vacancy-config.controller.js';

describe('EarlyVacancyConfigController (EVD-001 #48)', () => {
  let controller: EarlyVacancyConfigController;
  let svcMock: any;

  beforeEach(() => {
    svcMock = { getAll: jest.fn(), update: jest.fn() };
    controller = new EarlyVacancyConfigController(svcMock);
  });

  it('GET: 3 key + source envelope', async () => {
    svcMock.getAll.mockResolvedValue({
      emptyMinutes: { value: 10, source: 'default' },
      minRemainingMinutes: { value: 15, source: 'default' },
      minElapsedMinutes: { value: 10, source: 'env' },
    });
    const r = await controller.get();
    expect(r.success).toBe(true);
    expect(Object.keys(r.data)).toEqual([
      'emptyMinutes',
      'minRemainingMinutes',
      'minElapsedMinutes',
    ]);
    expect(r.data.minElapsedMinutes.source).toBe('env');
  });

  it('PUT: whitelist field → service.update với userId token', async () => {
    svcMock.update.mockResolvedValue({
      emptyMinutes: { value: 8, source: 'system_configs' },
    });
    const r = await controller.update({ emptyMinutes: 8 }, {
      user: { sub: 'admin1' },
    } as any);
    expect(svcMock.update).toHaveBeenCalledWith({ emptyMinutes: 8 }, 'admin1');
    expect(r.data.emptyMinutes.value).toBe(8);
  });

  it('PUT: value sai (service ném) → 400 propagate', async () => {
    svcMock.update.mockRejectedValue(
      new BadRequestException({ code: 'INVALID_CONFIG_VALUE' }),
    );
    await expect(
      controller.update({ emptyMinutes: 0 }, { user: {} } as any),
    ).rejects.toThrow(BadRequestException);
  });

  // SEC-02: key lạ chặn ở ValidationPipe(forbidNonWhitelisted) + DTO 3 field (declarative);
  // GET + PUT đều gated JwtAuthGuard.
  it('guard wiring: GET + PUT có JwtAuthGuard (SEC-02)', () => {
    const getGuards = Reflect.getMetadata('__guards__', controller.get) ?? [];
    const putGuards =
      Reflect.getMetadata('__guards__', controller.update) ?? [];
    expect(getGuards).toContain(JwtAuthGuard);
    expect(putGuards).toContain(JwtAuthGuard);
  });
});
