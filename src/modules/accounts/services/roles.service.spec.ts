import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { RolesService } from './roles.service.js';
import { RoleEntity } from '../entities/role.entity.js';
import { UserRoleEntity } from '../entities/user-role.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('RolesService', () => {
  let service: RolesService;
  let roleRepo: jest.Mocked<Repository<RoleEntity>>;
  let userRoleRepo: jest.Mocked<Repository<UserRoleEntity>>;
  let auditLogs: jest.Mocked<AuditLogsService>;

  const mockRole = {
    id: 'role-uuid',
    roleCode: 'ROOM_COORDINATOR',
    roleName: 'Room Coordinator',
    description: null,
    isSystemRole: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSystemRole = {
    ...mockRole,
    id: 'sys-role-uuid',
    roleCode: 'SYSTEM_ADMIN',
    roleName: 'System Admin',
    isSystemRole: true,
  };

  const mockUserRole = {
    id: 'ur-uuid',
    userId: 'user-uuid',
    roleId: 'role-uuid',
    isActive: true,
  };

  beforeEach(async () => {
    roleRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<RoleEntity>>;

    userRoleRepo = {
      count: jest.fn(),
    } as unknown as jest.Mocked<Repository<UserRoleEntity>>;

    auditLogs = {
      logAction: jest.fn(),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepo },
        { provide: getRepositoryToken(UserRoleEntity), useValue: userRoleRepo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  describe('create', () => {
    it('[AC-001] should create role successfully + audit log', async () => {
      roleRepo.findOne.mockResolvedValue(null);
      roleRepo.create.mockReturnValue(mockRole);
      roleRepo.save.mockResolvedValue(mockRole);

      const result = await service.create(
        { roleCode: 'ROOM_COORDINATOR', roleName: 'Room Coordinator' },
        'user-uuid',
      );

      expect(result.roleCode).toBe('ROOM_COORDINATOR');
      expect(result.isActive).toBe(true);
      expect(result.isSystemRole).toBe(false);
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'CREATE_ROLE' }),
      );
    });

    it('[AC-013] should reject duplicate roleCode -> 409', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole);

      await expect(
        service.create({ roleCode: 'ROOM_COORDINATOR', roleName: 'Test' }, 'user-uuid'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return paginated roles', async () => {
      roleRepo.findAndCount.mockResolvedValue([[mockRole], 1]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data.length).toBe(1);
      expect(result.total).toBe(1);
    });

    it('should filter by isActive', async () => {
      roleRepo.findAndCount.mockResolvedValue([[mockRole], 1]);

      const result = await service.findAll({ page: 1, limit: 20, isActive: true });

      expect(result.data.length).toBe(1);
    });

    it('should search by roleCode ILIKE', async () => {
      roleRepo.findAndCount.mockResolvedValue([[mockRole], 1]);

      const result = await service.findAll({ page: 1, limit: 20, search: 'COORD' });

      expect(result.data.length).toBe(1);
    });
  });

  describe('findOne', () => {
    it('[AC-003] should return role detail with assignedUserCount', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole);
      userRoleRepo.count.mockResolvedValue(3);

      const result = await service.findOne('role-uuid');

      expect(result.roleCode).toBe('ROOM_COORDINATOR');
      expect(result.assignedUserCount).toBe(3);
    });

    it('[AC-023] should throw NotFoundException when not found', async () => {
      roleRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('[AC-004] should update roleName/description/isActive', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole);
      roleRepo.save.mockResolvedValue({ ...mockRole, roleName: 'Updated Name', description: 'New desc', isActive: false });

      const result = await service.update('role-uuid', { roleName: 'Updated Name', description: 'New desc', isActive: false }, 'user-uuid');

      expect(result.roleName).toBe('Updated Name');
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'UPDATE_ROLE' }),
      );
    });

    it('[AC-015] should reject isActive false on system role -> 422', async () => {
      roleRepo.findOne.mockResolvedValue(mockSystemRole);

      await expect(
        service.update('sys-role-uuid', { isActive: false }, 'user-uuid'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[AC-018] should allow updating name on system role', async () => {
      roleRepo.findOne.mockResolvedValue(mockSystemRole);
      roleRepo.save.mockResolvedValue({ ...mockSystemRole, roleName: 'New Name' });

      const result = await service.update('sys-role-uuid', { roleName: 'New Name' }, 'user-uuid');

      expect(result.roleName).toBe('New Name');
    });

    it('[AC-023] should throw NotFoundException if role not found', async () => {
      roleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('invalid-id', { roleName: 'Test' }, 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('[AC-017] should soft-delete role successfully', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole);
      userRoleRepo.count.mockResolvedValue(0);
      roleRepo.save.mockResolvedValue({ ...mockRole, isActive: false });

      await service.remove('role-uuid', 'user-uuid');

      expect(roleRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'DELETE_ROLE' }),
      );
    });

    it('[AC-014] should reject deleting system role -> 422', async () => {
      roleRepo.findOne.mockResolvedValue(mockSystemRole);

      await expect(service.remove('sys-role-uuid', 'user-uuid')).rejects.toThrow(UnprocessableEntityException);
    });

    it('[AC-016] should reject deleting role with active users -> 409', async () => {
      roleRepo.findOne.mockResolvedValue(mockRole);
      userRoleRepo.count.mockResolvedValue(2);

      await expect(service.remove('role-uuid', 'user-uuid')).rejects.toThrow(ConflictException);
    });

    it('[AC-023] should throw NotFoundException if role not found', async () => {
      roleRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('invalid-id', 'user-uuid')).rejects.toThrow(NotFoundException);
    });
  });
});
