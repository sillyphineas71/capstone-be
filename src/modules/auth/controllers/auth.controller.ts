import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { LoginDto } from '../dto/login.dto';
import { LoginResponsePresenter } from '../presenters/login-response.presenter';
import { LoginService } from '../services/login.service';
import { hasOnlyAllowedLoginFields } from '../utils/login-normalization.util';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginService: LoginService,
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
}
