import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { PersonControlListService } from '../services/person-control-list.service.js';
import { CreatePersonControlListDto } from '../dto/create-person-control-list.dto.js';
import { UpdatePersonControlListDto } from '../dto/update-person-control-list.dto.js';
import { QueryPersonControlListDto } from '../dto/query-person-control-list.dto.js';
import { toPersonControlListResponse } from '../dto/person-control-list-response.dto.js';

const PERSON_CONTROL_LIST_PIPE = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/**
 * PersonControlListController (PWL-001 / UC-125) — CRUD `person_control_list`
 * (watchlist người), mirror `VehicleControlListController`. Toàn bộ route
 * admin/security-gated, KHÔNG route self-service.
 */
@ApiTags('Alerts - Person Control List')
@Controller('person-control-list')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PersonControlListController {
  constructor(
    private readonly personControlListService: PersonControlListService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('person_control_list.create')
  @UsePipes(PERSON_CONTROL_LIST_PIPE)
  @ApiOperation({ summary: 'Thêm 1 người vào danh sách kiểm soát (watchlist/blocklist)' })
  async create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreatePersonControlListDto,
  ) {
    const entity = await this.personControlListService.create(dto, user.userId);
    return {
      success: true,
      message: 'Person control list entry created successfully',
      data: toPersonControlListResponse(entity),
    };
  }

  @Get()
  @RequirePermissions('person_control_list.read')
  @UsePipes(PERSON_CONTROL_LIST_PIPE)
  @ApiOperation({ summary: 'Xem danh sách người trong danh sách kiểm soát, có phân trang + lọc' })
  async list(@Query() query: QueryPersonControlListDto) {
    const { items, meta } = await this.personControlListService.list(query);
    return {
      success: true,
      message: 'Person control list retrieved successfully',
      data: items.map(toPersonControlListResponse),
      meta,
    };
  }

  @Get(':id')
  @RequirePermissions('person_control_list.read')
  @ApiOperation({ summary: 'Xem chi tiết 1 mục trong danh sách kiểm soát người theo ID' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const entity = await this.personControlListService.findOne(id);
    return {
      success: true,
      message: 'Person control list entry retrieved successfully',
      data: toPersonControlListResponse(entity),
    };
  }

  @Patch(':id')
  @RequirePermissions('person_control_list.update')
  @UsePipes(PERSON_CONTROL_LIST_PIPE)
  @ApiOperation({ summary: 'Cập nhật 1 mục trong danh sách kiểm soát người' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonControlListDto,
  ) {
    const entity = await this.personControlListService.update(id, dto);
    return {
      success: true,
      message: 'Person control list entry updated successfully',
      data: toPersonControlListResponse(entity),
    };
  }

  @Delete(':id')
  @RequirePermissions('person_control_list.delete')
  @ApiOperation({ summary: 'Xóa 1 mục khỏi danh sách kiểm soát người' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.personControlListService.remove(id);
    return {
      success: true,
      message: 'Person control list entry deleted successfully',
      data: null,
    };
  }
}
