import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { RolePermissionsService } from './role-permissions.service.js';
import { RoleEntity } from '../entities/role.entity.js';
import { PermissionEntity } from '../entities/permission.entity.js';
import { RolePermissionEntity } from '../entities/role-permission.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('RolePermissionsService', () => {
  let service: RolePermissionsService;
  let roleRepo: jest.Mocked<Repository<RoleEntity>>;
  let permRepo: jest.Mocked<Repository<PermissionEntity>>;
  let rpRepo: jest.Mocked<Repository<RolePermissionEntity>>;
  let dataSource: jest.Mocked<DataSource>;
  let auditLogs: jest.Mocked<AuditLogsService>;

  const mockRole = {
    id: 'role-uuid',
    isSystemRole: false,
    roleCode: 'admin',
    roleName: 'Admin',
    isActive: true,
  };
  const mockSystemRole = {
    id: 'sysrole-uuid',
    isSystemRole: true,
    roleCode: 'sysadmin',
    roleName: 'System Admin',
    isActive: true,
  };
  const mockPermission = {
    id: 'perm-uuid',
    permissionCode: 'meetings.create',
    isActive: true,
    moduleCode: 'meetings',
  };
  const mockAdminPermission = {
    id: 'admin-perm-uuid',
    permissionCode: 'admin.manage_permissions',
    isActive: true,
    moduleCode: 'admin',
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: { save: jest.fn() },
  };

  beforeEach(async () => {
    roleRepo = { findOne: jest.fn() } as any;
    permRepo = { findByIds: jest.fn() } as any;
    rpRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
    } as any;
    auditLogs = { logAction: jest.fn() } as any;

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolePermissionsService,
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepo },
        { provide: getRepositoryToken(PermissionEntity), useValue: permRepo },
        { provide: getRepositoryToken(RolePermissionEntity), useValue: rpRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = module.get<RolePermissionsService>(RolePermissionsService);
  });

  describe('findByRole', () => {
    it('[AC-008] should return permissions for a role', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      rpRepo.find.mockResolvedValue([
        {
          id: 'rp-uuid',
          roleId: 'role-uuid',
          permissionId: 'perm-uuid',
          grantedBy: 'user-uuid',
          grantedAt: new Date(),
          permission: mockPermission,
        } as any,
      ]);

      const result = await service.findByRole('role-uuid');
      expect(result.length).toBe(1);
    });

    it('should throw ROLE_NOT_FOUND if role not exist', async () => {
      roleRepo.findOne.mockResolvedValue(null);

      await expect(service.findByRole('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assign', () => {
    it('[AC-006] should assign permissions successfully with transaction', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      permRepo.find.mockResolvedValue([mockPermission as any]);
      rpRepo.find.mockResolvedValue([]);
      rpRepo.create.mockReturnValue({} as any);
      mockQueryRunner.manager.save.mockResolvedValue([]);

      const result = await service.assign(
        'role-uuid',
        { permissionIds: ['perm-uuid'] },
        'user-uuid',
      );

      expect(result.assigned).toEqual(['perm-uuid']);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'ASSIGN_PERMISSION' }),
      );
    });

    it('[AC-017] should reject inactive permission — fatal rollback', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      permRepo.find.mockResolvedValue([
        { ...mockPermission, isActive: false } as any,
      ]);

      await expect(
        service.assign(
          'role-uuid',
          { permissionIds: ['perm-uuid'] },
          'user-uuid',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[AC-021] should skip already-assigned permissions (non-fatal)', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      permRepo.find.mockResolvedValue([mockPermission as any]);
      rpRepo.find.mockResolvedValue([{ permissionId: 'perm-uuid' } as any]);

      const result = await service.assign(
        'role-uuid',
        { permissionIds: ['perm-uuid'] },
        'user-uuid',
      );

      expect(result.assigned).toEqual([]);
      expect(result.skippedAlreadyAssigned).toEqual(['perm-uuid']);
    });

    it('should reject non-existent permissionId — fatal rollback', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      permRepo.find.mockResolvedValue([]); // none found

      await expect(
        service.assign(
          'role-uuid',
          { permissionIds: ['nonexistent-uuid'] },
          'user-uuid',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject non-existent roleId — fatal', async () => {
      roleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assign(
          'nonexistent',
          { permissionIds: ['perm-uuid'] },
          'user-uuid',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return no-op when all skipped', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      permRepo.find.mockResolvedValue([mockPermission as any]);
      rpRepo.find.mockResolvedValue([{ permissionId: 'perm-uuid' } as any]);

      const result = await service.assign(
        'role-uuid',
        { permissionIds: ['perm-uuid'] },
        'user-uuid',
      );

      expect(result.assigned).toEqual([]);
    });
  });

  describe('revoke', () => {
    it('[AC-007] should revoke permission from role', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      rpRepo.findOne.mockResolvedValue({
        id: 'rp-uuid',
        roleId: 'role-uuid',
        permissionId: 'perm-uuid',
        permission: mockPermission,
      } as any);
      rpRepo.remove.mockResolvedValue({} as any);

      await service.revoke('role-uuid', 'perm-uuid', 'user-uuid');
      expect(rpRepo.remove).toHaveBeenCalled();
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'REVOKE_PERMISSION' }),
      );
    });

    it('[AC-018] should reject revoking admin permission from system role', async () => {
      roleRepo.findOne.mockResolvedValue(mockSystemRole as any);
      rpRepo.findOne.mockResolvedValue({
        id: 'rp-uuid',
        permission: mockAdminPermission,
      } as any);

      await expect(
        service.revoke('sysrole-uuid', 'admin-perm-uuid', 'user-uuid'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[AC-019] should allow revoking non-admin permission from system role', async () => {
      roleRepo.findOne.mockResolvedValue(mockSystemRole as any);
      rpRepo.findOne.mockResolvedValue({
        id: 'rp-uuid',
        permission: mockPermission,
      } as any);
      rpRepo.remove.mockResolvedValue({} as any);

      await service.revoke('sysrole-uuid', 'perm-uuid', 'user-uuid');
      expect(rpRepo.remove).toHaveBeenCalled();
    });

    it('should throw PERMISSION_NOT_ASSIGNED if not assigned', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole as any);
      rpRepo.findOne.mockResolvedValue(null);

      await expect(
        service.revoke('role-uuid', 'perm-uuid', 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
