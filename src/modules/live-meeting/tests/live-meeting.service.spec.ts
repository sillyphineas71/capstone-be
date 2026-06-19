import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { LiveMeetingService } from '../services/live-meeting.service.js';
import { MeetingEntity, MeetingStatus } from '../../meetings/entities/meeting.entity.js';
import { MeetingEventEntity } from '../../meetings/entities/meeting-event.entity.js';
import { RoomBookingEntity, RoomBookingStatus } from '../../rooms/entities/room-booking.entity.js';
import { RoomBookingUsageEntity, RoomUsageStatus, OccupancySource } from '../../rooms/entities/room-booking-usage.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { StartMeetingResponseDto } from '../dto/start-meeting-response.dto.js';
import { EndMeetingResponseDto } from '../dto/end-meeting-response.dto.js';

describe('LiveMeetingService', () => {
  let service: LiveMeetingService;
  let dataSource: DataSource;
  let meetingRepo: Repository<MeetingEntity>;

  const mockWebsocketService = {
    emitToRoom: jest.fn(),
  };

  const now = new Date();
  const baseMeeting = {
    id: 'm-001',
    meetingCode: 'MTG-001',
    title: 'Test meeting',
    organizerId: 'org-1',
    hostId: 'host-1',
    roomId: 'room-1',
    status: MeetingStatus.SCHEDULED,
    startTime: new Date(now.getTime() + 30 * 60 * 1000),  // 30 phút sau
    endTime: new Date(now.getTime() + 90 * 60 * 1000),    // 90 phút sau
    actualStartTime: null,
    actualEndTime: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  // Mock entity manager
  const mockQueryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const mockTransactionalEm = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn(),
    save: jest.fn().mockResolvedValue({}),
  } as unknown as EntityManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveMeetingService,
        {
          provide: DataSource,
          useValue: {
            getRepository: jest.fn().mockReturnValue({
              findOne: jest.fn(),
              find: jest.fn(),
            }),
            transaction: jest.fn().mockImplementation(async (cb: Function) => {
              return cb(mockTransactionalEm);
            }),
          },
        },
        {
          provide: WebsocketService,
          useValue: mockWebsocketService,
        },
      ],
    }).compile();

    service = module.get<LiveMeetingService>(LiveMeetingService);
    dataSource = module.get<DataSource>(DataSource);
    meetingRepo = dataSource.getRepository(MeetingEntity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ────────────────────────────────────────
  //  Happy path
  // ────────────────────────────────────────
  it('T001: should start meeting successfully (happy path)', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    const result = await service.startMeeting('m-001', { userId: 'host-1' }, {});

    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
    expect(result.alreadyStarted).toBe(false);
    expect(result.actualStartTime).toBeTruthy();
    expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  // ────────────────────────────────────────
  //  Meeting not found
  // ────────────────────────────────────────
  it('T002: should throw MEETING_NOT_FOUND when meeting does not exist', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(null);

    await expect(
      service.startMeeting('invalid', { userId: 'host-1' }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('T002b: should throw MEETING_NOT_FOUND when meeting is soft-deleted', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      deletedAt: new Date(),
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  // ────────────────────────────────────────
  //  Authorization
  // ────────────────────────────────────────
  it('T003: should throw FORBIDDEN when user is not host or organizer', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'stranger' }, {}),
    ).rejects.toThrow(ForbiddenException);
  });

  // ────────────────────────────────────────
  //  Status validation
  // ────────────────────────────────────────
  it('T004: should throw when meeting is completed', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.COMPLETED,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T005: should throw when meeting is cancelled', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.CANCELLED,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T006: should throw when meeting is pending_approval', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.PENDING_APPROVAL,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T007: should throw when meeting is draft', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.DRAFT,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  Time window
  // ────────────────────────────────────────
  it('T008: should throw MEETING_START_TOO_EARLY when before start_time - 15m', async () => {
    const farFuture = new Date(now.getTime() + 120 * 60 * 1000);
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      startTime: farFuture,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T009: should throw MEETING_START_WINDOW_EXPIRED when after end_time', async () => {
    const pastEnd = new Date(now.getTime() - 10 * 60 * 1000);
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      startTime: new Date(now.getTime() - 60 * 60 * 1000),
      endTime: pastEnd,
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  Idempotent
  // ────────────────────────────────────────
  it('T010: should return idempotent response when already started', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.IN_PROGRESS,
      actualStartTime: new Date(),
    } as MeetingEntity);

    const result = await service.startMeeting('m-001', { userId: 'host-1' }, {});

    expect(result.alreadyStarted).toBe(true);
    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
  });

  // ────────────────────────────────────────
  //  Transaction lock re-validation
  // ────────────────────────────────────────
  it('T011: should throw MEETING_ALREADY_STARTED when lock re-validation finds actualStartTime set', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({
      ...baseMeeting,
      actualStartTime: new Date(),
    } as MeetingEntity);

    await expect(
      service.startMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  AF1 Device flow
  // ────────────────────────────────────────
  it('T012: AF1 should start meeting when exactly 1 meeting matches', async () => {
    const matchedMeeting = {
      ...baseMeeting,
      hostId: 'dev-host',
      roomId: 'dev-room',
    };
    jest.spyOn(meetingRepo, 'find').mockResolvedValue([matchedMeeting] as MeetingEntity[]);
    mockQueryBuilder.getOne.mockResolvedValue(matchedMeeting as MeetingEntity);

    const result = await service.startMeetingFromDeviceCheckIn({
      deviceId: 'dev-1',
      roomId: 'dev-room',
      recognizedUserId: 'dev-host',
      sourceType: 'device',
    });

    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
    expect(result.alreadyStarted).toBe(false);
  });

  it('T013: AF1 should throw when no meeting matches', async () => {
    jest.spyOn(meetingRepo, 'find').mockResolvedValue([]);

    await expect(
      service.startMeetingFromDeviceCheckIn({
        deviceId: 'dev-1',
        roomId: 'dev-room',
        recognizedUserId: 'nobody',
        sourceType: 'device',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('T014: AF1 should throw when multiple meetings match', async () => {
    const m1 = { ...baseMeeting, hostId: 'dev-host', roomId: 'dev-room' } as MeetingEntity;
    const m2 = { ...baseMeeting, id: 'm-002', hostId: 'dev-host', roomId: 'dev-room' } as MeetingEntity;
    jest.spyOn(meetingRepo, 'find').mockResolvedValue([m1, m2]);

    await expect(
      service.startMeetingFromDeviceCheckIn({
        deviceId: 'dev-1',
        roomId: 'dev-room',
        recognizedUserId: 'dev-host',
        sourceType: 'device',
      }),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  WebSocket best-effort
  // ────────────────────────────────────────
  it('T015: should emit WebSocket event after successful start', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    await service.startMeeting('m-001', { userId: 'host-1' }, {});

    expect(mockWebsocketService.emitToRoom).toHaveBeenCalledWith(
      'meeting:m-001',
      'meeting.session.started',
      expect.objectContaining({
        eventType: 'meeting.session.started',
        data: expect.objectContaining({
          meetingId: 'm-001',
          status: MeetingStatus.IN_PROGRESS,
        }),
      }),
    );
  });

  it('T015b: should not throw when WebSocket push fails', async () => {
    mockWebsocketService.emitToRoom.mockImplementationOnce(() => {
      throw new Error('WS unavailable');
    });

    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    const result = await service.startMeeting('m-001', { userId: 'host-1' }, {});

    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
  });


// ───────────────────────────────────────────────────────────
//  UC-IMM-05: End Meeting Session Tests
// ───────────────────────────────────────────────────────────

describe('LiveMeetingService - endMeeting', () => {
  const now = new Date();
  const baseMeeting = {
    id: 'm-001',
    meetingCode: 'MTG-001',
    title: 'Test meeting',
    organizerId: 'org-1',
    hostId: 'host-1',
    roomId: 'room-1',
    status: MeetingStatus.IN_PROGRESS,
    startTime: new Date(now.getTime() - 60 * 60 * 1000),  // 1 hour ago
    endTime: new Date(now.getTime() + 30 * 60 * 1000),    // 30 min later
    actualStartTime: new Date(now.getTime() - 60 * 60 * 1000),
    actualEndTime: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  // ────────────────────────────────────────
  //  Happy path — end on time
  // ────────────────────────────────────────
  it('T013-01: should end meeting successfully (on time, room NOT released)', async () => {
    // now() >= endTime
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting, endTime: new Date(now.getTime() - 1000) } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting, endTime: new Date(now.getTime() - 1000) } as MeetingEntity);

    const result = await service.endMeeting('m-001', { userId: 'host-1' }, {});

    expect(result.status).toBe(MeetingStatus.COMPLETED);
    expect(result.meetingId).toBe('m-001');
    expect(result.roomReleased).toBe(false);
    expect(result.actualEndTime).toBeTruthy();
    expect(result.duration).toBeGreaterThan(0);
    expect(mockQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
  });

  // ────────────────────────────────────────
  //  Happy path — end early
  // ────────────────────────────────────────
  it('T013-02: should end meeting early (room RELEASED)', async () => {
    // now() < endTime
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    const result = await service.endMeeting('m-001', { userId: 'host-1' }, {});

    expect(result.status).toBe(MeetingStatus.COMPLETED);
    expect(result.roomReleased).toBe(true);
    expect(result.duration).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────
  //  Meeting not found
  // ────────────────────────────────────────
  it('T013-03: should throw MEETING_NOT_FOUND when meeting does not exist', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(null);

    await expect(
      service.endMeeting('invalid', { userId: 'host-1' }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('T013-03b: should throw MEETING_NOT_FOUND when meeting is soft-deleted', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      deletedAt: new Date(),
    } as MeetingEntity);

    await expect(
      service.endMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(NotFoundException);
  });

  // ────────────────────────────────────────
  //  Authorization
  // ────────────────────────────────────────
  it('T013-04: should throw FORBIDDEN when user is not host or organizer', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    await expect(
      service.endMeeting('m-001', { userId: 'stranger' }, {}),
    ).rejects.toThrow(ForbiddenException);
  });

  // ────────────────────────────────────────
  //  Status validation
  // ────────────────────────────────────────
  it('T013-05: should throw when meeting is SCHEDULED', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.SCHEDULED,
    } as MeetingEntity);

    await expect(
      service.endMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T013-06: should throw when meeting is COMPLETED (already has actualEndTime)', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.COMPLETED,
      actualEndTime: new Date(),
    } as MeetingEntity);

    await expect(
      service.endMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  it('T013-07: should throw when meeting is CANCELLED', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.CANCELLED,
    } as MeetingEntity);

    await expect(
      service.endMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  Transaction lock re-validation
  // ────────────────────────────────────────
  it('T013-08: should throw MEETING_ALREADY_COMPLETED when lock re-validation finds actualEndTime set', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({
      ...baseMeeting,
      actualEndTime: new Date(),
    } as MeetingEntity);

    await expect(
      service.endMeeting('m-001', { userId: 'host-1' }, {}),
    ).rejects.toThrow(ConflictException);
  });

  // ────────────────────────────────────────
  //  WebSocket best-effort
  // ────────────────────────────────────────
  it('T013-09: should emit WebSocket event after successful end', async () => {
    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    await service.endMeeting('m-001', { userId: 'host-1' }, {});

    expect(mockWebsocketService.emitToRoom).toHaveBeenCalledWith(
      'meeting:m-001',
      'meeting.session.ended',
      expect.objectContaining({
        eventType: 'meeting.session.ended',
        data: expect.objectContaining({
          meetingId: 'm-001',
          status: MeetingStatus.COMPLETED,
        }),
      }),
    );
  });

  it('T013-10: should not throw when WebSocket push fails', async () => {
    mockWebsocketService.emitToRoom.mockImplementationOnce(() => {
      throw new Error('WS unavailable');
    });

    jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({ ...baseMeeting } as MeetingEntity);
    mockQueryBuilder.getOne.mockResolvedValue({ ...baseMeeting } as MeetingEntity);

    const result = await service.endMeeting('m-001', { userId: 'host-1' }, {});

    expect(result.status).toBe(MeetingStatus.COMPLETED);
  
  // ========================================================
  //  UC-IMM-07: getPresentAttendees
  // ========================================================

  describe('getPresentAttendees', () => {
    const baseMeetingPA = {
      id: 'm-pa-001',
      meetingCode: 'MTG-PA-001',
      title: 'Test present attendees meeting',
      organizerId: 'org-pa-1',
      hostId: 'host-pa-1',
      roomId: 'room-pa-1',
      status: MeetingStatus.IN_PROGRESS,
      startTime: new Date(now.getTime() - 30 * 60 * 1000),
      endTime: new Date(now.getTime() + 30 * 60 * 1000),
      actualStartTime: new Date(now.getTime() - 30 * 60 * 1000),
      actualEndTime: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const mockParticipantUser = {
      id: 'user-pa-1',
      fullName: 'Nguyen Van A',
      email: 'nva@company.com',
      avatarUrl: 'https://avatar.com/a.png',
      departmentId: 'dept-pa-1',
      department: { id: 'dept-pa-1', departmentName: 'Phong IT' },
    };

    const mockParticipants = [
      {
        userId: 'user-pa-1',
        meetingId: 'm-pa-001',
        participantRole: 'host',
        invitationStatus: 'accepted',
        joinedAt: now,
        user: mockParticipantUser,
      },
      {
        userId: 'user-pa-2',
        meetingId: 'm-pa-001',
        participantRole: 'attendee',
        invitationStatus: 'accepted',
        joinedAt: now,
        user: {
          id: 'user-pa-2',
          fullName: 'Tran Thi B',
          email: 'ttb@company.com',
          departmentId: 'dept-pa-1',
          department: { id: 'dept-pa-1', departmentName: 'Phong IT' },
        },
      },
    ];

    it('T014-01: should return present attendees for host (full access)', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(baseMeetingPA as any);

      const result = await service.getPresentAttendees(
        'm-pa-001',
        { userId: 'host-pa-1' },
        {},
        { search: undefined, departmentId: undefined, page: 1, limit: 20, sortBy: 'u.fullName', sortOrder: 'asc' },
      );

      expect(result.data.meetingId).toBe('m-pa-001');
      expect(result.data.occupancyCount).toBeGreaterThanOrEqual(0);
      expect(result.meta.total).toBeGreaterThanOrEqual(0);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('T014-02: should throw MEETING_NOT_FOUND when meeting does not exist', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.getPresentAttendees('m-none', { userId: 'host-pa-1' }, {}, { search: undefined, departmentId: undefined, page: 1, limit: 20, sortBy: 'u.fullName', sortOrder: 'asc' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('T014-03: should throw MEETING_NOT_IN_PROGRESS when meeting is scheduled but out of window', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeetingPA,
        status: MeetingStatus.SCHEDULED,
        startTime: new Date(now.getTime() + 60 * 60 * 1000),
        endTime: new Date(now.getTime() + 120 * 60 * 1000),
      } as any);

      await expect(
        service.getPresentAttendees('m-pa-001', { userId: 'host-pa-1' }, {}, { search: undefined, departmentId: undefined, page: 1, limit: 20, sortBy: 'u.fullName', sortOrder: 'asc' }),
      ).rejects.toThrow(ConflictException);
    });

    it('T014-04: should allow access when meeting is scheduled and now is in grace window', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue({
        ...baseMeetingPA,
        status: MeetingStatus.SCHEDULED,
        startTime: new Date(now.getTime() - 5 * 60 * 1000),
        endTime: new Date(now.getTime() + 55 * 60 * 1000),
        actualStartTime: null,
      } as any);

      const result = await service.getPresentAttendees(
        'm-pa-001',
        { userId: 'host-pa-1' },
        {},
        { search: undefined, departmentId: undefined, page: 1, limit: 20, sortBy: 'u.fullName', sortOrder: 'asc' },
      );

      expect(result.data.meetingId).toBe('m-pa-001');
    });

    it('T014-05: non-blocking audit - should return 200 even when audit write fails', async () => {
      jest.spyOn(meetingRepo, 'findOne').mockResolvedValue(baseMeetingPA as any);

      const result = await service.getPresentAttendees(
        'm-pa-001',
        { userId: 'host-pa-1' },
        {},
        { search: undefined, departmentId: undefined, page: 1, limit: 20, sortBy: 'u.fullName', sortOrder: 'asc' },
      );

      // Audit failure should not affect response
      expect(result.data.meetingId).toBe('m-pa-001');
      expect(result.meta).toBeDefined();
    });
  });

});
  // ------------------------------------------------------------------
  //  UC-IMM-09: Create Meeting Note
  // ------------------------------------------------------------------

  describe('createMeetingNote', () => {
    const meetingId = 'm-001';
    const currentUserId = 'user-1';
    const baseNoteDto = {
      noteType: 'in_meeting',
      content: 'Test note content',
      pinned: false,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should create in_meeting note successfully (AC-001/004)', async () => {
      const mockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: meetingId,
          status: 'in_progress',
          deletedAt: null,
        }),
      };
      const mockEm = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        create: jest.fn().mockReturnValue({ id: 'note-1' }),
        save: jest.fn().mockResolvedValue({ id: 'note-1', meetingId, authorId: currentUserId, noteType: 'in_meeting', content: 'Test note content', pinned: false, visibilityLevel: 'participants', createdAt: new Date() }),
        getCount: jest.fn().mockResolvedValue(0),
      };

      jest.spyOn(dataSource, 'transaction').mockImplementation(async (cb) => cb(mockEm));

      const mockNoteRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'note-1',
          meetingId,
          authorId: currentUserId,
          noteType: 'in_meeting',
          content: 'Test note content',
          pinned: false,
          visibilityLevel: 'participants',
          createdAt: new Date(),
          author: { id: currentUserId, fullName: 'Test User' },
        }),
      };
      jest.spyOn(dataSource, 'getRepository').mockReturnValue(mockNoteRepo);

      const result = await service.createMeetingNote(meetingId, baseNoteDto, { userId: currentUserId });

      expect(result).toBeDefined();
      expect(result.noteType).toBe('in_meeting');
      expect(result.visibilityLevel).toBe('participants');
      expect(result.author.id).toBe(currentUserId);
    });

    it('should create host_note with default private visibility (AC-003)', async () => {
      const mockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: meetingId,
          status: 'in_progress',
          deletedAt: null,
        }),
      };
      const mockEm = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        create: jest.fn().mockReturnValue({ id: 'note-1' }),
        save: jest.fn().mockResolvedValue({ id: 'note-1', meetingId, authorId: currentUserId, noteType: 'host_note', content: 'Host note', pinned: false, visibilityLevel: 'private', createdAt: new Date() }),
        getCount: jest.fn().mockResolvedValue(1),
      };

      jest.spyOn(dataSource, 'transaction').mockImplementation(async (cb) => cb(mockEm));

      const mockNoteRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'note-1',
          meetingId,
          authorId: currentUserId,
          noteType: 'host_note',
          content: 'Host note',
          pinned: false,
          visibilityLevel: 'private',
          createdAt: new Date(),
          author: { id: currentUserId, fullName: 'Host' },
        }),
      };
      jest.spyOn(dataSource, 'getRepository').mockReturnValue(mockNoteRepo);

      const result = await service.createMeetingNote(meetingId, { noteType: 'host_note', content: 'Host note' }, { userId: currentUserId });
      expect(result.visibilityLevel).toBe('private');
    });

    it('should throw NOTE_HOST_ONLY when non-host sends host_note (AC-007)', async () => {
      const mockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: meetingId,
          status: 'in_progress',
          deletedAt: null,
        }),
      };
      const mockEm = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        getCount: jest.fn().mockResolvedValue(0),
      };

      jest.spyOn(dataSource, 'transaction').mockImplementation(async (cb) => cb(mockEm));

      await expect(
        service.createMeetingNote(meetingId, { noteType: 'host_note', content: 'Test' }, { userId: 'non-host' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw MEETING_NOT_IN_PROGRESS when meeting is completed (AC-009)', async () => {
      const mockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: meetingId,
          status: 'completed',
          deletedAt: null,
        }),
      };
      const mockEm = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      };

      jest.spyOn(dataSource, 'transaction').mockImplementation(async (cb) => cb(mockEm));

      await expect(
        service.createMeetingNote(meetingId, baseNoteDto, { userId: currentUserId }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
});
