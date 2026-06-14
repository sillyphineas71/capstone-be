import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { AuthAuditRepository } from '../repositories/auth-audit.repository';
import { Request } from 'express';

@Injectable()
export class LogoutService {
  private readonly logger = new Logger(LogoutService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly authAuditRepository: AuthAuditRepository,
  ) {}

  async logout(jti: string, exp: number): Promise<void> {
    const ttlMillis = exp * 1000 - Date.now();
    if (ttlMillis > 0) {
      try {
        const ttlSeconds = Math.ceil(ttlMillis / 1000);
        await this.redisService.setWithTtl(`blacklist:${jti}`, '1', ttlSeconds);
      } catch (error) {
        this.logger.error(
          `Failed to blacklist token: ${error.message}`,
          error.stack,
        );
        throw new InternalServerErrorException(
          'Cannot process logout at the moment',
        );
      }
    }
  }

  async logLogoutAudit(
    userId: string,
    jti: string,
    req: Request,
  ): Promise<void> {
    try {
      await this.authAuditRepository.logLogoutSuccess({
        userId,
        jti,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to insert audit log for logout: ${error.message}`,
        error.stack,
      );
    }
  }
}