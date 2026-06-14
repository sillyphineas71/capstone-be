import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface WarningItem {
  type: string;
  message: string;
}

interface WarningTokenPayload {
  sub: string;
  meetingId: string;
  userId: string;
  warnings: WarningItem[];
  iat: number;
  exp: number;
}

interface VerifyResult {
  valid: boolean;
  warnings?: WarningItem[];
}

@Injectable()
export class WarningTokenUtil {
  private readonly secret: string;
  private readonly ttlSeconds = 300;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.secret =
      this.configService.get<string>('WARNING_TOKEN_SECRET') ??
      'fallback-warning-secret';
  }

  generateToken(
    meetingId: string,
    userId: string,
    warnings: WarningItem[],
  ): string {
    const payload: Partial<WarningTokenPayload> = {
      sub: 'warning:meet-add-participant',
      meetingId,
      userId,
      warnings,
    };

    return this.jwtService.sign(payload, {
      secret: this.secret,
      expiresIn: this.ttlSeconds,
    });
  }

  verifyToken(token: string, meetingId: string, userId: string): VerifyResult {
    try {
      const payload = this.jwtService.verify<WarningTokenPayload>(token, {
        secret: this.secret,
      });

      if (
        payload.meetingId !== meetingId ||
        payload.userId !== userId ||
        payload.sub !== 'warning:meet-add-participant'
      ) {
        return { valid: false };
      }

      return { valid: true, warnings: payload.warnings ?? [] };
    } catch {
      return { valid: false };
    }
  }
}
