import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RoomDeleteNotificationProcessor } from '../services/room-delete-notification.processor.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { SchedulingService } from '../../scheduling/services/scheduling.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';

describe('RoomDeleteNotificationProcessor', () => {
  let processor: RoomDeleteNotificationProcessor;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let schedulingService: jest.Mocked<Partial<SchedulingService>>;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;
  let backgroundJobsService: jest.Mocked<Partial<BackgroundJobsService>>;

  const jobId = 'job-1';
  const meetingId1 = 'meeting-1';
  const meetingId2 = 'meeting-2';

  const mockMeeting = {
    id: meetingId1,
    title: 'Họp kế hoạch Q3',
    organizerId: 'user-1',
    startTime: new Date(Date.now() + 3600_000),
    endTime: new Date(Date.now() + 7200_000),
  };

  const mockOrganizer = { id: 'user-1', email: 'organizer@example.com' };

  function repoFor(entity: unknown) {
    if (entity === MeetingEntity) {
      return {
        findOne: jest.fn().mockResolvedValue(mockMeeting),
      };
    }
    if (entity === UserEntity) {
      return {
        findOne: jest.fn().mockResolvedValue(mockOrganizer),
      };
    }
    if (
      entity === MeetingParticipantEntity ||
      entity === MeetingExternalParticipantEntity
    ) {
      return {
        count: jest.fn().mockResolvedValue(2),
      };
    }
    throw new Error('Unexpected entity in test mock: ' + String(entity));
  }

  beforeEach(async () => {
    dataSource = {
      getRepository: jest.fn((entity: unknown) => repoFor(entity)) as any,
    };

    schedulingService = {
      getRoomSuggestions: jest.fn().mockResolvedValue({
        data: [
          {
            roomId: 'r1',
            roomCode: 'R1',
            roomName: 'Room 1',
            capacity: 10,
            score: 100,
            available: true,
            matchedFeatures: [],
            warnings: [],
          },
          {
            roomId: 'r2',
            roomCode: 'R2',
            roomName: 'Room 2',
            capacity: 12,
            score: 90,
            available: true,
            matchedFeatures: [],
            warnings: [],
          },
        ],
        totalRoomsFound: 2,
      }),
    };

    notificationsService = {
      enqueueEmailNotification: jest
        .fn()
        .mockResolvedValue({ notification: {} as any }),
    };

    backgroundJobsService = {
      markRunning: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomDeleteNotificationProcessor,
        { provide: DataSource, useValue: dataSource },
        { provide: SchedulingService, useValue: schedulingService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: BackgroundJobsService, useValue: backgroundJobsService },
      ],
    }).compile();

    processor = module.get<RoomDeleteNotificationProcessor>(
      RoomDeleteNotificationProcessor,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should mark job running, send email with suggested rooms, then mark completed', async () => {
    await processor.process(jobId, [meetingId1]);

    expect(backgroundJobsService.markRunning).toHaveBeenCalledWith(jobId);
    expect(schedulingService.getRoomSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ attendeeCount: 4 }),
    );
    expect(notificationsService.enqueueEmailNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmails: ['organizer@example.com'],
        relatedEntityId: meetingId1,
      }),
    );
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(jobId, {
      successCount: 1,
      failedMeetingIds: [],
    });
  });

  it('should limit suggested rooms to top 3', async () => {
    (schedulingService.getRoomSuggestions as jest.Mock).mockResolvedValue({
      data: Array.from({ length: 5 }, (_, i) => ({
        roomId: `r${i}`,
        roomCode: `R${i}`,
        roomName: `Room ${i}`,
        capacity: 10,
        score: 100,
        available: true,
        matchedFeatures: [],
        warnings: [],
      })),
      totalRoomsFound: 5,
    });

    await processor.process(jobId, [meetingId1]);

    const call = (notificationsService.enqueueEmailNotification as jest.Mock)
      .mock.calls[0][0];
    expect((call.payloadJson.suggestedRooms as unknown[]).length).toBe(3);
  });

  it('should still send notification (empty suggestions) when scheduling call fails', async () => {
    (schedulingService.getRoomSuggestions as jest.Mock).mockRejectedValue(
      new Error('startTime không được nằm trong quá khứ'),
    );

    await processor.process(jobId, [meetingId1]);

    expect(notificationsService.enqueueEmailNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({ suggestedRooms: [] }),
      }),
    );
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(jobId, {
      successCount: 1,
      failedMeetingIds: [],
    });
  });

  it('should continue processing remaining meetings when one meeting fails (per-meeting error isolation)', async () => {
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: unknown) => {
        if (entity === MeetingEntity) {
          return {
            findOne: jest.fn((opts: any) => {
              if (opts.where.id === meetingId1) {
                throw new Error('DB error for meeting 1');
              }
              return Promise.resolve({ ...mockMeeting, id: meetingId2 });
            }),
          };
        }
        return repoFor(entity);
      },
    );

    await processor.process(jobId, [meetingId1, meetingId2]);

    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(jobId, {
      successCount: 1,
      failedMeetingIds: [meetingId1],
    });
    // Job status is still 'completed' — partial failure does NOT mark the whole job failed (FR-027)
  });

  it('should skip (not error) when organizer has no email', async () => {
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: unknown) => {
        if (entity === UserEntity) {
          return {
            findOne: jest.fn().mockResolvedValue({ id: 'user-1', email: null }),
          };
        }
        return repoFor(entity);
      },
    );

    await processor.process(jobId, [meetingId1]);

    expect(
      notificationsService.enqueueEmailNotification,
    ).not.toHaveBeenCalled();
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(jobId, {
      successCount: 1,
      failedMeetingIds: [],
    });
  });

  it('should skip gracefully (not error) when meeting was deleted/cancelled mid-flight', async () => {
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: unknown) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        return repoFor(entity);
      },
    );

    await processor.process(jobId, [meetingId1]);

    expect(
      notificationsService.enqueueEmailNotification,
    ).not.toHaveBeenCalled();
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(jobId, {
      successCount: 1,
      failedMeetingIds: [],
    });
  });
});
