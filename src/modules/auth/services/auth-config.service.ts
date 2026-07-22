import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthConfigService {
  constructor(private readonly configService: ConfigService) {}

  getAccessTokenTtlSeconds(): number {
    return this.configService.get<number>(
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
      60 * 180,
    );
  }

  getAccessTokenSecret(): string {
    return this.configService.get<string>('AUTH_ACCESS_TOKEN_SECRET', 'secret');
  }

  getRefreshTokenTtlSeconds(): number {
    return this.configService.get<number>(
      'AUTH_REFRESH_TOKEN_TTL_SECONDS',
      60 * 60 * 24 * 30,
    );
  }

  getRateLimitMaxAttempts(): number {
    return this.configService.get<number>(
      'AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
      5,
    );
  }

  getRateLimitWindowSeconds(): number {
    return this.configService.get<number>(
      'AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS',
      300,
    );
  }
}
