import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoomEntity, RoomStatus, RoomType } from '../entities/room.entity.js';
import { MeetingStatus } from '../../meetings/entities/meeting.entity.js';
import { RoomBookingStatus } from '../entities/room-booking.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { RoomsService } from '../services/rooms.service.js';
import { RoomStatusService } from '../services/room-status.service.js';
import { CreateRoomDto } from '../dto/create-room.dto.js';
import { CreateRoomResponseDto } from '../dto/create-room-response.dto.js';
import { UpdateRoomDto } from '../dto/update-room.dto.js';
import { UpdateRoomResponseDto } from '../dto/update-room-response.dto.js';
import { DeletionImpactResponseDto } from '../dto/deletion-impact-response.dto.js';
import { DeleteRoomResponseDto } from '../dto/delete-room-response.dto.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { RoomDeleteNotificationProcessor } from '../services/room-delete-notification.processor.js';

/** Chainable mock cho EntityManager/QueryBuilder — dung cho findFutureAffectedMeetings/hasBlockingInProgressMeeting. */
function mockQueryBuilder(overrides: {
  getMany?: unknown[];
  getCount?: number;
}) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(overrides.getMany ?? []),
    getCount: jest.fn().mockResolvedValue(overrides.getCount ?? 0),
  };
  return qb;
}

describe('RoomsService', () => {
  let service: RoomsService;
  let roomRepo: jest.Mocked<Partial<Repository<RoomEntity>>>;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let websocketService: jest.Mocked<Partial<WebsocketService>>;
  let backgroundJobsService: jest.Mocked<Partial<BackgroundJobsService>>;
  let roomDeleteNotificationProcessor: jest.Mocked<
    Partial<RoomDeleteNotificationProcessor>
  >;
  let roomStatusService: jest.Mocked<Partial<RoomStatusService>>;
  let managerCreateQueryBuilder: jest.Mock;

  const mockUserId = '550e8400-e29b-41d4-a716-446655440000';
  const mockRoomId = '660e8400-e29b-41d4-a716-446655440001';

  const validDto: CreateRoomDto = {
    roomCode: 'R301',
    roomName: 'Phong hop 301',
    capacity: 12,
  };

  const mockRoom = {
    id: mockRoomId,
    roomCode: 'R301',
    roomName: 'Phong hop 301',
    siteName: 'Toa A',
    areaName: 'Tang 3',
    locationDescription: null,
    capacity: 12,
    roomType: RoomType.MEETING_ROOM,
    currentStatus: RoomStatus.AVAILABLE,
    hasCamera: false,
    hasMicrophone: false,
    hasDisplay: false,
    allowRecording: false,
    isActive: true,
    createdBy: mockUserId,
    updatedBy: mockUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as RoomEntity;

  beforeEach(async () => {
    roomRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    managerCreateQueryBuilder = jest.fn().mockReturnValue(mockQueryBuilder({}));

    // Mock DataSource transaction supports multiple calls
    dataSource = {
      transaction: jest.fn(),
      manager: {
        createQueryBuilder: managerCreateQueryBuilder,
        query: jest.fn().mockResolvedValue([]),
      } as any,
    };

    websocketService = {
      broadcast: jest.fn(),
    };

    backgroundJobsService = {
      createQueuedJob: jest.fn().mockResolvedValue({ id: 'job-1' } as any),
    };

    roomDeleteNotificationProcessor = {
      process: jest.fn().mockResolvedValue(undefined),
    };

    roomStatusService = {
      getRoomStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: getRepositoryToken(RoomEntity), useValue: roomRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: WebsocketService, useValue: websocketService },
        { provide: BackgroundJobsService, useValue: backgroundJobsService },
        {
          provide: RoomDeleteNotificationProcessor,
          useValue: roomDeleteNotificationProcessor,
        },
        { provide: RoomStatusService, useValue: roomStatusService },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a room successfully and return response', async () => {
      // No duplicate roomCode
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);
      // No duplicate roomName
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      // First transaction (create room) succeeds
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn().mockReturnValue(mockRoom),
            save: jest.fn().mockResolvedValue(mockRoom),
          };
          return cb(mockEm);
        },
      );

      // Second transaction (audit log — fail-safe) succeeds
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn(),
            save: jest.fn().mockResolvedValue({}),
          };
          return cb(mockEm);
        },
      );

      const result = await service.create(validDto, mockUserId);

      expect(result).toBeInstanceOf(CreateRoomResponseDto);
      expect(result.roomCode).toBe('R301');
      expect(result.roomName).toBe('Phong hop 301');
      expect(result.capacity).toBe(12);
      expect(result.currentStatus).toBe('available');
      expect(result.isActive).toBe(true);
    });

    it('should throw ConflictException when roomCode already exists', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(mockRoom);

      await expect(service.create(validDto, mockUserId)).rejects.toThrow(
        ConflictException,
      );
      // Transaction should NOT be called
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when roomName already exists among non-deleted rooms', async () => {
      // roomCode check passes
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);

      // roomName check fails
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockRoom),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      await expect(service.create(validDto, mockUserId)).rejects.toThrow(
        ConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should still return room when audit log fails (FR-019)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      // First transaction (create room) succeeds
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn().mockReturnValue(mockRoom),
            save: jest.fn().mockResolvedValue(mockRoom),
          };
          return cb(mockEm);
        },
      );

      // Second transaction (audit log) FAILS — but room creation still returns
      (dataSource.transaction as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('DB connection lost');
      });

      const result = await service.create(validDto, mockUserId);
      expect(result).toBeInstanceOf(CreateRoomResponseDto);
      expect(result.roomCode).toBe('R301');
    });

    it('should upperCase roomCode automatically', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      let savedRoomCode = '';
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn((entity, data) => ({ ...data, id: mockRoomId })),
            save: jest.fn().mockImplementation((entity, data) => {
              savedRoomCode = data.roomCode;
              return Promise.resolve({ ...mockRoom, roomCode: data.roomCode });
            }),
          };
          return cb(mockEm);
        },
      );

      // Audit ok
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = { create: jest.fn(), save: jest.fn() };
          return cb(mockEm);
        },
      );

      await service.create({ ...validDto, roomCode: 'r301' }, mockUserId);
      expect(savedRoomCode).toBe('R301');
    });
  });

  describe('update', () => {
    const validUpdateDto: UpdateRoomDto = {
      roomName: 'Phong Hoi dong',
      areaName: 'Tang 5',
      capacity: 20,
    };

    function mockNoNameConflict() {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);
      return mockQb;
    }

    function mockUpdateTransactionSucceeds() {
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            save: jest
              .fn()
              .mockImplementation((_entity, data) =>
                Promise.resolve({ ...mockRoom, ...data }),
              ),
          };
          return cb(mockEm);
        },
      );
    }

    function mockAuditTransactionSucceeds() {
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const mockEm = {
            create: jest.fn(),
            save: jest.fn().mockResolvedValue({}),
          };
          return cb(mockEm);
        },
      );
    }

    it('should update a room successfully and broadcast room.updated', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNoNameConflict();
      mockUpdateTransactionSucceeds();
      mockAuditTransactionSucceeds();

      const result = await service.update(
        mockRoomId,
        validUpdateDto,
        mockUserId,
      );

      expect(result).toBeInstanceOf(UpdateRoomResponseDto);
      expect(result.roomName).toBe('Phong Hoi dong');
      expect(result.areaName).toBe('Tang 5');
      expect(result.capacity).toBe(20);
      // roomCode/currentStatus/isActive khong doi (FR-002)
      expect(result.roomCode).toBe('R301');
      expect(result.currentStatus).toBe(RoomStatus.AVAILABLE);
      expect(result.isActive).toBe(true);
      expect(websocketService.broadcast).toHaveBeenCalledTimes(1);
      expect(websocketService.broadcast).toHaveBeenCalledWith(
        'room.updated',
        expect.objectContaining({
          roomId: mockRoomId,
          roomName: 'Phong Hoi dong',
        }),
      );
    });

    it('should throw NotFoundException when room does not exist', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.update(mockRoomId, validUpdateDto, mockUserId),
      ).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(websocketService.broadcast).not.toHaveBeenCalled();
    });

    it('should NOT throw duplicate-name error when name is unchanged (self-exclusion)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      const qb = mockNoNameConflict();
      mockUpdateTransactionSucceeds();
      mockAuditTransactionSucceeds();

      await service.update(
        mockRoomId,
        { ...validUpdateDto, roomName: mockRoom.roomName },
        mockUserId,
      );

      // Verify excludeRoomId was applied in the query (self-exclusion)
      expect(qb.andWhere).toHaveBeenCalledWith('room.id != :excludeRoomId', {
        excludeRoomId: mockRoomId,
      });
    });

    it('should throw ConflictException when new roomName collides with another room', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'other-room-id' }),
      };
      (roomRepo.createQueryBuilder as jest.Mock).mockReturnValue(mockQb);

      await expect(
        service.update(mockRoomId, validUpdateDto, mockUserId),
      ).rejects.toThrow(ConflictException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(websocketService.broadcast).not.toHaveBeenCalled();
    });

    it('should preserve roomCode/currentStatus/isActive even if attempted in payload', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNoNameConflict();
      mockUpdateTransactionSucceeds();
      mockAuditTransactionSucceeds();

      const result = await service.update(
        mockRoomId,
        validUpdateDto,
        mockUserId,
      );

      expect(result.roomCode).toBe(mockRoom.roomCode);
      expect(result.currentStatus).toBe(mockRoom.currentStatus);
      expect(result.isActive).toBe(mockRoom.isActive);
    });

    it('should keep optional fields unchanged when not provided in request', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNoNameConflict();
      mockUpdateTransactionSucceeds();
      mockAuditTransactionSucceeds();

      const result = await service.update(
        mockRoomId,
        validUpdateDto, // siteName not provided
        mockUserId,
      );

      expect(result.siteName).toBe(mockRoom.siteName);
    });

    it('should still return updated room when audit log fails', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNoNameConflict();
      mockUpdateTransactionSucceeds();
      // Audit transaction fails
      (dataSource.transaction as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('DB connection lost');
      });

      const result = await service.update(
        mockRoomId,
        validUpdateDto,
        mockUserId,
      );

      expect(result).toBeInstanceOf(UpdateRoomResponseDto);
      expect(websocketService.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDeletionImpact', () => {
    it('should return affectedMeetingCount and blockedByInProgressMeeting', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      managerCreateQueryBuilder
        .mockReturnValueOnce(
          mockQueryBuilder({ getMany: [{ id: 'm1' }, { id: 'm2' }] }),
        )
        .mockReturnValueOnce(mockQueryBuilder({ getCount: 0 }));

      const result = await service.getDeletionImpact(mockRoomId);

      expect(result).toBeInstanceOf(DeletionImpactResponseDto);
      expect(result.affectedMeetingCount).toBe(2);
      expect(result.blockedByInProgressMeeting).toBe(false);
    });

    it('should throw NotFoundException when room does not exist', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getDeletionImpact(mockRoomId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteRoom', () => {
    function buildMockEm(affectedMeetings: any[], bookings: any[] = []) {
      const em: any = {
        createQueryBuilder: jest.fn((_entity: any, alias: string) => {
          if (alias === 'meeting') {
            return mockQueryBuilder({ getMany: affectedMeetings });
          }
          if (alias === 'booking') {
            return mockQueryBuilder({ getMany: bookings });
          }
          return mockQueryBuilder({});
        }),
        softRemove: jest.fn().mockResolvedValue(undefined),
        save: jest
          .fn()
          .mockImplementation((_entity: any, data: any) =>
            Promise.resolve(data),
          ),
        create: jest.fn().mockImplementation((_entity: any, data: any) => data),
      };
      return em;
    }

    function mockNotBlocked() {
      managerCreateQueryBuilder.mockReturnValueOnce(
        mockQueryBuilder({ getCount: 0 }),
      );
    }

    function mockAuditTransactionSucceeds() {
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => {
          const em = {
            create: jest.fn(),
            save: jest.fn().mockResolvedValue({}),
          };
          return cb(em);
        },
      );
    }

    it('should delete a room with no affected meetings — no job enqueued', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNotBlocked();
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => cb(buildMockEm([])),
      );
      mockAuditTransactionSucceeds();

      const result = await service.deleteRoom(mockRoomId, mockUserId);

      expect(result).toBeInstanceOf(DeleteRoomResponseDto);
      expect(result.affectedMeetingCount).toBe(0);
      expect(result.notificationJobId).toBeNull();
      expect(backgroundJobsService.createQueuedJob).not.toHaveBeenCalled();
      expect(roomDeleteNotificationProcessor.process).not.toHaveBeenCalled();
      expect(websocketService.broadcast).toHaveBeenCalledWith(
        'room.deleted',
        expect.objectContaining({ roomId: mockRoomId }),
      );
    });

    it('should delete a room with affected meetings — release bookings, null roomId, keep status, enqueue job', async () => {
      const affectedMeeting = {
        id: 'meeting-1',
        roomId: mockRoomId,
        status: MeetingStatus.SCHEDULED,
        startTime: new Date(Date.now() + 3600_000),
        endTime: new Date(Date.now() + 7200_000),
      };
      const booking = {
        id: 'booking-1',
        meetingId: 'meeting-1',
        roomId: mockRoomId,
        status: RoomBookingStatus.APPROVED,
      };

      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNotBlocked();
      const em = buildMockEm([affectedMeeting], [booking]);
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => cb(em),
      );
      mockAuditTransactionSucceeds();

      const result = await service.deleteRoom(mockRoomId, mockUserId);

      expect(result.affectedMeetingCount).toBe(1);
      expect(result.notificationJobId).toBe('job-1');
      // Meeting roomId nulled, status NOT touched (BR2)
      expect(affectedMeeting.roomId).toBeNull();
      expect(affectedMeeting.status).toBe(MeetingStatus.SCHEDULED);
      // Booking released
      expect(booking.status).toBe(RoomBookingStatus.RELEASED);
      expect(backgroundJobsService.createQueuedJob).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedEntityType: 'room',
          relatedEntityId: mockRoomId,
          inputJson: { affectedMeetingIds: ['meeting-1'] },
        }),
      );
      expect(roomDeleteNotificationProcessor.process).toHaveBeenCalledWith(
        'job-1',
        ['meeting-1'],
      );
      expect(websocketService.broadcast).toHaveBeenCalledWith(
        'room.deleted',
        expect.objectContaining({ roomId: mockRoomId }),
      );
    });

    it('should throw NotFoundException when room does not exist', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteRoom(mockRoomId, mockUserId)).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (ROOM_IN_USE) when room has a blocking meeting — re-checked at delete time', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      managerCreateQueryBuilder.mockReturnValueOnce(
        mockQueryBuilder({ getCount: 1 }),
      );

      await expect(service.deleteRoom(mockRoomId, mockUserId)).rejects.toThrow(
        ConflictException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(websocketService.broadcast).not.toHaveBeenCalled();
    });

    it('should propagate error and skip audit/broadcast/job when the main transaction fails (atomicity)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNotBlocked();
      (dataSource.transaction as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('DB write failed mid-transaction');
      });

      await expect(service.deleteRoom(mockRoomId, mockUserId)).rejects.toThrow(
        'DB write failed mid-transaction',
      );
      expect(websocketService.broadcast).not.toHaveBeenCalled();
      expect(backgroundJobsService.createQueuedJob).not.toHaveBeenCalled();
    });

    it('should still succeed when audit log fails', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue({ ...mockRoom });
      mockNotBlocked();
      (dataSource.transaction as jest.Mock).mockImplementationOnce(
        async (cb: any) => cb(buildMockEm([])),
      );
      (dataSource.transaction as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('audit DB down');
      });

      const result = await service.deleteRoom(mockRoomId, mockUserId);

      expect(result).toBeInstanceOf(DeleteRoomResponseDto);
      expect(websocketService.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // ROOM-VIEW-DETAIL-001: getRoomDetail
  // ---------------------------------------------------------------------------
  describe('getRoomDetail', () => {
    const mockCreatedByUser = {
      id: 'user-created-id',
      fullName: 'Nguyen Van A',
    };
    const mockUpdatedByUser = {
      id: 'user-updated-id',
      fullName: 'Tran Thi B',
    };

    const mockRoomWithRelations = {
      ...mockRoom,
      createdByUser: mockCreatedByUser,
      updatedByUser: mockUpdatedByUser,
      layoutJson: { seats: 12, shape: 'u-shape' },
    } as any;

    const mockOccupancyStatus = {
      roomId: mockRoomId,
      roomCode: 'R301',
      currentStatus: 'available',
      currentBooking: {
        bookingId: 'booking-uuid-1',
        meetingId: 'meeting-uuid-1',
        title: 'Hop Sprint',
        hostName: 'Nguyen Van A',
        reservedStartTime: new Date('2026-08-11T09:00:00Z'),
        reservedEndTime: new Date('2026-08-11T10:30:00Z'),
      },
      noShowCase: null,
      noShowStatus: null,
      releaseHistory: [],
      lastPresenceAt: new Date('2026-08-11T09:10:00Z'),
      occupancyCount: 5,
    };

    const mockUpcomingRows = [
      {
        booking_id: 'upcoming-booking-1',
        meeting_id: 'upcoming-meeting-1',
        title: 'Hop review Q3',
        host_name: 'Le Van C',
        reserved_start_time: new Date('2026-08-11T14:00:00Z'),
        reserved_end_time: new Date('2026-08-11T15:00:00Z'),
      },
    ];

    it('should return full room detail with correct field mapping (found)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(mockRoomWithRelations);
      (roomStatusService.getRoomStatus as jest.Mock).mockResolvedValue(
        mockOccupancyStatus,
      );
      (dataSource.manager.query as jest.Mock).mockResolvedValue(
        mockUpcomingRows,
      );

      const result = await service.getRoomDetail(mockRoomId);

      // Info tinh
      expect(result.roomId).toBe(mockRoomId);
      expect(result.roomCode).toBe('R301');
      expect(result.roomName).toBe('Phong hop 301');
      expect(result.capacity).toBe(12);
      expect(result.isActive).toBe(true);

      // BR-3: administrativeStatus = rooms.current_status, KHONG merge vao occupancyStatus
      expect(result.administrativeStatus).toBe(RoomStatus.AVAILABLE);
      expect(result.occupancyStatus).not.toHaveProperty('administrativeStatus');

      // occupancyStatus tu RoomStatusService
      expect(result.occupancyStatus.currentBooking).not.toBeNull();
      expect(result.occupancyStatus.currentBooking?.bookingId).toBe(
        'booking-uuid-1',
      );
      expect(result.occupancyStatus.occupancyCount).toBe(5);
      expect(result.occupancyStatus.noShowStatus).toBeNull();

      // upcomingBookings map dung
      expect(result.upcomingBookings).toHaveLength(1);
      expect(result.upcomingBookings[0].bookingId).toBe('upcoming-booking-1');
      expect(result.upcomingBookings[0].title).toBe('Hop review Q3');

      // BR-6: createdBy/updatedBy dung
      expect(result.createdBy).toEqual({
        userId: 'user-created-id',
        fullName: 'Nguyen Van A',
      });
      expect(result.updatedBy).toEqual({
        userId: 'user-updated-id',
        fullName: 'Tran Thi B',
      });
    });

    it('should throw NotFoundException EARLY when room not found — roomStatusService MUST NOT be called (BR-2)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getRoomDetail(mockRoomId)).rejects.toThrow(
        NotFoundException,
      );

      // KHONG goi roomStatusService khi da biet room khong ton tai
      expect(roomStatusService.getRoomStatus).not.toHaveBeenCalled();
      expect(roomStatusService.getRoomStatus).toHaveBeenCalledTimes(0);
    });

    it('should return createdBy=null when entity.createdByUser is null (BR-6 null-safe)', async () => {
      const roomNullCreatedBy = {
        ...mockRoomWithRelations,
        createdByUser: null,
        updatedByUser: null,
      };
      (roomRepo.findOne as jest.Mock).mockResolvedValue(roomNullCreatedBy);
      (roomStatusService.getRoomStatus as jest.Mock).mockResolvedValue({
        ...mockOccupancyStatus,
        currentBooking: null,
      });
      (dataSource.manager.query as jest.Mock).mockResolvedValue([]);

      const result = await service.getRoomDetail(mockRoomId);

      expect(result.createdBy).toBeNull();
      expect(result.updatedBy).toBeNull();
    });

    it('should return createdBy object when entity.createdByUser is present (BR-6)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(mockRoomWithRelations);
      (roomStatusService.getRoomStatus as jest.Mock).mockResolvedValue(
        mockOccupancyStatus,
      );
      (dataSource.manager.query as jest.Mock).mockResolvedValue([]);

      const result = await service.getRoomDetail(mockRoomId);

      expect(result.createdBy).toEqual({
        userId: 'user-created-id',
        fullName: 'Nguyen Van A',
      });
    });

    it('should return upcomingBookings=[] when no future bookings (BR-4 empty)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(mockRoomWithRelations);
      (roomStatusService.getRoomStatus as jest.Mock).mockResolvedValue(
        mockOccupancyStatus,
      );
      (dataSource.manager.query as jest.Mock).mockResolvedValue([]);

      const result = await service.getRoomDetail(mockRoomId);

      expect(result.upcomingBookings).toEqual([]);
    });

    it('should pass correct roomId param to SQL query (SEC-03 parameterized)', async () => {
      (roomRepo.findOne as jest.Mock).mockResolvedValue(mockRoomWithRelations);
      (roomStatusService.getRoomStatus as jest.Mock).mockResolvedValue(
        mockOccupancyStatus,
      );
      (dataSource.manager.query as jest.Mock).mockResolvedValue([]);

      await service.getRoomDetail(mockRoomId);

      // Assert SQL chứa 'LIMIT 5' và 'reserved_start_time > now()'
      const [sqlArg, paramsArg] = (dataSource.manager.query as jest.Mock).mock
        .calls[0];
      expect(sqlArg).toContain('LIMIT 5');
      expect(sqlArg).toContain('reserved_start_time > now()');
      expect(paramsArg).toEqual([mockRoomId]);
    });

    it('should map up to 5 upcoming bookings (BR-4 limit)', async () => {
      const fiveBookings = Array.from({ length: 5 }, (_, i) => ({
        booking_id: `booking-${i}`,
        meeting_id: `meeting-${i}`,
        title: `Meeting ${i}`,
        host_name: 'Host',
        reserved_start_time: new Date(`2026-08-12T0${i}:00:00Z`),
        reserved_end_time: new Date(`2026-08-12T0${i}:30:00Z`),
      }));

      (roomRepo.findOne as jest.Mock).mockResolvedValue(mockRoomWithRelations);
      (roomStatusService.getRoomStatus as jest.Mock).mockResolvedValue(
        mockOccupancyStatus,
      );
      (dataSource.manager.query as jest.Mock).mockResolvedValue(fiveBookings);

      const result = await service.getRoomDetail(mockRoomId);

      expect(result.upcomingBookings).toHaveLength(5);
      expect(result.upcomingBookings[0].bookingId).toBe('booking-0');
    });

    it('should separate administrativeStatus from occupancyStatus (D-5, BR-3)', async () => {
      // Edge case: currentStatus = maintenance nhung van co booking active trong DB
      const roomMaintenance = {
        ...mockRoomWithRelations,
        currentStatus: RoomStatus.MAINTENANCE,
      };
      (roomRepo.findOne as jest.Mock).mockResolvedValue(roomMaintenance);
      (roomStatusService.getRoomStatus as jest.Mock).mockResolvedValue(
        mockOccupancyStatus,
      );
      (dataSource.manager.query as jest.Mock).mockResolvedValue([]);

      const result = await service.getRoomDetail(mockRoomId);

      // administrativeStatus phai la maintenance (field thu cong cua admin)
      expect(result.administrativeStatus).toBe(RoomStatus.MAINTENANCE);
      // occupancyStatus van co currentBooking (doc lap voi administrativeStatus)
      expect(result.occupancyStatus.currentBooking).not.toBeNull();
      expect(result.occupancyStatus.currentBooking?.bookingId).toBe(
        'booking-uuid-1',
      );
    });
  });
});
