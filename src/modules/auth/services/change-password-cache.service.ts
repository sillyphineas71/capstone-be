import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

/**
 * Redis TTL constants for change-password rate-limiting.
 * 15 minutes expressed in milliseconds.
 */
const RATE_LIMIT_TTL_MS = 15 * 60 * 1000; // 900_000 ms
const MAX_FAILED_ATTEMPTS = 5;

@Injectable()
export class ChangePasswordCacheService {
  private readonly logger = new Logger(ChangePasswordCacheService.name);

  private readonly FAILED_PREFIX = 'change_password:failed:';
  private readonly BLOCK_PREFIX = 'change_password:block:';

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  /**
   * Returns true if the user is currently blocked from attempting a password change.
   * Fail-closed: if Redis is unavailable, throws InternalServerErrorException.
   */
  async isBlocked(userId: string): Promise<boolean> {
    try {
      const key = `${this.BLOCK_PREFIX}${userId}`;
      const value = await this.cacheManager.get(key);
      return value != null;
    } catch (error) {
      this.logger.error(
        `[ChangePasswordCache] Failed to check block status for user ${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to check rate-limit block status',
      );
    }
  }

  /**
   * Increments the failed-attempt counter for a user and resets the TTL.
   * If the key does not exist yet (first failure), initialises it to 1.
   *
   * Returns the new counter value after incrementing.
   */
  async incrementFailedCounter(userId: string): Promise<number> {
    try {
      const key = `${this.FAILED_PREFIX}${userId}`;

      // Read current value (returns null / undefined if key absent)
      const raw = await this.cacheManager.get<number | string>(key);
      const current =
        raw == null ? 0 : typeof raw === 'string' ? parseInt(raw, 10) : raw;

      const next = current + 1;
      // Always reset TTL on each increment (sliding window)
      await this.cacheManager.set(key, next, RATE_LIMIT_TTL_MS);
      return next;
    } catch (error) {
      this.logger.error(
        `[ChangePasswordCache] Failed to increment failed counter for user ${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to update rate-limit counter',
      );
    }
  }

  /**
   * Sets the block flag for a user, preventing further change-password attempts
   * for RATE_LIMIT_TTL_MS (15 minutes).
   */
  async setBlockFlag(userId: string): Promise<void> {
    try {
      const key = `${this.BLOCK_PREFIX}${userId}`;
      await this.cacheManager.set(key, 'true', RATE_LIMIT_TTL_MS);
    } catch (error) {
      this.logger.error(
        `[ChangePasswordCache] Failed to set block flag for user ${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException(
        'Failed to set rate-limit block flag',
      );
    }
  }

  /** Exposed for testing purposes. */
  get maxFailedAttempts(): number {
    return MAX_FAILED_ATTEMPTS;
  }
}
