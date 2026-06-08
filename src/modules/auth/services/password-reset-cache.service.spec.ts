import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PasswordResetCacheService } from './password-reset-cache.service';
import { PasswordResetOtpSession } from '../types/password-reset.types';

describe('PasswordResetCacheService', () => {
  let service: PasswordResetCacheService;
  let cacheManager: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(async () => {
    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetCacheService,
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get<PasswordResetCacheService>(PasswordResetCacheService);
  });

  describe('OtpSession Operations', () => {
    const email = 'test@example.com';
    const mockSession: PasswordResetOtpSession = {
      otpHash: 'hashedotpvalue',
      attempts: 0,
      createdAt: new Date().toISOString(),
    };

    it('should get OTP session successfully when it returns an object', async () => {
      cacheManager.get.mockResolvedValue(mockSession);

      const result = await service.getOtpSession(email);
      expect(result).toEqual(mockSession);
      expect(cacheManager.get).toHaveBeenCalledWith(
        `otp:password_reset:${email}`,
      );
    });

    it('should get OTP session successfully when it returns a JSON string', async () => {
      cacheManager.get.mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.getOtpSession(email);
      expect(result).toEqual(mockSession);
    });

    it('should return null when OTP session is not found', async () => {
      cacheManager.get.mockResolvedValue(null);

      const result = await service.getOtpSession(email);
      expect(result).toBeNull();
    });

    it('should throw InternalServerErrorException when get fails', async () => {
      cacheManager.get.mockRejectedValue(new Error('Cache error'));

      await expect(service.getOtpSession(email)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should set OTP session with correct key and TTL', async () => {
      const ttlMs = 600000; // 10 mins
      await service.setOtpSession(email, mockSession, ttlMs);

      expect(cacheManager.set).toHaveBeenCalledWith(
        `otp:password_reset:${email}`,
        mockSession,
        ttlMs,
      );
    });

    it('should throw InternalServerErrorException when set fails', async () => {
      cacheManager.set.mockRejectedValue(new Error('Cache error'));

      await expect(
        service.setOtpSession(email, mockSession, 600000),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should delete OTP session successfully', async () => {
      await service.deleteOtpSession(email);

      expect(cacheManager.del).toHaveBeenCalledWith(
        `otp:password_reset:${email}`,
      );
    });

    it('should throw InternalServerErrorException when delete fails', async () => {
      cacheManager.del.mockRejectedValue(new Error('Cache error'));

      await expect(service.deleteOtpSession(email)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('LimitCounter Operations', () => {
    const email = 'test@example.com';

    it('should return 0 when limit counter is not found', async () => {
      cacheManager.get.mockResolvedValue(null);

      const result = await service.getLimitCounter(email);
      expect(result).toBe(0);
    });

    it('should return numeric value when limit counter is a number', async () => {
      cacheManager.get.mockResolvedValue(2);

      const result = await service.getLimitCounter(email);
      expect(result).toBe(2);
    });

    it('should return numeric value when limit counter is a string', async () => {
      cacheManager.get.mockResolvedValue('3');

      const result = await service.getLimitCounter(email);
      expect(result).toBe(3);
    });

    it('should throw InternalServerErrorException when get limit counter fails', async () => {
      cacheManager.get.mockRejectedValue(new Error('Cache error'));

      await expect(service.getLimitCounter(email)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should increment limit counter from 0 to 1', async () => {
      cacheManager.get.mockResolvedValue(null);
      const ttlMs = 300000; // 5 mins

      const result = await service.incrementLimitCounter(email, ttlMs);
      expect(result).toBe(1);
      expect(cacheManager.set).toHaveBeenCalledWith(
        `otp_limit:password_reset:${email}`,
        1,
        ttlMs,
      );
    });

    it('should increment limit counter from 2 to 3', async () => {
      cacheManager.get.mockResolvedValue(2);
      const ttlMs = 300000;

      const result = await service.incrementLimitCounter(email, ttlMs);
      expect(result).toBe(3);
      expect(cacheManager.set).toHaveBeenCalledWith(
        `otp_limit:password_reset:${email}`,
        3,
        ttlMs,
      );
    });

    it('should delete limit counter successfully', async () => {
      await service.deleteLimitCounter(email);

      expect(cacheManager.del).toHaveBeenCalledWith(
        `otp_limit:password_reset:${email}`,
      );
    });
  });

  describe('Block Operations', () => {
    const email = 'test@example.com';

    it('should return false when block key is not found', async () => {
      cacheManager.get.mockResolvedValue(null);

      const result = await service.isBlocked(email);
      expect(result).toBe(false);
    });

    it('should return true when block key exists', async () => {
      cacheManager.get.mockResolvedValue(true);

      const result = await service.isBlocked(email);
      expect(result).toBe(true);
    });

    it('should block email with correct key and TTL', async () => {
      const ttlMs = 3600000; // 60 mins
      await service.blockEmail(email, ttlMs);

      expect(cacheManager.set).toHaveBeenCalledWith(
        `otp_blocked:password_reset:${email}`,
        true,
        ttlMs,
      );
    });

    it('should delete block key successfully', async () => {
      await service.deleteBlockKey(email);

      expect(cacheManager.del).toHaveBeenCalledWith(
        `otp_blocked:password_reset:${email}`,
      );
    });
  });
});
