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
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

import { UsersService } from '../services/users.service.js';
import { AccountImportService } from '../services/account-import.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { ImportAccountsDto } from '../dto/import-accounts.dto.js';
import { ImportAccountReportDto } from '../dto/import-accounts-response.dto.js';
import { XLSX_MIME } from '../constants/import-accounts.constants.js';
import { UserResponseDto } from '../dto/user-response.dto.js';
import { UserDetailResponseDto } from '../dto/user-detail-response.dto.js';
import { UserPublicProfileResponseDto } from '../dto/user-public-profile-response.dto.js';
import { ListUsersQueryDto } from '../dto/list-users-query.dto.js';
import { UserListItemDto } from '../dto/user-list-item.dto.js';

@ApiTags('Accounts')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountImportService: AccountImportService,
  ) {}

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

  @Get('import/template')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.import')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tải tệp Excel mẫu để import tài khoản nhân viên',
    description:
      'Trả về file .xlsx chứa header chuẩn (full_name, email, department_code, role_codes, employee_code, phone_number, position_title, direct_manager_email), dòng ví dụ và sheet hướng dẫn.',
  })
  async downloadImportTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.accountImportService.generateTemplate();
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="employee-accounts-template.xlsx"',
    );
    res.send(buffer);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tạo tài khoản nhân viên bằng import Excel',
    description:
      'Tải lên file .xlsx danh sách nhân viên. commit=false trả preview kiểm tra (không ghi DB); commit=true tạo tài khoản cho các dòng hợp lệ (bỏ dòng lỗi), sinh mật khẩu tạm và gửi email credentials cho từng người.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commit: { type: 'boolean' },
      },
      required: ['file'],
    },
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.import).',
  })
  async importAccounts(
    @UploadedFile()
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
    @Body() dto: ImportAccountsDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: ImportAccountReportDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.accountImportService.importAccounts(
      file,
      { commit: dto.commit },
      { userId: actorId },
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message:
        result.mode === 'commit'
          ? 'Tạo tài khoản hoàn tất'
          : 'Kiểm tra hoàn tất',
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
