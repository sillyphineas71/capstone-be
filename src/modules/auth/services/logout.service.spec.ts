import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { LogoutService } from './logout.service';
import { AuthAuditRepository } from '../repositories/auth-audit.repository';
import { Request } from 'express';

describe('LogoutService', () => {
  let service: LogoutService;
  let cacheManager: { set: jest.Mock };
  let authAuditRepository: { logLogoutSuccess: jest.Mock };

  beforeEach(async () => {
    cacheManager = { set: jest.Mock = jest.fn() };
    authAuditRepository = { logLogoutSuccess: jest.Mock = jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogoutService,
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: AuthAuditRepository, useValue: authAuditRepository },
      ],
    }).compile();

    service = module.get<LogoutService>(LogoutService);
  });

  describe('logout', () => {
    it('should blacklist token with correct TTL', async () => {
      const jti = 'some-jti';
      const now = Date.now();
      const exp = Math.floor(now / 1000) + 3600; // 1 hour later
      
      jest.spyOn(Date, 'now').mockReturnValue(now);
      
      await service.logout(jti, exp);
      
      const expectedTtlMillis = exp * 1000 - now;
      expect(cacheManager.set).toHaveBeenCalledWith(`blacklist:${jti}`, true, expectedTtlMillis);
    });

    it('should throw InternalServerErrorException if cache set fails', async () => {
      const jti = 'some-jti';
      const exp = Math.floor(Date.now() / 1000) + 3600;
      
      cacheManager.set.mockRejectedValue(new Error('Redis error'));
      
      await expect(service.logout(jti, exp)).rejects.toThrow(InternalServerErrorException);
    });

    it('should not cache if TTL is negative (already expired)', async () => {
      const jti = 'some-jti';
      const exp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      
      await service.logout(jti, exp);
      
      expect(cacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('logLogoutAudit', () => {
    it('should call authAuditRepository.logLogoutSuccess', async () => {
      const userId = 'user-1';
      const jti = 'jti-1';
      const req = { ip: '127.0.0.1', headers: { 'user-agent': 'test-agent' } } as unknown as Request;

      await service.logLogoutAudit(userId, jti, req);

      expect(authAuditRepository.logLogoutSuccess).toHaveBeenCalledWith({
        userId,
        jti,
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      });
    });

    it('should not throw if authAuditRepository fails', async () => {
      authAuditRepository.logLogoutSuccess.mockRejectedValue(new Error('DB error'));
      const req = { ip: '127.0.0.1', headers: {} } as unknown as Request;
      
      // Should resolve normally despite inner error
      await expect(service.logLogoutAudit('user-1', 'jti-1', req)).resolves.toBeUndefined();
    });
  });
});
