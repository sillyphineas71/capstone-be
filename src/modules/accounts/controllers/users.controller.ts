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
import { UpdateUserDto } from '../dto/update-user.dto.js';
import { UpdateUserStatusDto } from '../dto/update-user-status.dto.js';
import { LockUserDto } from '../dto/lock-user.dto.js';
import { UpdateUserRolesDto } from '../dto/update-user-roles.dto.js';
import {
  UserResponseDto,
  UserRoleResponseDto,
} from '../dto/user-response.dto.js';
import { UserDetailResponseDto } from '../dto/user-detail-response.dto.js';
import { UserPublicProfileResponseDto } from '../dto/user-public-profile-response.dto.js';
import { ListUsersQueryDto } from '../dto/list-users-query.dto.js';
import { UserListItemDto } from '../dto/user-list-item.dto.js';
import { ManageUsersQueryDto } from '../dto/manage-users-query.dto.js';
import { ManageUserItemDto } from '../dto/manage-user-item.dto.js';

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

  // ⚠️ Route order: khai báo ':userId/lock' và ':userId/unlock' TRƯỚC ':userId'
  // (UC-09) để route cụ thể hơn không bị pattern ':userId' nuốt.
  @Patch(':userId/lock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.lock')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Khóa tài khoản người dùng',
    description:
      'Cho phép System Admin (toàn hệ thống) và Business Admin (giới hạn department scope) khóa một tài khoản (kỷ luật/bảo mật). Tài khoản chuyển LOCKED, mọi session bị thu hồi ngay, dữ liệu lịch sử (vai trò, hồ sơ) giữ nguyên. Lý do khóa (tùy chọn) được ghi vào nhật ký kiểm toán.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần khóa',
    type: String,
  })
  @ApiBody({ type: LockUserDto, required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tài khoản đã được khóa thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.lock) hoặc ngoài phạm vi department.',
  })
  async lockUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/lock',
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
    dto: LockUserDto,
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

    const result = await this.usersService.lockUser(
      userId,
      dto.reason,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Đã khóa tài khoản thành công',
      data: result,
    };
  }

  @Patch(':userId/unlock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.unlock')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mở khóa tài khoản người dùng',
    description:
      'Cho phép System Admin và Business Admin (giới hạn department scope) mở khóa một tài khoản đang bị khóa, đưa về trạng thái active và đặt lại bộ đếm đăng nhập thất bại.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần mở khóa',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tài khoản đã được mở khóa thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.unlock) hoặc ngoài phạm vi department.',
  })
  async unlockUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/unlock',
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
    data: { id: string; accountStatus: string };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.unlockUser(userId, actorId, {
      ipAddress,
      userAgent,
      requestId,
    });

    return {
      success: true,
      message: 'Đã mở khóa tài khoản thành công',
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

  // ⚠️ Route order: khai báo path tĩnh 'manage' TRƯỚC ':userId' để không bị
  // pattern ':userId' nuốt "manage".
  @Get('manage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lọc danh sách tài khoản (quản trị)',
    description:
      'Cho phép System Admin (toàn hệ thống) và Business Admin (giới hạn department scope) lọc danh sách tài khoản theo phòng ban / vai trò / trạng thái, kết hợp tìm kiếm theo tên/email/mã NV, có sắp xếp và phân trang. Endpoint quản trị (khác endpoint autocomplete GET /users).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách tài khoản (đã lọc, sắp xếp, phân trang).',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.manage) hoặc ngoài phạm vi department.',
  })
  async listUsersForManagement(
    @Query() query: ManageUsersQueryDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: ManageUserItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const page = query.page || 1;
    const limit = query.limit || 20;

    const { data, total } = await this.usersService.listUsersForManagement(
      query,
      actorId,
    );

    return {
      success: true,
      message: 'Lấy danh sách tài khoản thành công',
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
