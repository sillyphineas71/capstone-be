import { AuthAuditRepository } from '../repositories/auth-audit.repository';
import { AuthzReadRepository } from '../repositories/authz-read.repository';
import { UsersAuthRepository } from '../repositories/users-auth.repository';
import { AvatarStatusRawRepository } from '../repositories/avatar-status-raw.repository';
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
  const avatarStatusRawRepository = {
    getFaceProfileRows: jest.fn(),
  } as unknown as AvatarStatusRawRepository;

  const service = new LoginService(
    usersAuthRepository,
    authzReadRepository,
    authAuditRepository,
    rateLimitService,
    tokenService,
    authConfigService,
    avatarStatusRawRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (rateLimitService.checkOrThrow as jest.Mock).mockImplementation(
      () => undefined,
    );
    (
      avatarStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([]);
  });

  /** Mock thành công đầy đủ để chạy tới bước build summary. */
  const mockActiveLogin = () => {
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
    (tokenService.generateAccessToken as jest.Mock).mockResolvedValue('access');
    (tokenService.generateRefreshToken as jest.Mock).mockResolvedValue(
      'refresh',
    );
    (
      authzReadRepository.getEffectiveRolesAndPermissions as jest.Mock
    ).mockResolvedValue({ roles: ['INTERNAL_USER'], permissions: [] });
    (usersAuthRepository.updateLastLoginAt as jest.Mock).mockResolvedValue(
      undefined,
    );
    (authAuditRepository.logLoginSuccess as jest.Mock).mockResolvedValue(
      undefined,
    );
  };

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

  // ── ACCT-AVATAR-SUBMIT-001 (BR-016): avatar fields trong login response ──

  it('login response chứa avatarReviewStatus=approved khi user có row active (AC-006)', async () => {
    mockActiveLogin();
    (
      avatarStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([
      { status: 'active', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.avatarReviewStatus).toBe('approved');
    expect(result.user.avatarRequired).toBe(false);
    expect(result.user.shouldShowAvatarPopup).toBe(false);
  });

  it('login response chứa avatarReviewStatus=not_uploaded khi user chưa có row (AC-001)', async () => {
    mockActiveLogin();
    (
      avatarStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.avatarReviewStatus).toBe('not_uploaded');
    expect(result.user.shouldShowAvatarPopup).toBe(true);
  });

  it('login response chứa avatarReviewStatus=rejected khi user có row rejected (AC-004)', async () => {
    mockActiveLogin();
    (
      avatarStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockResolvedValue([
      { status: 'rejected', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.user.avatarReviewStatus).toBe('rejected');
    expect(result.user.shouldShowAvatarPopup).toBe(true);
  });

  it('login KHÔNG fail khi đọc avatar status lỗi → fallback not_uploaded (resilience)', async () => {
    mockActiveLogin();
    (
      avatarStatusRawRepository.getFaceProfileRows as jest.Mock
    ).mockRejectedValue(new Error('db down'));

    const result = await service.login(
      { email: 'user@example.com', password: 'secret' },
      {},
    );

    expect(result.accessToken).toBe('access');
    expect(result.user.avatarReviewStatus).toBe('not_uploaded');
  });
});
