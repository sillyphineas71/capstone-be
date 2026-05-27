import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, Req, SetMetadata, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiUnauthorizedResponse, ApiInternalServerErrorResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { LoginDto } from '../dto/login.dto';
import { LogoutResponseDto } from '../dto/logout-response.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { LoginResponsePresenter } from '../presenters/login-response.presenter';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { hasOnlyAllowedLoginFields } from '../utils/login-normalization.util';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginService: LoginService,
    private readonly logoutService: LogoutService,
    private readonly loginResponsePresenter: LoginResponsePresenter,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async login(
    @Body() loginDto: LoginDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('x-request-id') requestId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const rawBody = request.body as Record<string, unknown>;
    if (!hasOnlyAllowedLoginFields(rawBody)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body contains unsupported fields.',
          details: [],
          requestId,
        },
      };
    }

    const result = await this.loginService.login(loginDto, {
      ipAddress,
      requestId,
      userAgent,
    });

    return this.loginResponsePresenter.success(result);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @SetMetadata('ignoreBlacklist', true)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout', description: 'Invalidates the current session token' })
  @ApiResponse({ status: 200, description: 'Logout successful', type: LogoutResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized / Token invalid' })
  @ApiInternalServerErrorResponse({ description: 'Internal server error (e.g., Redis issue)' })
  async logout(@Req() request: Request): Promise<{ success: boolean; message: string; data: LogoutResponseDto }> {
    const user = request['user'] as { userId: string; jti: string; exp: number };
    
    // Blacklist the token
    await this.logoutService.logout(user.jti, user.exp);
    
    // Fire-and-forget audit logging
    this.logoutService.logLogoutAudit(user.userId, user.jti, request).catch(() => {});

    return {
      success: true,
      message: 'Logout successful',
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    };
  }
}
