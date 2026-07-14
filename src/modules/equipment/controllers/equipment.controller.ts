import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';

import { EquipmentService } from '../services/equipment.service.js';
import { CreateEquipmentDto } from '../dto/create-equipment.dto.js';
import { ReportEquipmentFaultDto } from '../dto/report-equipment-fault.dto.js';
import { ListEquipmentsQueryDto } from '../dto/list-equipments-query.dto.js';
import { EquipmentResponseDto } from '../dto/equipment-response.dto.js';

@ApiTags('Equipment')
@Controller('equipments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Dang ky thiet bi hop moi' })
  @ApiBody({ type: CreateEquipmentDto })
  @ApiResponse({ status: 201, description: 'Dang ky thiet bi thanh cong' })
  @ApiResponse({
    status: 400,
    description: 'Thieu truong bat buoc / field cam',
  })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.create' })
  @ApiResponse({
    status: 409,
    description: 'Trung serialNumber hoac equipmentCode',
  })
  @ApiResponse({ status: 422, description: 'Du lieu khong hop le' })
  async create(
    @Body() dto: CreateEquipmentDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.create(dto, userId, ipAddress);

    return {
      success: true,
      message: 'Dang ky thiet bi thanh cong',
      data: result,
    };
  }

  @Patch(':equipmentId/fault')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.report_fault')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Bao loi / chuyen bao tri thiet bi' })
  @ApiBody({ type: ReportEquipmentFaultDto })
  @ApiResponse({
    status: 200,
    description: 'Cap nhat trang thai loi thanh cong',
  })
  @ApiResponse({ status: 400, description: 'Du lieu DTO khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({
    status: 403,
    description: 'Khong co quyen equipment.report_fault',
  })
  @ApiResponse({ status: 404, description: 'Khong tim thay thiet bi' })
  @ApiResponse({
    status: 409,
    description: 'Thiet bi retired/lost khong the bao loi',
  })
  @ApiResponse({ status: 422, description: 'Khong co status thay doi' })
  async reportFault(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @Body() dto: ReportEquipmentFaultDto,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    const result = await this.equipmentService.reportFault(
      equipmentId,
      dto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Cap nhat trang thai loi thiet bi thanh cong',
      data: result,
    };
  }

  @Delete(':equipmentId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.delete')
  @ApiOperation({ summary: 'Xoa mem thiet bi (soft delete)' })
  @ApiResponse({ status: 200, description: 'Xoa thiet bi thanh cong' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.delete' })
  @ApiResponse({ status: 404, description: 'Khong tim thay thiet bi' })
  async deleteEquipment(
    @Param('equipmentId', ParseUUIDPipe) equipmentId: string,
    @CurrentUser() user: { userId: string } | undefined,
    @Ip() ipAddress: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required — check JwtAuthGuard');
    }

    await this.equipmentService.deleteEquipment(equipmentId, userId, ipAddress);

    return {
      success: true,
      message: 'Xoa thiet bi thanh cong',
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionsGuard)
  @RequirePermissions('equipment.read')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  @ApiOperation({ summary: 'Tim kiem / loc kho thiet bi (co phan trang)' })
  @ApiResponse({ status: 200, description: 'Danh sach thiet bi' })
  @ApiResponse({ status: 400, description: 'Query khong hop le' })
  @ApiResponse({ status: 401, description: 'Chua xac thuc' })
  @ApiResponse({ status: 403, description: 'Khong co quyen equipment.read' })
  async listEquipments(@Query() query: ListEquipmentsQueryDto): Promise<{
    success: boolean;
    message: string;
    data: EquipmentResponseDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { data, total } = await this.equipmentService.listEquipments(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    return {
      success: true,
      message: 'Danh sach thiet bi',
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
