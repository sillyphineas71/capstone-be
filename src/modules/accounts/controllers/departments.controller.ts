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
  Patch,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

import { DepartmentsService } from '../services/departments.service.js';
import { CreateDepartmentDto } from '../dto/create-department.dto.js';
import { UpdateDepartmentDto } from '../dto/update-department.dto.js';
import { DepartmentResponseDto } from '../dto/department-response.dto.js';
import { ListDepartmentsQueryDto } from '../dto/list-departments-query.dto.js';
import { PaginationMeta } from '../dto/pagination-meta.dto.js';
import { DepartmentMemberItemDto } from '../dto/department-member-item.dto.js';

@ApiTags('Accounts')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  // ── POST /departments ──────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('department.create')
  @ApiBearerAuth()
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Khởi tạo phòng ban mới',
    description:
      'Cho phép Admin/Manager tạo phòng ban mới với mã, tên, phòng ban cha, người quản lý và mô tả.',
  })
  @ApiBody({ type: CreateDepartmentDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Phòng ban được tạo thành công.',
    type: DepartmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Thiếu hoặc sai dữ liệu đầu vào.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission department.create).',
  })
  async createDepartment(
    @Body() createDepartmentDto: CreateDepartmentDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
    @Headers('Idempotency-Key') idempotencyKey?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: DepartmentResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const creatorId = user?.userId || 'system';

    const result = await this.departmentsService.createDepartment(
      createDepartmentDto,
      creatorId,
      { ipAddress, userAgent, requestId },
      idempotencyKey,
    );

    return {
      success: true,
      message: 'Khởi tạo phòng ban thành công',
      data: result,
    };
  }

  // ── GET /departments ───────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('department.read')
  @ApiBearerAuth()
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Liệt kê phòng ban',
    description:
      'Trả về danh sách phòng ban (phục vụ dropdown FE). Hỗ trợ search (tên/mã), phân trang (page/limit), lọc theo parentId. Yêu cầu permission department.read.',
  })
  @ApiQuery({ name: 'search', required: false, type: 'string' })
  @ApiQuery({ name: 'page', required: false, type: 'number' })
  @ApiQuery({ name: 'limit', required: false, type: 'number' })
  @ApiQuery({
    name: 'parentId',
    required: false,
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách phòng ban.',
    type: [DepartmentResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission department.read).',
  })
  async listDepartments(@Query() query: ListDepartmentsQueryDto): Promise<{
    success: boolean;
    message: string;
    data: DepartmentResponseDto[];
    meta: PaginationMeta;
  }> {
    const result = await this.departmentsService.listDepartments(query);

    return {
      success: true,
      message: 'Lấy danh sách phòng ban thành công',
      data: result.data,
      meta: result.meta,
    };
  }

  // ── GET /departments/:id — ACCT-DEPT-DETAIL-001 ───────────────────────────
  // QUAN TRỌNG: route này phải được đặt TRƯỚC :id/members để NestJS khớp đúng
  // thứ tự. Hiện tại không có xung đột vì :id/members có suffix /members.

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('department.read')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem chi tiết 1 phòng ban',
    description:
      'Trả về đúng 1 bản ghi phòng ban theo id. isActive=false vẫn được trả về. Tái dùng permission department.read — không cần permission mới. (ACCT-DEPT-DETAIL-001)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chi tiết phòng ban.',
    type: DepartmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Phòng ban không tồn tại hoặc đã bị xóa.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission department.read).',
  })
  async getDepartmentById(@Param('id', ParseUUIDPipe) id: string): Promise<{
    success: boolean;
    message: string;
    data: DepartmentResponseDto;
  }> {
    const data = await this.departmentsService.getDepartmentById(id);

    return {
      success: true,
      message: 'Lấy chi tiết phòng ban thành công',
      data,
    };
  }

  // ── GET /departments/:id/members ──────────────────────────────────────────

  @Get(':id/members')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.list')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sách nhân viên trực thuộc trực tiếp 1 phòng ban',
    description:
      'Trả về toàn bộ nhân viên đang hoạt động (employment_status active/probation, account_status active) trực thuộc TRỰC TIẾP phòng ban (không đệ quy phòng ban con). Không phân trang. Dùng để FE nạp nhanh cả phòng ban vào danh sách người tham dự khi đặt lịch họp. Yêu cầu permission accounts.user.list (cùng permission dùng cho GET /users).',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách nhân viên phòng ban.',
    type: [DepartmentMemberItemDto],
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Phòng ban không tồn tại hoặc đã bị xóa.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.list).',
  })
  async listDepartmentMembers(@Param('id', ParseUUIDPipe) id: string): Promise<{
    success: boolean;
    message: string;
    data: DepartmentMemberItemDto[];
  }> {
    const data = await this.departmentsService.listDepartmentMembers(id);

    return {
      success: true,
      message: 'Lấy danh sách nhân viên phòng ban thành công',
      data,
    };
  }

  // ── PATCH /departments/:id ────────────────────────────────────────────────

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('department.update')
  @ApiBearerAuth()
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Cập nhật phòng ban',
    description:
      'Cho phép Admin/Manager cập nhật tên, phòng ban cha, người quản lý, mô tả. KHÔNG cho sửa departmentCode. BREAKING CHANGE (2026-08-12, ACCT-DEPT-DEACTIVATE-001): field isActive đã bị xóa khỏi endpoint này — dùng POST /departments/:id/deactivate và /reactivate thay thế.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateDepartmentDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Phòng ban được cập nhật thành công.',
    type: DepartmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Body rỗng — không có trường nào để cập nhật, hoặc gửi field isActive (đã bị xóa khỏi endpoint này).',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Phòng ban/phòng ban cha/người quản lý không tồn tại.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Tên phòng ban đã được sử dụng.',
  })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'Chu trình cha-con hoặc vượt quá độ sâu phân cấp cho phép.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission department.update).',
  })
  async updateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: DepartmentResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const updaterId = user?.userId || 'system';

    const result = await this.departmentsService.updateDepartment(
      id,
      updateDepartmentDto,
      updaterId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Cập nhật phòng ban thành công',
      data: result,
    };
  }

  // ── ACCT-DEPT-DEACTIVATE-001 ───────────────────────────────────────────────

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('department.deactivate')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Vô hiệu hoá phòng ban',
    description:
      'Đặt isActive=false. Business rules: từ chối nếu còn phòng ban con active (409 DEPARTMENT_HAS_ACTIVE_CHILDREN) hoặc nhân viên active (409 DEPARTMENT_HAS_ACTIVE_MEMBERS). Không cho deactivate PARTNER_DEPARTMENT_ID (403). (ACCT-DEPT-DEACTIVATE-001)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Phòng ban đã bị vô hiệu hoá.',
    type: DepartmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Phòng ban không tồn tại hoặc đã bị xóa.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'DEPARTMENT_ALREADY_INACTIVE | DEPARTMENT_HAS_ACTIVE_CHILDREN | DEPARTMENT_HAS_ACTIVE_MEMBERS',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission department.deactivate) hoặc PARTNER_DEPARTMENT_PROTECTED.',
  })
  async deactivateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: DepartmentResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const data = await this.departmentsService.deactivateDepartment(
      id,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Vô hiệu hoá phòng ban thành công',
      data,
    };
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('department.deactivate')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Kích hoạt lại phòng ban',
    description:
      'Đặt isActive=true. Business rules: từ chối nếu phòng ban cha đang inactive (409 PARENT_DEPARTMENT_INACTIVE). PARTNER_DEPARTMENT_ID không bị chặn khi reactivate. (ACCT-DEPT-DEACTIVATE-001)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Phòng ban đã được kích hoạt lại.',
    type: DepartmentResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Phòng ban không tồn tại hoặc đã bị xóa.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'DEPARTMENT_ALREADY_ACTIVE | PARENT_DEPARTMENT_INACTIVE',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission department.deactivate).',
  })
  async reactivateDepartment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: DepartmentResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const data = await this.departmentsService.reactivateDepartment(
      id,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Kích hoạt lại phòng ban thành công',
      data,
    };
  }
}
