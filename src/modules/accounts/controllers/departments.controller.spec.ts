/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
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
  };
  let reflector: Reflector;

  beforeEach(async () => {
    service = {
      createDepartment: jest.fn(),
      listDepartments: jest.fn(),
      listDepartmentMembers: jest.fn(),
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
  });
});
