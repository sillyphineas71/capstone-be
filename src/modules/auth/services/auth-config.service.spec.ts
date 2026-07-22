import { ConfigService } from '@nestjs/config';
import { AuthConfigService } from './auth-config.service';

describe('AuthConfigService', () => {
  it('returns default TTL values when env missing', () => {
    const configService = {
      get: jest.fn((_: string, defaultValue: number) => defaultValue),
    } as unknown as ConfigService;

    const service = new AuthConfigService(configService);

    expect(service.getAccessTokenTtlSeconds()).toBe(10800);
    expect(service.getRefreshTokenTtlSeconds()).toBe(2592000);
  });
});
