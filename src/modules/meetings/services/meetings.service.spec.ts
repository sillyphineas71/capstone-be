/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';

import { MeetingsService } from './meetings.service.js';
import { CreateMeetingDto } from '../dto/create-meeting.dto.js';
import {
  MeetingEntity,
  MeetingStatus,
  MeetingType,
  MeetingMode,
} from '../entities/meeting.entity.js';
import {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalMode,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../entities/meeting-request.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  InvitationStatus,
  ParticipantAttendanceStatus,
} from '../entities/meeting-participant.entity.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
} from '../entities/meeting-event.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
  BookingType,
} from '../../rooms/entities/room-booking.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
  NotificationDeliveryStatus,
} from '../../notifications/entities/notification.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

describe('MeetingsService', () => {
  let service: MeetingsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;
  let mockRepo: jest.Mocked<
    Pick<Repository<any>, 'findOne' | 'find' | 'count' | 'save' | 'create' | 'createQueryBuilder'>
  >;

  const mockQueryBuilder = () => {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn(),
      getRawMany: jest.fn(),
      getRawOne: jest.fn(),
    };
    return qb;
  };

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue({
        count: jest.fn().mockResolvedValue(0),
      }),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (manager: EntityManager) => unknown) =>
          cb(em),
        ),
      getRepository: jest.fn().mockReturnValue(mockRepo),
    } as unknown as jest.Mocked<DataSource>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingsService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<MeetingsService>(MeetingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRoomAvailability', () => {
    it('[T013] should return no conflict when room is available', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const result = await service.getRoomAvailability(
        'room-uuid',
        new Date('2026-07-01T10:00:00Z'),
        new Date('2026-07-01T11:00:00Z'),
      );

      expect(result.hasConflict).toBe(false);
      expect(result.conflictingBookingId).toBeNull();
    });

    it('[T013] should return conflict when room has overlapping booking', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'booking-uuid' });

      const result = await service.getRoomAvailability(
        'room-uuid',
        new Date('2026-07-01T10:00:00Z'),
        new Date('2026-07-01T11:00:00Z'),
      );

      expect(result.hasConflict).toBe(true);
      expect(result.conflictingBookingId).toBe('booking-uuid');
    });
  });

  describe('generateMeetingCode', () => {
    it('[T014] should generate code in MT-YYYYMMDD-NNN format', async () => {
      mockRepo.count.mockResolvedValue(0);

      const code = await service.generateMeetingCode();

      expect(code).toMatch(/^MT-\d{8}-001$/);
    });

    it('[T014] should increment sequence number', async () => {
      mockRepo.count.mockResolvedValue(5);

      const code = await service.generateMeetingCode();

      expect(code).toMatch(/^MT-\d{8}-006$/);
    });
  });

  describe('generateBookingCode', () => {
    it('[T015] should generate code in BK-YYYYMMDD-NNN format', async () => {
      mockRepo.count.mockResolvedValue(2);

      const code = await service.generateBookingCode();

      expect(code).toMatch(/^BK-\d{8}-003$/);
    });
  });

  describe('checkParticipantConflicts', () => {
    const startTime = new Date('2026-07-01T10:00:00Z');
    const endTime = new Date('2026-07-01T11:00:00Z');

    it('[T015b] should return empty conflicts when no participants', async () => {
      const result = await service.checkParticipantConflicts(
        [],
        startTime,
        endTime,
      );

      expect(result.conflicts).toHaveLength(0);
    });

    it('[T015b] should return empty conflicts when no time overlap', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.checkParticipantConflicts(
        ['user-1'],
        startTime,
        endTime,
      );

      expect(result.conflicts).toHaveLength(0);
    });

    it('[T015b] should detect participant conflict', async () => {
      const qb = mockQueryBuilder();
      const mockMeeting = {
        title: 'Conflicting Meeting',
        id: 'meeting-2',
        startTime: new Date('2026-07-01T09:00:00Z'),
        endTime: new Date('2026-07-01T12:00:00Z'),
      };
      qb.getMany.mockResolvedValue([
        {
          userId: 'user-1',
          meeting: mockMeeting,
        } as MeetingParticipantEntity,
      ]);
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.checkParticipantConflicts(
        ['user-1'],
        startTime,
        endTime,
      );

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].userId).toBe('user-1');
      expect(result.conflicts[0].meetingTitle).toBe('Conflicting Meeting');
    });
  });

  describe('getAvailableRooms', () => {
    const startTime = new Date('2026-07-01T10:00:00Z');
    const endTime = new Date('2026-07-01T11:00:00Z');

    it('[T017d] should return active rooms with no conflicts', async () => {
      const roomsQb = mockQueryBuilder();
      const availableRoom = {
        id: 'room-1',
        roomCode: 'R01',
        roomName: 'Phòng A',
        capacity: 10,
        isActive: true,
        currentStatus: 'available',
      } as RoomEntity;
      roomsQb.getMany.mockResolvedValue([availableRoom]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime);

      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('room-1');
    });

    it('[T017d] should exclude rooms with conflicting bookings', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-1',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
        {
          id: 'room-2',
          capacity: 15,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([{ rb_room_id: 'room-2' }]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime);

      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('room-1');
    });

    it('[T017d] should filter by min capacity', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-2',
          capacity: 20,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime, 10);

      expect(rooms).toHaveLength(1);
      expect(rooms[0].id).toBe('room-2');
    });

    it('[T017d] should exclude inactive rooms', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRooms(startTime, endTime);

      expect(rooms).toHaveLength(0);
    });
  });

  describe('create', () => {
    const validDto: CreateMeetingDto = {
      title: 'Họp dự án',
      startTime: '2026-07-15T10:00:00.000Z',
      endTime: '2026-07-15T11:00:00.000Z',
      roomId: 'room-uuid',
      participantUserIds: ['user-p1', 'user-p2'],
    };

    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    let saveSeq = 0;

    function setupDefaultMocks() {
      saveSeq = 0;
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = `saved-${++saveSeq}`;
          return data;
        }
        return _entity;
      });

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 20,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return null;
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });

      mockRepo.find.mockImplementation(async (options?: any) => {
        const ids: string[] = options?.where?.id?._value ?? [];
        return ids.map((uid: string) => ({
          id: uid,
          accountStatus: AccountStatus.ACTIVE,
        }));
      });

      mockRepo.count.mockResolvedValue(0);

      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([
        { id: 'approver-1' } as UserEntity,
      ]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(approverQb);
    }

    it('[T021] should create meeting successfully with all records', async () => {
      setupDefaultMocks();

      const result = await service.create(validDto, authUser, clientContext);

      expect(result).toBeDefined();
      expect(result.title).toBe('Họp dự án');
      expect(result.status).toBe(MeetingStatus.PENDING_APPROVAL);
      expect(result.approvalStatus).toBe(ApprovalStatus.PENDING);
      expect(result.bookingStatus).toBe(RoomBookingStatus.PENDING);
      expect(result.roomName).toBe('Phòng A');
      expect(result.meetingCode).toMatch(/^MT-\d{8}-\d{3}$/);
      expect(result.bookingCode).toMatch(/^BK-\d{8}-\d{3}$/);
      expect(result.hostId).toBe(authUser.userId);
      expect(result.organizerId).toBe(authUser.userId);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[T026] should default host to authUser when hostId not provided', async () => {
      const dto = { ...validDto, hostId: undefined };
      setupDefaultMocks();
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([]);

      const result = await service.create(dto, authUser, clientContext);

      expect(result.hostId).toBe(authUser.userId);
    });

    it('[T026] should auto-add host to participants', async () => {
      setupDefaultMocks();

      const result = await service.create(
        { ...validDto, participantUserIds: [] },
        authUser,
        clientContext,
      );

      expect(result.participantCount).toBe(1);
    });

    it('[T022] should throw 409 when room has conflict', async () => {
      setupDefaultMocks();
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 20,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return { id: 'booking-1' };
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });
      mockRepo.find.mockImplementation(async (options?: any) => {
        const ids: string[] = options?.where?.id?._value ?? [];
        return ids.map((uid: string) => ({
          id: uid,
          accountStatus: AccountStatus.ACTIVE,
        }));
      });
      mockRepo.count.mockResolvedValue(0);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(approverQb);

      await expect(
        service.create(validDto, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[T023] should throw 422 when capacity exceeded without override', async () => {
      const dto = {
        ...validDto,
        participantUserIds: [
          'user-p1',
          'user-p2',
          'user-p3',
          'user-p4',
          'user-p5',
          'user-p6',
          'user-p7',
          'user-p8',
          'user-p9',
          'user-p10',
          'user-p11',
          'user-p12',
          'user-p13',
          'user-p14',
          'user-p15',
          'user-p16',
          'user-p17',
          'user-p18',
          'user-p19',
          'user-p20',
        ],
      };

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 10,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return null;
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });
      mockRepo.find.mockImplementation(async (options?: any) => {
        const ids: string[] = options?.where?.id?._value ?? [];
        return ids.map((uid: string) => ({
          id: uid,
          accountStatus: AccountStatus.ACTIVE,
        }));
      });
      mockRepo.count.mockResolvedValue(0);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(conflictQb);

      await expect(
        service.create(dto, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T024] should allow creation with capacity override', async () => {
      const dto = {
        ...validDto,
        capacityOverrideConfirmed: true,
        participantUserIds: ['user-p1', 'user-p2'],
      };

      saveSeq = 0;
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = `saved-${++saveSeq}`;
          return data;
        }
        return _entity;
      });

      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'room-uuid') {
          return {
            id: 'room-uuid',
            roomName: 'Phòng A',
            capacity: 10,
            isActive: true,
            currentStatus: 'available',
          } as RoomEntity;
        }
        if (options?.where?.roomId) {
          return null;
        }
        if (options?.where?.configKey) {
          return null;
        }
        return { id: 'some-id', accountStatus: AccountStatus.ACTIVE };
      });
      mockRepo.find.mockImplementation(async (options?: any) => {
        const ids: string[] = options?.where?.id?._value ?? [];
        return ids.map((uid: string) => ({
          id: uid,
          accountStatus: AccountStatus.ACTIVE,
        }));
      });
      mockRepo.count.mockResolvedValue(0);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      const approverQb = mockQueryBuilder();
      approverQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(conflictQb)
        .mockReturnValueOnce(approverQb);

      const result = await service.create(dto, authUser, clientContext);

      expect(result).toBeDefined();
      expect(result.status).toBe(MeetingStatus.PENDING_APPROVAL);
    });

    it('[T025] should throw 404 when room not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(validDto, authUser, clientContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('[T027] should generate valid meeting_code and booking_code', async () => {
      setupDefaultMocks();

      const result = await service.create(validDto, authUser, clientContext);

      expect(result.meetingCode).toMatch(/^MT-\d{8}-\d{3}$/);
      expect(result.bookingCode).toMatch(/^BK-\d{8}-\d{3}$/);
    });

    it('[T028] should create notification and audit log records', async () => {
      setupDefaultMocks();

      await service.create(validDto, authUser, clientContext);

      expect(em.create).toHaveBeenCalledWith(
        NotificationEntity,
        expect.objectContaining({
          deliveryStatus: NotificationDeliveryStatus.QUEUED,
        }),
      );
      expect(em.create).toHaveBeenCalledWith(
        AuditLogEntity,
        expect.objectContaining({
          actionType: 'create',
          entityType: 'meeting_request',
        }),
      );
    });

    it('[T029] should rollback transaction on DB failure', async () => {
      setupDefaultMocks();

      dataSource.transaction.mockImplementation(async (_cb: any) => {
        throw new Error('DB Error');
      });

      await expect(
        service.create(validDto, authUser, clientContext),
      ).rejects.toThrow('DB Error');
    });

    it('should throw BadRequest for past startTime', async () => {
      const pastDto = {
        ...validDto,
        startTime: '2020-01-01T10:00:00.000Z',
        endTime: '2020-01-01T11:00:00.000Z',
      };

      await expect(
        service.create(pastDto, authUser, clientContext),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequest for endTime before startTime', async () => {
      const invalidDto = {
        ...validDto,
        startTime: '2026-07-15T11:00:00.000Z',
        endTime: '2026-07-15T10:00:00.000Z',
      };

      await expect(
        service.create(invalidDto, authUser, clientContext),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAvailableRoomsForMeeting', () => {
    const fakeMeeting = {
      id: 'meeting-uuid',
      roomId: 'room-uuid',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:00:00Z'),
    };

    beforeEach(() => {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        if (options?.where?.id === 'meeting-uuid') return fakeMeeting;
        if (options?.where?.id === 'nonexistent-uuid') return null;
        return null;
      });

      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);
    });

    it('[T013-1] should return available rooms excluding current room', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-other',
          roomCode: 'R02',
          roomName: 'Phòng B',
          capacity: 20,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
        {
          id: 'room-uuid',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid');

      expect(rooms).toHaveLength(1);
      expect(rooms[0].roomId).toBe('room-other');
      expect(rooms[0].isCurrentRoom).toBe(false);
    });

    it('[T013-2] should include current room when includeCurrentRoom=true', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-uuid',
          roomCode: 'R01',
          roomName: 'Phòng A',
          capacity: 10,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid', {
        includeCurrentRoom: true,
      });

      expect(rooms).toHaveLength(1);
      expect(rooms[0].isCurrentRoom).toBe(true);
    });

    it('[T013-3] should attach capacityWarning when capacityWarningMode=true', async () => {
      const roomsQb = mockQueryBuilder();
      roomsQb.getMany.mockResolvedValue([
        {
          id: 'room-small',
          roomCode: 'R02',
          roomName: 'Small Room',
          capacity: 3,
          isActive: true,
          currentStatus: 'available',
        } as RoomEntity,
      ]);
      const bookingsQb = mockQueryBuilder();
      bookingsQb.getRawMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReset()
        .mockReturnValueOnce(roomsQb)
        .mockReturnValueOnce(bookingsQb);

      mockRepo.count.mockResolvedValue(3);

      const rooms = await service.getAvailableRoomsForMeeting('meeting-uuid', {
        capacityWarningMode: true,
      });

      expect(rooms).toHaveLength(1);
      expect(rooms[0].capacityWarning).toBeDefined();
      expect(rooms[0].capacityWarning!.roomCapacity).toBe(3);
      expect(rooms[0].capacityWarning!.attendeeCount).toBe(6);
    });

    it('[T013-4] should throw when meeting not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getAvailableRoomsForMeeting('nonexistent-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMeetingRoom', () => {
    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    const fakeMeeting = {
      id: 'meeting-uuid',
      meetingCode: 'MT-20260701-001',
      title: 'Họp dự án',
      roomId: 'old-room-uuid',
      organizerId: 'auth-user-uuid',
      hostId: 'auth-user-uuid',
      startTime: new Date('2026-07-01T10:00:00Z'),
      endTime: new Date('2026-07-01T11:00:00Z'),
      status: MeetingStatus.SCHEDULED,
      recurrenceRuleId: null,
      parentMeetingId: null,
      deletedAt: null,
    };

    const fakeNewRoom = {
      id: 'new-room-uuid',
      roomName: 'New Room',
      capacity: 20,
      isActive: true,
      currentStatus: 'available',
    };

    function setupFindOneMocks(customMocks?: Record<string, any>) {
      mockRepo.findOne.mockImplementation(async (options?: any) => {
        const id = options?.where?.id;
        if (id === 'meeting-uuid') return customMocks?.meeting ?? fakeMeeting;
        if (id === 'old-room-uuid') return { id: 'old-room-uuid', roomName: 'Old Room', capacity: 10 };
        if (id === 'new-room-uuid') return customMocks?.newRoom ?? fakeNewRoom;
        if (id === 'small-room') return { id: 'small-room', roomName: 'Small', capacity: 2, isActive: true, currentStatus: 'available' };
        if (id === 'null-cap-room') return { id: 'null-cap-room', roomName: 'NullCap', capacity: null, isActive: true, currentStatus: 'available' };
        return null;
      });
    }

    function setupAttendeeCountMocks(count: number) {
      mockRepo.count.mockResolvedValue(count);
      const extCountQb = mockQueryBuilder();
      extCountQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extCountQb)
        .mockReturnValueOnce(conflictQb);
    }

    function setupTransactionMocks() {
      em.findOne.mockResolvedValue(fakeMeeting);
      em.update.mockResolvedValue({ affected: 1 } as any);
      em.create.mockImplementation(<T>(_: any, plain: T): T => plain);
      em.save.mockImplementation(async (_entity: any, data: any) => {
        if (data && typeof data === 'object') {
          if (!data.id) data.id = 'saved-id';
          return data;
        }
        return _entity;
      });
      em.count.mockResolvedValue(0);
    }

    it('[T012-1] should update room successfully for organizer', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        authUser,
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.oldRoom.id).toBe('old-room-uuid');
      expect(result.newRoom.id).toBe('new-room-uuid');
      expect(result.notificationStatus).toBe('sent');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[T012-2] should update room successfully for host', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, hostId: 'host-uuid', organizerId: 'other-uuid' } });
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        { userId: 'host-uuid' },
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.oldRoom.id).toBe('old-room-uuid');
    });

    it('[T012-3] should update room successfully for admin', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, organizerId: 'other-uuid', hostId: 'other-uuid' } });

      mockRepo.count.mockResolvedValue(5);

      const permQb = mockQueryBuilder();
      permQb.getOne.mockResolvedValue({ id: 'user' } as any);
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(permQb)
        .mockReturnValueOnce(conflictQb);

      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid' },
        { userId: 'admin-uuid' },
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
    });

    it('[T012-4] should throw 403 for participant', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, organizerId: 'other-uuid', hostId: 'other-uuid' } });

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, { userId: 'participant-uuid' }, clientContext),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[T012-5] should throw 409 for non-SCHEDULED meeting', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, status: MeetingStatus.COMPLETED } });

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-6] should throw 409 when meeting already started', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, startTime: new Date('2026-06-01T10:00:00Z') } });

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-7] should throw 422 when same room', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, roomId: 'new-room-uuid' } });

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T012-8] should throw 409 when new room has conflict', async () => {
      setupFindOneMocks();
      mockRepo.count.mockResolvedValue(5);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([{ id: 'booking-1' }]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extQb)
        .mockReturnValueOnce(conflictQb);

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-9] should throw 422 when capacity too low without override', async () => {
      setupFindOneMocks({ newRoom: { ...fakeNewRoom, id: 'small-room', capacity: 2 } });
      mockRepo.count.mockResolvedValue(10);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extQb)
        .mockReturnValueOnce(conflictQb);

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'small-room' }, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T012-10] should override capacity warning and pass', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, roomId: 'old-room-uuid' } });
      mockRepo.count.mockResolvedValue(10);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      const conflictQb = mockQueryBuilder();
      conflictQb.getMany.mockResolvedValue([]);
      mockRepo.createQueryBuilder
        .mockReturnValueOnce(extQb)
        .mockReturnValueOnce(conflictQb);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom(
        'meeting-uuid',
        { newRoomId: 'new-room-uuid', confirmCapacityOverride: true },
        authUser,
        clientContext,
      );

      expect(result.meetingId).toBe('meeting-uuid');
    });

    it('[T012-11] should throw 422 when new room capacity is null', async () => {
      setupFindOneMocks({ newRoom: { id: 'null-cap-room', roomName: 'NullCap', capacity: null, isActive: true, currentStatus: 'available' } });
      mockRepo.count.mockResolvedValue(5);
      const extQb = mockQueryBuilder();
      extQb.getRawOne.mockResolvedValue({ total: 0 });
      mockRepo.createQueryBuilder.mockReturnValueOnce(extQb);

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'null-cap-room' }, authUser, clientContext),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('[T012-12] should throw 409 for recurring series master', async () => {
      setupFindOneMocks({ meeting: { ...fakeMeeting, recurrenceRuleId: 'rule-uuid', parentMeetingId: null } });

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext),
      ).rejects.toThrow(ConflictException);
    });

    it('[T012-13] should rollback transaction on failure', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      em.save.mockRejectedValue(new Error('DB Error'));

      await expect(
        service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext),
      ).rejects.toThrow('DB Error');
    });

    it('[T012-14] should preserve other meeting fields', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.find.mockResolvedValue([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });

      const result = await service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext);

      expect(result.meetingId).toBe('meeting-uuid');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[T012-15] should return 200 with notificationStatus= failed when notification fails', async () => {
      setupFindOneMocks();
      setupAttendeeCountMocks(5);
      setupTransactionMocks();
      mockRepo.save.mockRejectedValue(new Error('Send failed'));

      const result = await service.updateMeetingRoom('meeting-uuid', { newRoomId: 'new-room-uuid' }, authUser, clientContext);

      expect(result.notificationStatus).toBe('failed');
    });
  });

  describe('cancelMeeting', () => {
    const authUser = { userId: 'auth-user-uuid' };
    const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

    function buildMeeting(overrides?: Record<string, any>) {
      return {
        id: 'meeting-uuid',
        meetingCode: 'MT-20260701-001',
        title: 'Họp dự án',
        status: MeetingStatus.SCHEDULED,
        organizerId: 'auth-user-uuid',
        hostId: 'auth-user-uuid',
        roomId: 'room-uuid',
        startTime: new Date('2099-07-01T10:00:00Z'),
        endTime: new Date('2099-07-01T11:00:00Z'),
        deletedAt: null,
        cancellationReason: null,
        updatedAt: new Date('2026-06-01T00:00:00Z'),
        ...overrides,
      };
    }

    const LOCKED_MEETING = [
      {
        id: 'meeting-uuid',
        status: 'scheduled',
        start_time: '2099-07-01T10:00:00.000Z',
        end_time: '2099-07-01T11:00:00.000Z',
        organizer_id: 'auth-user-uuid',
        host_id: 'auth-user-uuid',
        title: 'Họp dự án',
        cancellation_reason: null,
        updated_at: new Date('2026-06-01T00:00:00Z'),
      },
    ];

    const FULL_BOOKING = [
      {
        id: 'booking-uuid',
        room_id: 'room-uuid',
        status: 'approved',
        start_time: '2099-07-01T10:00:00.000Z',
        end_time: '2099-07-01T11:00:00.000Z',
      },
    ];

    const FULL_USAGE = [
      { id: 'usage-uuid', usage_status: 'not_started' },
    ];

    const CANCELLED_AT = new Date('2026-06-01T12:00:00Z');

    function setupEmQueryFullFlow(cancelledAt: Date = CANCELLED_AT) {
      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)           // 4a: Lock meeting
        .mockResolvedValueOnce(FULL_BOOKING)               // 4c: Lock bookings
        .mockResolvedValueOnce(FULL_USAGE)                // 4d: Lock usages
        .mockResolvedValueOnce(undefined)                 // 4e: Update booking
        .mockResolvedValueOnce(undefined)                 // 4f: Update usage
        .mockResolvedValueOnce(undefined)                 // 4g: Insert room event
        .mockResolvedValueOnce(undefined)                 // 4h: Insert audit (release)
        .mockResolvedValueOnce(undefined)                 // 4i: Update meeting
        .mockResolvedValueOnce([{ updated_at: cancelledAt }]) // 4j: Select updated_at
        .mockResolvedValueOnce(undefined)                 // 4k: Insert meeting event
        .mockResolvedValueOnce(undefined);                // 4l: Insert audit (cancel)
    }

    function setupEmQueryNoBooking() {
      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)           // 4a: Lock meeting
        .mockResolvedValueOnce([])                         // 4c: No bookings
        .mockResolvedValueOnce(undefined)                 // 4i: Update meeting
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }]) // 4j: Select updated_at
        .mockResolvedValueOnce(undefined)                 // 4k: Insert meeting event
        .mockResolvedValueOnce(undefined);                // 4l: Insert audit (cancel)
    }

    function setupNotificationMocks() {
      mockRepo.find
        .mockResolvedValueOnce([
          { userId: 'participant-1' },
          { userId: 'participant-2' },
        ])
        .mockResolvedValueOnce([
          { email: 'external@example.com' },
        ]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'saved-id' });
    }

    // ── Happy Path ──

    it('[T006-1] should cancel meeting as organizer (200)', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, 'Lý do',
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.status).toBe('cancelled');
      expect(result.roomReleased).toBe(true);
      expect(result.releasedBookingId).toBe('booking-uuid');
      expect(result.cancelledBy).toBe('auth-user-uuid');
      expect(result.notificationStatus).toBe('queued');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('[T006-2] should cancel meeting as host (200)', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'auth-user-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.status).toBe('cancelled');
      expect(result.roomReleased).toBe(true);
    });

    it('[T006-3] should cancel meeting as admin with cancel.any (200)', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'other-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      const permQb = { ...mockQueryBuilder(), getOne: jest.fn().mockResolvedValue({ id: 'user' }) };
      mockRepo.createQueryBuilder.mockReturnValue(permQb);

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', { userId: 'admin-uuid' }, clientContext, undefined,
      );

      expect(result.status).toBe('cancelled');
    });

    // ── Authorization ──

    it('[T006-4] should throw 403 for participant without cancel permission', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'other-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      const permQb = { ...mockQueryBuilder(), getOne: jest.fn().mockResolvedValue(null) };
      mockRepo.createQueryBuilder.mockReturnValue(permQb);

      await expect(
        service.cancelMeeting(
          'meeting-uuid', { userId: 'participant-uuid' }, clientContext, undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('[T006-5] should throw 403 for user with cancel.own but not owner', async () => {
      const meeting = buildMeeting({
        organizerId: 'other-uuid',
        hostId: 'other-uuid',
      });
      mockRepo.findOne.mockResolvedValue(meeting);

      const permQb = { ...mockQueryBuilder(), getOne: jest.fn().mockResolvedValue(null) };
      mockRepo.createQueryBuilder.mockReturnValue(permQb);

      await expect(
        service.cancelMeeting(
          'meeting-uuid', { userId: 'other-with-own' }, clientContext, undefined,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    // ── Business validation ──

    it('[T006-6] should throw 409 for in_progress meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ status: MeetingStatus.IN_PROGRESS }),
      );

      await expect(
        service.cancelMeeting('meeting-uuid', authUser, clientContext, undefined),
      ).rejects.toThrow(ConflictException);
    });

    it('[T006-7] should throw 409 for completed meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ status: MeetingStatus.COMPLETED }),
      );

      await expect(
        service.cancelMeeting('meeting-uuid', authUser, clientContext, undefined),
      ).rejects.toThrow(ConflictException);
    });

    it('[T006-8] should throw 409 for already cancelled meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ status: MeetingStatus.CANCELLED }),
      );

      await expect(
        service.cancelMeeting('meeting-uuid', authUser, clientContext, undefined),
      ).rejects.toThrow(ConflictException);
    });

    it('[T006-9] should throw 409 for meeting where start_time <= now', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ startTime: new Date('2020-01-01T10:00:00Z') }),
      );

      await expect(
        service.cancelMeeting('meeting-uuid', authUser, clientContext, undefined),
      ).rejects.toThrow(ConflictException);
    });

    // ── Not found ──

    it('[T006-10] should throw 404 for non-existent meeting', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.cancelMeeting('nonexistent-uuid', authUser, clientContext, undefined),
      ).rejects.toThrow(NotFoundException);
    });

    it('[T006-10b] should throw 404 for soft-deleted meeting', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ deletedAt: new Date() }),
      );

      await expect(
        service.cancelMeeting('meeting-uuid', authUser, clientContext, undefined),
      ).rejects.toThrow(NotFoundException);
    });

    // ── Room/booking state ──

    it('[T006-11] should cancel booking with reason when booking approved', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)
        .mockResolvedValueOnce(FULL_BOOKING)
        .mockResolvedValueOnce(FULL_USAGE)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, 'Lý do cụ thể',
      );

      expect(result.roomReleased).toBe(true);
      expect(result.releasedBookingId).toBe('booking-uuid');
    });

    it('[T006-12] should set roomReleased=false when no booking exists', async () => {
      mockRepo.findOne.mockResolvedValue(
        buildMeeting({ roomId: null }),
      );

      setupEmQueryNoBooking();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.roomReleased).toBe(false);
      expect(result.releasedBookingId).toBeNull();
    });

    it('[T006-13] should release usage when usage is not_started', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)
        .mockResolvedValueOnce(FULL_BOOKING)
        .mockResolvedValueOnce([{ id: 'usage-uuid', usage_status: 'not_started' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.roomReleased).toBe(true);
      expect(em.query.mock.calls[4][0]).toContain('UPDATE room_booking_usages');
    });

    it('[T006-14] should not create usage when no usage record exists', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query
        .mockResolvedValueOnce(LOCKED_MEETING)
        .mockResolvedValueOnce(FULL_BOOKING)
        .mockResolvedValueOnce([])                           // No usage
        .mockResolvedValueOnce(undefined)                     // Update booking
        .mockResolvedValueOnce(undefined)                     // Insert room event
        .mockResolvedValueOnce(undefined)                     // Insert audit (release)
        .mockResolvedValueOnce(undefined)                     // Update meeting
        .mockResolvedValueOnce([{ updated_at: CANCELLED_AT }])
        .mockResolvedValueOnce(undefined)                     // Insert meeting event
        .mockResolvedValueOnce(undefined);                    // Insert audit (cancel)
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.roomReleased).toBe(true);
    });

    // ── Events ──

    it('[T006-15] should create meeting_events with status_changed', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.status).toBe('cancelled');
      const meetingEventCall = em.query.mock.calls[9];
      expect(meetingEventCall[0]).toContain('INSERT INTO meeting_events');
      expect(meetingEventCall[0]).toContain('status_changed');
    });

    it('[T006-16] should create room_events with room_released', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      const roomEventCall = em.query.mock.calls[5];
      expect(roomEventCall[0]).toContain('INSERT INTO room_events');
      expect(roomEventCall[0]).toContain('room_released');
    });

    // ── Notification ──

    it('[T006-17] should create notification with [CANCELLED] subject prefix', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find
        .mockResolvedValueOnce([{ userId: 'participant-1' }])
        .mockResolvedValueOnce([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'notif-id' });

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.notificationStatus).toBe('queued');
      const createCalls = (mockRepo.create as jest.Mock).mock.calls;
      const notifArg = createCalls.find((args: any[]) => args[0]?.subject?.startsWith('[CANCELLED]'));
      expect(notifArg).toBeDefined();
    });

    it('[T006-18] should include reason in notification content', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find
        .mockResolvedValueOnce([{ userId: 'participant-1' }])
        .mockResolvedValueOnce([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save.mockResolvedValue({ id: 'notif-id' });

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, 'Hết giờ',
      );

      expect(result.notificationStatus).toBe('queued');
      const createCalls = (mockRepo.create as jest.Mock).mock.calls;
      const notifArg = createCalls.find((args: any[]) =>
        args[0]?.content?.includes('Hết giờ'),
      );
      expect(notifArg).toBeDefined();
    });

    // ── Audit ──

    it('[T006-19] should record audit logs for cancel and release', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      const auditCalls = em.query.mock.calls.filter(
        (call: any[]) => call[0].includes('INSERT INTO audit_logs'),
      );
      expect(auditCalls.length).toBe(2);
      expect(auditCalls[0][0]).toContain('release_room');
      expect(auditCalls[1][0]).toContain('cancel_meeting');
    });

    // ── Concurrency ──

    it('[T006-20] should throw 409 for concurrent cancel request', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      em.query.mockResolvedValueOnce([                    // 4a: Lock meeting (already cancelled)
        {
          id: 'meeting-uuid',
          status: 'cancelled',
          start_time: '2099-07-01T10:00:00.000Z',
          end_time: '2099-07-01T11:00:00.000Z',
          organizer_id: 'auth-user-uuid',
          host_id: 'auth-user-uuid',
          title: 'Họp dự án',
          cancellation_reason: null,
          updated_at: new Date('2026-06-01T00:00:00Z'),
        },
      ]);

      await expect(
        service.cancelMeeting('meeting-uuid', authUser, clientContext, undefined),
      ).rejects.toThrow(ConflictException);
    });

    // ── Notification failure ──

    it('[T006-21] should return 200 with notificationStatus=failed_to_queue when save fails', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find
        .mockResolvedValueOnce([{ userId: 'participant-1' }])
        .mockResolvedValueOnce([]);
      (mockRepo.create as jest.Mock).mockImplementation((data: any) => data);
      mockRepo.save
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValue({ id: 'audit-id' });

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.status).toBe('cancelled');
      expect(result.notificationStatus).toBe('failed_to_queue');
    });

    it('[T006-22] should not rollback cancel when notification fails (FR-032)', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      mockRepo.find.mockRejectedValue(new Error('DB error'));

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, undefined,
      );

      expect(result.meetingId).toBe('meeting-uuid');
      expect(result.status).toBe('cancelled');
      expect(result.notificationStatus).toBe('failed_to_queue');
    });

    // ── Reason handling ──

    it('[T006-23] should handle cancellation reason with whitespace trim', async () => {
      mockRepo.findOne.mockResolvedValue(buildMeeting());

      setupEmQueryFullFlow();
      setupNotificationMocks();

      const result = await service.cancelMeeting(
        'meeting-uuid', authUser, clientContext, '  lý do  ',
      );

      expect(result.status).toBe('cancelled');
      expect(result.meetingId).toBe('meeting-uuid');
    });
  });
});
