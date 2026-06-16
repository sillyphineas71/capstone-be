/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { NoShowController } from './no-show.controller.js';
import { InternalTokenGuard } from '../guards/internal-token.guard.js';

describe('NoShowController (NSC-001)', () => {
  let controller: NoShowController;
  let serviceMock: any;

  beforeEach(() => {
    serviceMock = {
      create: jest.fn(),
      update: jest.fn(),
    };
    controller = new NoShowController(serviceMock);
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
