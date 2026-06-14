import { ConfigService } from '@nestjs/config';
import { AuthConfigService } from './auth-config.service';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from '../../redis/redis.service';

describe('RateLimitService', () => {
  let service: RateLimitService;
  let redisService: { incr: jest.Mock; expire: jest.Mock };

  beforeEach(() => {
    redisService = { incr: jest.fn(), expire: jest.fn() };

    const authConfigService = new AuthConfigService({
      get: jest.fn((key: string, defaultValue: number) => defaultValue),
    } as unknown as ConfigService);

    service = new RateLimitService(authConfigService, redisService as unknown as RedisService);
  });

  it('allows attempts below threshold', async () => {
    redisService.incr.mockResolvedValue(1);

    await expect(
      service.checkOrThrow('127.0.0.1', 'user@example.com'),
    ).resolves.toBeUndefined();
    expect(redisService.incr).toHaveBeenCalledWith(
      'rate_limit:login:127.0.0.1:user@example.com',
    );
    expect(redisService.expire).toHaveBeenCalledWith(
      'rate_limit:login:127.0.0.1:user@example.com',
      300,
    );
  });

  it('blocks when threshold exceeded', async () => {
    redisService.incr.mockResolvedValue(6); // maxAttempts=5

    await expect(
      service.checkOrThrow('127.0.0.1', 'user@example.com'),
    ).rejects.toThrow('AUTH_TOO_MANY_ATTEMPTS');
  });

  it('allows exactly maxAttempts attempts', async () => {
    redisService.incr.mockResolvedValue(5); // maxAttempts=5

    await expect(
      service.checkOrThrow('127.0.0.1', 'user@example.com'),
    ).resolves.toBeUndefined();
  });

  it('uses unknown as default IP when ipAddress is undefined', async () => {
    redisService.incr.mockResolvedValue(1);

    await service.checkOrThrow(undefined, 'user@example.com');
    expect(redisService.incr).toHaveBeenCalledWith(
      'rate_limit:login:unknown:user@example.com',
    );
  });

  it('sets expire only on first increment (incr returns 1)', async () => {
    redisService.incr.mockResolvedValue(1);

    await service.checkOrThrow('127.0.0.1', 'user@example.com');

    expect(redisService.expire).toHaveBeenCalledWith(
      'rate_limit:login:127.0.0.1:user@example.com',
      300,
    );
  });

  it('does not set expire on subsequent increments', async () => {
    redisService.incr.mockResolvedValue(3);

    await service.checkOrThrow('127.0.0.1', 'user@example.com');

    expect(redisService.expire).not.toHaveBeenCalled();
  });
});