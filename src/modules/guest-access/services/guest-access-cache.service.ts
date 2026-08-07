import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';
import {
  GUEST_REDIS_KEYS,
  GuestLobbyStatus,
} from '../constants/guest-access.constants.js';
import { hashGuestInviteSecret } from '../utils/guest-invite-token.util.js';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';

/**
 * GuestAccessCacheService — toàn bộ thao tác Redis cho luồng khách ngoài công ty.
 *
 * Mirror `PasswordResetCacheService`. Bộ đếm (OTP sai/OTP gửi) BẮT BUỘC dùng
 * `INCR` (atomic) — KHÔNG lưu trong `metadata_json` (spec FR-GLA-042, tránh
 * race condition khi bị dò mã hàng loạt).
 */
@Injectable()
export class GuestAccessCacheService {
  constructor(
    private readonly redisService: RedisService,
    private readonly config: GuestAccessConfigService,
  ) {}

  // ── OTP session ──────────────────────────────────────────────────────────

  async setOtp(inviteId: string, otp: string): Promise<void> {
    const key = GUEST_REDIS_KEYS.otp(inviteId);
    await this.redisService.setWithTtl(
      key,
      hashGuestInviteSecret(otp),
      this.config.getOtpTtlSeconds(),
    );
  }

  async getOtpHash(inviteId: string): Promise<string | null> {
    return this.redisService.get(GUEST_REDIS_KEYS.otp(inviteId));
  }

  async deleteOtp(inviteId: string): Promise<void> {
    await this.redisService.del(GUEST_REDIS_KEYS.otp(inviteId));
  }

  /** Tăng bộ đếm nhập sai OTP (atomic). Trả về giá trị sau khi tăng. */
  async incrementOtpAttempt(inviteId: string): Promise<number> {
    const key = GUEST_REDIS_KEYS.otpAttempt(inviteId);
    const count = await this.redisService.incr(key);
    if (count === 1) {
      await this.redisService.expire(key, this.config.getOtpBlockSeconds());
    }
    return count;
  }

  async resetOtpAttempt(inviteId: string): Promise<void> {
    await this.redisService.del(GUEST_REDIS_KEYS.otpAttempt(inviteId));
  }

  /** Tăng bộ đếm yêu cầu gửi OTP (atomic). Trả về giá trị sau khi tăng. */
  async incrementOtpSendCount(inviteId: string): Promise<number> {
    const key = GUEST_REDIS_KEYS.otpSend(inviteId);
    const count = await this.redisService.incr(key);
    if (count === 1) {
      await this.redisService.expire(
        key,
        this.config.getOtpResendWindowSeconds(),
      );
    }
    return count;
  }

  async blockOtp(inviteId: string): Promise<void> {
    await this.redisService.setWithTtl(
      GUEST_REDIS_KEYS.otpBlocked(inviteId),
      '1',
      this.config.getOtpBlockSeconds(),
    );
  }

  async isOtpBlocked(inviteId: string): Promise<boolean> {
    return this.redisService.exists(GUEST_REDIS_KEYS.otpBlocked(inviteId));
  }

  // ── Phiên khách ───────────────────────────────────────────────────────────

  async setSession(jti: string, ttlSeconds: number): Promise<void> {
    await this.redisService.setJsonWithTtl(
      GUEST_REDIS_KEYS.session(jti),
      { createdAt: new Date().toISOString() },
      ttlSeconds,
    );
  }

  async markAttendanceLogged(jti: string): Promise<void> {
    const key = GUEST_REDIS_KEYS.session(jti);
    const ttl = await this.redisService.ttl(key);
    await this.redisService.setJsonWithTtl(
      key,
      { attendanceLogged: true },
      ttl > 0 ? ttl : this.config.getSessionMaxHours() * 3600,
    );
  }

  async hasAttendanceLogged(jti: string): Promise<boolean> {
    const data = await this.redisService.getJson<{
      attendanceLogged?: boolean;
    }>(GUEST_REDIS_KEYS.session(jti));
    return data?.attendanceLogged === true;
  }

  async revokeSession(jti: string, ttlSeconds: number): Promise<void> {
    await this.redisService.setWithTtl(
      GUEST_REDIS_KEYS.revoked(jti),
      '1',
      ttlSeconds,
    );
  }

  async isSessionRevoked(jti: string): Promise<boolean> {
    return this.redisService.exists(GUEST_REDIS_KEYS.revoked(jti));
  }

  async setCurrentJti(
    inviteId: string,
    jti: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redisService.setWithTtl(
      GUEST_REDIS_KEYS.inviteCurrentJti(inviteId),
      jti,
      ttlSeconds,
    );
  }

  async getCurrentJti(inviteId: string): Promise<string | null> {
    return this.redisService.get(GUEST_REDIS_KEYS.inviteCurrentJti(inviteId));
  }

  // ── Vô hiệu hóa theo lời mời (mirror auth:user:<id>:invalid_after) ────────

  async setInviteInvalidAfter(inviteId: string): Promise<void> {
    await this.redisService.setWithTtl(
      GUEST_REDIS_KEYS.inviteInvalidAfter(inviteId),
      String(Date.now()),
      24 * 3600,
    );
  }

  async getInviteInvalidAfter(inviteId: string): Promise<number | null> {
    const value = await this.redisService.get(
      GUEST_REDIS_KEYS.inviteInvalidAfter(inviteId),
    );
    return value !== null ? parseInt(value, 10) : null;
  }

  // ── Phòng chờ (lobby) ─────────────────────────────────────────────────────

  async addToLobby(meetingId: string, inviteId: string): Promise<void> {
    await this.redisService.sadd(GUEST_REDIS_KEYS.lobby(meetingId), inviteId);
    await this.redisService.set(
      GUEST_REDIS_KEYS.lobbyStatus(inviteId),
      GuestLobbyStatus.WAITING,
    );
  }

  async removeFromLobby(meetingId: string, inviteId: string): Promise<void> {
    await this.redisService.srem(GUEST_REDIS_KEYS.lobby(meetingId), inviteId);
  }

  async listLobby(meetingId: string): Promise<string[]> {
    return this.redisService.smembers(GUEST_REDIS_KEYS.lobby(meetingId));
  }

  async setLobbyStatus(
    inviteId: string,
    status: GuestLobbyStatus,
  ): Promise<void> {
    await this.redisService.set(GUEST_REDIS_KEYS.lobbyStatus(inviteId), status);
  }

  async getLobbyStatus(inviteId: string): Promise<GuestLobbyStatus | null> {
    const value = await this.redisService.get(
      GUEST_REDIS_KEYS.lobbyStatus(inviteId),
    );
    return value as GuestLobbyStatus | null;
  }

  // ── Ghi nhớ thiết bị (device remember, FR-GLA-026) ────────────────────────

  async rememberDevice(inviteId: string, deviceId: string): Promise<void> {
    await this.redisService.setWithTtl(
      GUEST_REDIS_KEYS.device(inviteId, deviceId),
      '1',
      this.config.getDeviceRememberDays() * 24 * 3600,
    );
  }

  async isDeviceRemembered(
    inviteId: string,
    deviceId: string,
  ): Promise<boolean> {
    return this.redisService.exists(
      GUEST_REDIS_KEYS.device(inviteId, deviceId),
    );
  }
}
