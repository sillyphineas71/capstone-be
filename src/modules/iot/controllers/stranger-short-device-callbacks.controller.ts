import { Controller, Get, Post, Req, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { IotDevicesService } from '../services/iot-devices.service';

@Controller('sf')
export class StrangerShortDeviceCallbacksController {
  constructor(private readonly iotDevicesService: IotDevicesService) {}

  @Get(':deviceCode/:callbackToken')
  async handleStrangerGet(@Req() req: any) {
    return this.handleStranger(req);
  }

  @Post(':deviceCode/:callbackToken')
  @UseInterceptors(
    AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } }),
  )
  async handleStrangerPost(@Req() req: any) {
    return this.handleStranger(req);
  }

  private async handleStranger(req: any) {
    const result = await this.iotDevicesService.receiveStrangerEvent({
      headers: req.headers || {},
      body: req.body || null,
      query: req.query || {},
      params: req.params || {},
      clientIp: req.ip || req.socket?.remoteAddress || undefined,
      files: req.files || [],
    });

    return {
      success: true,
      message: 'Stranger event received successfully',
      data: result,
    };
  }
}
