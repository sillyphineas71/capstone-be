/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsService } from '../services/departments.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('DepartmentsController', () => {
  let controller: DepartmentsController;
  let service: {
    createDepartment: jest.Mock;
    listDepartments: jest.Mock;
    listDepartmentMembers: jest.Mock;
    getDepartmentById: jest.Mock;
    deactivateDepartment: jest.Mock;
    reactivateDepartment: jest.Mock;
  };
  let reflector: Reflector;

  const baseDept = {
    id: 'dept-uuid',
    departmentCode: 'IT',
    departmentName: 'Phòng IT',
    parentDepartmentId: null,
    managerUserId: null,
    description: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    service = {
      createDepartment: jest.fn(),
      listDepartments: jest.fn(),
      listDepartmentMembers: jest.fn(),
      getDepartmentById: jest.fn(),
      deactivateDepartment: jest.fn(),
      reactivateDepartment: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DepartmentsController],
      providers: [{ provide: DepartmentsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(DepartmentsController);
    reflector = new Reflector();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listDepartments', () => {
    it('gọi service.listDepartments(query) + envelope { success, message, data, meta }', async () => {
      const svcResult = {
        data: [{ id: 'd1', departmentCode: 'IT' }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
      service.listDepartments.mockResolvedValue(svcResult);

      const query = { search: 'it', page: 1, limit: 20 };
      const res = await controller.listDepartments(query);

      expect(service.listDepartments).toHaveBeenCalledWith(query);
      expect(res).toEqual({
        success: true,
        message: 'Lấy danh sách phòng ban thành công',
        data: svcResult.data,
        meta: svcResult.meta,
      });
    });

    it('list rỗng → data [] + meta total 0', async () => {
      service.listDepartments.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
      const res = await controller.listDepartments({});
      expect(res.data).toEqual([]);
      expect(res.meta.total).toBe(0);
    });
  });

  describe('listDepartmentMembers', () => {
    it('gọi service.listDepartmentMembers(id) + envelope { success, message, data }', async () => {
      const svcResult = [
        {
          id: 'u1',
          employeeCode: 'EMP001',
          fullName: 'Nguyễn Văn A',
          email: 'a@company.com',
          phoneNumber: null,
          avatarUrl: null,
          positionTitle: 'Backend Engineer',
          employmentStatus: 'active',
          isDepartmentManager: false,
        },
      ];
      service.listDepartmentMembers.mockResolvedValue(svcResult);

      const res = await controller.listDepartmentMembers('d1');

      expect(service.listDepartmentMembers).toHaveBeenCalledWith('d1');
      expect(res).toEqual({
        success: true,
        message: 'Lấy danh sách nhân viên phòng ban thành công',
        data: svcResult,
      });
    });

    it('phòng ban không tồn tại → propagate NotFoundException từ service', async () => {
      service.listDepartmentMembers.mockRejectedValue(
        new NotFoundException({
          success: false,
          message: 'Không tìm thấy phòng ban',
          error: { code: 'DEPARTMENT_NOT_FOUND' },
        }),
      );

      await expect(controller.listDepartmentMembers('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('phòng ban rỗng → data []', async () => {
      service.listDepartmentMembers.mockResolvedValue([]);
      const res = await controller.listDepartmentMembers('d1');
      expect(res.data).toEqual([]);
    });
  });

  // ── ACCT-DEPT-DETAIL-001 ────────────────────────────────────────────────

  describe('getDepartmentById', () => {
    it('[AC-001] 200 + envelope đúng shape khi tìm thấy', async () => {
      service.getDepartmentById.mockResolvedValue(baseDept);

      const res = await controller.getDepartmentById('dept-uuid');

      expect(service.getDepartmentById).toHaveBeenCalledWith('dept-uuid');
      expect(res).toEqual({
        success: true,
        message: 'Lấy chi tiết phòng ban thành công',
        data: baseDept,
      });
    });

    it('[AC-002] isActive=false vẫn trả về 200', async () => {
      service.getDepartmentById.mockResolvedValue({
        ...baseDept,
        isActive: false,
      });

      const res = await controller.getDepartmentById('dept-uuid');

      expect(res.data.isActive).toBe(false);
      expect(res.success).toBe(true);
    });

    it('[AC-003/AC-004] propagate NotFoundException từ service khi không tìm thấy', async () => {
      service.getDepartmentById.mockRejectedValue(
        new NotFoundException({
          success: false,
          message: 'Phòng ban không tồn tại hoặc đã bị xóa.',
          error: { code: 'DEPARTMENT_NOT_FOUND', details: { id: 'missing' } },
        }),
      );

      await expect(controller.getDepartmentById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── ACCT-DEPT-DEACTIVATE-001 ─────────────────────────────────────────────

  describe('deactivateDepartment', () => {
    const mockReq = { user: { userId: 'actor-id' } } as unknown as Request;

    it('[AC-001] 200 + isActive=false khi deactivate thành công', async () => {
      const deactivatedDept = { ...baseDept, isActive: false };
      service.deactivateDepartment.mockResolvedValue(deactivatedDept);

      const res = await controller.deactivateDepartment(
        'dept-uuid',
        mockReq,
        '127.0.0.1',
      );

      expect(service.deactivateDepartment).toHaveBeenCalledWith(
        'dept-uuid',
        'actor-id',
        expect.any(Object),
      );
      expect(res.success).toBe(true);
      expect(res.data.isActive).toBe(false);
      expect(res.message).toBe('Vô hiệu hoá phòng ban thành công');
    });

    it('[AC-002] DEPARTMENT_HAS_ACTIVE_CHILDREN → propagate ConflictException', async () => {
      service.deactivateDepartment.mockRejectedValue(
        new ConflictException({
          success: false,
          message: 'Không thể vô hiệu hoá: còn phòng ban con active.',
          error: { code: 'DEPARTMENT_HAS_ACTIVE_CHILDREN', details: {} },
        }),
      );

      await expect(
        controller.deactivateDepartment('dept-uuid', mockReq, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-003] DEPARTMENT_HAS_ACTIVE_MEMBERS → propagate ConflictException', async () => {
      service.deactivateDepartment.mockRejectedValue(
        new ConflictException({
          success: false,
          message: 'Không thể vô hiệu hoá: còn nhân viên active.',
          error: { code: 'DEPARTMENT_HAS_ACTIVE_MEMBERS', details: {} },
        }),
      );

      await expect(
        controller.deactivateDepartment('dept-uuid', mockReq, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-005] PARTNER_DEPARTMENT_PROTECTED → propagate ForbiddenException', async () => {
      service.deactivateDepartment.mockRejectedValue(
        new ForbiddenException({
          success: false,
          message: 'Không thể vô hiệu hoá department cố định.',
          error: { code: 'PARTNER_DEPARTMENT_PROTECTED', details: {} },
        }),
      );

      await expect(
        controller.deactivateDepartment('partner-uuid', mockReq, '127.0.0.1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reactivateDepartment', () => {
    const mockReq = { user: { userId: 'actor-id' } } as unknown as Request;

    it('[AC-006] 200 + isActive=true khi reactivate thành công', async () => {
      const reactivatedDept = { ...baseDept, isActive: true };
      service.reactivateDepartment.mockResolvedValue(reactivatedDept);

      const res = await controller.reactivateDepartment(
        'dept-uuid',
        mockReq,
        '127.0.0.1',
      );

      expect(service.reactivateDepartment).toHaveBeenCalledWith(
        'dept-uuid',
        'actor-id',
        expect.any(Object),
      );
      expect(res.success).toBe(true);
      expect(res.data.isActive).toBe(true);
      expect(res.message).toBe('Kích hoạt lại phòng ban thành công');
    });

    it('[AC-007] PARENT_DEPARTMENT_INACTIVE → propagate ConflictException', async () => {
      service.reactivateDepartment.mockRejectedValue(
        new ConflictException({
          success: false,
          message: 'Không thể kích hoạt lại: phòng ban cha đang inactive.',
          error: { code: 'PARENT_DEPARTMENT_INACTIVE', details: {} },
        }),
      );

      await expect(
        controller.reactivateDepartment('dept-uuid', mockReq, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('[AC-008] DEPARTMENT_ALREADY_ACTIVE → propagate ConflictException', async () => {
      service.reactivateDepartment.mockRejectedValue(
        new ConflictException({
          success: false,
          message: 'Phòng ban đã ở trạng thái hoạt động.',
          error: { code: 'DEPARTMENT_ALREADY_ACTIVE', details: {} },
        }),
      );

      await expect(
        controller.reactivateDepartment('dept-uuid', mockReq, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── RBAC metadata (@RequirePermissions) ─────────────────────────────────

  describe('RBAC metadata (@RequirePermissions)', () => {
    it('listDepartments yêu cầu department.read', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.listDepartments,
      );
      expect(perms).toEqual(['department.read']);
    });

    it('createDepartment giữ department.create (POST không đổi)', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.createDepartment,
      );
      expect(perms).toEqual(['department.create']);
    });

    it('listDepartmentMembers yêu cầu accounts.user.list', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.listDepartmentMembers,
      );
      expect(perms).toEqual(['accounts.user.list']);
    });

    it('[ACCT-DEPT-DETAIL-001] getDepartmentById yêu cầu department.read', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.getDepartmentById,
      );
      expect(perms).toEqual(['department.read']);
    });

    it('[ACCT-DEPT-DEACTIVATE-001] deactivateDepartment yêu cầu department.deactivate', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.deactivateDepartment,
      );
      expect(perms).toEqual(['department.deactivate']);
    });

    it('[ACCT-DEPT-DEACTIVATE-001] reactivateDepartment yêu cầu department.deactivate', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.reactivateDepartment,
      );
      expect(perms).toEqual(['department.deactivate']);
    });
  });
});
