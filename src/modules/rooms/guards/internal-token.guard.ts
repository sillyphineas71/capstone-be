import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * InternalTokenGuard (NSC-001 / UC-41) — bảo vệ endpoint internal bằng shared-secret.
 *
 * SEC-01: token đọc từ env, so sánh constant-time, FAIL-CLOSED (env rỗng / sai → 401),
 * KHÔNG bao giờ log token. Header: `X-Internal-Token`.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, unknown>;
    }>();
    const expected = this.configService.get<string>(
      'NOSHOW_INTERNAL_TOKEN',
      '',
    );
    // Fail-closed: chưa cấu hình token → từ chối hết.
    if (!expected) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Internal endpoint not configured.',
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

  /** So sánh constant-time; khác độ dài → false (timingSafeEqual yêu cầu bằng độ dài). */
  private constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
