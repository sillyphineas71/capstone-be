import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PermissionsService } from './permissions.service.js';
import { PermissionEntity } from '../entities/permission.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let repo: jest.Mocked<Repository<PermissionEntity>>;
  let auditLogs: jest.Mocked<AuditLogsService>;

  const mockPermission = {
    id: 'perm-uuid',
    permissionCode: 'meetings.create',
    permissionName: 'Create Meeting',
    moduleCode: 'meetings',
    actionCode: 'create',
    description: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findByIds: jest.fn(),
    } as unknown as jest.Mocked<Repository<PermissionEntity>>;

    auditLogs = {
      logAction: jest.fn(),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: getRepositoryToken(PermissionEntity), useValue: repo },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
  });

  describe('create', () => {
    it('[AC-001] should create permission successfully', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(mockPermission);
      repo.save.mockResolvedValue(mockPermission);

      const result = await service.create(
        {
          permissionCode: 'meetings.create',
          permissionName: 'Create Meeting',
          moduleCode: 'meetings',
          actionCode: 'create',
        },
        'user-uuid',
      );

      expect(result.permissionCode).toBe('meetings.create');
      expect(result.isActive).toBe(true);
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'CREATE_PERMISSION' }),
      );
    });

    it('[AC-016] should reject duplicate permissionCode', async () => {
      repo.findOne.mockResolvedValue(mockPermission);

      await expect(
        service.create(
          {
            permissionCode: 'meetings.create',
            permissionName: 'Test',
            moduleCode: 'test',
            actionCode: 'test',
          },
          'user-uuid',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('[AC-002] should return paginated results', async () => {
      repo.findAndCount.mockResolvedValue([[mockPermission], 1]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data.length).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('[AC-003] should return permission by id', async () => {
      repo.findOne.mockResolvedValue(mockPermission);

      const result = await service.findOne('perm-uuid');
      expect(result.id).toBe('perm-uuid');
    });

    it('should throw NotFoundException for non-existent id', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('[AC-004] should update permission', async () => {
      repo.findOne.mockResolvedValue(mockPermission);
      repo.save.mockResolvedValue({
        ...mockPermission,
        permissionName: 'Updated',
      });

      const result = await service.update(
        'perm-uuid',
        { permissionName: 'Updated' },
        'user-uuid',
      );
      expect(result.permissionName).toBe('Updated');
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'UPDATE_PERMISSION' }),
      );
    });

    it('should throw NotFoundException if permission not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { permissionName: 'Test' }, 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggleActive', () => {
    it('[AC-022] should toggle from active to inactive', async () => {
      repo.findOne.mockResolvedValue(mockPermission);
      repo.save.mockResolvedValue({
        ...mockPermission,
        isActive: false,
      });

      const result = await service.toggleActive('perm-uuid', 'user-uuid');
      expect(result.isActive).toBe(false);
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'TOGGLE_PERMISSION' }),
      );
    });

    it('[AC-023] should toggle from inactive to active', async () => {
      repo.findOne.mockResolvedValue({
        ...mockPermission,
        isActive: false,
      });
      repo.save.mockResolvedValue({ ...mockPermission, isActive: true });

      const result = await service.toggleActive('perm-uuid', 'user-uuid');
      expect(result.isActive).toBe(true);
    });

    it('should throw NotFoundException if permission not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.toggleActive('nonexistent', 'user-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
