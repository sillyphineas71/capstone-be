import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller.js';
import { UsersService } from '../services/users.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';

describe('UsersController', () => {
  let controller: UsersController;
  let service: { createUser: jest.Mock; getUserDetail: jest.Mock };

  beforeEach(async () => {
    service = {
      createUser: jest.fn(),
      getUserDetail: jest.fn(),
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
});
