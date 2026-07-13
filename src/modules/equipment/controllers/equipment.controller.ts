import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
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
}
