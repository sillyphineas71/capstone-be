import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BiometricEnforcementGuard } from './biometric-enforcement.guard';
import { AuthzReadRepository } from '../repositories/authz-read.repository';
import { BiometricStatusRawRepository } from '../repositories/biometric-status-raw.repository';

function buildContext(path: string, userId?: string): ExecutionContext {
  const request = {
    path,
    user: userId ? { userId } : undefined,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('BiometricEnforcementGuard (Docs/Nam_Sent/be-biometric-enforcement.md §2)', () => {
  let guard: BiometricEnforcementGuard;
  let mockAuthzReadRepository: {
    getEffectiveRolesAndPermissions: jest.Mock;
  };
  let mockBiometricStatusRawRepository: { getFaceProfileRows: jest.Mock };

  beforeEach(async () => {
    mockAuthzReadRepository = { getEffectiveRolesAndPermissions: jest.fn() };
    mockBiometricStatusRawRepository = { getFaceProfileRows: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiometricEnforcementGuard,
        {
          provide: AuthzReadRepository,
          useValue: mockAuthzReadRepository,
        },
        {
          provide: BiometricStatusRawRepository,
          useValue: mockBiometricStatusRawRepository,
        },
      ],
    }).compile();

    guard = module.get<BiometricEnforcementGuard>(BiometricEnforcementGuard);
  });

  it('unauthenticated request (no request.user) → canActivate returns true', async () => {
    const ctx = buildContext('/api/v1/meetings');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(
      mockAuthzReadRepository.getEffectiveRolesAndPermissions,
    ).not.toHaveBeenCalled();
  });

  it('whitelisted route /me/biometric-status → canActivate returns true without DB lookup', async () => {
    const ctx = buildContext('/api/v1/me/biometric-status', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(
      mockAuthzReadRepository.getEffectiveRolesAndPermissions,
    ).not.toHaveBeenCalled();
  });

  it('whitelisted route /me/biometric-submission → canActivate returns true without DB lookup', async () => {
    const ctx = buildContext('/api/v1/me/biometric-submission', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(
      mockAuthzReadRepository.getEffectiveRolesAndPermissions,
    ).not.toHaveBeenCalled();
  });

  it('whitelisted route /auth/logout → canActivate returns true without DB lookup', async () => {
    const ctx = buildContext('/api/v1/auth/logout', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(
      mockAuthzReadRepository.getEffectiveRolesAndPermissions,
    ).not.toHaveBeenCalled();
  });

  it('exempt role (SYSTEM_ADMIN) → canActivate returns true regardless of biometric status', async () => {
    mockAuthzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['SYSTEM_ADMIN'],
      permissions: [],
    });

    const ctx = buildContext('/api/v1/meetings', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(
      mockBiometricStatusRawRepository.getFaceProfileRows,
    ).not.toHaveBeenCalled();
  });

  it('EMPLOYEE + biometricReviewStatus=approved → canActivate returns true', async () => {
    mockAuthzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['EMPLOYEE'],
      permissions: [],
    });
    mockBiometricStatusRawRepository.getFaceProfileRows.mockResolvedValue([
      { status: 'active', lastUpdatedAt: new Date(), enrolledAt: new Date() },
    ]);

    const ctx = buildContext('/api/v1/meetings', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('EMPLOYEE + biometricReviewStatus=pending_review → canActivate returns true (không block chờ duyệt)', async () => {
    mockAuthzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['EMPLOYEE'],
      permissions: [],
    });
    mockBiometricStatusRawRepository.getFaceProfileRows.mockResolvedValue([
      {
        status: 'pending_review',
        lastUpdatedAt: new Date(),
        enrolledAt: null,
      },
    ]);

    const ctx = buildContext('/api/v1/meetings', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('MANAGER + biometricReviewStatus=not_uploaded → throw ForbiddenException BIOMETRIC_REQUIRED', async () => {
    mockAuthzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['MANAGER'],
      permissions: [],
    });
    mockBiometricStatusRawRepository.getFaceProfileRows.mockResolvedValue([]);

    const ctx = buildContext('/api/v1/meetings', 'user-001');

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

    let thrownError: ForbiddenException | undefined;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      thrownError = err as ForbiddenException;
    }
    const body = thrownError?.getResponse() as { error: { code: string } };
    expect(body?.error?.code).toBe('BIOMETRIC_REQUIRED');
  });

  it('EMPLOYEE + biometricReviewStatus=rejected → throw ForbiddenException BIOMETRIC_REQUIRED', async () => {
    mockAuthzReadRepository.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['EMPLOYEE'],
      permissions: [],
    });
    mockBiometricStatusRawRepository.getFaceProfileRows.mockResolvedValue([
      { status: 'rejected', lastUpdatedAt: new Date(), enrolledAt: null },
    ]);

    const ctx = buildContext('/api/v1/meetings', 'user-001');

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('DB lookup lỗi → fail-open, canActivate returns true', async () => {
    mockAuthzReadRepository.getEffectiveRolesAndPermissions.mockRejectedValue(
      new Error('db down'),
    );

    const ctx = buildContext('/api/v1/meetings', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
