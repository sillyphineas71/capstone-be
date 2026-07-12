import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ParseUUIDPipe, HttpStatus } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UsersController } from './users.controller.js';
import { UsersService } from '../services/users.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { UpdateUserRolesDto } from '../dto/update-user-roles.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('UsersController', () => {
  let controller: UsersController;
  let service: {
    createUser: jest.Mock;
    getUserDetail: jest.Mock;
    getPublicProfile: jest.Mock;
    updateUserRoles: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createUser: jest.fn(),
      getUserDetail: jest.fn(),
      getPublicProfile: jest.fn(),
      updateUserRoles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createUser', () => {
    it('should call UsersService.createUser and return response in standard success format', async () => {
      const dto: CreateUserDto = {
        fullName: 'Nguyen Van A',
        email: 'nva@company.com',
        departmentId: 'dept-uuid',
        roleIds: ['role-uuid'],
      };

      const mockUserResult = {
        id: 'new-user-uuid',
        employeeCode: null,
        email: 'nva@company.com',
        fullName: 'Nguyen Van A',
        accountStatus: 'active',
        mustChangePassword: true,
        roles: [
          { id: 'role-uuid', roleCode: 'employee', roleName: 'Employee' },
        ],
        createdAt: new Date(),
      };

      service.createUser.mockResolvedValue(mockUserResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.createUser(
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.createUser).toHaveBeenCalledWith(dto, 'admin-uuid', {
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        requestId: 'req-id',
      });

      expect(result).toEqual({
        success: true,
        message:
          'Nhân viên đã được tạo thành công và thông tin đăng nhập đã được gửi tới email.',
        data: mockUserResult,
      });
    });
  });

  describe('getUserDetail', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    const mockDetailResult = {
      id: validUserId,
      employeeCode: 'EMP001',
      email: 'user@company.com',
      fullName: 'Nguyen Van A',
      phoneNumber: '0909123456',
      avatarUrl: null,
      positionTitle: 'Software Engineer',
      department: { id: 'dept-id', departmentName: 'IT Department' },
      directManager: { id: 'mgr-id', fullName: 'Tran Van B' },
      accountStatus: 'active',
      employmentStatus: 'active',
      mustChangePassword: false,
      lastLoginAt: '2026-06-07T10:30:00.000Z',
      roles: [{ id: 'role-id', roleCode: 'EMPLOYEE', roleName: 'Nhan vien' }],
      hasFaceProfile: true,
      createdAt: '2026-01-15T08:00:00.000Z',
    };

    it('[HP1] Happy path — gọi service với đúng params, response format (AC-001)', async () => {
      service.getUserDetail.mockResolvedValue(mockDetailResult);

      const request = {
        user: { userId: 'admin-uuid' },
      } as unknown as Request;

      const result = await controller.getUserDetail(
        validUserId,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.getUserDetail).toHaveBeenCalledWith(
        validUserId,
        'admin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );

      expect(result).toEqual({
        success: true,
        message: 'User detail retrieved successfully',
        data: mockDetailResult,
      });
    });
  });

  describe('getPublicProfile', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    const mockPublicProfileResult = {
      id: validUserId,
      fullName: 'Nguyen Van A',
      email: 'a.nguyen@company.com',
      employeeCode: 'EMP001',
      department: { id: 'dept-id', departmentName: 'Phong Ky Thuat' },
      avatarUrl: 'https://res.cloudinary.com/demo/image/upload/avatar.jpg',
    };

    it('[AC-001] Happy path — gọi service đúng userId, response format chuẩn', async () => {
      service.getPublicProfile.mockResolvedValue(mockPublicProfileResult);

      const result = await controller.getPublicProfile(validUserId);

      expect(service.getPublicProfile).toHaveBeenCalledWith(validUserId);
      expect(result).toEqual({
        success: true,
        message: 'Lấy hồ sơ công khai thành công',
        data: mockPublicProfileResult,
      });
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { getPublicProfile } = UsersController.prototype;

    it('[AC-003] Endpoint chỉ áp dụng JwtAuthGuard, KHÔNG có PermissionsGuard — mọi role đều truy cập được', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        getPublicProfile,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard]);
      expect(guards).not.toContain(PermissionsGuard);
    });

    it('[AC-004] userId không hợp lệ → ParseUUIDPipe reject với code INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/public-profile',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });
  });

  describe('updateUserRoles', () => {
    const validUserId = '550e8400-e29b-41d4-a716-446655440000';

    it('[C1] Success — gọi service đúng params & trả response format chuẩn', async () => {
      const dto: UpdateUserRolesDto = {
        roleIds: ['role-uuid-1', 'role-uuid-2'],
      };
      const mockResult = {
        userId: validUserId,
        roles: [
          { id: 'role-uuid-1', roleCode: 'MANAGER', roleName: 'Quản lý' },
        ],
      };
      service.updateUserRoles.mockResolvedValue(mockResult);

      const request = {
        user: { userId: 'sysadmin-uuid' },
      } as unknown as Request;

      const result = await controller.updateUserRoles(
        validUserId,
        dto,
        request,
        '127.0.0.1',
        'Mozilla/5.0',
        'req-id',
      );

      expect(service.updateUserRoles).toHaveBeenCalledWith(
        validUserId,
        dto.roleIds,
        'sysadmin-uuid',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-id',
        },
      );
      expect(result).toEqual({
        success: true,
        message: 'Cập nhật vai trò tài khoản thành công',
        data: mockResult,
      });
    });

    it('[C2] userId không hợp lệ → ParseUUIDPipe reject code INVALID_USER_ID (400)', async () => {
      const pipe = new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/roles',
        }),
      });

      await expect(
        pipe.transform('not-a-valid-uuid', {} as never),
      ).rejects.toMatchObject({
        error: { code: 'INVALID_USER_ID', details: {} },
      });
    });

    it('[C3] roleIds rỗng → DTO @ArrayNotEmpty báo lỗi validation (400)', async () => {
      const dto = plainToInstance(UpdateUserRolesDto, { roleIds: [] });
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('roleIds');
      expect(errors[0].constraints).toHaveProperty('arrayNotEmpty');
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { updateUserRoles } = UsersController.prototype;

    it('[C4] Endpoint áp dụng JwtAuthGuard + PermissionsGuard (401/403 gate)', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        updateUserRoles,
      ) as unknown[];

      expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    });

    it('[C5] Yêu cầu permission accounts.user.update_roles (403 nếu thiếu)', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        updateUserRoles,
      ) as string[];

      expect(permissions).toEqual(['accounts.user.update_roles']);
    });
  });
});
