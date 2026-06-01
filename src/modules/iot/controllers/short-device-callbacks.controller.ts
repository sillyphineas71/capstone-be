import { Controller, Get, Post, Req } from '@nestjs/common';
import { IotDevicesService } from '../services/iot-devices.service';

@Controller('hb')
export class ShortDeviceCallbacksController {
  constructor(private readonly iotDevicesService: IotDevicesService) {}

  @Get()
  async handleHeartbeatGet(@Req() req: any) {
    return this.handleHeartbeat(req);
  }

  @Post()
  async handleHeartbeatPost(@Req() req: any) {
    return this.handleHeartbeat(req);
  }

  @Get(':deviceCode/:callbackToken')
  async handleHeartbeatGetWithParams(@Req() req: any) {
    return this.handleHeartbeat(req);
  }

  @Post(':deviceCode/:callbackToken')
  async handleHeartbeatPostWithParams(@Req() req: any) {
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
