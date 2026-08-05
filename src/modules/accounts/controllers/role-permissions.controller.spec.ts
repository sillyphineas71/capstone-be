import { Test, TestingModule } from '@nestjs/testing';
import { RolePermissionsController } from './role-permissions.controller.js';
import { RolePermissionsService } from '../services/role-permissions.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';

describe('RolePermissionsController', () => {
  let controller: RolePermissionsController;
  let service: jest.Mocked<RolePermissionsService>;

  beforeEach(async () => {
    service = {
      findByRole: jest.fn(),
      assign: jest.fn(),
      revoke: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolePermissionsController],
      providers: [{ provide: RolePermissionsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RolePermissionsController>(
      RolePermissionsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findByRole', () => {
    it('[AC-008] should return role permissions', async () => {
      service.findByRole.mockResolvedValue([]);

      const result = await controller.findByRole('role-uuid');
      expect(result.success).toBe(true);
    });
  });

  describe('assign', () => {
    it('[AC-006] should assign permissions', async () => {
      service.assign.mockResolvedValue({
        assigned: ['perm-uuid'],
        skippedAlreadyAssigned: [],
        skippedDuplicatedInRequest: [],
        autoAddedDueToDependency: [],
      });
      const user = { userId: 'user-uuid' };

      const result = await controller.assign(
        'role-uuid',
        { permissionIds: ['perm-uuid'] },
        user,
      );

      expect(result.success).toBe(true);
      expect(service.assign).toHaveBeenCalledWith(
        'role-uuid',
        { permissionIds: ['perm-uuid'] },
        'user-uuid',
      );
    });

    it('should handle empty assign (all skipped)', async () => {
      service.assign.mockResolvedValue({
        assigned: [],
        skippedAlreadyAssigned: ['perm-uuid'],
        skippedDuplicatedInRequest: [],
        autoAddedDueToDependency: [],
      });
      const user = { userId: 'user-uuid' };

      const result = await controller.assign(
        'role-uuid',
        { permissionIds: ['perm-uuid'] },
        user,
      );
      expect(result.success).toBe(true);
      expect(result.data.assigned).toEqual([]);
    });
  });

  describe('revoke', () => {
    it('[AC-007] should revoke permission from role', async () => {
      service.revoke.mockResolvedValue(undefined);
      const user = { userId: 'user-uuid' };

      const result = await controller.revoke('role-uuid', 'perm-uuid', user);
      expect(result.success).toBe(true);
      expect(service.revoke).toHaveBeenCalledWith(
        'role-uuid',
        'perm-uuid',
        'user-uuid',
      );
    });
  });
});
