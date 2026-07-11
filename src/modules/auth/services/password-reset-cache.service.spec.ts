import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PasswordResetCacheService } from './password-reset-cache.service';
import { RedisService } from '../../redis/redis.service';
import { PasswordResetOtpSession } from '../types/password-reset.types';

describe('PasswordResetCacheService', () => {
  let service: PasswordResetCacheService;
  let redisService: {
    getJson: jest.Mock;
    setJsonWithTtl: jest.Mock;
    del: jest.Mock;
    get: jest.Mock;
    setWithTtl: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
    exists: jest.Mock;
  };

  beforeEach(async () => {
    redisService = {
      getJson: jest.fn(),
      setJsonWithTtl: jest.fn(),
      del: jest.fn(),
      get: jest.fn(),
      setWithTtl: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      exists: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetCacheService,
        { provide: RedisService, useValue: redisService },
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

    it('should get OTP session successfully', async () => {
      redisService.getJson.mockResolvedValue(mockSession);

      const result = await service.getOtpSession(email);
      expect(result).toEqual(mockSession);
      expect(redisService.getJson).toHaveBeenCalledWith(
        `otp:password_reset:${email}`,
      );
    });

    it('should return null when OTP session is not found', async () => {
      redisService.getJson.mockResolvedValue(null);

      const result = await service.getOtpSession(email);
      expect(result).toBeNull();
    });

    it('should throw InternalServerErrorException when get fails', async () => {
      redisService.getJson.mockRejectedValue(new Error('Cache error'));

      await expect(service.getOtpSession(email)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should set OTP session with correct key and TTL (ms converted to seconds)', async () => {
      const ttlMs = 600000; // 10 mins
      const expectedTtlSeconds = Math.ceil(ttlMs / 1000);
      await service.setOtpSession(email, mockSession, ttlMs);

      expect(redisService.setJsonWithTtl).toHaveBeenCalledWith(
        `otp:password_reset:${email}`,
        mockSession,
        expectedTtlSeconds,
      );
    });

    it('should throw InternalServerErrorException when set fails', async () => {
      redisService.setJsonWithTtl.mockRejectedValue(new Error('Cache error'));

      await expect(
        service.setOtpSession(email, mockSession, 600000),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should delete OTP session successfully', async () => {
      await service.deleteOtpSession(email);

      expect(redisService.del).toHaveBeenCalledWith(
        `otp:password_reset:${email}`,
      );
    });

    it('should throw InternalServerErrorException when delete fails', async () => {
      redisService.del.mockRejectedValue(new Error('Cache error'));

      await expect(service.deleteOtpSession(email)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('LimitCounter Operations', () => {
    const email = 'test@example.com';

    it('should return 0 when limit counter is not found', async () => {
      redisService.get.mockResolvedValue(null);

      const result = await service.getLimitCounter(email);
      expect(result).toBe(0);
    });

    it('should return numeric value when limit counter exists', async () => {
      redisService.get.mockResolvedValue('2');

      const result = await service.getLimitCounter(email);
      expect(result).toBe(2);
    });

    it('should throw InternalServerErrorException when get limit counter fails', async () => {
      redisService.get.mockRejectedValue(new Error('Cache error'));

      await expect(service.getLimitCounter(email)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should increment limit counter using incr and set expire', async () => {
      redisService.incr.mockResolvedValue(1);
      const ttlMs = 300000; // 5 mins
      const expectedTtlSeconds = Math.ceil(ttlMs / 1000);

      const result = await service.incrementLimitCounter(email, ttlMs);
      expect(result).toBe(1);
      expect(redisService.incr).toHaveBeenCalledWith(
        `otp_limit:password_reset:${email}`,
      );
      expect(redisService.expire).toHaveBeenCalledWith(
        `otp_limit:password_reset:${email}`,
        expectedTtlSeconds,
      );
    });

    it('should increment limit counter from 2 to 3', async () => {
      redisService.incr.mockResolvedValue(3);
      const ttlMs = 300000;

      const result = await service.incrementLimitCounter(email, ttlMs);
      expect(result).toBe(3);
    });

    it('should delete limit counter successfully', async () => {
      await service.deleteLimitCounter(email);

      expect(redisService.del).toHaveBeenCalledWith(
        `otp_limit:password_reset:${email}`,
      );
    });
  });

  describe('Block Operations', () => {
    const email = 'test@example.com';

    it('should return false when block key is not found', async () => {
      redisService.exists.mockResolvedValue(false);

      const result = await service.isBlocked(email);
      expect(result).toBe(false);
    });

    it('should return true when block key exists', async () => {
      redisService.exists.mockResolvedValue(true);

      const result = await service.isBlocked(email);
      expect(result).toBe(true);
    });

    it('should block email with correct key and TTL (ms converted to seconds)', async () => {
      const ttlMs = 3600000; // 60 mins
      const expectedTtlSeconds = Math.ceil(ttlMs / 1000);
      await service.blockEmail(email, ttlMs);

      expect(redisService.setWithTtl).toHaveBeenCalledWith(
        `otp_blocked:password_reset:${email}`,
        '1',
        expectedTtlSeconds,
      );
    });

    it('should delete block key successfully', async () => {
      await service.deleteBlockKey(email);

      expect(redisService.del).toHaveBeenCalledWith(
        `otp_blocked:password_reset:${email}`,
      );
    });
  });
});
