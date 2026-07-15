import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { PATH_METADATA } from '@nestjs/common/constants';
import { RecordingSessionController } from './recording-session.controller.js';
import { RecordingSessionService } from '../services/recording-session.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('RecordingSessionController pause/resume (UC-114/115)', () => {
  let controller: RecordingSessionController;
  const mockService = {
    pauseVideo: jest.fn(),
    resumeVideo: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordingSessionController],
      providers: [{ provide: RecordingSessionService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<RecordingSessionController>(
      RecordingSessionController,
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('[C1] pause gọi service đúng + envelope', async () => {
    mockService.pauseVideo.mockResolvedValue({ status: 'paused' });
    const res = await controller.pauseVideo('m1', 's1');
    expect(mockService.pauseVideo).toHaveBeenCalledWith('m1', 's1');
    expect(res).toEqual({
      success: true,
      message: 'Video recording paused',
      data: { status: 'paused' },
    });
  });

  it('[C2] resume gọi service đúng + envelope', async () => {
    mockService.resumeVideo.mockResolvedValue({ status: 'recording' });
    const res = await controller.resumeVideo('m1', 's1');
    expect(mockService.resumeVideo).toHaveBeenCalledWith('m1', 's1');
    expect(res).toEqual({
      success: true,
      message: 'Video recording resumed',
      data: { status: 'recording' },
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { pauseVideo, resumeVideo } = RecordingSessionController.prototype;

  it('[C3] cả 2 handler yêu cầu permission recording.video.stop', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, pauseVideo) as string[],
    ).toEqual(['recording.video.stop']);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, resumeVideo) as string[],
    ).toEqual(['recording.video.stop']);
  });

  it('[C4] route path pause-video / resume-video', () => {
    expect(Reflect.getMetadata(PATH_METADATA, pauseVideo) as string).toBe(
      'live-meetings/:meetingId/recording/:sessionId/pause-video',
    );
    expect(Reflect.getMetadata(PATH_METADATA, resumeVideo) as string).toBe(
      'live-meetings/:meetingId/recording/:sessionId/resume-video',
    );
  });
});
