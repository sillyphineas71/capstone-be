import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';
import { LoginDto } from '../dto/login.dto';
import { AuthAuditRepository } from '../repositories/auth-audit.repository';
import { AuthzReadRepository } from '../repositories/authz-read.repository';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { AvatarStatusRawRepository } from '../repositories/avatar-status-raw.repository';
import { resolveAvatarReviewStatus } from '../../../common/utils/avatar-status-resolver.util';
import {
  AuthUserSummary,
  LoginSuccessData,
  RequestContextInfo,
} from '../types/login.types';
import { normalizeLoginEmail } from '../utils/login-normalization.util';
import { AuthConfigService } from './auth-config.service';
import { RateLimitService } from './rate-limit.service';
import { TokenService } from './token.service';

@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  constructor(
    private readonly usersAuthRepository: UsersAuthRepository,
    private readonly authzReadRepository: AuthzReadRepository,
    private readonly authAuditRepository: AuthAuditRepository,
    private readonly rateLimitService: RateLimitService,
    private readonly tokenService: TokenService,
    private readonly authConfigService: AuthConfigService,
    private readonly avatarStatusRawRepository: AvatarStatusRawRepository,
  ) {}

  async login(
    loginDto: LoginDto,
    requestContext: RequestContextInfo,
  ): Promise<LoginSuccessData> {
    const normalizedEmail = normalizeLoginEmail(loginDto.email);

    try {
      await this.rateLimitService.checkOrThrow(
        requestContext.ipAddress,
        normalizedEmail,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS
      ) {
        throw new HttpException(
          {
            code: AUTH_ERROR_CODES.AUTH_TOO_MANY_ATTEMPTS,
            message: 'Too many login attempts.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw error;
    }

    const user =
      await this.usersAuthRepository.findByNormalizedEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    const passwordMatched = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );
    if (!passwordMatched) {
      throw new UnauthorizedException({
        code: AUTH_ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        message: 'Invalid credentials.',
      });
    }

    switch (user.accountStatus) {
      case 'active':
        break;
      case 'inactive':
        throw new ForbiddenException({
          code: AUTH_ERROR_CODES.AUTH_ACCOUNT_INACTIVE,
          message: 'Account is inactive.',
        });
      case 'locked':
        throw new HttpException(
          {
            code: AUTH_ERROR_CODES.AUTH_ACCOUNT_LOCKED,
            message: 'Account is locked.',
          },
          HttpStatus.LOCKED,
        );
      default:
        throw new ForbiddenException({
          code: AUTH_ERROR_CODES.AUTH_ACCOUNT_STATUS_NOT_ALLOWED,
          message: 'Account status is not allowed for login.',
        });
    }

    const jti = randomUUID();
    let accessToken: string;
    let refreshToken: string;

    try {
      accessToken = await this.tokenService.generateAccessToken({
        sub: user.id,
        jti,
        email: user.email,
      });
      refreshToken = await this.tokenService.generateRefreshToken({
        sub: user.id,
        jti,
      });
    } catch (error) {
      this.logger.error(
        'Token generation failed.',
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException({
        code: AUTH_ERROR_CODES.AUTH_TOKEN_GENERATION_FAILED,
        message: 'Failed to generate authentication tokens.',
      });
    }

    const authz =
      await this.authzReadRepository.getEffectiveRolesAndPermissions(user.id);

    try {
      await this.usersAuthRepository.updateLastLoginAt(user.id, new Date());
    } catch (error) {
      this.logger.error(
        'Failed to update last_login_at.',
        error instanceof Error ? error.stack : undefined,
      );
    }

    try {
      await this.authAuditRepository.logLoginSuccess({
        userId: user.id,
        requestId: requestContext.requestId,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        jti,
      });
    } catch (error) {
      this.logger.error(
        'Failed to write login audit log.',
        error instanceof Error ? error.stack : undefined,
      );
    }

    // ACCT-AVATAR-SUBMIT-001 (BR-016): tính trạng thái avatar cho login response.
    // Resilient: lỗi đọc avatar status KHÔNG làm fail login (avatar không chặn đăng nhập).
    let avatarReview = {
      avatarReviewStatus: 'not_uploaded' as const,
      avatarRequired: true,
      shouldShowAvatarPopup: true,
    } as ReturnType<typeof resolveAvatarReviewStatus>;
    try {
      const rows = await this.avatarStatusRawRepository.getFaceProfileRows(
        user.id,
      );
      avatarReview = resolveAvatarReviewStatus(rows);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve avatar review status for user ${user.id}; defaulting to not_uploaded.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    const summary: AuthUserSummary = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      avatarReviewStatus: avatarReview.avatarReviewStatus,
      avatarRequired: avatarReview.avatarRequired,
      shouldShowAvatarPopup: avatarReview.shouldShowAvatarPopup,
      departmentId: user.departmentId,
      roles: authz.roles,
      permissions: authz.permissions,
    };

    return {
      accessToken,
      refreshToken,
      expiresIn: this.authConfigService.getAccessTokenTtlSeconds(),
      user: summary,
    };
  }
}
