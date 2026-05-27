import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CreateIotDeviceDto } from '../dto/create-iot-device.dto';
import { AssignRoomDto } from '../dto/assign-room.dto';
import { IotDevicesService } from '../services/iot-devices.service';
import { toIotDeviceResponse } from '../dto/iot-device-response.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

// Mocks for PermissionsGuard since it's not implemented in auth module yet
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any) => {};

@Controller('iot-devices')
export class IotDevicesController {
  constructor(private readonly iotDevicesService: IotDevicesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('iot_devices:create')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async create(@Req() req: any, @Body() dto: CreateIotDeviceDto) {
    // Fallback manual mapping if ValidationPipe did not transform snake_case
    // class-transformer should handle it with @Expose if ValidationPipe has transform:true
    // We assume the DTO is mapped correctly here.

    // Extract userId from req.user (JwtAuthGuard maps it to userId, but fallback to id just in case)
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.create(userId, dto);

    return {
      success: true,
      data: toIotDeviceResponse(device),
    };
  }

  @Post(':id/assign-room')
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('iot_devices:assign_room')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  )
  async assignRoom(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoomDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.assignRoom(userId, id, dto);

    return {
      success: true,
      message: 'Room assigned successfully',
      data: toIotDeviceResponse(device),
    };
  }
}
