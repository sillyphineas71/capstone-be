import { Injectable } from '@nestjs/common';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';
import { AuthConfigService } from './auth-config.service';

@Injectable()
export class RateLimitService {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly authConfigService: AuthConfigService) {}

  checkOrThrow(ipAddress: string | undefined, email: string): void {
    const maxAttempts = this.authConfigService.getRateLimitMaxAttempts();
    const windowSeconds = this.authConfigService.getRateLimitWindowSeconds();
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    const key = `${ipAddress ?? 'unknown'}:${email}`;
    const currentAttempts = (this.attempts.get(key) ?? []).filter(
      (timestamp) => timestamp >= windowStart,
    );

    if (currentAttempts.length >= maxAttempts) {
      const error = new Error(AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS);
      error.name = AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS;
      throw error;
    }

    currentAttempts.push(now);
    this.attempts.set(key, currentAttempts);
  }
}
