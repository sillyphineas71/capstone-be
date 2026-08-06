/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext } from '@nestjs/common';
import { JwtQueryOrHeaderAuthGuard } from './jwt-query-or-header-auth.guard.js';
import { RedisService } from '../../redis/redis.service';
import { AuthConfigService } from '../services/auth-config.service';

describe('JwtQueryOrHeaderAuthGuard', () => {
  let guard: JwtQueryOrHeaderAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let redisService: { exists: jest.Mock; get: jest.Mock };
  let authConfigService: { getAccessTokenSecret: jest.Mock };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    redisService = { exists: jest.fn(), get: jest.fn() };
    authConfigService = {
      getAccessTokenSecret: jest.fn().mockReturnValue('secret'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtQueryOrHeaderAuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: RedisService, useValue: redisService },
        { provide: AuthConfigService, useValue: authConfigService },
      ],
    }).compile();

    guard = module.get<JwtQueryOrHeaderAuthGuard>(JwtQueryOrHeaderAuthGuard);
  });

  const mkContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
    }) as any;

  describe('extractTokenFromHeader (nguồn token thô)', () => {
    const extract = (request: any): string | undefined =>
      (guard as any).extractTokenFromHeader(request);

    it('có header Authorization → ưu tiên header (KHÔNG đọc query)', () => {
      const request = {
        headers: { authorization: 'Bearer from-header' },
        query: { token: 'from-query' },
      };
      expect(extract(request)).toBe('from-header');
    });

    it('KHÔNG có header → fallback query ?token=', () => {
      const request = { headers: {}, query: { token: 'from-query' } };
      expect(extract(request)).toBe('from-query');
    });

    it('KHÔNG có header lẫn query → undefined', () => {
      expect(extract({ headers: {}, query: {} })).toBeUndefined();
      expect(extract({ headers: {}, query: undefined })).toBeUndefined();
    });

    it('query.token KHÔNG phải string (vd mảng do ?token=a&token=b) → undefined (defensive)', () => {
      const request = { headers: {}, query: { token: ['a', 'b'] } };
      expect(extract(request)).toBeUndefined();
    });

    it('header sai format (KHÔNG "Bearer ") → fallback query', () => {
      const request = {
        headers: { authorization: 'Basic xxx' },
        query: { token: 'from-query' },
      };
      expect(extract(request)).toBe('from-query');
    });
  });

  describe('canActivate — verify/blacklist/invalid_after ĐẦY ĐỦ trên nhánh query (KHÔNG bớt bước)', () => {
    it('query token hợp lệ, KHÔNG có header → 200 (true), attach user', async () => {
      const request = {
        headers: {},
        query: { token: 'valid-query-token' },
      };
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        exp: 123456,
      });
      redisService.exists.mockResolvedValue(false);

      const result = await guard.canActivate(mkContext(request));

      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-query-token', {
        secret: 'secret',
      });
      expect((request as any).user).toEqual({
        userId: 'user-1',
        jti: 'jti-1',
        exp: 123456,
        sub: 'user-1',
      });
    });

    it('KHÔNG có token ở cả header lẫn query → UnauthorizedException', async () => {
      const request = { headers: {}, query: {} };
      await expect(guard.canActivate(mkContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('query token hết hạn/không verify được → UnauthorizedException (KHÔNG bypass)', async () => {
      const request = { headers: {}, query: { token: 'expired' } };
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      await expect(guard.canActivate(mkContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('query token bị revoke (blacklist) → UnauthorizedException (check blacklist VẪN chạy)', async () => {
      const request = { headers: {}, query: { token: 'revoked' } };
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        exp: 123456,
      });
      redisService.exists.mockResolvedValue(true);

      await expect(guard.canActivate(mkContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(redisService.exists).toHaveBeenCalledWith('blacklist:jti-1');
    });

    it('query token phát hành TRƯỚC lần đổi mật khẩu (invalid_after) → UnauthorizedException', async () => {
      const request = { headers: {}, query: { token: 'stale' } };
      const nowSeconds = Math.floor(Date.now() / 1000);
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        exp: nowSeconds + 3600,
        iat: nowSeconds - 10,
      });
      redisService.exists.mockResolvedValue(false);
      redisService.get.mockImplementation((key: string) => {
        if (key === 'auth:user:user-1:invalid_after')
          return Promise.resolve(String(Date.now()));
        return Promise.resolve(null);
      });

      await expect(guard.canActivate(mkContext(request))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('có header hợp lệ (query KHÔNG có token) → vẫn hoạt động như JwtAuthGuard gốc', async () => {
      const request = {
        headers: { authorization: 'Bearer from-header' },
        query: {},
      };
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
        exp: 123456,
      });
      redisService.exists.mockResolvedValue(false);

      const result = await guard.canActivate(mkContext(request));
      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('from-header', {
        secret: 'secret',
      });
    });
  });
});
