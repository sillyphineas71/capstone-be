import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MustChangePasswordGuard } from './must-change-password.guard';
import { UsersChangePasswordRepository } from '../repositories/users-change-password.repository';

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

describe('MustChangePasswordGuard — 4 test cases (FR-CHPWD-026, AC-006b)', () => {
  let guard: MustChangePasswordGuard;
  let mockUsersRepo: { findMustChangePassword: jest.Mock };

  beforeEach(async () => {
    mockUsersRepo = { findMustChangePassword: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MustChangePasswordGuard,
        { provide: UsersChangePasswordRepository, useValue: mockUsersRepo },
      ],
    }).compile();

    guard = module.get<MustChangePasswordGuard>(MustChangePasswordGuard);
  });

  // ── TC-01: must_change_password = false → allow ───────────────────────────
  it('TC-01: must_change_password=false → canActivate returns true', async () => {
    mockUsersRepo.findMustChangePassword.mockResolvedValue({ mustChangePassword: false });

    const ctx = buildContext('/api/v1/meetings', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── TC-02: must_change_password = true, route = /auth/change-password → allow
  it('TC-02: must_change_password=true + route /auth/change-password → canActivate returns true (whitelist)', async () => {
    // findMustChangePassword should NOT be called for whitelisted routes
    const ctx = buildContext('/api/v1/auth/change-password', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockUsersRepo.findMustChangePassword).not.toHaveBeenCalled();
  });

  // ── TC-03: must_change_password = true, business API → 403 ───────────────
  it('TC-03: must_change_password=true + route /api/v1/meetings → throw ForbiddenException MUST_CHANGE_PASSWORD (AC-006b)', async () => {
    mockUsersRepo.findMustChangePassword.mockResolvedValue({ mustChangePassword: true });

    const ctx = buildContext('/api/v1/meetings', 'user-001');

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

    let thrownError: ForbiddenException | undefined;
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      thrownError = err as ForbiddenException;
    }

    const body = thrownError?.getResponse() as { error: { code: string } };
    expect(body?.error?.code).toBe('MUST_CHANGE_PASSWORD');
  });

  // ── TC-04: must_change_password = true, route = /auth/logout → allow ─────
  it('TC-04: must_change_password=true + route /auth/logout → canActivate returns true (whitelist)', async () => {
    const ctx = buildContext('/api/v1/auth/logout', 'user-001');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockUsersRepo.findMustChangePassword).not.toHaveBeenCalled();
  });
});
