import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RoomBookingsService } from '../services/room-bookings.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { DepartmentEntity } from '../../accounts/entities/department.entity.js';

describe('RoomBookingsService', () => {
  let service: RoomBookingsService;
  let dataSource: jest.Mocked<DataSource>;
  let authzRepo: jest.Mocked<AuthzReadRepository>;
  let mockQueryBuilder: any;

  const mockUserId = '550e8400-e29b-41d4-a716-446655440000';
  const adminUserId = 'admin-550e8400-e29b-41d4-a716-446655440000';

  const mockBookingRow = {
    id: '660e8400-e29b-41d4-a716-446655440001',
    bookingCode: 'BK-2026-001',
    bookingType: 'scheduled',
    status: 'approved',
    roomId: '770e8400-e29b-41d4-a716-446655440002',
    meetingId: '880e8400-e29b-41d4-a716-446655440003',
    bookedBy: mockUserId,
    reservedStartTime: new Date('2026-07-25T09:00:00.000Z'),
    reservedEndTime: new Date('2026-07-25T10:00:00.000Z'),
    approvedBy: null,
    approvedAt: null,
    cancellationReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    room: { id: '770e8400-e29b-41d4-a716-446655440002', roomName: 'Phong 101' },
    meeting: {
      id: '880e8400-e29b-41d4-a716-446655440003',
      title: 'Sprint Planning',
    },
    bookedByUser: {
      id: mockUserId,
      fullName: 'Nguyen Van A',
      email: 'nva@company.com',
    },
    approvedByUser: null,
  };

  beforeEach(async () => {
    mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[mockBookingRow], 1]),
    };

    const mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    dataSource = {
      getRepository: jest.fn().mockReturnValue(mockRepository),
      manager: { query: jest.fn() },
    } as any;

    authzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomBookingsService,
        { provide: DataSource, useValue: dataSource },
        { provide: AuthzReadRepository, useValue: authzRepo },
      ],
    }).compile();

    service = module.get<RoomBookingsService>(RoomBookingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findRoomBookings', () => {
    it('should return paginated bookings for admin', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      const result = await service.findRoomBookings(
        { page: 1, limit: 20 },
        { userId: adminUserId },
      );

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should apply scope filter for manager', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['room.booking.read'],
      });

      dataSource.getRepository = jest.fn().mockImplementation((entity: any) => {
        if (entity === DepartmentEntity) {
          return {
            find: jest
              .fn()
              .mockResolvedValue([{ id: 'dept-1', managerUserId: mockUserId }]),
          };
        }
        return {
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        };
      });

      const result = await service.findRoomBookings(
        { page: 1, limit: 20 },
        { userId: mockUserId },
      );

      expect(result.items).toHaveLength(1);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should apply empty scope filter for manager with no depts', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['room.booking.read'],
      });

      dataSource.getRepository = jest.fn().mockImplementation((entity: any) => {
        if (entity === DepartmentEntity) {
          return {
            find: jest.fn().mockResolvedValue([]),
          };
        }
        return {
          createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        };
      });

      const result = await service.findRoomBookings(
        { page: 1, limit: 20 },
        { userId: mockUserId },
      );

      expect(result.total).toBe(1);
    });

    it('should not apply scope filter for BUSINESS_ADMIN', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['room.booking.read'],
      });

      const result = await service.findRoomBookings(
        { page: 1, limit: 20 },
        { userId: adminUserId },
      );

      expect(result.items).toHaveLength(1);
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('should filter by roomId', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      await service.findRoomBookings(
        { page: 1, limit: 20, roomId: '770e8400-e29b-41d4-a716-446655440002' },
        { userId: adminUserId },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'rb.roomId = :roomId',
        { roomId: '770e8400-e29b-41d4-a716-446655440002' },
      );
    });

    it('should filter by status', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      await service.findRoomBookings(
        { page: 1, limit: 20, status: 'active' },
        { userId: adminUserId },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'rb.status = :status',
        { status: 'active' },
      );
    });

    it('should filter by bookingType', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      await service.findRoomBookings(
        { page: 1, limit: 20, bookingType: 'ad_hoc' },
        { userId: adminUserId },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'rb.bookingType = :bookingType',
        { bookingType: 'ad_hoc' },
      );
    });

    it('should search by bookingCode', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      await service.findRoomBookings(
        { page: 1, limit: 20, q: 'BK-001' },
        { userId: adminUserId },
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'rb.bookingCode ILIKE :q',
        { q: '%BK-001%' },
      );
    });

    it('should order by default reserved_start_time DESC', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      await service.findRoomBookings(
        { page: 1, limit: 20 },
        { userId: adminUserId },
      );

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'rb.reserved_start_time',
        'DESC',
      );
    });

    it('should handle null meeting relation', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      const nullMeetingRow = {
        ...mockBookingRow,
        meeting: null,
      };

      mockQueryBuilder.getManyAndCount.mockResolvedValue([[nullMeetingRow], 1]);

      const result = await service.findRoomBookings(
        { page: 1, limit: 20 },
        { userId: adminUserId },
      );

      expect(result.items[0].meeting).toBeNull();
    });

    it('should handle null approvedByUser', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      const result = await service.findRoomBookings(
        { page: 1, limit: 20 },
        { userId: adminUserId },
      );

      expect(result.items[0].approvedByUser).toBeNull();
    });

    it('should use pagination skip/take', async () => {
      authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['room.booking.read'],
      });

      await service.findRoomBookings(
        { page: 2, limit: 10 },
        { userId: adminUserId },
      );

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });
});
