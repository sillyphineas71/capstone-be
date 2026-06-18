import {
  Controller,
  Post,
  Param,
  Req,
  HttpCode,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FaceProfileService } from '../services/face-profile.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';

// Mock PermissionsGuard — nhất quán recording/iot controller.
const MockPermissionsGuard = class {
  canActivate() {
    return true;
  }
};
const Permissions =
  (...args: string[]) =>
  (target: any, key?: any, descriptor?: any) => {};

const PORTRAIT_LIMIT =
  Number(process.env.FACE_PORTRAIT_MAX_BYTES) || 5 * 1024 * 1024;

@Controller()
export class FaceProfileController {
  constructor(private readonly faceProfileService: FaceProfileService) {}

  // UC-17: enroll ảnh chân dung cho user.
  @Post('users/:userId/face-profile')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, MockPermissionsGuard)
  @Permissions('account.face.register')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: PORTRAIT_LIMIT } }),
  )
  async enroll(
    @Param('userId', ParseUUIDPipe) userId: string,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    const enrolledBy =
      req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.faceProfileService.enrollPortrait(
      userId,
      file,
      enrolledBy,
    );
    return {
      success: true,
      message: 'Face portrait enrolled',
      data,
    };
  }
}
