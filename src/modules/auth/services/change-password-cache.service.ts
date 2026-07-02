import {Injectable,InternalServerErrorException,Logger,} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

const RATE_LIMIT_TTL_MS = 15 * 60 * 1000; // 900_000 ms
const MAX_FAILED_ATTEMPTS = 5;

@Injectable()
export class ChangePasswordCacheService {
  private readonly logger = new Logger(ChangePasswordCacheService.name);

  private readonly FAILED_PREFIX = 'change_password:failed:';
  private readonly BLOCK_PREFIX = 'change_password:block:';

  constructor(private readonly redisService: RedisService) {}

  async isBlocked(userId: string): Promise<boolean> {
    try {
      const key = `${this.BLOCK_PREFIX}${userId}`;
      return this.redisService.exists(key);
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

  async incrementFailedCounter(userId: string): Promise<number> {
    try {
      const key = `${this.FAILED_PREFIX}${userId}`;
      const ttlSeconds = Math.ceil(RATE_LIMIT_TTL_MS / 1000);
      const nextVal = await this.redisService.incr(key);
      await this.redisService.expire(key, ttlSeconds);
      return nextVal;
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

  async setBlockFlag(userId: string): Promise<void> {
    try {
      const key = `${this.BLOCK_PREFIX}${userId}`;
      const ttlSeconds = Math.ceil(RATE_LIMIT_TTL_MS / 1000);
      await this.redisService.setWithTtl(key, '1', ttlSeconds);
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

  get maxFailedAttempts(): number {
    return MAX_FAILED_ATTEMPTS;
  }
}
