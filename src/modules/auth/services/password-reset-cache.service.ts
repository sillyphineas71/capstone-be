import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PasswordResetOtpSession } from '../types/password-reset.types';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class PasswordResetCacheService {
  private readonly logger = new Logger(PasswordResetCacheService.name);

  private readonly OTP_PREFIX = 'otp:password_reset:';
  private readonly LIMIT_PREFIX = 'otp_limit:password_reset:';
  private readonly BLOCK_PREFIX = 'otp_blocked:password_reset:';

  constructor(private readonly redisService: RedisService) {}

  async getOtpSession(email: string): Promise<PasswordResetOtpSession | null> {
    try {
      const key = `${this.OTP_PREFIX}${email}`;
      return await this.redisService.getJson<PasswordResetOtpSession>(key);
    } catch (error) {
      this.logger.error(
        `Error getting OTP session for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve OTP session from cache',
      );
    }
  }

  async setOtpSession(
    email: string,
    session: PasswordResetOtpSession,
    ttlMs: number,
  ): Promise<void> {
    try {
      const key = `${this.OTP_PREFIX}${email}`;
      const ttlSeconds = Math.ceil(ttlMs / 1000);
      await this.redisService.setJsonWithTtl(key, session, ttlSeconds);
    } catch (error) {
      this.logger.error(
        `Error setting OTP session for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to save OTP session to cache',
      );
    }
  }

  async deleteOtpSession(email: string): Promise<void> {
    try {
      const key = `${this.OTP_PREFIX}${email}`;
      await this.redisService.del(key);
    } catch (error) {
      this.logger.error(
        `Error deleting OTP session for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to delete OTP session from cache',
      );
    }
  }

  async getLimitCounter(email: string): Promise<number> {
    try {
      const key = `${this.LIMIT_PREFIX}${email}`;
      const count = await this.redisService.get(key);
      return count !== null ? parseInt(count, 10) : 0;
    } catch (error) {
      this.logger.error(
        `Error getting limit counter for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve rate limit state',
      );
    }
  }

  async incrementLimitCounter(email: string, ttlMs: number): Promise<number> {
    try {
      const key = `${this.LIMIT_PREFIX}${email}`;
      const ttlSeconds = Math.ceil(ttlMs / 1000);
      const nextVal = await this.redisService.incr(key);
      await this.redisService.expire(key, ttlSeconds);
      return nextVal;
    } catch (error) {
      this.logger.error(
        `Error incrementing limit counter for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to update rate limit state',
      );
    }
  }

  async deleteLimitCounter(email: string): Promise<void> {
    try {
      const key = `${this.LIMIT_PREFIX}${email}`;
      await this.redisService.del(key);
    } catch (error) {
      this.logger.error(
        `Error deleting limit counter for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to delete rate limit state',
      );
    }
  }

  async isBlocked(email: string): Promise<boolean> {
    try {
      const key = `${this.BLOCK_PREFIX}${email}`;
      return await this.redisService.exists(key);
    } catch (error) {
      this.logger.error(
        `Error checking block status for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to check spam block status',
      );
    }
  }

  async blockEmail(email: string, ttlMs: number): Promise<void> {
    try {
      const key = `${this.BLOCK_PREFIX}${email}`;
      const ttlSeconds = Math.ceil(ttlMs / 1000);
      await this.redisService.setWithTtl(key, '1', ttlSeconds);
    } catch (error) {
      this.logger.error(
        `Error blocking email ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to block email');
    }
  }

  async deleteBlockKey(email: string): Promise<void> {
    try {
      const key = `${this.BLOCK_PREFIX}${email}`;
      await this.redisService.del(key);
    } catch (error) {
      this.logger.error(
        `Error deleting block key for ${email}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to release block key');
    }
  }

  async invalidateUserTokens(userId: string, ttlMs: number): Promise<void> {
    try {
      const key = `auth:user:${userId}:invalid_after`;
      const ttlSeconds = Math.ceil(ttlMs / 1000);
      await this.redisService.setWithTtl(key, String(Date.now()), ttlSeconds);
    } catch (error) {
      this.logger.error(
        `Error invalidating user tokens for ${userId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to set token invalidation marker',
      );
    }
  }
}
