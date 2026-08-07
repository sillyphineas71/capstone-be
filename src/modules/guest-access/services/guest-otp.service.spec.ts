import { ConflictException, HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { GuestOtpService } from './guest-otp.service';
import { GuestInviteService } from './guest-invite.service';
import { GuestAccessCacheService } from './guest-access-cache.service';
import { GuestEmailService } from './guest-email.service';
import { GuestSessionService } from './guest-session.service';
import { GuestLobbyService } from './guest-lobby.service';
import { GuestAccessConfigService } from '../config/guest-access-config.service';
import { AuditLogsService } from '../../administration/services/audit-logs.service';

describe('GuestOtpService', () => {
  let service: GuestOtpService;
  let inviteService: {
    resolveInvite: jest.Mock;
    markJoined: jest.Mock;
  };
  let cache: {
    isOtpBlocked: jest.Mock;
    incrementOtpSendCount: jest.Mock;
    setOtp: jest.Mock;
    resetOtpAttempt: jest.Mock;
    getOtpHash: jest.Mock;
    incrementOtpAttempt: jest.Mock;
    blockOtp: jest.Mock;
    deleteOtp: jest.Mock;
    setSession: jest.Mock;
    setCurrentJti: jest.Mock;
  };
  let emailService: { sendOtp: jest.Mock };
  let sessionService: { signGuestToken: jest.Mock };
  let lobbyService: {
    isLobbyEnabled: jest.Mock;
    enqueue: jest.Mock;
    admitDirectly: jest.Mock;
  };
  let config: {
    getJoinWindowBeforeMinutes: jest.Mock;
    getJoinWindowAfterMinutes: jest.Mock;
    getOtpMaxResends: jest.Mock;
    getOtpMaxVerifyAttempts: jest.Mock;
    getVerificationModeDefault: jest.Mock;
  };
  let auditLogsService: { logSecurityEvent: jest.Mock };

  const now = Date.now();
  const meeting = {
    id: 'meeting-1',
    title: 'Weekly Sync',
    startTime: new Date(now - 5 * 60_000),
    endTime: new Date(now + 30 * 60_000),
    host: { fullName: 'Host Nguyen' },
  };
  const externalParticipant = {
    id: 'ep-1',
    email: 'guest@partner.com',
  };

  beforeEach(async () => {
    inviteService = {
      resolveInvite: jest
        .fn()
        .mockResolvedValue({ externalParticipant, meeting, guestInvite: {} }),
      markJoined: jest.fn(),
    };
    cache = {
      isOtpBlocked: jest.fn().mockResolvedValue(false),
      incrementOtpSendCount: jest.fn().mockResolvedValue(1),
      setOtp: jest.fn(),
      resetOtpAttempt: jest.fn(),
      getOtpHash: jest.fn(),
      incrementOtpAttempt: jest.fn().mockResolvedValue(1),
      blockOtp: jest.fn(),
      deleteOtp: jest.fn(),
      setSession: jest.fn(),
      setCurrentJti: jest.fn(),
    };
    emailService = { sendOtp: jest.fn() };
    sessionService = {
      signGuestToken: jest.fn().mockResolvedValue({
        token: 'guest-jwt',
        jti: 'jti-1',
        expiresInSeconds: 14400,
      }),
    };
    lobbyService = {
      isLobbyEnabled: jest.fn().mockResolvedValue(true),
      enqueue: jest.fn(),
      admitDirectly: jest.fn(),
    };
    config = {
      getJoinWindowBeforeMinutes: jest.fn().mockReturnValue(30),
      getJoinWindowAfterMinutes: jest.fn().mockReturnValue(15),
      getOtpMaxResends: jest.fn().mockReturnValue(3),
      getOtpMaxVerifyAttempts: jest.fn().mockReturnValue(5),
      getVerificationModeDefault: jest.fn().mockReturnValue('otp'),
    };
    auditLogsService = { logSecurityEvent: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestOtpService,
        { provide: GuestInviteService, useValue: inviteService },
        { provide: GuestAccessCacheService, useValue: cache },
        { provide: GuestEmailService, useValue: emailService },
        { provide: GuestSessionService, useValue: sessionService },
        { provide: GuestLobbyService, useValue: lobbyService },
        { provide: GuestAccessConfigService, useValue: config },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = module.get(GuestOtpService);
  });

  describe('getInviteInfo', () => {
    it('should return masked email and never the raw email', async () => {
      const info = await service.getInviteInfo('token');
      expect(info.maskedEmail).not.toBe(externalParticipant.email);
      expect(info.maskedEmail).toMatch(/\*/);
      expect(info.maskedEmail.endsWith('@partner.com')).toBe(true);
      expect(info.hostName).toBe('Host Nguyen');
    });
  });

  describe('requestOtp', () => {
    it('should send OTP to the stored email, never a client-supplied one', async () => {
      await service.requestOtp('token');
      expect(emailService.sendOtp).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'guest@partner.com' }),
      );
    });

    it('should throw ConflictException when outside the join window', async () => {
      inviteService.resolveInvite.mockResolvedValue({
        externalParticipant,
        meeting: {
          ...meeting,
          startTime: new Date(now + 60 * 60_000), // starts in 1h, window is 30m before
          endTime: new Date(now + 120 * 60_000),
        },
        guestInvite: {},
      });
      await expect(service.requestOtp('token')).rejects.toThrow(
        ConflictException,
      );
      expect(emailService.sendOtp).not.toHaveBeenCalled();
    });

    it('should throw HttpException(429) when blocked', async () => {
      cache.isOtpBlocked.mockResolvedValue(true);
      await expect(service.requestOtp('token')).rejects.toThrow(HttpException);
      expect(emailService.sendOtp).not.toHaveBeenCalled();
    });

    it('should throw HttpException(429) when resend limit exceeded, without sending mail', async () => {
      cache.incrementOtpSendCount.mockResolvedValue(4); // max is 3
      await expect(service.requestOtp('token')).rejects.toThrow(HttpException);
      expect(emailService.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    function otpHash(otp: string): string {
      return crypto.createHash('sha256').update(otp, 'utf8').digest('hex');
    }

    it('should throw when there is no active OTP session', async () => {
      cache.getOtpHash.mockResolvedValue(null);
      await expect(service.verifyOtp('token', '123456')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should increment attempts and reject on wrong OTP', async () => {
      cache.getOtpHash.mockResolvedValue(otpHash('999999'));
      await expect(service.verifyOtp('token', '123456')).rejects.toThrow(
        ConflictException,
      );
      expect(cache.incrementOtpAttempt).toHaveBeenCalledWith('ep-1');
      expect(inviteService.markJoined).not.toHaveBeenCalled();
    });

    it('should block the invite after reaching max verify attempts', async () => {
      cache.getOtpHash.mockResolvedValue(otpHash('999999'));
      cache.incrementOtpAttempt.mockResolvedValue(5); // max is 5
      await expect(service.verifyOtp('token', '123456')).rejects.toThrow(
        ConflictException,
      );
      expect(cache.blockOtp).toHaveBeenCalledWith('ep-1');
      expect(cache.deleteOtp).toHaveBeenCalledWith('ep-1');
    });

    it('should issue a guest session and enqueue lobby on correct OTP (lobby enabled)', async () => {
      cache.getOtpHash.mockResolvedValue(otpHash('123456'));
      const result = await service.verifyOtp('token', '123456');

      expect(result.guestToken).toBe('guest-jwt');
      expect(result.lobbyRequired).toBe(true);
      expect(result.meetingId).toBe('meeting-1');
      expect(inviteService.markJoined).toHaveBeenCalledWith('ep-1');
      expect(lobbyService.enqueue).toHaveBeenCalledWith('meeting-1', 'ep-1');
      expect(lobbyService.admitDirectly).not.toHaveBeenCalled();
      expect(cache.setCurrentJti).toHaveBeenCalledWith('ep-1', 'jti-1', 14400);
    });

    it('should admit directly (bypass lobby) when lobby is disabled', async () => {
      lobbyService.isLobbyEnabled.mockResolvedValue(false);
      cache.getOtpHash.mockResolvedValue(otpHash('123456'));

      const result = await service.verifyOtp('token', '123456');

      expect(result.lobbyRequired).toBe(false);
      expect(lobbyService.admitDirectly).toHaveBeenCalledWith('ep-1');
      expect(lobbyService.enqueue).not.toHaveBeenCalled();
    });
  });
});
