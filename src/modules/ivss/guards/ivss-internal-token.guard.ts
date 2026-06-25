import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * IvssInternalTokenGuard (IVS-001 #36) — bảo vệ webhook IVSS bằng shared-secret.
 *
 * R1/OQ-2: 1 secret `IVSS_BRIDGE_TOKEN` (cùng dùng cho client outbound). Header `X-Internal-Token`,
 * so sánh constant-time, FAIL-CLOSED (env rỗng / sai → 401), KHÔNG log token.
 * File riêng — KHÔNG sửa InternalTokenGuard của no-show.
 */
@Injectable()
export class IvssInternalTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, unknown>;
    }>();
    const expected = this.configService.get<string>('IVSS_BRIDGE_TOKEN', '');
    if (!expected) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'IVSS webhook not configured.',
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
