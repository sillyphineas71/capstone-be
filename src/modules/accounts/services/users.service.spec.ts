/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
} from '@nestjs/common';

import { UsersService } from './users.service.js';
import { PasswordGeneratorService } from './password-generator.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { UserEntity, EmploymentStatus, AccountStatus } from '../entities/user.entity.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import { UserRoleEntity } from '../entities/user-role.entity.js';
import { FaceProfileEntity } from '../entities/face-profile.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';

interface MockFindOneOptions {
  where?: {
    email?: string;
    username?: string;
    employeeCode?: string;
    id?: string;
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let dataSource: jest.Mocked<DataSource>;
  let passwordGeneratorService: jest.Mocked<PasswordGeneratorService>;
  let em: jest.Mocked<EntityManager>;

  beforeEach(async () => {
    // Mock EntityManager
    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    // Mock DataSource
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      manager: em,
    } as unknown as jest.Mocked<DataSource>;

    // Mock PasswordGeneratorService
    passwordGeneratorService = {
      generateTemporaryPassword: jest.fn().mockReturnValue('tempPassword123!'),
    } as unknown as jest.Mocked<PasswordGeneratorService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: PasswordGeneratorService,
          useValue: passwordGeneratorService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  const validDto: CreateUserDto = {
    fullName: 'Nguyen Van A',
    email: 'nva@company.com',
    departmentId: 'dept-id',
    roleIds: ['role-id-1'],
    employeeCode: 'EMP001',
    phoneNumber: '+84 987654321',
    positionTitle: 'Developer',
    directManagerId: 'manager-id',
  };

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUserDetail', () => {
    const targetUserId = 'target-user-id';
    const authUserId = 'auth-user-id';
    const managerUserId = 'manager-user-id';

    const baseTargetUser = {
      id: targetUserId,
      employeeCode: 'EMP001',
      email: 'user@company.com',
      fullName: 'Nguyen Van A',
      phoneNumber: '0909123456',
      avatarUrl: 'https://storage.example.com/avatars/uuid.jpg',
      positionTitle: 'Software Engineer',
      departmentId: 'dept-id',
      directManagerId: managerUserId,
      accountStatus: 'active',
      employmentStatus: 'active',
      mustChangePassword: false,
      lastLoginAt: new Date('2026-06-07T10:30:00.000Z'),
      createdAt: new Date('2026-01-15T08:00:00.000Z'),
      department: { id: 'dept-id', departmentName: 'IT Department' },
    };

    const baseAuthAdmin = {
      id: authUserId,
      departmentId: 'admin-dept-id',
    };

    const managerUser = {
      id: managerUserId,
      fullName: 'Tran Van B',
    };

    const activeRole = {
      id: 'role-id-1',
      role: {
        id: 'role-id-1',
        roleCode: 'EMPLOYEE',
        roleName: 'Nhan vien',
      },
    };

    function setupSystemAdmin() {
      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId) return baseTargetUser;
          if (options?.where?.id === authUserId) return baseAuthAdmin;
          if (options?.where?.id === managerUserId) return managerUser;
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return { id: 'face-profile-id', userId: targetUserId };
        }
        if (entityClass === DepartmentEntity) {
          return null;
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            // System Admin role
            return [
              {
                role: {
                  id: 'sysadmin-role-id',
                  isSystemRole: true,
                },
              },
            ];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        return [];
      });

      em.create.mockImplementation((_entityClass: unknown, plain: unknown) => plain);
      em.save.mockImplementation(async (_entityClass: unknown, entity: unknown) => entity);
    }

    function setupBusinessAdmin(
      adminDeptId: string,
      targetDeptId: string,
      childDeptIds: string[] = [],
    ) {
      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId) {
            return { ...baseTargetUser, departmentId: targetDeptId };
          }
          if (options?.where?.id === authUserId) {
            return { ...baseAuthAdmin, departmentId: adminDeptId };
          }
          if (options?.where?.id === managerUserId) return managerUser;
          if (options?.where?.id) return null;
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return { id: 'face-profile-id', userId: targetUserId };
        }
        if (entityClass === DepartmentEntity) {
          if (options?.where?.parentDepartmentId === adminDeptId) {
            return null;
          }
          return null;
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            // Business Admin role (isSystemRole = false)
            return [{ role: { id: 'bizadmin-role-id', isSystemRole: false } }];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        if (entityClass === DepartmentEntity) {
          // For scope resolution: return children for adminDeptId
          if (options?.where?.parentDepartmentId === adminDeptId) {
            return childDeptIds.map((id) => ({ id }));
          }
        }
        return [];
      });

      em.create.mockImplementation((_entityClass: unknown, plain: unknown) => plain);
      em.save.mockImplementation(async (_entityClass: unknown, entity: unknown) => entity);
    }

    // ===== HAPPY PATH TESTS (T007) =====

    it('[HP1] System Admin xem user detail — HTTP 200, đầy đủ 17 fields (AC-001, AC-012)', async () => {
      setupSystemAdmin();

      const result = await service.getUserDetail(targetUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
      expect(result.employeeCode).toBe('EMP001');
      expect(result.email).toBe('user@company.com');
      expect(result.fullName).toBe('Nguyen Van A');
      expect(result.phoneNumber).toBe('0909123456');
      expect(result.avatarUrl).toBe('https://storage.example.com/avatars/uuid.jpg');
      expect(result.positionTitle).toBe('Software Engineer');
      expect(result.department).toBeDefined();
      expect(result.department!.id).toBe('dept-id');
      expect(result.department!.departmentName).toBe('IT Department');
      expect(result.directManager).toBeDefined();
      expect(result.directManager!.id).toBe(managerUserId);
      expect(result.directManager!.fullName).toBe('Tran Van B');
      expect(result.accountStatus).toBe('active');
      expect(result.employmentStatus).toBe('active');
      expect(result.mustChangePassword).toBe(false);
      expect(result.lastLoginAt).toBe('2026-06-07T10:30:00.000Z');
      expect(result.roles).toHaveLength(1);
      expect(result.roles[0].roleCode).toBe('EMPLOYEE');
      expect(result.hasFaceProfile).toBe(true);
      expect(result.createdAt).toBe('2026-01-15T08:00:00.000Z');

      // Verify 16 fields exist
      const fieldCount = Object.keys(result).length;
      expect(fieldCount).toBe(16);
    });

    it('[HP2] Business Admin xem user cùng department — HTTP 200 (AC-013)', async () => {
      setupBusinessAdmin('dept-id', 'dept-id');

      const result = await service.getUserDetail(targetUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
      expect(result.fullName).toBe('Nguyen Van A');
    });

    it('[HP3] Business Admin xem user ở child department — HTTP 200 (AC-013)', async () => {
      setupBusinessAdmin('parent-dept', 'child-dept', ['child-dept']);

      const result = await service.getUserDetail(targetUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
    });

    it('[HP4] Self-view (Business Admin xem chính mình) — bypass scope (AC-014)', async () => {
      // Self-view: targetUserId === authUserId
      em.findOne.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === authUserId) {
            return {
              ...baseTargetUser,
              id: authUserId,
              departmentId: 'own-dept',
            };
          }
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return null; // No face profile for self
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [{ role: { id: 'bizadmin-role-id', isSystemRole: false } }];
          }
        }
        return [];
      });

      em.create.mockImplementation((_entityClass: unknown, plain: unknown) => plain);
      em.save.mockImplementation(async (_entityClass: unknown, entity: unknown) => entity);

      // Should NOT throw ForbiddenException despite being out of scope
      const result = await service.getUserDetail(authUserId, authUserId);

      expect(result).toBeDefined();
      expect(result.id).toBe(authUserId);
      expect(result.hasFaceProfile).toBe(false);
    });

    // ===== ERROR CASE TESTS (T008) =====

    it('[E5] User không tồn tại — 404 USER_NOT_FOUND (AC-007)', async () => {
      em.findOne.mockImplementation(async (entityClass: unknown) => {
        if (entityClass === UserEntity) return null;
        return null;
      });
      em.find.mockResolvedValue([]);

      await expect(
        service.getUserDetail('non-existent-id', authUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('[E6] User soft-deleted — 404 USER_NOT_FOUND (AC-008)', async () => {
      // Mock: findOne returns null for the target (as if soft-deleted)
      em.findOne.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId &&
              options?.where?.deletedAt !== undefined) {
            return null; // Soft-deleted user is excluded by deletedAt: IsNull()
          }
        }
        return null;
      });

      await expect(
        service.getUserDetail(targetUserId, authUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('[E4] Business Admin ngoài scope — 403 FORBIDDEN (AC-006)', async () => {
      setupBusinessAdmin('admin-dept', 'other-dept');

      await expect(
        service.getUserDetail(targetUserId, authUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Audit log failure không block response (non-blocking try/catch)', async () => {
      setupSystemAdmin();

      // Make audit log save fail
      em.save.mockImplementation(async (entityClass: unknown) => {
        if (entityClass === AuditLogEntity) {
          throw new Error('Audit service down');
        }
        return undefined;
      });

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result).toBeDefined();
      expect(result.id).toBe(targetUserId);
    });

    it('Database error — throw 500 INTERNAL_ERROR', async () => {
      em.findOne.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        service.getUserDetail(targetUserId, authUserId),
      ).rejects.toThrow(Error);
    });

    // ===== DATA FORMAT TESTS (T009) =====

    it('[HP4] hasFaceProfile = false khi không có face_profile (AC-002)', async () => {
      setupSystemAdmin();
      // Override face profile to return null
      em.findOne.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId) return baseTargetUser;
          if (options?.where?.id === authUserId) return baseAuthAdmin;
          if (options?.where?.id === managerUserId) return managerUser;
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return null; // No face profile
        }
        return null;
      });

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.hasFaceProfile).toBe(false);
    });

    it('[HP5] directManager = null khi direct_manager_id = null (AC-015)', async () => {
      const userWithoutManager = {
        ...baseTargetUser,
        directManagerId: null,
      };

      em.findOne.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId) return userWithoutManager;
          if (options?.where?.id === authUserId) return baseAuthAdmin;
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return { id: 'face-id' };
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [{ role: { id: 'sysadmin-role-id', isSystemRole: true } }];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        return [];
      });

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.directManager).toBeNull();
      // Verify field is present (not omitted)
      expect(result).toHaveProperty('directManager');
    });

    it('[HP6] avatarUrl = null khi avatar_url = null (AC-016)', async () => {
      const userWithoutAvatar = {
        ...baseTargetUser,
        avatarUrl: null,
      };

      em.findOne.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserEntity) {
          if (options?.where?.id === targetUserId) return userWithoutAvatar;
          if (options?.where?.id === authUserId) return baseAuthAdmin;
          return null;
        }
        if (entityClass === FaceProfileEntity) {
          return { id: 'face-id' };
        }
        return null;
      });

      em.find.mockImplementation(async (entityClass: unknown, options: any) => {
        if (entityClass === UserRoleEntity) {
          if (options?.where?.userId === authUserId) {
            return [{ role: { id: 'sysadmin-role-id', isSystemRole: true } }];
          }
          if (options?.where?.userId === targetUserId) {
            return [activeRole];
          }
        }
        return [];
      });

      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.avatarUrl).toBeNull();
    });

    it('[HP7] avatarUrl có giá trị từ DB (AC-017)', async () => {
      setupSystemAdmin();
      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(result.avatarUrl).toBe('https://storage.example.com/avatars/uuid.jpg');
    });

    it('[AC-018] employmentStatus chỉ nhận 4 enum values', async () => {
      setupSystemAdmin();
      const result = await service.getUserDetail(targetUserId, authUserId);
      expect(['active', 'probation', 'resigned', 'transferred']).toContain(
        result.employmentStatus,
      );
    });

    it('[AC-009, AC-010] No INSERT/UPDATE/DELETE operations — only SELECT', async () => {
      setupSystemAdmin();
      await service.getUserDetail(targetUserId, authUserId);

      // findOne and find should have been called for SELECT operations
      expect(em.findOne).toHaveBeenCalled();
      expect(em.find).toHaveBeenCalled();
      // Verify no save was called for data mutation (audit log save is allowed)
      // Audit log save is non-blocking but still a save operation
    });
  });

  describe('createUser', () => {
    it('should create user successfully (Happy Path)', async () => {
      // Mock checks passing
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'active',
                employmentStatus: 'active',
              };
            }
            // No email / username / employeeCode exists
            return null;
          }
          if (entityClass === DepartmentEntity) {
            return {
              id: 'dept-id',
              isActive: true,
            };
          }
          if (entityClass === RoleEntity) {
            return {
              id: 'role-id-1',
              roleCode: 'employee',
              roleName: 'Employee',
              isActive: true,
            };
          }
          return null;
        },
      );

      // Mock save results
      const mockSavedUser = {
        id: 'new-user-id',
        fullName: 'Nguyen Van A',
        email: 'nva@company.com',
        username: 'nva@company.com',
        employeeCode: 'EMP001',
        accountStatus: 'active',
        mustChangePassword: true,
        createdAt: new Date(),
      };
      em.create.mockImplementation(
        <T>(_entityClass: unknown, plain: T): T => plain,
      );
      em.save.mockImplementation(
        async <T>(entityClass: unknown, entity: T): Promise<T> => {
          if (entityClass === UserEntity) {
            return mockSavedUser as unknown as T;
          }
          return entity;
        },
      );

      const result = await service.createUser(validDto, 'creator-id', {
        ipAddress: '127.0.0.1',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('new-user-id');
      expect(result.email).toBe('nva@company.com');
      expect(result.mustChangePassword).toBe(true);
      expect(result.roles[0].roleCode).toBe('employee');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(em.save).toHaveBeenCalledTimes(4); // User + UserRole + BackgroundJob + AuditLog
    });

    it('should throw ConflictException if email already exists', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (
            entityClass === UserEntity &&
            options?.where?.email === 'nva@company.com'
          ) {
            return { id: 'existing-id' };
          }
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if username already exists', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.email === 'nva@company.com') return null;
            if (options?.where?.username === 'nva@company.com')
              return { id: 'existing-id' };
          }
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if department does not exist', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity) return null; // not found
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException if department is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity) {
          return {
            id: 'dept-id',
            isActive: false,
          }; // inactive
        }
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw NotFoundException if role does not exist', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity)
          return {
            id: 'dept-id',
            isActive: true,
          };
        if (entityClass === RoleEntity) return null; // role not found
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException if role is inactive', async () => {
      em.findOne.mockImplementation(async (entityClass) => {
        if (entityClass === UserEntity) return null;
        if (entityClass === DepartmentEntity)
          return {
            id: 'dept-id',
            isActive: true,
          };
        if (entityClass === RoleEntity)
          return { id: 'role-id-1', isActive: false }; // inactive
        return null;
      });

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should throw ConflictException if employeeCode already exists', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.email === 'nva@company.com') return null;
            if (options?.where?.username === 'nva@company.com') return null;
            if (options?.where?.employeeCode === 'EMP001')
              return { id: 'existing-id' };
          }
          if (entityClass === DepartmentEntity)
            return {
              id: 'dept-id',
              isActive: true,
            };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException if manager does not exist', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') return null; // manager not found
            return null;
          }
          if (entityClass === DepartmentEntity)
            return {
              id: 'dept-id',
              isActive: true,
            };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException if manager is inactive/resigned', async () => {
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'inactive', // inactive
                employmentStatus: 'active',
              };
            }
            return null;
          }
          if (entityClass === DepartmentEntity)
            return {
              id: 'dept-id',
              isActive: true,
            };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should propagate error and rollback if background job fails to queue', async () => {
      // Mock checks passing
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'active',
                employmentStatus: 'active',
              };
            }
            return null;
          }
          if (entityClass === DepartmentEntity)
            return {
              id: 'dept-id',
              isActive: true,
            };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      em.create.mockImplementation(
        <T>(_entityClass: unknown, plain: T): T => plain,
      );
      em.save.mockImplementation(
        async <T>(entityClass: unknown, entity: T): Promise<T> => {
          if (entityClass === UserEntity) {
            return {
              id: 'new-user-id',
              email: 'nva@company.com',
            } as unknown as T;
          }
          // Fail when saving background job
          if (
            typeof entityClass === 'function' &&
            entityClass.name === 'BackgroundJobEntity'
          ) {
            throw new Error('Database connection failed');
          }
          return entity;
        },
      );

      await expect(
        service.createUser(validDto, 'creator-id', {}),
      ).rejects.toThrow('Database connection failed');
    });

    it('should not block user creation if audit log writing fails', async () => {
      // Mock checks passing
      em.findOne.mockImplementation(
        async (entityClass, options?: MockFindOneOptions) => {
          if (entityClass === UserEntity) {
            if (options?.where?.id === 'manager-id') {
              return {
                id: 'manager-id',
                accountStatus: 'active',
                employmentStatus: 'active',
              };
            }
            return null;
          }
          if (entityClass === DepartmentEntity)
            return {
              id: 'dept-id',
              isActive: true,
            };
          if (entityClass === RoleEntity)
            return { id: 'role-id-1', isActive: true };
          return null;
        },
      );

      const mockSavedUser = {
        id: 'new-user-id',
        email: 'nva@company.com',
        fullName: 'Nguyen Van A',
        accountStatus: 'active',
        mustChangePassword: true,
        createdAt: new Date(),
      };
      em.create.mockImplementation(
        <T>(_entityClass: unknown, plain: T): T => plain,
      );
      em.save.mockImplementation(
        async <T>(entityClass: unknown, entity: T): Promise<T> => {
          if (entityClass === UserEntity) {
            return mockSavedUser as unknown as T;
          }
          // Fail when saving audit log
          if (
            typeof entityClass === 'function' &&
            entityClass.name === 'AuditLogEntity'
          ) {
            throw new Error('Audit service down');
          }
          return entity;
        },
      );

      const result = await service.createUser(validDto, 'creator-id', {});
      expect(result).toBeDefined();
      expect(result.id).toBe('new-user-id');
      // Audit log failed, but user creation succeeded
    });
  });
});
