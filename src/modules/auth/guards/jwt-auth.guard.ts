import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../../redis/redis.service';
import { AuthConfigService } from '../services/auth-config.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authConfigService: AuthConfigService,
    private readonly redisService: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Token not found');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.authConfigService.getAccessTokenSecret(),
      });

      if (payload.jti) {
        const ignoreBlacklist = this.reflector.get<boolean>(
          'ignoreBlacklist',
          context.getHandler(),
        );
        if (!ignoreBlacklist) {
          const isBlacklisted = await this.redisService.exists(
            `blacklist:${payload.jti}`,
          );
          if (isBlacklisted) {
            throw new UnauthorizedException('Token has been revoked');
          }
        }
      }

      if (payload.sub) {
        const invalidAfterKey = `auth:user:${payload.sub}:invalid_after`;
        const invalidAfter = await this.redisService.get(invalidAfterKey);
        if (invalidAfter !== null) {
          const invalidAfterMs = parseInt(invalidAfter, 10);
          if (payload.iat * 1000 < invalidAfterMs) {
            throw new UnauthorizedException(
              'Token has been revoked due to password change',
            );
          }
        }
      }

      request['user'] = {
        userId: payload.sub,
        jti: payload.jti,
        exp: payload.exp,
        ...payload,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}