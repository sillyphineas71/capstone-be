import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { PermissionsService } from '../services/permissions.service.js';
import { CreatePermissionDto } from '../dto/create-permission.dto.js';
import { UpdatePermissionDto } from '../dto/update-permission.dto.js';
import { PaginationQueryDto } from '../dto/pagination-query.dto.js';

@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions('admin.manage_permissions', 'permission.read')
  async findAll(@Query() query: PaginationQueryDto) {
    const { data, total } = await this.permissionsService.findAll(query);
    const page = query.page || 1;
    const limit = query.limit || 20;
    return {
      success: true,
      message: 'Danh sách permission',
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get(':id')
  @RequirePermissions('admin.manage_permissions', 'permission.read')
  async findOne(@Param('id') id: string) {
    const data = await this.permissionsService.findOne(id);
    return {
      success: true,
      message: 'Chi tiết permission',
      data,
    };
  }

  @Post()
  @RequirePermissions('admin.manage_permissions')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreatePermissionDto,
    @CurrentUser() user: { userId: string } | undefined,
  ) {
    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException({
        success: false,
        message: 'Không thể xác định người dùng từ token.',
        error: { code: 'UNAUTHORIZED' },
      });
    }
    const data = await this.permissionsService.create(dto, userId);
    return {
      success: true,
      message: 'Permission đã được tạo thành công',
      data,
    };
  }

  @Patch(':id')
  @RequirePermissions('admin.manage_permissions')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePermissionDto,
    @CurrentUser() user: { userId: string } | undefined,
  ) {
    // Reject if permissionCode sent in body (immutable field)
    if ((dto as any).permissionCode) {
      throw new BadRequestException({
        success: false,
        message: 'permissionCode không thể thay đổi sau khi tạo.',
        error: { code: 'VALIDATION_ERROR', details: { field: 'permissionCode' } },
      });
    }

    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException({
        success: false,
        message: 'Không thể xác định người dùng từ token.',
        error: { code: 'UNAUTHORIZED' },
      });
    }

    const data = await this.permissionsService.update(id, dto, userId);
    return {
      success: true,
      message: 'Permission đã được cập nhật thành công',
      data,
    };
  }

  @Post(':id/toggle-active')
  @RequirePermissions('admin.manage_permissions')
  async toggleActive(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string } | undefined,
  ) {
    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException({
        success: false,
        message: 'Không thể xác định người dùng từ token.',
        error: { code: 'UNAUTHORIZED' },
      });
    }

    const data = await this.permissionsService.toggleActive(id, userId);
    return {
      success: true,
      message: `Permission đã được ${data.isActive ? 'kích hoạt' : 'vô hiệu hóa'} thành công`,
      data,
    };
  }
}
