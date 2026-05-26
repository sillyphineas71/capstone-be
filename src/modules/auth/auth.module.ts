import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './controllers/auth.controller';
import { LoginResponsePresenter } from './presenters/login-response.presenter';
import { AuthAuditRepository } from './repositories/auth-audit.repository';
import { AuthzReadRepository } from './repositories/authz-read.repository';
import { UserSessionsRepository } from './repositories/user-sessions.repository';
import { UsersAuthRepository } from './repositories/users-auth.repository';
import { AuthConfigService } from './services/auth-config.service';
import { LoginService } from './services/login.service';
import { RateLimitService } from './services/rate-limit.service';
import { TokenService } from './services/token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthConfigService,
    RateLimitService,
    TokenService,
    LoginService,
    LoginResponsePresenter,
    UsersAuthRepository,
    AuthzReadRepository,
    UserSessionsRepository,
    AuthAuditRepository,
  ],
  exports: [
    AuthConfigService,
    RateLimitService,
    TokenService,
    LoginService,
    UsersAuthRepository,
    AuthzReadRepository,
    UserSessionsRepository,
    AuthAuditRepository,
  ],
})
export class AuthModule {}
