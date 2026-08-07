import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GuestAccessConfigService } from '../config/guest-access-config.service';
import { GuestSessionService } from './guest-session.service';

function buildConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    GUEST_TOKEN_SECRET: 'guest-secret-at-least-16-chars',
    GUEST_ACCESS_SESSION_MAX_HOURS: 4,
    ...overrides,
  };
  return new GuestAccessConfigService({
    get: jest.fn((key: string, defaultValue?: unknown) => {
      return key in values ? values[key] : defaultValue;
    }),
  } as unknown as ConfigService);
}

describe('GuestSessionService', () => {
  it('signs a token with typ=guest, correct sub/mid, and a fresh jti', async () => {
    const service = new GuestSessionService(new JwtService(), buildConfig());
    const { token, jti } = await service.signGuestToken({
      externalParticipantId: 'ep-1',
      meetingId: 'meeting-1',
    });

    const payload = await service.verifyGuestToken(token);
    expect(payload.typ).toBe('guest');
    expect(payload.sub).toBe('ep-1');
    expect(payload.mid).toBe('meeting-1');
    expect(payload.jti).toBe(jti);
    expect(payload.scope).toEqual(['meeting.guest.view']);
  });

  it('rejects a token signed with a DIFFERENT secret (core security boundary, FR-GLA-020)', async () => {
    const serviceA = new GuestSessionService(
      new JwtService(),
      buildConfig({ GUEST_TOKEN_SECRET: 'secret-A-at-least-16-chars' }),
    );
    const serviceB = new GuestSessionService(
      new JwtService(),
      buildConfig({ GUEST_TOKEN_SECRET: 'secret-B-at-least-16-chars' }),
    );

    const { token } = await serviceA.signGuestToken({
      externalParticipantId: 'ep-1',
      meetingId: 'meeting-1',
    });

    await expect(serviceB.verifyGuestToken(token)).rejects.toThrow();
  });

  it('rejects a token whose typ claim was tampered to something else', async () => {
    const config = buildConfig();
    const jwtService = new JwtService();
    const tamperedToken = await jwtService.signAsync(
      {
        typ: 'employee',
        sub: 'ep-1',
        mid: 'meeting-1',
        scope: ['meeting.guest.view'],
        jti: 'jti-1',
      },
      { secret: config.getGuestTokenSecret(), expiresIn: '4h' },
    );
    const service = new GuestSessionService(jwtService, config);

    await expect(service.verifyGuestToken(tamperedToken)).rejects.toThrow(
      'Invalid guest token type',
    );
  });

  it('rejects an expired token', async () => {
    const config = buildConfig();
    const jwtService = new JwtService();
    const expiredToken = await jwtService.signAsync(
      {
        typ: 'guest',
        sub: 'ep-1',
        mid: 'meeting-1',
        scope: ['meeting.guest.view'],
        jti: 'jti-1',
      },
      { secret: config.getGuestTokenSecret(), expiresIn: -10 },
    );
    const service = new GuestSessionService(jwtService, config);

    await expect(service.verifyGuestToken(expiredToken)).rejects.toThrow();
  });

  it('signs TTL according to GUEST_ACCESS_SESSION_MAX_HOURS config', async () => {
    const service = new GuestSessionService(
      new JwtService(),
      buildConfig({ GUEST_ACCESS_SESSION_MAX_HOURS: 2 }),
    );
    const { expiresInSeconds } = await service.signGuestToken({
      externalParticipantId: 'ep-1',
      meetingId: 'meeting-1',
    });
    expect(expiresInSeconds).toBe(2 * 3600);
  });
});
