import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ParseUUIDPipe,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RolesService } from '../services/roles.service.js';
import { CreateRoleDto } from '../dto/create-role.dto.js';
import { UpdateRoleDto } from '../dto/update-role.dto.js';
import { ListRolesQueryDto } from '../dto/list-roles-query.dto.js';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('account.role.read')
  async findAll(@Query() query: ListRolesQueryDto) {
    const { data, total } = await this.rolesService.findAll(query);
    const page = query.page || 1;
    const limit = query.limit || 20;
    return {
      success: true,
      message: 'Danh sach role',
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
  @RequirePermissions('account.role.read')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.rolesService.findOne(id);
    return {
      success: true,
      message: 'Chi tiet role',
      data,
    };
  }

  @Post()
  @RequirePermissions('account.role.create')
  @HttpCode(HttpStatus.CREATED)
  // Repo KHONG co global ValidationPipe (main.ts) => phai khai tuong minh, neu khong
  // decorator tren CreateRoleDto khong chay (roleCode mat regex + uppercase-transform,
  // thieu roleName => NOT NULL => 500). Dat o METHOD, khong dat o controller: route GET
  // dung query DTO co @Max(100) trong khi FE goi limit=500 => se 400 oan.
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: { userId: string } | undefined,
  ) {
    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException({
        success: false,
        message: 'Khong the xac dinh nguoi dung tu token.',
        error: { code: 'UNAUTHORIZED' },
      });
    }
    const data = await this.rolesService.create(dto, userId);
    return {
      success: true,
      message: 'Role da duoc tao thanh cong',
      data,
    };
  }

  @Patch(':id')
  @RequirePermissions('account.role.update')
  // KHONG bat whitelist o route nay: handler co doc rawDto.roleCode/isSystemRole de tra
  // 400 tuong minh (immutable field). whitelist se strip 2 field do truoc khi vao handler
  // => request doi roleCode se am tham 200 thay vi bao loi.
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: { userId: string } | undefined,
  ) {
    const rawDto = dto as Record<string, unknown>;
    if (rawDto.roleCode) {
      throw new BadRequestException({
        success: false,
        message: 'roleCode khong the thay doi sau khi tao.',
        error: {
          code: 'VALIDATION_ERROR',
          details: { field: 'roleCode' },
        },
      });
    }
    if (rawDto.isSystemRole !== undefined) {
      throw new BadRequestException({
        success: false,
        message: 'isSystemRole khong the thay doi qua API.',
        error: {
          code: 'VALIDATION_ERROR',
          details: { field: 'isSystemRole' },
        },
      });
    }

    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException({
        success: false,
        message: 'Khong the xac dinh nguoi dung tu token.',
        error: { code: 'UNAUTHORIZED' },
      });
    }

    const data = await this.rolesService.update(id, dto, userId);
    return {
      success: true,
      message: 'Role da duoc cap nhat thanh cong',
      data,
    };
  }

  @Delete(':id')
  @RequirePermissions('account.role.delete')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { userId: string } | undefined,
  ) {
    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException({
        success: false,
        message: 'Khong the xac dinh nguoi dung tu token.',
        error: { code: 'UNAUTHORIZED' },
      });
    }
    await this.rolesService.remove(id, userId);
    return {
      success: true,
      message: 'Role da duoc xoa (vo hieu hoa) thanh cong',
    };
  }
}
