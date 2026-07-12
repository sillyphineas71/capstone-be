import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

import { UsersService } from '../services/users.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { UpdateUserDto } from '../dto/update-user.dto.js';
import { UpdateUserStatusDto } from '../dto/update-user-status.dto.js';
import { UpdateUserRolesDto } from '../dto/update-user-roles.dto.js';
import {
  UserResponseDto,
  UserRoleResponseDto,
} from '../dto/user-response.dto.js';
import { UserDetailResponseDto } from '../dto/user-detail-response.dto.js';
import { UserPublicProfileResponseDto } from '../dto/user-public-profile-response.dto.js';
import { ListUsersQueryDto } from '../dto/list-users-query.dto.js';
import { UserListItemDto } from '../dto/user-list-item.dto.js';

@ApiTags('Accounts')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.create')
  @ApiBearerAuth()
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: 'Tạo tài khoản nhân viên thủ công',
    description:
      'Cho phép Manager/Admin tạo tài khoản cho nhân viên mới, gán vai trò và xếp hàng gửi email thông tin đăng nhập.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Tài khoản nhân viên được tạo thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.create).',
  })
  async createUser(
    @Body() createUserDto: CreateUserDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{ success: boolean; message: string; data: UserResponseDto }> {
    const user = request['user'] as { userId: string } | undefined;
    const creatorId = user?.userId || 'system';

    const result = await this.usersService.createUser(
      createUserDto,
      creatorId,
      {
        ipAddress,
        userAgent,
        requestId,
      },
    );

    return {
      success: true,
      message:
        'Nhân viên đã được tạo thành công và thông tin đăng nhập đã được gửi tới email.',
      data: result,
    };
  }

  @Put(':userId/roles')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.update_roles')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật vai trò tài khoản (replace-set)',
    description:
      'Cho phép System Admin thay thế toàn bộ tập vai trò của một tài khoản. Nhận full desired roleIds[]; hệ thống tự soft-remove vai trò bị bỏ và gán vai trò được thêm theo RBAC.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần cập nhật vai trò',
    type: String,
  })
  @ApiBody({ type: UpdateUserRolesDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vai trò tài khoản được cập nhật thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.update_roles).',
  })
  async updateUserRoles(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/roles',
        }),
      }),
    )
    userId: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateUserRolesDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { userId: string; roles: UserRoleResponseDto[] };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.updateUserRoles(
      userId,
      dto.roleIds,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Cập nhật vai trò tài khoản thành công',
      data: result,
    };
  }

  // ⚠️ Route order: khai báo ':userId/status' TRƯỚC ':userId' (UC-09) để route
  // cụ thể hơn không bị pattern ':userId' nuốt.
  @Patch(':userId/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.update_status')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật trạng thái tài khoản (ACTIVE/INACTIVE)',
    description:
      'Cho phép System Admin (toàn hệ thống) và Business Admin (giới hạn department scope) chuyển trạng thái tài khoản giữa active và inactive. Tài khoản inactive bị chặn đăng nhập; khi vô hiệu hóa, token đang hoạt động bị thu hồi ngay. Không dùng để khóa (locked) hay đổi trạng thái đặt lại mật khẩu.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần đổi trạng thái',
    type: String,
  })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trạng thái tài khoản được cập nhật thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.update_status) hoặc ngoài phạm vi department.',
  })
  async updateUserStatus(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/status',
        }),
      }),
    )
    userId: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateUserStatusDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { id: string; accountStatus: string };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.updateUserStatus(
      userId,
      dto.status,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Cập nhật trạng thái tài khoản thành công',
      data: result,
    };
  }

  @Patch(':userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.update')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật thông tin tài khoản nhân sự',
    description:
      'Cho phép System Admin (toàn hệ thống) và Business Admin (giới hạn department scope) cập nhật một phần thông tin hồ sơ: họ tên, mã nhân viên, số điện thoại, chức danh, phòng ban. Không đổi email/vai trò/trạng thái tài khoản qua endpoint này.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần cập nhật thông tin',
    type: String,
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Thông tin tài khoản được cập nhật thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.update) hoặc ngoài phạm vi department.',
  })
  async updateUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      }),
    )
    userId: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateUserDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UserDetailResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.updateUser(userId, dto, actorId, {
      ipAddress,
      userAgent,
      requestId,
    });

    return {
      success: true,
      message: 'Cập nhật thông tin tài khoản thành công',
      data: result,
    };
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.delete')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xóa tài khoản người dùng (soft-delete)',
    description:
      'Cho phép System Admin xóa (soft-delete) một tài khoản chưa phát sinh dữ liệu ràng buộc. Thu hồi token và vô hiệu hóa vai trò của tài khoản. Chặn xóa nếu còn ràng buộc active (đang tổ chức/tham dự cuộc họp sắp tới, có booking hiệu lực, là quản lý trực tiếp/trưởng phòng ban).',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần xóa',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Đã xóa tài khoản thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.delete).',
  })
  async deleteUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      }),
    )
    userId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    await this.usersService.deleteUser(userId, actorId, {
      ipAddress,
      userAgent,
      requestId,
    });

    return {
      success: true,
      message: 'Đã xóa tài khoản thành công',
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.list')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tìm kiếm/danh sách rút gọn người dùng nội bộ',
    description:
      'Trả về danh sách rút gọn (id, fullName, email) của người dùng đang active, dùng cho autocomplete (ví dụ chọn người tham dự cuộc họp). Hỗ trợ tìm theo tên/email và pagination.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách người dùng (rút gọn).',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.list).',
  })
  async listUsers(@Query() query: ListUsersQueryDto): Promise<{
    success: boolean;
    message: string;
    data: UserListItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const { data, total } = await this.usersService.listUsers(query);

    return {
      success: true,
      message: 'Lấy danh sách người dùng thành công',
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':userId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('account.user.read.detail')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem chi tiết hồ sơ tài khoản',
    description:
      'Cho phép System Admin hoặc Business Admin xem chi tiết hồ sơ của một tài khoản nhân sự. Business Admin bị giới hạn department scope.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần xem chi tiết',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chi tiết hồ sơ tài khoản.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn hoặc ngoài phạm vi department.',
  })
  async getUserDetail(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      }),
    )
    userId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UserDetailResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const authenticatedUserId = user?.userId || 'system';

    const result = await this.usersService.getUserDetail(
      userId,
      authenticatedUserId,
      {
        ipAddress,
        userAgent,
        requestId,
      },
    );

    return {
      success: true,
      message: 'User detail retrieved successfully',
      data: result,
    };
  }

  @Get(':userId/public-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem hồ sơ công khai tài khoản',
    description:
      'Cho phép bất kỳ user đã đăng nhập xem hồ sơ công khai rút gọn (id, fullName, email, employeeCode, department, avatarUrl) của một tài khoản khác. Không yêu cầu permission/role quản trị.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần xem hồ sơ công khai',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Hồ sơ công khai của tài khoản.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  async getPublicProfile(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/public-profile',
        }),
      }),
    )
    userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UserPublicProfileResponseDto;
  }> {
    const result = await this.usersService.getPublicProfile(userId);

    return {
      success: true,
      message: 'Lấy hồ sơ công khai thành công',
      data: result,
    };
  }
}
