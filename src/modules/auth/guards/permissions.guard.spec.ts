import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from './permissions.guard';
import { AuthzReadRepository } from '../repositories/authz-read.repository';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let authzRepo: { getEffectiveRolesAndPermissions: jest.Mock };

  beforeEach(async () => {
    authzRepo = { getEffectiveRolesAndPermissions: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: AuthzReadRepository,
          useValue: authzRepo,
        },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  function createMockContext(requestUser: any): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: requestUser }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as any;
  }

  it('should return true if no permissions are required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ userId: 'user-1' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should return true if required permissions list is empty', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    const context = createMockContext({ userId: 'user-1' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should throw ForbiddenException if user is not in request', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['account.user.create']);
    const context = createMockContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should throw ForbiddenException if user does not have userId', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['account.user.create']);
    const context = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should return true if user has all required permissions', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['account.user.create']);
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['admin'],
      permissions: ['account.user.create', 'account.user.read'],
    });
    const context = createMockContext({ userId: 'user-1' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(authzRepo.getEffectiveRolesAndPermissions).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('should throw ForbiddenException if user does not have all required permissions', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['account.user.create', 'admin.manage']);
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['admin'],
      permissions: ['account.user.create'],
    });
    const context = createMockContext({ userId: 'user-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
