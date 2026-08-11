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

  const reqWith = (userId: string | null) => ({ user: { userId } }) as any;

  it('[C1] pause gọi service đúng + envelope', async () => {
    mockService.pauseVideo.mockResolvedValue({ status: 'paused' });
    const res = await controller.pauseVideo(reqWith('u1'), 'm1', 's1');
    expect(mockService.pauseVideo).toHaveBeenCalledWith('m1', 's1', 'u1');
    expect(res).toEqual({
      success: true,
      message: 'Video recording paused',
      data: { status: 'paused' },
    });
  });

  it('[C2] resume gọi service đúng + envelope', async () => {
    mockService.resumeVideo.mockResolvedValue({ status: 'recording' });
    const res = await controller.resumeVideo(reqWith('u1'), 'm1', 's1');
    expect(mockService.resumeVideo).toHaveBeenCalledWith('m1', 's1', 'u1');
    expect(res).toEqual({
      success: true,
      message: 'Video recording resumed',
      data: { status: 'recording' },
    });
  });

  it('[C5] pause: userId lấy từ req.user.sub khi thiếu userId', async () => {
    mockService.pauseVideo.mockResolvedValue({ status: 'paused' });
    await controller.pauseVideo({ user: { sub: 'u2' } } as any, 'm1', 's1');
    expect(mockService.pauseVideo).toHaveBeenCalledWith('m1', 's1', 'u2');
  });

  it('[C6] resume: userId = null khi req.user rỗng (không throw)', async () => {
    mockService.resumeVideo.mockResolvedValue({ status: 'recording' });
    await controller.resumeVideo({} as any, 'm1', 's1');
    expect(mockService.resumeVideo).toHaveBeenCalledWith('m1', 's1', null);
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
