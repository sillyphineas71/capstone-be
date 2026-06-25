import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
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
import { UserResponseDto } from '../dto/user-response.dto.js';
import { UserDetailResponseDto } from '../dto/user-detail-response.dto.js';
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
  async listUsers(
    @Query() query: ListUsersQueryDto,
  ): Promise<{
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
}
