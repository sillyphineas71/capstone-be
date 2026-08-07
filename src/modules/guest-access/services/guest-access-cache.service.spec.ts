import { Test, TestingModule } from '@nestjs/testing';
import { GuestAccessCacheService } from './guest-access-cache.service';
import { RedisService } from '../../redis/redis.service';
import { GuestAccessConfigService } from '../config/guest-access-config.service';
import { GuestLobbyStatus } from '../constants/guest-access.constants';

describe('GuestAccessCacheService', () => {
  let service: GuestAccessCacheService;
  let redis: Partial<Record<keyof RedisService, jest.Mock>>;
  let config: Partial<Record<keyof GuestAccessConfigService, jest.Mock>>;

  beforeEach(async () => {
    redis = {
      get: jest.fn(),
      getJson: jest.fn(),
      set: jest.fn(),
      setWithTtl: jest.fn(),
      setJsonWithTtl: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      sadd: jest.fn(),
      srem: jest.fn(),
      smembers: jest.fn(),
    };
    config = {
      getOtpTtlSeconds: jest.fn().mockReturnValue(600),
      getOtpBlockSeconds: jest.fn().mockReturnValue(900),
      getOtpResendWindowSeconds: jest.fn().mockReturnValue(300),
      getSessionMaxHours: jest.fn().mockReturnValue(4),
      getDeviceRememberDays: jest.fn().mockReturnValue(30),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestAccessCacheService,
        { provide: RedisService, useValue: redis },
        { provide: GuestAccessConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(GuestAccessCacheService);
  });

  describe('OTP session', () => {
    it('setOtp should hash the otp before storing with TTL', async () => {
      await service.setOtp('invite-1', '123456');
      expect(redis.setWithTtl).toHaveBeenCalledWith(
        'guest:otp:invite-1',
        expect.stringMatching(/^[0-9a-f]{64}$/),
        600,
      );
    });

    it('getOtpHash should read from the correct key', async () => {
      (redis.get as jest.Mock).mockResolvedValue('hash-value');
      const result = await service.getOtpHash('invite-1');
      expect(redis.get).toHaveBeenCalledWith('guest:otp:invite-1');
      expect(result).toBe('hash-value');
    });

    it('deleteOtp should delete the correct key', async () => {
      await service.deleteOtp('invite-1');
      expect(redis.del).toHaveBeenCalledWith('guest:otp:invite-1');
    });
  });

  describe('OTP attempt counter (atomic)', () => {
    it('should INCR and set expiry only on first attempt', async () => {
      (redis.incr as jest.Mock).mockResolvedValue(1);
      const count = await service.incrementOtpAttempt('invite-1');
      expect(count).toBe(1);
      expect(redis.expire).toHaveBeenCalledWith(
        'guest:otp_attempt:invite-1',
        900,
      );
    });

    it('should NOT reset expiry on subsequent attempts', async () => {
      (redis.incr as jest.Mock).mockResolvedValue(2);
      const count = await service.incrementOtpAttempt('invite-1');
      expect(count).toBe(2);
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('resetOtpAttempt should delete the counter key', async () => {
      await service.resetOtpAttempt('invite-1');
      expect(redis.del).toHaveBeenCalledWith('guest:otp_attempt:invite-1');
    });
  });

  describe('OTP send counter (rate-limit)', () => {
    it('should INCR and set expiry only on first send', async () => {
      (redis.incr as jest.Mock).mockResolvedValue(1);
      await service.incrementOtpSendCount('invite-1');
      expect(redis.expire).toHaveBeenCalledWith('guest:otp_send:invite-1', 300);
    });
  });

  describe('OTP block', () => {
    it('blockOtp should set the blocked flag with TTL', async () => {
      await service.blockOtp('invite-1');
      expect(redis.setWithTtl).toHaveBeenCalledWith(
        'guest:otp_blocked:invite-1',
        '1',
        900,
      );
    });

    it('isOtpBlocked should check existence of the blocked key', async () => {
      (redis.exists as jest.Mock).mockResolvedValue(true);
      const blocked = await service.isOtpBlocked('invite-1');
      expect(redis.exists).toHaveBeenCalledWith('guest:otp_blocked:invite-1');
      expect(blocked).toBe(true);
    });
  });

  describe('Session revocation', () => {
    it('revokeSession should set the revoked flag with TTL', async () => {
      await service.revokeSession('jti-1', 3600);
      expect(redis.setWithTtl).toHaveBeenCalledWith(
        'guest:revoked:jti-1',
        '1',
        3600,
      );
    });

    it('isSessionRevoked should check the revoked key', async () => {
      (redis.exists as jest.Mock).mockResolvedValue(false);
      const revoked = await service.isSessionRevoked('jti-1');
      expect(revoked).toBe(false);
    });
  });

  describe('Invite invalid_after (mirror auth:user:<id>:invalid_after)', () => {
    it('setInviteInvalidAfter should store current timestamp with 24h TTL', async () => {
      await service.setInviteInvalidAfter('invite-1');
      expect(redis.setWithTtl).toHaveBeenCalledWith(
        'guest:invite:invite-1:invalid_after',
        expect.stringMatching(/^\d+$/),
        24 * 3600,
      );
    });

    it('getInviteInvalidAfter should return null when not set', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);
      const result = await service.getInviteInvalidAfter('invite-1');
      expect(result).toBeNull();
    });

    it('getInviteInvalidAfter should parse the stored timestamp', async () => {
      (redis.get as jest.Mock).mockResolvedValue('1234567890');
      const result = await service.getInviteInvalidAfter('invite-1');
      expect(result).toBe(1234567890);
    });
  });

  describe('Lobby (Redis SET)', () => {
    it('addToLobby should SADD and set status to waiting', async () => {
      await service.addToLobby('meeting-1', 'invite-1');
      expect(redis.sadd).toHaveBeenCalledWith(
        'guest:lobby:meeting-1',
        'invite-1',
      );
      expect(redis.set).toHaveBeenCalledWith(
        'guest:lobby:status:invite-1',
        GuestLobbyStatus.WAITING,
      );
    });

    it('removeFromLobby should SREM the member', async () => {
      await service.removeFromLobby('meeting-1', 'invite-1');
      expect(redis.srem).toHaveBeenCalledWith(
        'guest:lobby:meeting-1',
        'invite-1',
      );
    });

    it('listLobby should return SMEMBERS result', async () => {
      (redis.smembers as jest.Mock).mockResolvedValue(['a', 'b']);
      const result = await service.listLobby('meeting-1');
      expect(result).toEqual(['a', 'b']);
    });

    it('setLobbyStatus / getLobbyStatus should round-trip', async () => {
      await service.setLobbyStatus('invite-1', GuestLobbyStatus.ADMITTED);
      expect(redis.set).toHaveBeenCalledWith(
        'guest:lobby:status:invite-1',
        GuestLobbyStatus.ADMITTED,
      );

      (redis.get as jest.Mock).mockResolvedValue(GuestLobbyStatus.ADMITTED);
      const status = await service.getLobbyStatus('invite-1');
      expect(status).toBe(GuestLobbyStatus.ADMITTED);
    });
  });

  describe('Attendance-logged flag (anti-duplicate)', () => {
    it('markAttendanceLogged should reuse remaining TTL of the session key', async () => {
      (redis.ttl as jest.Mock).mockResolvedValue(1800);
      await service.markAttendanceLogged('jti-1');
      expect(redis.setJsonWithTtl).toHaveBeenCalledWith(
        'guest:session:jti-1',
        { attendanceLogged: true },
        1800,
      );
    });

    it('markAttendanceLogged should fall back to session max hours if TTL is missing', async () => {
      (redis.ttl as jest.Mock).mockResolvedValue(-2);
      await service.markAttendanceLogged('jti-1');
      expect(redis.setJsonWithTtl).toHaveBeenCalledWith(
        'guest:session:jti-1',
        { attendanceLogged: true },
        4 * 3600,
      );
    });

    it('hasAttendanceLogged should return true only when flag is set', async () => {
      (redis.getJson as jest.Mock).mockResolvedValue({
        attendanceLogged: true,
      });
      expect(await service.hasAttendanceLogged('jti-1')).toBe(true);

      (redis.getJson as jest.Mock).mockResolvedValue(null);
      expect(await service.hasAttendanceLogged('jti-1')).toBe(false);
    });
  });

  describe('Device remember', () => {
    it('rememberDevice should set with TTL in days converted to seconds', async () => {
      await service.rememberDevice('invite-1', 'device-1');
      expect(redis.setWithTtl).toHaveBeenCalledWith(
        'guest:device:invite-1:device-1',
        '1',
        30 * 24 * 3600,
      );
    });

    it('isDeviceRemembered should check existence', async () => {
      (redis.exists as jest.Mock).mockResolvedValue(true);
      const result = await service.isDeviceRemembered('invite-1', 'device-1');
      expect(result).toBe(true);
    });
  });
});
