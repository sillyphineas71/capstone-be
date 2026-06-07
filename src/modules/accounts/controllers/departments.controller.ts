import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
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
import { DepartmentResponseDto } from '../dto/department-response.dto.js';

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
  ): Promise<{ success: boolean; message: string; data: DepartmentResponseDto }> {
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
}

