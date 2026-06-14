import { Controller, Get, Post, Req, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { IotDevicesService } from '../services/iot-devices.service.js';

@Controller('vf')
export class VerifyShortDeviceCallbacksController {
  constructor(private readonly iotDevicesService: IotDevicesService) {}

  @Get(':deviceCode/:callbackToken')
  async handleVerifyGetWithParams(@Req() req: any) {
    return this.handleVerify(req);
  }

  @Post(':deviceCode/:callbackToken')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } }))
  async handleVerifyPostWithParams(@Req() req: any) {
    return this.handleVerify(req);
  }

  private async handleVerify(req: any) {
    const result = await this.iotDevicesService.receiveVerifyEvent({
      headers: req.headers || {},
      body: req.body || null,
      query: req.query || {},
      params: req.params || {},
      clientIp: req.ip || req.socket?.remoteAddress || undefined,
      files: req.files || [],
    });

    return {
      success: true,
      message: 'Verify event received successfully',
      data: result,
    };
  }
}
