import { BadRequestException, ForbiddenException, HttpException, InternalServerErrorException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ChangePasswordService } from './change-password.service';
import { UsersChangePasswordRepository } from '../repositories/users-change-password.repository';
import { ChangePasswordCacheService } from './change-password-cache.service';
import { ChangePasswordAuditRepository } from '../repositories/change-password-audit.repository';
import { PasswordResetCacheService } from './password-reset-cache.service';
import * as bcrypt from 'bcryptjs';

// ── Shared test fixtures ─────────────────────────────────────────────────────
const USER_ID = 'test-user-uuid-001';
const CURRENT_PASSWORD = 'OldPass@123';
const NEW_PASSWORD = 'NewPass@456';
const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-001' };

async function hashPassword(pw: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(pw, salt);
}

const validDto = {
  currentPassword: CURRENT_PASSWORD,
  newPassword: NEW_PASSWORD,
  confirmPassword: NEW_PASSWORD,
};

// ── Mock factories ────────────────────────────────────────────────────────────
function buildMocks() {
  const mockDataSource = {
    transaction: jest.fn(),
  } as unknown as DataSource;

  const mockUsersRepo = {
    findByIdForUpdate: jest.fn(),
    updatePassword: jest.fn(),
  } as unknown as UsersChangePasswordRepository;

  const mockCacheService = {
    isBlocked: jest.fn(),
    incrementFailedCounter: jest.fn(),
    setBlockFlag: jest.fn(),
  } as unknown as ChangePasswordCacheService;

  const mockAuditRepo = {
    logSuccess: jest.fn(),
    logRateLimited: jest.fn(),
  } as unknown as ChangePasswordAuditRepository;

  const mockPasswordResetCacheService = {
    invalidateUserTokens: jest.fn(),
  } as unknown as PasswordResetCacheService;

  return {
    mockDataSource,
    mockUsersRepo,
    mockCacheService,
    mockAuditRepo,
    mockPasswordResetCacheService,
  };
}

async function buildService(mocks: ReturnType<typeof buildMocks>): Promise<ChangePasswordService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChangePasswordService,
      { provide: DataSource, useValue: mocks.mockDataSource },
      { provide: UsersChangePasswordRepository, useValue: mocks.mockUsersRepo },
      { provide: ChangePasswordCacheService, useValue: mocks.mockCacheService },
      { provide: ChangePasswordAuditRepository, useValue: mocks.mockAuditRepo },
      { provide: PasswordResetCacheService, useValue: mocks.mockPasswordResetCacheService },
    ],
  }).compile();

  return module.get<ChangePasswordService>(ChangePasswordService);
}

// Helper: configure DataSource.transaction to run the callback with a mock EntityManager
function mockTransactionWith(mocks: ReturnType<typeof buildMocks>, user: Awaited<ReturnType<typeof buildMocks>['mockUsersRepo']['findByIdForUpdate']>) {
  (mocks.mockDataSource.transaction as jest.Mock).mockImplementation(
    async (cb: (em: object) => Promise<void>) => {
      const em = {};
      (mocks.mockUsersRepo.findByIdForUpdate as jest.Mock).mockResolvedValue(user);
      (mocks.mockUsersRepo.updatePassword as jest.Mock).mockResolvedValue(undefined);
      await cb(em);
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ChangePasswordService — 12 test cases (UC-AUTH-04)', () => {
  let service: ChangePasswordService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    service = await buildService(mocks);
    jest.clearAllMocks();
  });

  // ── TC-01: Happy path ───────────────────────────────────────────────────────
  it('TC-01: Happy path — returns success, calls invalidateUserTokens and logSuccess (AC-001)', async () => {
    const passwordHash = await hashPassword(CURRENT_PASSWORD);
    const activeUser = {
      id: USER_ID,
      passwordHash,
      accountStatus: 'active',
      mustChangePassword: false,
      deletedAt: null,
    };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    mockTransactionWith(mocks, activeUser);
    (mocks.mockPasswordResetCacheService.invalidateUserTokens as jest.Mock).mockResolvedValue(undefined);
    (mocks.mockAuditRepo.logSuccess as jest.Mock).mockResolvedValue(undefined);

    const result = await service.changePassword(USER_ID, { ...validDto }, CTX);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Thay đổi mật khẩu thành công');
    expect(mocks.mockPasswordResetCacheService.invalidateUserTokens).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Number),
    );
    expect(mocks.mockAuditRepo.logSuccess).toHaveBeenCalled();
  });

  // ── TC-02: must_change_password reset to false ──────────────────────────────
  it('TC-02: must_change_password=true — updatePassword is called, resetting the flag (AC-002)', async () => {
    const passwordHash = await hashPassword(CURRENT_PASSWORD);
    const userWithFlag = {
      id: USER_ID,
      passwordHash,
      accountStatus: 'active',
      mustChangePassword: true,
      deletedAt: null,
    };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    mockTransactionWith(mocks, userWithFlag);
    (mocks.mockPasswordResetCacheService.invalidateUserTokens as jest.Mock).mockResolvedValue(undefined);
    (mocks.mockAuditRepo.logSuccess as jest.Mock).mockResolvedValue(undefined);

    await service.changePassword(USER_ID, { ...validDto }, CTX);

    // updatePassword is called — the SQL inside resets must_change_password = false
    expect(mocks.mockUsersRepo.updatePassword).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.any(String),
    );
  });

  // ── TC-03: Block flag active → 429 immediately, no DB/bcrypt (AC-013) ───────
  it('TC-03: Block flag exists → HTTP 429 immediately without touching DB (AC-013)', async () => {
    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(true);

    await expect(
      service.changePassword(USER_ID, { ...validDto }, CTX),
    ).rejects.toThrow(HttpException);

    // No DB transaction should have been opened
    expect(mocks.mockDataSource.transaction).not.toHaveBeenCalled();
    expect(mocks.mockUsersRepo.findByIdForUpdate).not.toHaveBeenCalled();
  });

  // ── TC-04: confirmPassword mismatch → 400 ────────────────────────────────────
  it('TC-04: confirmPassword ≠ newPassword → HTTP 400 CONFIRM_PASSWORD_MISMATCH', async () => {
    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);

    await expect(
      service.changePassword(
        USER_ID,
        { currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: 'Different@789' },
        CTX,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(mocks.mockDataSource.transaction).not.toHaveBeenCalled();
  });

  // ── TC-05: currentPassword wrong (attempt #1) → counter incremented ─────────
  it('TC-05: Wrong currentPassword (attempt #1) → counter=1, HTTP 400 CURRENT_PASSWORD_INCORRECT', async () => {
    const passwordHash = await hashPassword('AnotherPass@999');
    const activeUser = { id: USER_ID, passwordHash, accountStatus: 'active', mustChangePassword: false, deletedAt: null };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    (mocks.mockCacheService.incrementFailedCounter as jest.Mock).mockResolvedValue(1);
    mockTransactionWith(mocks, activeUser);

    await expect(
      service.changePassword(USER_ID, { ...validDto }, CTX),
    ).rejects.toThrow(BadRequestException);

    expect(mocks.mockCacheService.incrementFailedCounter).toHaveBeenCalledWith(USER_ID);
    expect(mocks.mockCacheService.setBlockFlag).not.toHaveBeenCalled();
  });

  // ── TC-06: currentPassword wrong (attempt #5) → block flag set, still HTTP 400
  it('TC-06: Wrong currentPassword (attempt #5) → setBlockFlag called, logRateLimited called, still HTTP 400', async () => {
    const passwordHash = await hashPassword('AnotherPass@999');
    const activeUser = { id: USER_ID, passwordHash, accountStatus: 'active', mustChangePassword: false, deletedAt: null };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    (mocks.mockCacheService.incrementFailedCounter as jest.Mock).mockResolvedValue(5);
    (mocks.mockCacheService.setBlockFlag as jest.Mock).mockResolvedValue(undefined);
    (mocks.mockAuditRepo.logRateLimited as jest.Mock).mockResolvedValue(undefined);
    mockTransactionWith(mocks, activeUser);

    await expect(
      service.changePassword(USER_ID, { ...validDto }, CTX),
    ).rejects.toThrow(BadRequestException);

    expect(mocks.mockCacheService.setBlockFlag).toHaveBeenCalledWith(USER_ID);
    // logRateLimited is fire-and-forget; give it one tick to settle
    await Promise.resolve();
    expect(mocks.mockAuditRepo.logRateLimited).toHaveBeenCalled();
  });

  // ── TC-07: 6th request when block is active → BL-1 → HTTP 429 (AC-012) ─────
  it('TC-07: Block flag set by previous attempt — next request gets HTTP 429 CHANGE_PASSWORD_RATE_LIMITED (AC-012)', async () => {
    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(true);

    const err = await service.changePassword(USER_ID, { ...validDto }, CTX).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);

    const responseBody = (err as HttpException).getResponse() as { error: { code: string } };
    expect(responseBody.error.code).toBe('CHANGE_PASSWORD_RATE_LIMITED');
  });

  // ── TC-08: newPassword same as current → 422 SAME_AS_CURRENT_PASSWORD ────────
  it('TC-08: newPassword equals current password (bcrypt E5) → HTTP 422 SAME_AS_CURRENT_PASSWORD (AC-008)', async () => {
    const passwordHash = await hashPassword(CURRENT_PASSWORD);
    const activeUser = { id: USER_ID, passwordHash, accountStatus: 'active', mustChangePassword: false, deletedAt: null };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    mockTransactionWith(mocks, activeUser);

    await expect(
      service.changePassword(
        USER_ID,
        { currentPassword: CURRENT_PASSWORD, newPassword: CURRENT_PASSWORD, confirmPassword: CURRENT_PASSWORD },
        CTX,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // ── TC-09: account_status locked → HTTP 403 ACCOUNT_RESTRICTED ───────────────
  it('TC-09: account_status = locked → HTTP 403 ACCOUNT_RESTRICTED (rollback)', async () => {
    const passwordHash = await hashPassword(CURRENT_PASSWORD);
    const lockedUser = { id: USER_ID, passwordHash, accountStatus: 'locked', mustChangePassword: false, deletedAt: null };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    mockTransactionWith(mocks, lockedUser);

    await expect(
      service.changePassword(USER_ID, { ...validDto }, CTX),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── TC-10: DB transaction throws → HTTP 500 ───────────────────────────────────
  it('TC-10: DB transaction throws → InternalServerErrorException HTTP 500', async () => {
    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    (mocks.mockDataSource.transaction as jest.Mock).mockRejectedValue(
      new InternalServerErrorException('DB error'),
    );

    await expect(
      service.changePassword(USER_ID, { ...validDto }, CTX),
    ).rejects.toThrow(InternalServerErrorException);
  });

  // ── TC-11: Audit log failure does not affect response ─────────────────────────
  it('TC-11: logSuccess throws — error is swallowed, response is still success', async () => {
    const passwordHash = await hashPassword(CURRENT_PASSWORD);
    const activeUser = { id: USER_ID, passwordHash, accountStatus: 'active', mustChangePassword: false, deletedAt: null };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    mockTransactionWith(mocks, activeUser);
    (mocks.mockPasswordResetCacheService.invalidateUserTokens as jest.Mock).mockResolvedValue(undefined);
    (mocks.mockAuditRepo.logSuccess as jest.Mock).mockRejectedValue(new Error('DB down'));

    const result = await service.changePassword(USER_ID, { ...validDto }, CTX);
    expect(result.success).toBe(true);
  });

  // ── TC-12: logger.warn called when currentPassword is wrong (NFR-CHPWD-013) ───
  it('TC-12: Wrong currentPassword → logger.warn is called (NFR-CHPWD-013)', async () => {
    const passwordHash = await hashPassword('AnotherPass@999');
    const activeUser = { id: USER_ID, passwordHash, accountStatus: 'active', mustChangePassword: false, deletedAt: null };

    (mocks.mockCacheService.isBlocked as jest.Mock).mockResolvedValue(false);
    (mocks.mockCacheService.incrementFailedCounter as jest.Mock).mockResolvedValue(1);
    mockTransactionWith(mocks, activeUser);

    const warnSpy = jest.spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');

    await service.changePassword(USER_ID, { ...validDto }, CTX).catch(() => {});

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Wrong currentPassword'));
  });
});
