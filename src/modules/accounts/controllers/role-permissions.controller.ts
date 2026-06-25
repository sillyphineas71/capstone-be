import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RolePermissionsService } from '../services/role-permissions.service.js';
import { AssignPermissionsDto } from '../dto/assign-permissions.dto.js';

@Controller('roles/:roleId/permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolePermissionsController {
  constructor(
    private readonly rolePermissionsService: RolePermissionsService,
  ) {}

  @Get()
  @RequirePermissions('admin.manage_permissions')
  async findByRole(@Param('roleId') roleId: string) {
    const data = await this.rolePermissionsService.findByRole(roleId);
    return {
      success: true,
      message: 'Danh sách permission của role',
      data,
    };
  }

  @Post()
  @RequirePermissions('admin.manage_permissions')
  async assign(
    @Param('roleId') roleId: string,
    @Body() dto: AssignPermissionsDto,
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

    const data = await this.rolePermissionsService.assign(roleId, dto, userId);

    const httpStatus =
      data.assigned.length > 0 ? HttpStatus.CREATED : HttpStatus.OK;

    return {
      success: true,
      message:
        data.assigned.length > 0
          ? 'Permission đã được gán thành công'
          : 'Không có permission mới nào được gán (tất cả đã được skip)',
      data,
      _statusCode: httpStatus,
    };
  }

  @Delete(':permissionId')
  @RequirePermissions('admin.manage_permissions')
  async revoke(
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
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

    await this.rolePermissionsService.revoke(roleId, permissionId, userId);
    return {
      success: true,
      message: 'Permission đã được gỡ khỏi role thành công',
    };
  }
}
