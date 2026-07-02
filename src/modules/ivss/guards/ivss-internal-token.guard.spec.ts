/* eslint-disable @typescript-eslint/no-unsafe-return */
import { UnauthorizedException } from '@nestjs/common';
import { IvssInternalTokenGuard } from './ivss-internal-token.guard.js';

const ctx = (headers: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as any;

const guard = (token: string) =>
  new IvssInternalTokenGuard({ get: () => token } as any);

describe('IvssInternalTokenGuard (IVS-001 #36, R1)', () => {
  it('token đúng (IVSS_BRIDGE_TOKEN) → true', () => {
    expect(
      guard('sekret').canActivate(ctx({ 'x-internal-token': 'sekret' })),
    ).toBe(true);
  });

  it('token sai → 401', () => {
    expect(() =>
      guard('sekret').canActivate(ctx({ 'x-internal-token': 'wrong' })),
    ).toThrow(UnauthorizedException);
  });

  it('thiếu header → 401', () => {
    expect(() => guard('sekret').canActivate(ctx({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('env rỗng → 401 (fail-closed)', () => {
    expect(() =>
      guard('').canActivate(ctx({ 'x-internal-token': 'anything' })),
    ).toThrow(UnauthorizedException);
  });
});
