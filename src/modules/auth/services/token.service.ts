import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { AuthConfigService } from './auth-config.service';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authConfigService: AuthConfigService,
  ) {}

  async generateAccessToken(payload: { sub: string; jti: string; email: string }): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.authConfigService.getAccessTokenSecret(),
      expiresIn: this.authConfigService.getAccessTokenTtlSeconds(),
    });
  }

  async generateRefreshToken(payload: { sub: string; jti: string }): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: process.env.AUTH_REFRESH_TOKEN_SECRET ?? 'dev-refresh-secret',
      expiresIn: this.authConfigService.getRefreshTokenTtlSeconds(),
    });
  }

  hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }
}
