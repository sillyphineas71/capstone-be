import {
  Body,
  Controller,
  Post,
  Patch,
  Get,
  Query,
  HttpCode,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CreateIotDeviceDto } from '../dto/create-iot-device.dto.js';
import { UpdateIotDeviceDto } from '../dto/update-iot-device.dto.js';
import { ListIotDevicesQueryDto } from '../dto/list-iot-devices-query.dto.js';
import { AssignRoomDto } from '../dto/assign-room.dto.js';
import { IotDevicesService } from '../services/iot-devices.service.js';
import { toIotDeviceResponse } from '../dto/iot-device-response.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

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

  // IOT-013: liệt kê thiết bị (filter + phân trang). Read-only, query whitelist-only.
  @Get()
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('iot.device.read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async list(@Query() query: ListIotDevicesQueryDto) {
    const { items, meta } = await this.iotDevicesService.findAll(query);

    return {
      success: true,
      message: 'IoT devices retrieved successfully',
      data: items,
      meta,
    };
  }

  // IOT-013: chi tiết thiết bị. Read-only.
  @Get(':id')
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('iot.device.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const data = await this.iotDevicesService.findOne(id);

    return {
      success: true,
      message: 'IoT device retrieved successfully',
      data,
    };
  }

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

  // IOT-011: cập nhật thông tin mô tả/kết nối (allowlist 4 field). Pipe route-level
  // bật forbidNonWhitelisted=true để field ngoài allowlist => 400.
  @Patch(':id')
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('iot.device.update')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  async update(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIotDeviceDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.update(userId, id, dto);

    return {
      success: true,
      message: 'IoT device updated successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // IOT-012: vô hiệu hóa thiết bị (status -> disabled). POST action, không body.
  // @HttpCode(200) vì POST mặc định trả 201.
  @Post(':id/disable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('iot.device.disable')
  async disable(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.disable(userId, id);

    return {
      success: true,
      message: 'IoT device disabled successfully',
      data: toIotDeviceResponse(device),
    };
  }

  // IOT-012: kích hoạt lại thiết bị (disabled -> offline). POST action, không body.
  @Post(':id/enable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('iot.device.enable')
  async enable(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;

    const device = await this.iotDevicesService.enable(userId, id);

    return {
      success: true,
      message: 'IoT device enabled successfully',
      data: toIotDeviceResponse(device),
    };
  }
}
