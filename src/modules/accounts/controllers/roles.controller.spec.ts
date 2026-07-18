import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RolesController } from './roles.controller.js';
import { RolesService } from '../services/roles.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';

describe('RolesController', () => {
  let controller: RolesController;
  let service: jest.Mocked<RolesService>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [{ provide: RolesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RolesController>(RolesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /roles', () => {
    it('[AC-002] should return paginated roles list', async () => {
      service.findAll.mockResolvedValue({ data: [], total: 0 });

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(result.success).toBe(true);
      expect(result.meta).toBeDefined();
      expect(result.data).toEqual([]);
    });
  });

  describe('GET /roles/:id', () => {
    it('[AC-003] should return role detail', async () => {
      service.findOne.mockResolvedValue({ id: 'uuid', roleCode: 'TEST', assignedUserCount: 0 } as any);

      const result = await controller.findOne('uuid');

      expect(result.success).toBe(true);
      expect(result.data.roleCode).toBe('TEST');
    });
  });

  describe('POST /roles', () => {
    it('[AC-001] should create role returning 201', async () => {
      service.create.mockResolvedValue({ id: 'uuid', roleCode: 'TEST', roleName: 'Test' } as any);
      const user = { userId: 'user-uuid' };

      const result = await controller.create(
        { roleCode: 'TEST', roleName: 'Test' },
        user,
      );

      expect(result.success).toBe(true);
    });
  });

  describe('PATCH /roles/:id', () => {
    it('[AC-004] should update role', async () => {
      service.update.mockResolvedValue({ id: 'uuid', roleName: 'Updated' } as any);
      const user = { userId: 'user-uuid' };

      const result = await controller.update('uuid', { roleName: 'Updated' }, user);

      expect(result.success).toBe(true);
    });

    it('[AC-008] should reject PATCH with roleCode in body', async () => {
      const user = { userId: 'user-uuid' };

      await expect(
        controller.update('uuid', { roleCode: 'SHOULD_NOT' } as any, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('[AC-008] should reject PATCH with isSystemRole in body', async () => {
      const user = { userId: 'user-uuid' };

      await expect(
        controller.update('uuid', { isSystemRole: true } as any, user),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('DELETE /roles/:id', () => {
    it('[AC-005] should soft-delete role', async () => {
      service.remove.mockResolvedValue(undefined);
      const user = { userId: 'user-uuid' };

      const result = await controller.remove('uuid', user);

      expect(result.success).toBe(true);
    });
  });
});
