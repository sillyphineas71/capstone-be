import { ConfigService } from '@nestjs/config';
import { GuestAccessConfigService } from './guest-access-config.service';

describe('GuestAccessConfigService', () => {
  it('returns default values when env missing', () => {
    const configService = {
      get: jest.fn((_: string, defaultValue: unknown) => defaultValue),
    } as unknown as ConfigService;

    const service = new GuestAccessConfigService(configService);

    expect(service.getSessionMaxHours()).toBe(4);
    expect(service.getOtpTtlSeconds()).toBe(600);
    expect(service.getOtpMaxResends()).toBe(3);
    expect(service.getOtpResendWindowSeconds()).toBe(300);
    expect(service.getOtpMaxVerifyAttempts()).toBe(5);
    expect(service.getOtpBlockSeconds()).toBe(900);
    expect(service.getJoinWindowBeforeMinutes()).toBe(30);
    expect(service.getJoinWindowAfterMinutes()).toBe(15);
    expect(service.getInviteLinkTtlHours()).toBe(24);
    expect(service.getDeviceRememberDays()).toBe(30);
    expect(service.getLobbyEnabledDefault()).toBe(true);
    expect(service.getVerificationModeDefault()).toBe('otp');
  });

  it('reads GUEST_TOKEN_SECRET from env', () => {
    const configService = {
      get: jest.fn((key: string, defaultValue: unknown) =>
        key === 'GUEST_TOKEN_SECRET' ? 'configured-secret' : defaultValue,
      ),
    } as unknown as ConfigService;

    const service = new GuestAccessConfigService(configService);
    expect(service.getGuestTokenSecret()).toBe('configured-secret');
  });
});
