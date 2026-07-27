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

@ApiTags('Accounts')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

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
      'Cho phép Admin/Manager cập nhật tên, phòng ban cha, người quản lý, mô tả, trạng thái hoạt động. KHÔNG cho sửa departmentCode.',
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
    description: 'Body rỗng — không có trường nào để cập nhật.',
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
}
