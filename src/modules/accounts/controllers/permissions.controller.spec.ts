import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsController } from './permissions.controller.js';
import { PermissionsService } from '../services/permissions.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';

describe('PermissionsController', () => {
  let controller: PermissionsController;
  let service: jest.Mocked<PermissionsService>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      toggleActive: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PermissionsController],
      providers: [{ provide: PermissionsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PermissionsController>(PermissionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('[AC-002] should return paginated permissions list', async () => {
      service.findAll.mockResolvedValue({ data: [], total: 0 });

      const result = await controller.findAll({ page: 1, limit: 20 });

      expect(result.success).toBe(true);
      expect(result.meta).toBeDefined();
      expect(result.meta.page).toBe(1);
    });
  });

  describe('findOne', () => {
    it('[AC-003] should return a permission', async () => {
      service.findOne.mockResolvedValue({
        id: 'uuid',
        permissionCode: 'test.read',
      } as any);

      const result = await controller.findOne('uuid');
      expect(result.success).toBe(true);
      expect(result.data.permissionCode).toBe('test.read');
    });
  });

  describe('create', () => {
    it('[AC-001] should create and return 201', async () => {
      service.create.mockResolvedValue({
        id: 'uuid',
        permissionCode: 'test.read',
      } as any);
      const user = { userId: 'user-uuid' };

      const result = await controller.create(
        {
          permissionCode: 'test.read',
          permissionName: 'Test',
          moduleCode: 'meetings',
          actionCode: 'read',
        },
        user,
      );

      expect(result.success).toBe(true);
      expect(service.create).toHaveBeenCalledWith(
        expect.any(Object),
        'user-uuid',
      );
    });

    it('[AC-013] should handle missing user', async () => {
      await expect(
        controller.create({} as any, undefined as any),
      ).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('[AC-004] should update permission', async () => {
      service.update.mockResolvedValue({
        id: 'uuid',
        permissionName: 'Updated',
      } as any);
      const user = { userId: 'user-uuid' };

      const result = await controller.update(
        'uuid',
        { permissionName: 'Updated' },
        user,
      );
      expect(result.success).toBe(true);
    });

    it('[AC-020] should reject when permissionCode sent in body', async () => {
      const user = { userId: 'user-uuid' };

      await expect(
        controller.update(
          'uuid',
          { permissionName: 'Test', permissionCode: 'new.code' } as any,
          user as any,
        ),
      ).rejects.toThrow();
    });
  });

  describe('toggleActive', () => {
    it('[AC-005] should toggle permission status', async () => {
      service.toggleActive.mockResolvedValue({ id: 'uuid', isActive: false });
      const user = { userId: 'user-uuid' };

      const result = await controller.toggleActive('uuid', user);
      expect(result.success).toBe(true);
      expect(result.data.isActive).toBe(false);
    });
  });
});
