import { Test, TestingModule } from '@nestjs/testing';
import { GuestContentController } from './guest-content.controller';
import { GuestContentService } from '../services/guest-content.service';
import { GuestSessionGuard } from '../guards/guest-session.guard';
import { GuestMeetingScopeGuard } from '../guards/guest-meeting-scope.guard';

describe('GuestContentController', () => {
  let controller: GuestContentController;
  let service: { getGuestMeetingView: jest.Mock };

  beforeEach(async () => {
    service = {
      getGuestMeetingView: jest.fn().mockResolvedValue({ meetingTitle: 'X' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GuestContentController],
      providers: [{ provide: GuestContentService, useValue: service }],
    })
      .overrideGuard(GuestSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(GuestMeetingScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(GuestContentController);
  });

  it('should read request.guest (set by GuestSessionGuard) and delegate to the service', async () => {
    const guest = {
      externalParticipantId: 'ep-1',
      meetingId: 'meeting-1',
      jti: 'jti-1',
    };
    const request = { guest } as any;

    const result = await controller.getMeetingView(request);

    expect(service.getGuestMeetingView).toHaveBeenCalledWith(guest);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ meetingTitle: 'X' });
  });
});
