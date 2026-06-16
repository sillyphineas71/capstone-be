import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalApiGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiGuard.name);
  private readonly validApiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>('INTERNAL_API_KEY');
    if (!key) {
      this.logger.warn(
        'INTERNAL_API_KEY is not configured. All internal endpoints will be blocked until the key is set.',
      );
    }
    this.validApiKey = key;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.validApiKey) {
      throw new UnauthorizedException({
        message: 'Internal API is not configured on this server',
        error: 'INTERNAL_API_NOT_CONFIGURED',
      });
    }

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException({
        message: 'Missing X-API-Key header',
        error: 'MISSING_API_KEY',
      });
    }

    if (apiKey !== this.validApiKey) {
      throw new UnauthorizedException({
        message: 'Invalid API key',
        error: 'INVALID_API_KEY',
      });
    }

    return true;
  }
}

