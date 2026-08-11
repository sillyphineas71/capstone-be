import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import { ALLOW_PARTNER_ACCOUNT_KEY } from '../../../common/decorators/allow-partner-account.decorator.js';
import { isPartnerAccountByUserId } from '../../../common/utils/partner-account.util.js';

@Injectable()
export class PartnerAccountRestrictionGuard implements CanActivate {
  private readonly logger = new Logger(PartnerAccountRestrictionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const user = request['user'] as { userId?: string } | undefined;
    if (!user?.userId) {
      return true;
    }

    let isPartner: boolean;
    try {
      isPartner = await isPartnerAccountByUserId(
        user.userId,
        this.dataSource,
      );
    } catch (error) {
      // Fail-closed có chủ đích: khác BiometricEnforcementGuard/MustChangePasswordGuard
      // (fail-open vì chỉ nới lỏng 1 yêu cầu tuân thủ), guard này là ranh giới phân quyền
      // giữa tài khoản đối tác và toàn bộ API nội bộ — nếu fail-open, lỗi DB tạm thời sẽ
      // vô tình mở toang quyền truy cập cho tài khoản đối tác. Chấp nhận việc user thường
      // cũng bị 503 trong đúng khoảnh khắc DB lỗi (khi đó JwtAuthGuard/PermissionsGuard
      // vốn cũng đã cần DB nên hệ thống khó hoạt động bình thường được).
      this.logger.error(
        `[PartnerAccountRestrictionGuard] DB lookup failed for user ${user.userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new ServiceUnavailableException({
        success: false,
        message:
          'Không thể xác minh quyền truy cập lúc này. Vui lòng thử lại sau.',
        error: { code: 'PARTNER_ACCOUNT_CHECK_UNAVAILABLE', details: {} },
      });
    }

    if (!isPartner) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PARTNER_ACCOUNT_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!allowed) {
      this.logger.warn(
        `[PartnerAccountRestrictionGuard] Blocked partner account ${user.userId} from ${request.method} ${request.path}`,
      );
      throw new ForbiddenException({
        success: false,
        message: 'Tài khoản đối tác không được phép truy cập chức năng này.',
        error: { code: 'PARTNER_ACCOUNT_RESTRICTED', details: {} },
      });
    }

    return true;
  }
}