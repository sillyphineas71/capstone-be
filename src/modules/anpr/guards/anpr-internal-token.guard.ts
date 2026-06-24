import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * AnprInternalTokenGuard (VWH-001 / UC4) — bảo vệ webhook vehicle bằng shared-secret.
 *
 * OQ-1: dùng CÙNG env `IVSS_BRIDGE_TOKEN` (một bridge IVSS gửi cả face + vehicle event).
 * Header `X-Internal-Token`, so sánh constant-time, FAIL-CLOSED (env rỗng/thiếu/sai → 401),
 * KHÔNG log token, KHÔNG JWT. File riêng trong anpr — KHÔNG import IvssInternalTokenGuard
 * cross-module (giữ anpr độc lập, không phụ thuộc IvssModule).
 */
@Injectable()
export class AnprInternalTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, unknown>;
    }>();
    const expected = this.configService.get<string>('IVSS_BRIDGE_TOKEN', '');
    if (!expected) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Vehicle webhook not configured.',
      });
    }
    const provided = req.headers['x-internal-token'];
    if (
      typeof provided !== 'string' ||
      !this.constantTimeEqual(provided, expected)
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid internal token.',
      });
    }
    return true;
  }

  /** So sánh constant-time; khác độ dài → false. */
  private constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
