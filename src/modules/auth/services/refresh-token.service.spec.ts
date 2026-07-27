import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { RefreshTokenService } from './refresh-token.service';
import { AuthConfigService } from './auth-config.service';
import { TokenService } from './token.service';
import { RedisService } from '../../redis/redis.service';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { AUTH_ERROR_CODES } from '../constants/auth-error-codes';

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let jwtService: { verifyAsync: jest.Mock };
  let authConfigService: {
    getRefreshTokenSecret: jest.Mock;
    getAccessTokenTtlSeconds: jest.Mock;
  };
  let redisService: { exists: jest.Mock; setWithTtl: jest.Mock };
  let usersAuthRepository: { findById: jest.Mock };
  let tokenService: {
    generateAccessToken: jest.Mock;
    generateRefreshToken: jest.Mock;
  };

  const activeUser = {
    id: 'user-1',
    email: 'user1@example.com',
    passwordHash: 'hash',
    fullName: 'User One',
    avatarUrl: null,
    departmentId: null,
    accountStatus: 'active',
  };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    authConfigService = {
      getRefreshTokenSecret: jest.fn().mockReturnValue('refresh-secret'),
      getAccessTokenTtlSeconds: jest.fn().mockReturnValue(10800),
    };
    redisService = {
      exists: jest.fn().mockResolvedValue(false),
      setWithTtl: jest.fn().mockResolvedValue(undefined),
    };
    usersAuthRepository = { findById: jest.fn().mockResolvedValue(activeUser) };
    tokenService = {
      generateAccessToken: jest.fn().mockResolvedValue('new-access-token'),
      generateRefreshToken: jest.fn().mockResolvedValue('new-refresh-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: JwtService, useValue: jwtService },
        { provide: AuthConfigService, useValue: authConfigService },
        { provide: RedisService, useValue: redisService },
        { provide: UsersAuthRepository, useValue: usersAuthRepository },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = module.get<RefreshTokenService>(RefreshTokenService);
  });

  const validPayload = () => ({
    sub: 'user-1',
    jti: 'old-jti',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  it('returns new access+refresh token pair for a valid refresh token', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());

    const result = await service.refresh('valid-refresh-token');

    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 10800,
    });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-refresh-token', {
      secret: 'refresh-secret',
    });
  });

  it('generates the new token pair with a fresh jti (different from the old one)', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());

    await service.refresh('valid-refresh-token');

    const accessCallArg = tokenService.generateAccessToken.mock.calls[0][0];
    const refreshCallArg = tokenService.generateRefreshToken.mock.calls[0][0];
    expect(accessCallArg.jti).toBe(refreshCallArg.jti);
    expect(accessCallArg.jti).not.toBe('old-jti');
    expect(accessCallArg.sub).toBe('user-1');
  });

  it('blacklists the old jti with TTL derived from token exp', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const payload = {
      sub: 'user-1',
      jti: 'old-jti',
      exp: Math.floor(now / 1000) + 3600,
    };
    jwtService.verifyAsync.mockResolvedValue(payload);

    await service.refresh('valid-refresh-token');

    const expectedTtlSeconds = Math.ceil((payload.exp * 1000 - now) / 1000);
    expect(redisService.setWithTtl).toHaveBeenCalledWith(
      'blacklist:old-jti',
      '1',
      expectedTtlSeconds,
    );
  });

  it('throws 401 REFRESH_TOKEN_INVALID when jwt signature/expiry verification fails', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(service.refresh('bad-token')).rejects.toMatchObject({
      status: 401,
      response: { code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID },
    });
    expect(usersAuthRepository.findById).not.toHaveBeenCalled();
  });

  it('throws 401 REFRESH_TOKEN_REVOKED when jti is already blacklisted', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    redisService.exists.mockResolvedValue(true);

    await expect(service.refresh('replayed-token')).rejects.toMatchObject({
      status: 401,
      response: { code: AUTH_ERROR_CODES.REFRESH_TOKEN_REVOKED },
    });
    expect(usersAuthRepository.findById).not.toHaveBeenCalled();
  });

  it('throws 401 REFRESH_TOKEN_INVALID when user no longer exists', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    usersAuthRepository.findById.mockResolvedValue(null);

    await expect(service.refresh('valid-refresh-token')).rejects.toMatchObject({
      status: 401,
      response: { code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID },
    });
    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
  });

  it('throws 401 REFRESH_TOKEN_INVALID when user account is not active (locked/inactive)', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    usersAuthRepository.findById.mockResolvedValue({
      ...activeUser,
      accountStatus: 'locked',
    });

    await expect(service.refresh('valid-refresh-token')).rejects.toMatchObject({
      status: 401,
      response: { code: AUTH_ERROR_CODES.REFRESH_TOKEN_INVALID },
    });
  });

  it('khong goi setWithTtl khi TTL con lai <= 0 (mirror logout.service)', async () => {
    const payload = {
      sub: 'user-1',
      jti: 'old-jti',
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    jwtService.verifyAsync.mockResolvedValue(payload);

    await service.refresh('valid-refresh-token');

    expect(redisService.setWithTtl).not.toHaveBeenCalled();
  });

  it('fails closed (401) when Redis is unreachable while blacklisting the old jti', async () => {
    jwtService.verifyAsync.mockResolvedValue(validPayload());
    redisService.setWithTtl.mockRejectedValue(new Error('Redis down'));

    await expect(service.refresh('valid-refresh-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
