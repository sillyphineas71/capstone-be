import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { AuthConfigService } from './auth-config.service';
import { TokenService } from './token.service';

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  exp: number;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * RefreshTokenService — BE-01 (PA-1: stateless JWT + rotation qua Redis blacklist).
 *
 * Khong dung bang user_sessions (dung schema v3.2 Compact). Login phat access+refresh
 * cung mot jti (login.service.ts) nen blacklist jti cu o buoc 5 khai tu luon access
 * token cu, dung y do rotation.
 *
 * Residual da chap nhan: neu Redis down thi refresh fail-closed (401) vi khong doc
 * duoc blacklist — chon fail-closed thay vi fail-open de khong mo duong replay token.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authConfigService: AuthConfigService,
    private readonly redisService: RedisService,
    private readonly usersAuthRepository: UsersAuthRepository,
    private readonly tokenService: TokenService,
  ) {}

  async refresh(refreshToken: string): Promise<RefreshResult> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.authConfigService.getRefreshTokenSecret() },
      );
    } catch {
      // Gop chung sai chu ky / het han / malformed — khong tiet lo ly do cu the (SEC-02).
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID,
        message: 'Refresh token is invalid or expired.',
      });
    }

    const isRevoked = await this.redisService.exists(
      `blacklist:${payload.jti}`,
    );
    if (isRevoked) {
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.REFRESH_TOKEN_REVOKED,
        message: 'Refresh token has been revoked.',
      });
    }

    const user = await this.usersAuthRepository.findById(payload.sub);
    if (!user || user.accountStatus !== 'active') {
      // Khong phan biet "user khong ton tai" vs "user bi khoa" ra ngoai API (SEC-02).
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID,
        message: 'Refresh token is invalid or expired.',
      });
    }

    const newJti = randomUUID();
    const [newAccessToken, newRefreshToken] = await Promise.all([
      this.tokenService.generateAccessToken({
        sub: user.id,
        jti: newJti,
        email: user.email,
      }),
      this.tokenService.generateRefreshToken({ sub: user.id, jti: newJti }),
    ]);

    const ttlMillis = payload.exp * 1000 - Date.now();
    if (ttlMillis > 0) {
      try {
        const ttlSeconds = Math.ceil(ttlMillis / 1000);
        await this.redisService.setWithTtl(
          `blacklist:${payload.jti}`,
          '1',
          ttlSeconds,
        );
      } catch (error) {
        this.logger.error(
          `Failed to blacklist old jti during refresh: ${(error as Error).message}`,
          (error as Error).stack,
        );
        throw new UnauthorizedException({
          code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID,
          message: 'Cannot process refresh at the moment.',
        });
      }
    }

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.authConfigService.getAccessTokenTtlSeconds(),
    };
  }
}
