import { Controller, Get, Post, Req, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { IotDevicesService } from '../services/iot-devices.service.js';

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

  @Get('face/verify')
  async handleVerifyGet(@Req() req: any) {
    return this.handleVerify(req);
  }

  @Post('face/verify')
  @UseInterceptors(
    AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } }),
  )
  async handleVerifyPost(@Req() req: any) {
    return this.handleVerify(req);
  }

  @Get('face/stranger')
  async handleStrangerGet(@Req() req: any) {
    return this.handleStranger(req);
  }

  @Post('face/stranger')
  @UseInterceptors(
    AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } }),
  )
  async handleStrangerPost(@Req() req: any) {
    return this.handleStranger(req);
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
