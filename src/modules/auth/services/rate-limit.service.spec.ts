import { ConfigService } from '@nestjs/config';
import { AuthConfigService } from './auth-config.service';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  it('allows attempts below threshold', () => {
    const authConfigService = new AuthConfigService({
      get: jest.fn((key: string, defaultValue: number) => defaultValue),
    } as unknown as ConfigService);
    const service = new RateLimitService(authConfigService);

    expect(() => service.checkOrThrow('127.0.0.1', 'user@example.com')).not.toThrow();
  });
});
