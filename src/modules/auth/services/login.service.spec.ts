import { LoginDto } from '../dto/login.dto';
import { AuthAuditRepository } from '../repositories/auth-audit.repository';
import { AuthzReadRepository } from '../repositories/authz-read.repository';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { LoginService } from './login.service';
import { RateLimitService } from './rate-limit.service';
import { TokenService } from './token.service';
import { AuthConfigService } from './auth-config.service';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

describe('LoginService', () => {
  const usersAuthRepository = {
    findByNormalizedEmail: jest.fn(),
    updateLastLoginAt: jest.fn(),
  } as unknown as UsersAuthRepository;
  const authzReadRepository = {
    getEffectiveRolesAndPermissions: jest.fn(),
  } as unknown as AuthzReadRepository;
  const authAuditRepository = {
    logLoginSuccess: jest.fn(),
  } as unknown as AuthAuditRepository;
  const rateLimitService = {
    checkOrThrow: jest.fn(),
  } as unknown as RateLimitService;
  const tokenService = {
    generateAccessToken: jest.fn(),
    generateRefreshToken: jest.fn(),
    hashRefreshToken: jest.fn(() => 'hashed-refresh'),
  } as unknown as TokenService;
  const authConfigService = {
    getRefreshTokenTtlSeconds: jest.fn(() => 604800),
    getAccessTokenTtlSeconds: jest.fn(() => 3600),
  } as unknown as AuthConfigService;

  const service = new LoginService(
    usersAuthRepository,
    authzReadRepository,
    authAuditRepository,
    rateLimitService,
    tokenService,
    authConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (rateLimitService.checkOrThrow as jest.Mock).mockImplementation(
      () => undefined,
    );
  });

  it('throws AUTH_INVALID_CREDENTIALS when user not found', async () => {
    (usersAuthRepository.findByNormalizedEmail as jest.Mock).mockResolvedValue(
      null,
    );

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_INVALID_CREDENTIALS',
      },
      status: 401,
    });
  });

  it('throws AUTH_TOO_MANY_ATTEMPTS when rate limit exceeded', async () => {
    (rateLimitService.checkOrThrow as jest.Mock).mockImplementation(() => {
      const error = new Error('AUTH_TOO_MANY_ATTEMPTS');
      error.name = 'AUTH_TOO_MANY_ATTEMPTS';
      throw error;
    });

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_TOO_MANY_ATTEMPTS',
      },
      status: 429,
    });
  });

  it('throws AUTH_ACCOUNT_INACTIVE when status inactive', async () => {
    (usersAuthRepository.findByNormalizedEmail as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      passwordHash: 'hash',
      fullName: 'User',
      avatarUrl: null,
      departmentId: null,
      accountStatus: 'inactive',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_ACCOUNT_INACTIVE',
      },
      status: 403,
    });
  });

  it('throws AUTH_TOKEN_GENERATION_FAILED when token generation fails', async () => {
    (usersAuthRepository.findByNormalizedEmail as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      passwordHash: 'hash',
      fullName: 'User',
      avatarUrl: null,
      departmentId: null,
      accountStatus: 'active',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (tokenService.generateAccessToken as jest.Mock).mockRejectedValue(
      new Error('token generation failed'),
    );

    await expect(
      service.login({ email: 'user@example.com', password: 'secret' }, {}),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_TOKEN_GENERATION_FAILED',
      },
      status: 500,
    });
  });
});
