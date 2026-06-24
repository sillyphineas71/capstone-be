import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { VehicleRegistrationService } from '../services/vehicle-registration.service.js';
import { CreateVehicleRegistrationDto } from '../dto/create-vehicle-registration.dto.js';
import { AdminCreateVehicleRegistrationDto } from '../dto/admin-create-vehicle-registration.dto.js';
import { toVehicleRegistrationResponse } from '../dto/vehicle-registration-response.dto.js';

const REGISTER_PIPE = new ValidationPipe({ whitelist: true, transform: true });

/**
 * VehicleRegistrationController (VPR-001 / UC1) — đăng ký biển số xe.
 *
 * 2 route (OQ-1):
 * - USER  POST /api/v1/anpr/vehicle-registrations        — JwtAuthGuard, user_id từ @CurrentUser.
 * - ADMIN POST /api/v1/anpr/admin/vehicle-registrations  — gate THẬT (PermissionsGuard +
 *         @RequirePermissions), user_id từ body.
 * Cả 2 dùng chung service.register + cùng response mapper + envelope 201.
 */
@Controller('anpr')
export class VehicleRegistrationController {
  constructor(
    private readonly vehicleRegistrationService: VehicleRegistrationService,
  ) {}

  // USER: tự đăng ký biển của mình — user_id LẤY TỪ JWT (KHÔNG body) — SEC-01.
  @Post('vehicle-registrations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @UsePipes(REGISTER_PIPE)
  async registerOwn(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateVehicleRegistrationDto,
  ) {
    const entity = await this.vehicleRegistrationService.register(
      user.userId,
      dto,
    );
    return {
      success: true,
      message: 'Vehicle registered successfully',
      data: toVehicleRegistrationResponse(entity),
    };
  }

  // ADMIN: đăng ký hộ user bất kỳ — gate THẬT + user_id TỪ BODY.
  @Post('admin/vehicle-registrations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('anpr.vehicle.admin_register')
  @UsePipes(REGISTER_PIPE)
  async registerForUser(@Body() dto: AdminCreateVehicleRegistrationDto) {
    const entity = await this.vehicleRegistrationService.register(
      dto.userId,
      dto,
    );
    return {
      success: true,
      message: 'Vehicle registered successfully',
      data: toVehicleRegistrationResponse(entity),
    };
  }
}
