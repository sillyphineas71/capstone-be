import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * GuestAccessConfigService — đọc toàn bộ config env cho luồng khách ngoài công ty.
 *
 * Mirror `AuthConfigService`. Không đọc `system_configs` ở đây (đó là việc của
 * `GuestLobbyService.resolveLobbyEnabled()` — feature flag theo runtime, khác
 * với các TTL/secret cố định theo deployment ở đây).
 */
@Injectable()
export class GuestAccessConfigService {
  constructor(private readonly configService: ConfigService) {}

  getGuestTokenSecret(): string {
    return this.configService.get<string>('GUEST_TOKEN_SECRET', 'secret');
  }

  getSessionMaxHours(): number {
    return this.configService.get<number>('GUEST_ACCESS_SESSION_MAX_HOURS', 4);
  }

  getOtpTtlSeconds(): number {
    return this.configService.get<number>('GUEST_ACCESS_OTP_TTL_SECONDS', 600);
  }

  getOtpMaxResends(): number {
    return this.configService.get<number>('GUEST_ACCESS_OTP_MAX_RESENDS', 3);
  }

  getOtpResendWindowSeconds(): number {
    return this.configService.get<number>(
      'GUEST_ACCESS_OTP_RESEND_WINDOW_SECONDS',
      300,
    );
  }

  getOtpMaxVerifyAttempts(): number {
    return this.configService.get<number>(
      'GUEST_ACCESS_OTP_MAX_VERIFY_ATTEMPTS',
      5,
    );
  }

  getOtpBlockSeconds(): number {
    return this.configService.get<number>(
      'GUEST_ACCESS_OTP_BLOCK_SECONDS',
      900,
    );
  }

  getJoinWindowBeforeMinutes(): number {
    return this.configService.get<number>(
      'GUEST_ACCESS_JOIN_WINDOW_BEFORE_MINUTES',
      30,
    );
  }

  getJoinWindowAfterMinutes(): number {
    return this.configService.get<number>(
      'GUEST_ACCESS_JOIN_WINDOW_AFTER_MINUTES',
      15,
    );
  }

  getInviteLinkTtlHours(): number {
    return this.configService.get<number>(
      'GUEST_ACCESS_INVITE_LINK_TTL_HOURS',
      24,
    );
  }

  getInviteBaseUrl(): string {
    return this.configService.get<string>(
      'GUEST_ACCESS_INVITE_BASE_URL',
      'http://localhost:5173/guest/join',
    );
  }

  getDeviceRememberDays(): number {
    return this.configService.get<number>(
      'GUEST_ACCESS_DEVICE_REMEMBER_DAYS',
      30,
    );
  }

  getLobbyEnabledDefault(): boolean {
    return this.configService.get<boolean>(
      'GUEST_ACCESS_LOBBY_ENABLED_DEFAULT',
      true,
    );
  }

  getVerificationModeDefault(): 'otp' | 'magic_click' {
    return this.configService.get<'otp' | 'magic_click'>(
      'GUEST_ACCESS_VERIFICATION_MODE_DEFAULT',
      'otp',
    );
  }
}
