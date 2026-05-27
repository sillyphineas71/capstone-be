import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './controllers/auth.controller';
import { LoginResponsePresenter } from './presenters/login-response.presenter';
import { AuthAuditRepository } from './repositories/auth-audit.repository';
import { AuthzReadRepository } from './repositories/authz-read.repository';
import { UsersAuthRepository } from './repositories/users-auth.repository';
import { UsersResetRepository } from './repositories/users-reset.repository';
import { ResetAuditRepository } from './repositories/reset-audit.repository';
import { AuthConfigService } from './services/auth-config.service';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { RateLimitService } from './services/rate-limit.service';
import { TokenService } from './services/token.service';
import { PasswordResetCacheService } from './services/password-reset-cache.service';
import { AuthEmailService } from './services/auth-email.service';
import { PasswordResetService } from './services/password-reset.service';

@Module({
  imports: [JwtModule.register({}), CacheModule.register()],
  controllers: [AuthController],
  providers: [
    AuthConfigService,
    RateLimitService,
    TokenService,
    LoginService,
    LogoutService,
    LoginResponsePresenter,
    UsersAuthRepository,
    AuthzReadRepository,
    AuthAuditRepository,
    UsersResetRepository,
    ResetAuditRepository,
    PasswordResetCacheService,
    AuthEmailService,
    PasswordResetService,
  ],
  exports: [
    AuthConfigService,
    RateLimitService,
    TokenService,
    LoginService,
    LogoutService,
    UsersAuthRepository,
    AuthzReadRepository,
    AuthAuditRepository,
    UsersResetRepository,
    ResetAuditRepository,
    PasswordResetCacheService,
    AuthEmailService,
    PasswordResetService,
  ],
})
export class AuthModule {}
