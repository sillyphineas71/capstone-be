/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { NoShowController } from './no-show.controller.js';
import { InternalTokenGuard } from '../guards/internal-token.guard.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

describe('NoShowController (NSC-001)', () => {
  let controller: NoShowController;
  let serviceMock: any;
  let lifecycleMock: any;

  beforeEach(() => {
    serviceMock = {
      create: jest.fn(),
      update: jest.fn(),
    };
    lifecycleMock = {
      manualRelease: jest.fn(),
    };
    controller = new NoShowController(serviceMock, lifecycleMock);
  });

  it('createInternal: created=true → status 201 + envelope', async () => {
    serviceMock.create.mockResolvedValue({
      case: {
        id: 'nsc-1',
        booking_id: 'bk-1',
        detection_status: 'risk',
        detected_at: 't',
      },
      created: true,
    });
    const res = { status: jest.fn() } as any;
    const r = await controller.createInternal(
      { bookingId: 'bk-1', meetingId: 'mt-1', roomId: 'rm-1' },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(r.data).toMatchObject({ noShowCaseId: 'nsc-1' });
  });

  it('createInternal: existing → status 200', async () => {
    serviceMock.create.mockResolvedValue({
      case: { id: 'nsc-1', booking_id: 'bk-1', detection_status: 'risk' },
      created: false,
    });
    const res = { status: jest.fn() } as any;
    await controller.createInternal({ bookingId: 'bk-1' } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('update: passthrough envelope', async () => {
    serviceMock.update.mockResolvedValue({ id: 'nsc-1' });
    const r = await controller.update('nsc-1', { note: 'x' }, {
      user: { sub: 'u1' },
    } as any);
    expect(serviceMock.update).toHaveBeenCalledWith(
      'nsc-1',
      { note: 'x' },
      'u1',
    );
    expect(r.data).toMatchObject({ id: 'nsc-1' });
  });

  it('update: 404 propagate', async () => {
    serviceMock.update.mockRejectedValue(new NotFoundException());
    await expect(
      controller.update('nsc-1', {} as any, { user: {} } as any),
    ).rejects.toThrow(NotFoundException);
  });

  // ── #33b manual release endpoint (fold A: map mã trả) ──
  const callRelease = () =>
    controller.release('nsc-1', { reason: 'admin reason' }, {
      user: { sub: 'admin1' },
    } as any);

  it('release: success → envelope released:true + userId từ token', async () => {
    lifecycleMock.manualRelease.mockResolvedValue({
      noShowCaseId: 'nsc-1',
      detectionStatus: 'released',
      released: true,
    });
    const r = await callRelease();
    expect(lifecycleMock.manualRelease).toHaveBeenCalledWith(
      'nsc-1',
      'admin reason',
      'admin1',
    );
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ released: true });
  });

  it('release: 200 no-op (already released) → released:false', async () => {
    lifecycleMock.manualRelease.mockResolvedValue({
      noShowCaseId: 'nsc-1',
      detectionStatus: 'released',
      released: false,
    });
    const r = await callRelease();
    expect(r.data).toMatchObject({ released: false });
  });

  it('release: case không tồn tại → 404 propagate', async () => {
    lifecycleMock.manualRelease.mockRejectedValue(new NotFoundException());
    await expect(callRelease()).rejects.toThrow(NotFoundException);
  });

  it('release: dismissed|resolved → 400 INVALID_NO_SHOW_TRANSITION propagate', async () => {
    lifecycleMock.manualRelease.mockRejectedValue(
      new BadRequestException({ code: 'INVALID_NO_SHOW_TRANSITION' }),
    );
    await expect(callRelease()).rejects.toThrow(BadRequestException);
  });

  it('release: booking_changed → 409 BOOKING_NOT_RELEASABLE propagate', async () => {
    lifecycleMock.manualRelease.mockRejectedValue(
      new ConflictException({ code: 'BOOKING_NOT_RELEASABLE' }),
    );
    await expect(callRelease()).rejects.toThrow(ConflictException);
  });

  it('guard wiring: release endpoint có JwtAuthGuard (SEC-02)', () => {
    const guards = Reflect.getMetadata('__guards__', controller.release) ?? [];
    expect(guards).toContain(JwtAuthGuard);
  });
});

describe('InternalTokenGuard (NSC-001)', () => {
  const makeCtx = (headers: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as any;

  const guard = (token: string) =>
    new InternalTokenGuard({ get: () => token } as any);

  it('env token rỗng → 401 (fail-closed)', () => {
    expect(() =>
      guard('').canActivate(makeCtx({ 'x-internal-token': 'anything' })),
    ).toThrow(UnauthorizedException);
  });

  it('token đúng → true', () => {
    expect(
      guard('secret').canActivate(makeCtx({ 'x-internal-token': 'secret' })),
    ).toBe(true);
  });

  it('token sai → 401', () => {
    expect(() =>
      guard('secret').canActivate(makeCtx({ 'x-internal-token': 'wrong' })),
    ).toThrow(UnauthorizedException);
  });

  it('token thiếu → 401', () => {
    expect(() => guard('secret').canActivate(makeCtx({}))).toThrow(
      UnauthorizedException,
    );
  });
});
