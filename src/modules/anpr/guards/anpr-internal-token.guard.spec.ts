/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnprInternalTokenGuard } from './anpr-internal-token.guard.js';

describe('AnprInternalTokenGuard (VWH-001 / UC4)', () => {
  const ctx = (headers: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as any;

  const build = (token: string) =>
    new AnprInternalTokenGuard({
      get: (_k: string, def: string) => token || def,
    } as unknown as ConfigService);

  it('token đúng → canActivate true', () => {
    const guard = build('secret-123');
    expect(guard.canActivate(ctx({ 'x-internal-token': 'secret-123' }))).toBe(
      true,
    );
  });

  it('token sai → 401', () => {
    const guard = build('secret-123');
    expect(() =>
      guard.canActivate(ctx({ 'x-internal-token': 'wrong' })),
    ).toThrow(UnauthorizedException);
  });

  it('thiếu header → 401', () => {
    const guard = build('secret-123');
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('env IVSS_BRIDGE_TOKEN rỗng → 401 (fail-closed)', () => {
    const guard = build('');
    expect(() =>
      guard.canActivate(ctx({ 'x-internal-token': 'anything' })),
    ).toThrow(UnauthorizedException);
  });
});
