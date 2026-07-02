import { Injectable } from '@nestjs/common';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';
import { AuthConfigService } from './auth-config.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RateLimitService {
  private readonly PREFIX = 'rate_limit:login:';

  constructor(
    private readonly authConfigService: AuthConfigService,
    private readonly redisService: RedisService,
  ) {}

  async checkOrThrow(
    ipAddress: string | undefined,
    email: string,
  ): Promise<void> {
    const maxAttempts = this.authConfigService.getRateLimitMaxAttempts();
    const windowSeconds = this.authConfigService.getRateLimitWindowSeconds();
    const key = `${this.PREFIX}${ipAddress ?? 'unknown'}:${email}`;

    const current = await this.redisService.incr(key);
    if (current === 1) {
      await this.redisService.expire(key, windowSeconds);
    }

    if (current > maxAttempts) {
      const error = new Error(AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS);
      error.name = AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS;
      throw error;
    }
  }
}
