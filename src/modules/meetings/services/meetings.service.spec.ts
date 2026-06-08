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
    Pick<Repository<any>, 'findOne' | 'find' | 'count' | 'createQueryBuilder'>
  >;

  const mockQueryBuilder = () => {
    const qb: any = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getRawMany: jest.fn(),
    };
    return qb;
  };

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    em = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
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
});
