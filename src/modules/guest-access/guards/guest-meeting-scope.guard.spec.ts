import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { GuestMeetingScopeGuard } from './guest-meeting-scope.guard';
import { GuestAccessConfigService } from '../config/guest-access-config.service';
import { MeetingStatus } from '../../meetings/entities/meeting.entity';

describe('GuestMeetingScopeGuard', () => {
  let guard: GuestMeetingScopeGuard;
  let findOne: jest.Mock;
  let dataSource: { getRepository: jest.Mock };
  let config: { getJoinWindowAfterMinutes: jest.Mock };

  beforeEach(async () => {
    findOne = jest.fn();
    dataSource = {
      getRepository: jest.fn().mockReturnValue({ findOne }),
    };
    config = {
      getJoinWindowAfterMinutes: jest.fn().mockReturnValue(15),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestMeetingScopeGuard,
        { provide: DataSource, useValue: dataSource },
        { provide: GuestAccessConfigService, useValue: config },
      ],
    }).compile();

    guard = module.get(GuestMeetingScopeGuard);
  });

  function buildContext(
    guest: { meetingId: string } | undefined,
    meetingIdParam: string,
  ): ExecutionContext {
    const request = {
      guest,
      params: { meetingId: meetingIdParam },
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('should throw ForbiddenException when token meetingId does not match param', async () => {
    const context = buildContext({ meetingId: 'meeting-A' }, 'meeting-B');
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when request.guest is missing (guard order violated)', async () => {
    const context = buildContext(undefined, 'meeting-A');
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should throw ForbiddenException when meeting does not exist', async () => {
    findOne.mockResolvedValue(null);
    const context = buildContext({ meetingId: 'meeting-A' }, 'meeting-A');
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should throw ConflictException when meeting is cancelled', async () => {
    findOne.mockResolvedValue({
      id: 'meeting-A',
      status: MeetingStatus.CANCELLED,
      endTime: new Date(Date.now() + 3600_000),
      deletedAt: null,
    });
    const context = buildContext({ meetingId: 'meeting-A' }, 'meeting-A');
    await expect(guard.canActivate(context)).rejects.toThrow(ConflictException);
  });

  it('should throw ConflictException when now is past endTime + joinWindowAfterMinutes', async () => {
    findOne.mockResolvedValue({
      id: 'meeting-A',
      status: MeetingStatus.COMPLETED,
      endTime: new Date(Date.now() - 3600_000), // 1h ago, way past +15m grace
      deletedAt: null,
    });
    const context = buildContext({ meetingId: 'meeting-A' }, 'meeting-A');
    await expect(guard.canActivate(context)).rejects.toThrow(ConflictException);
  });

  it('should allow when within extended window even if past original endTime (quickstart S8)', async () => {
    findOne.mockResolvedValue({
      id: 'meeting-A',
      status: MeetingStatus.IN_PROGRESS,
      endTime: new Date(Date.now() + 5 * 60_000), // 5 minutes from now, within +15m grace
      deletedAt: null,
    });
    const context = buildContext({ meetingId: 'meeting-A' }, 'meeting-A');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
