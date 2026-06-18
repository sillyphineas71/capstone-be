/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Get,
  Post,
  Req,
  Logger,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { IotDevicesService } from '../services/iot-devices.service.js';
import { stripSanpPic } from '../utils/face-verify-payload.util.js';

@Controller('vf')
export class VerifyShortDeviceCallbacksController {
  private readonly logger = new Logger(
    VerifyShortDeviceCallbacksController.name,
  );

  constructor(private readonly iotDevicesService: IotDevicesService) {}

  @Get(':deviceCode/:callbackToken')
  async handleVerifyGetWithParams(@Req() req: any) {
    this.logRaw(req);
    return this.handleVerify(req);
  }

  @Post(':deviceCode/:callbackToken')
  @UseInterceptors(
    AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } }),
  )
  async handleVerifyPostWithParams(@Req() req: any) {
    this.logRaw(req);
    return this.handleVerify(req);
  }

  /**
   * Debug-only: soi payload cam gửi khi FACE_VERIFY_DEBUG==='true'.
   * Luôn strip SanpPic (base64) — KHÔNG bao giờ log ảnh.
   */
  private logRaw(req: any): void {
    if (process.env.FACE_VERIFY_DEBUG !== 'true') return;
    const body =
      req.body && typeof req.body === 'object'
        ? stripSanpPic(req.body)
        : req.body;
    this.logger.debug(
      JSON.stringify({
        ct: req.headers['content-type'],
        query: req.query,
        params: req.params,
        body,
      }),
    );
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
