import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthzReadRepository } from '../repositories/authz-read.repository.js';
import { ROLES_KEY } from '../decorators/require-roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authzRepo: AuthzReadRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request['user'] as { userId?: string } | undefined;

    if (!user || !user.userId) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: { code: 'FORBIDDEN', details: {} },
      });
    }

    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      user.userId,
    );

    const hasRequiredRole = roles.some((role) => requiredRoles.includes(role));

    if (!hasRequiredRole) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: { code: 'FORBIDDEN', details: {} },
      });
    }

    return true;
  }
}
