/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { NoShowConfigController } from './no-show-config.controller.js';

describe('NoShowConfigController (NSL-001 #35)', () => {
  let controller: NoShowConfigController;
  let svcMock: any;

  beforeEach(() => {
    svcMock = { getAll: jest.fn(), update: jest.fn() };
    controller = new NoShowConfigController(svcMock);
  });

  it('GET: trả 3 key + source trong envelope', async () => {
    svcMock.getAll.mockResolvedValue({
      thresholdMinutes: { value: 15, source: 'default' },
      warningGraceMinutes: { value: 0, source: 'default' },
      autoReleaseGraceMinutes: { value: 5, source: 'env' },
    });
    const r = await controller.get();
    expect(r.success).toBe(true);
    expect(Object.keys(r.data)).toEqual([
      'thresholdMinutes',
      'warningGraceMinutes',
      'autoReleaseGraceMinutes',
    ]);
    expect(r.data.autoReleaseGraceMinutes.source).toBe('env');
  });

  it('PUT: nhận field whitelist → gọi service.update với userId từ token', async () => {
    svcMock.update.mockResolvedValue({
      thresholdMinutes: { value: 20, source: 'system_configs' },
    });
    const r = await controller.update({ thresholdMinutes: 20 }, {
      user: { sub: 'admin1' },
    } as any);
    expect(svcMock.update).toHaveBeenCalledWith(
      { thresholdMinutes: 20 },
      'admin1',
    );
    expect(r.data.thresholdMinutes.value).toBe(20);
  });

  it('PUT: value ≤ 0 (service ném) → 400 propagate', async () => {
    svcMock.update.mockRejectedValue(
      new BadRequestException({ code: 'INVALID_CONFIG_VALUE' }),
    );
    await expect(
      controller.update({ thresholdMinutes: 0 }, { user: {} } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('PUT: không field nào (service ném NO_CONFIG_FIELDS) → 400 propagate', async () => {
    svcMock.update.mockRejectedValue(
      new BadRequestException({ code: 'NO_CONFIG_FIELDS' }),
    );
    await expect(controller.update({}, { user: {} } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  // SEC-02 / R4: GET + PUT đều gated JwtAuthGuard (admin-only). Whitelist key lạ do
  // ValidationPipe(forbidNonWhitelisted) + DTO 3 field — declarative, proof qua metadata.
  it('guard wiring: GET + PUT đều có JwtAuthGuard (SEC-02)', () => {
    const getGuards = Reflect.getMetadata('__guards__', controller.get) ?? [];
    const putGuards =
      Reflect.getMetadata('__guards__', controller.update) ?? [];
    expect(getGuards).toContain(JwtAuthGuard);
    expect(putGuards).toContain(JwtAuthGuard);
  });
});
