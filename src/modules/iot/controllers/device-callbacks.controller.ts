import { Controller, Get, Post, Req } from '@nestjs/common';
import { IotDevicesService } from '../services/iot-devices.service';

@Controller('device-callbacks')
export class DeviceCallbacksController {
  constructor(private readonly iotDevicesService: IotDevicesService) {}

  @Get('face/heartbeat')
  async handleHeartbeatGet(@Req() req: any) {
    return this.handleHeartbeat(req);
  }

  @Post('face/heartbeat')
  async handleHeartbeatPost(@Req() req: any) {
    return this.handleHeartbeat(req);
  }

  private async handleHeartbeat(req: any) {
    const result = await this.iotDevicesService.receiveHeartbeat({
      headers: req.headers || {},
      body: req.body || null,
      query: req.query || {},
      params: req.params || {},
      clientIp: req.ip || req.socket?.remoteAddress || undefined,
    });

    return {
      success: true,
      message: 'Heartbeat received successfully',
      data: result,
    };
  }
}
