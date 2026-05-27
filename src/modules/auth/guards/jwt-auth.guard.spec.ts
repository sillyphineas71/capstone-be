import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthConfigService } from '../services/auth-config.service';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let cacheManager: { get: jest.Mock };
  let authConfigService: { getAccessTokenSecret: jest.Mock };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    cacheManager = { get: jest.fn() };
    authConfigService = { getAccessTokenSecret: jest.fn().mockReturnValue('secret') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: AuthConfigService, useValue: authConfigService },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  function createMockContext(headers: any): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
      getHandler: () => jest.fn(),
    } as any;
  }

  it('should throw UnauthorizedException if no token is provided', async () => {
    const context = createMockContext({});
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if token is invalid', async () => {
    const context = createMockContext({ authorization: 'Bearer invalid' });
    jwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if token is blacklisted', async () => {
    const context = createMockContext({ authorization: 'Bearer valid-token' });
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'jti-1', exp: 123456 });
    cacheManager.get.mockResolvedValue(true);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(cacheManager.get).toHaveBeenCalledWith('blacklist:jti-1');
  });

  it('should attach user to request and return true if token is valid and not blacklisted', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
    } as any;
    
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'jti-1', exp: 123456 });
    cacheManager.get.mockResolvedValue(null);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request['user']).toEqual({
      userId: 'user-1',
      jti: 'jti-1',
      exp: 123456,
      sub: 'user-1',
    });
  });

  it('should throw UnauthorizedException if token was issued before password change (iat < invalid_after)', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
    } as any;

    const nowSeconds = Math.floor(Date.now() / 1000);
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'jti-1', exp: nowSeconds + 3600, iat: nowSeconds - 10 });

    cacheManager.get.mockImplementation(async (key: string) => {
      if (key === 'blacklist:jti-1') return null;
      if (key === 'auth:user:user-1:invalid_after') return Date.now();
      return null;
    });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should succeed if token was issued after password change (iat >= invalid_after)', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
    } as any;

    const nowSeconds = Math.floor(Date.now() / 1000);
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'jti-1', exp: nowSeconds + 3600, iat: nowSeconds + 10 });

    cacheManager.get.mockImplementation(async (key: string) => {
      if (key === 'blacklist:jti-1') return null;
      if (key === 'auth:user:user-1:invalid_after') return Date.now() - 10000;
      return null;
    });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });
});
