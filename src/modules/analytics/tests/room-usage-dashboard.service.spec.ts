import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { RoomUsageDashboardService } from '../services/room-usage-dashboard.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { RoomUsageDashboardRepository } from '../repositories/room-usage-dashboard.repository';
import { RoomUsageConfigService } from '../services/room-usage-config.service';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryRoomUsageDashboardDto } from '../dto/query-room-usage-dashboard.dto';
import { QueryRoomDetailDto } from '../dto/query-room-detail.dto';

describe('RoomUsageDashboardService', () => {
  let service: RoomUsageDashboardService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<RoomUsageDashboardRepository>;
  let mockConfigService: jest.Mocked<RoomUsageConfigService>;
  let mockDashboardConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';
  const mockRoomId = '00000000-0000-0000-0000-000000000002';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerRoomIds: jest.fn(),
      getRoom: jest.fn(),
      getBookedAggregate: jest.fn(),
      getActualAggregate: jest.fn(),
      listRoomsForComparison: jest.fn(),
      getRoomMeetingsList: jest.fn(),
      getRoomTrend: jest.fn(),
      getRoomUsagesRaw: jest.fn(),
    } as unknown as jest.Mocked<RoomUsageDashboardRepository>;

    mockConfigService = {
      getOperatingHoursPerDay: jest.fn(),
    } as unknown as jest.Mocked<RoomUsageConfigService>;

    mockDashboardConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomUsageDashboardService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: RoomUsageDashboardRepository, useValue: mockRepo },
        { provide: RoomUsageConfigService, useValue: mockConfigService },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockDashboardConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<RoomUsageDashboardService>(RoomUsageDashboardService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveDateRange', () => {
    it('defaults to month boundaries', () => {
      const result = service.resolveDateRange();
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
    });

    it('preset=day', () => {
      const result = service.resolveDateRange('day');
      expect(result.from).toBe(result.to);
    });

    it('preset=week', () => {
      const result = service.resolveDateRange('week');
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
    });

    it('preset=custom valid', () => {
      const result = service.resolveDateRange(
        'custom',
        '2026-06-01',
        '2026-06-15',
      );
      expect(result).toEqual({ from: '2026-06-01', to: '2026-06-15' });
    });

    it('preset=custom invalid (from > to) -> BadRequestException', () => {
      expect(() =>
        service.resolveDateRange('custom', '2026-06-15', '2026-06-01'),
      ).toThrow(BadRequestException);
    });

    // T2: preset=custom with missing `to` -> BadRequestException (VALIDATION_ERROR)
    it('preset=custom missing to -> BadRequestException', () => {
      expect(() =>
        service.resolveDateRange('custom', '2026-06-01', undefined),
      ).toThrow(BadRequestException);
    });

    // T2: preset=custom with missing both dates -> BadRequestException
    it('preset=custom missing both from and to -> BadRequestException', () => {
      expect(() =>
        service.resolveDateRange('custom', undefined, undefined),
      ).toThrow(BadRequestException);
    });
  });

  describe('validateMaxRange', () => {
    it('passes if range <= maxDays', async () => {
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-06-30'),
      ).resolves.toBeUndefined();
    });

    it('throws if range > maxDays', async () => {
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(30);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-07-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveScope', () => {
    it('SYSTEM_ADMIN -> scopeRoomIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.room.read'],
      });

      const result = await service.resolveScope(
        mockUserId,
        '2026-06-01',
        '2026-06-30',
      );
      expect(result).toEqual({
        isAdmin: true,
        scopeRoomIds: null,
        viewerRole: 'SYSTEM_ADMIN',
      });
    });

    it('MANAGER -> queries room ids based on date range', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.room.read'],
      });
      mockRepo.getManagerRoomIds.mockResolvedValue(['r1']);

      const result = await service.resolveScope(
        mockUserId,
        '2026-06-01',
        '2026-06-30',
      );
      expect(result).toEqual({
        isAdmin: false,
        scopeRoomIds: ['r1'],
        viewerRole: 'MANAGER',
      });
      expect(mockRepo.getManagerRoomIds).toHaveBeenCalledWith(
        mockUserId,
        '2026-06-01',
        '2026-06-30',
      );
    });

    // T1: MANAGER scope changes dynamically based on the period being queried
    it('T1 – MANAGER scope changes by period: room in June but NOT July', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.room.read'],
      });

      // Room R1 is booked by department in June
      mockRepo.getManagerRoomIds.mockResolvedValueOnce(['r1']);
      const juneScope = await service.resolveScope(
        mockUserId,
        '2026-06-01',
        '2026-06-30',
      );
      expect(juneScope.scopeRoomIds).toContain('r1');
      expect(mockRepo.getManagerRoomIds).toHaveBeenCalledWith(
        mockUserId,
        '2026-06-01',
        '2026-06-30',
      );

      // No rooms booked by department in July (period boundary changes scope)
      mockRepo.getManagerRoomIds.mockResolvedValueOnce([]);
      const julyScope = await service.resolveScope(
        mockUserId,
        '2026-07-01',
        '2026-07-31',
      );
      expect(julyScope.scopeRoomIds).toEqual([]);
      expect(mockRepo.getManagerRoomIds).toHaveBeenCalledWith(
        mockUserId,
        '2026-07-01',
        '2026-07-31',
      );
    });

    // T4: EMPLOYEE role -> ForbiddenException (PERMISSION_DENIED)
    it('T4 – EMPLOYEE role -> ForbiddenException', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      await expect(
        service.resolveScope(mockUserId, '2026-06-01', '2026-06-30'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getComparisonDashboard', () => {
    it('throws validation error (400) before permission check (403) if date range is invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryRoomUsageDashboardDto = {
        preset: 'custom',
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(
        service.getComparisonDashboard({ userId: mockUserId }, query),
      ).rejects.toThrow(BadRequestException);
    });

    it('empty state (manager has 0 rooms in scope)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.room.read'],
      });
      mockRepo.getManagerRoomIds.mockResolvedValue([]);
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);

      const query: QueryRoomUsageDashboardDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getComparisonDashboard(
        { userId: mockUserId },
        query,
      );

      expect(result.data.rooms).toEqual([]);
      expect(result.data.summary.totalBookedHours).toBe(0);
      expect(mockRepo.listRoomsForComparison).not.toHaveBeenCalled();
    });

    it('happy path with occupancy calculation and rates', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockConfigService.getOperatingHoursPerDay.mockResolvedValue(8);

      const bookedMap = new Map<string, number>();
      bookedMap.set(mockRoomId, 120); // 2 hours
      const actualMap = new Map<
        string,
        { actualMinutes: number; hasActualData: boolean }
      >();
      actualMap.set(mockRoomId, { actualMinutes: 90, hasActualData: true }); // 1.5 hours

      mockRepo.getBookedAggregate.mockResolvedValue(bookedMap);
      mockRepo.getActualAggregate.mockResolvedValue(actualMap);
      mockRepo.listRoomsForComparison.mockResolvedValue([
        { id: mockRoomId, roomName: 'Room A' },
      ]);
      mockRepo.getRoomTrend.mockResolvedValue([]);

      const query: QueryRoomUsageDashboardDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05', // 5 days, capacity = 8 * 5 = 40 hours
      };

      const result = await service.getComparisonDashboard(
        { userId: mockUserId },
        query,
      );

      expect(result.data.rooms.length).toBe(1);
      expect(result.data.rooms[0].bookedHours).toBe(2.0);
      expect(result.data.rooms[0].actualHours).toBe(1.5);
      expect(result.data.rooms[0].reservationUtilizationRate).toBe(5.0); // 2 / 40 * 100
      expect(result.data.rooms[0].roomOccupancyRate).toBe(75.0); // 1.5 / 2 * 100
      expect(result.data.rooms[0].hasActualData).toBe(true);
      expect(result.data.summary.totalBookedHours).toBe(2.0);
      expect(result.data.summary.actualUsedHours).toBe(1.5);
      expect(result.data.summary.reservationUtilizationRate).toBe(5.0);
      expect(result.data.summary.roomOccupancyRate).toBe(75.0);
      expect(mockAuditLogsService.logAction).toHaveBeenCalled();
    });
  });

  describe('getRoomDetail', () => {
    it('throws NotFoundException if room does not exist', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getRoom.mockResolvedValue(null);

      await expect(
        service.getRoomDetail({ userId: mockUserId }, mockRoomId, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if MANAGER accesses a room outside scope', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.room.read'],
      });
      mockRepo.getManagerRoomIds.mockResolvedValue(['different-room']);
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getRoom.mockResolvedValue({
        id: mockRoomId,
        roomName: 'Room A',
        siteName: null,
        areaName: null,
        capacity: 10,
      });

      await expect(
        service.getRoomDetail({ userId: mockUserId }, mockRoomId, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('happy path details and heatmap', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockConfigService.getOperatingHoursPerDay.mockResolvedValue(8);
      mockRepo.getRoom.mockResolvedValue({
        id: mockRoomId,
        roomName: 'Room A',
        siteName: 'HQ',
        areaName: 'Floor 1',
        capacity: 10,
      });

      const bookedMap = new Map<string, number>();
      bookedMap.set(mockRoomId, 120);
      mockRepo.getBookedAggregate.mockResolvedValue(bookedMap);
      mockRepo.getActualAggregate.mockResolvedValue(new Map());
      mockRepo.getRoomMeetingsList.mockResolvedValue([]);
      mockRepo.getRoomUsagesRaw.mockResolvedValue([
        {
          actualStartTime: new Date('2026-06-01T09:30:00+07:00'),
          actualEndTime: new Date('2026-06-01T11:15:00+07:00'),
        },
      ]);

      const result = await service.getRoomDetail(
        { userId: mockUserId },
        mockRoomId,
        {
          preset: 'custom',
          from: '2026-06-01',
          to: '2026-06-05',
        },
      );

      expect(result.data.room.roomName).toBe('Room A');
      expect(result.data.room.siteName).toBe('HQ');
      expect(result.data.room.areaName).toBe('Floor 1');
      expect(result.data.room.capacity).toBe(10);
      expect(result.data.bookedHours).toBe(2.0);
      expect(result.data.hasActualData).toBe(false);
      expect(result.data.heatmap[9].actualMinutes).toBe(30);
      expect(result.data.heatmap[10].actualMinutes).toBe(60);
      expect(result.data.heatmap[11].actualMinutes).toBe(15);
    });

    // T3: Heatmap cumulates minutes from multiple sessions falling in the same hour bucket
    it('T3 – heatmap accumulates minutes from multiple sessions in the same hour bucket', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockConfigService.getOperatingHoursPerDay.mockResolvedValue(8);
      mockRepo.getRoom.mockResolvedValue({
        id: mockRoomId,
        roomName: 'Room A',
        siteName: null,
        areaName: null,
        capacity: 10,
      });

      mockRepo.getBookedAggregate.mockResolvedValue(new Map());
      mockRepo.getActualAggregate.mockResolvedValue(new Map());
      mockRepo.getRoomMeetingsList.mockResolvedValue([]);

      // Two sessions on DIFFERENT days, same hour bucket (hour 9): each contributes 30 min
      mockRepo.getRoomUsagesRaw.mockResolvedValue([
        {
          actualStartTime: new Date('2026-06-01T09:00:00+07:00'),
          actualEndTime: new Date('2026-06-01T09:30:00+07:00'),
          firstPresenceAt: null,
          lastPresenceAt: null,
        },
        {
          actualStartTime: new Date('2026-06-02T09:00:00+07:00'),
          actualEndTime: new Date('2026-06-02T09:30:00+07:00'),
          firstPresenceAt: null,
          lastPresenceAt: null,
        },
      ]);

      const result = await service.getRoomDetail(
        { userId: mockUserId },
        mockRoomId,
        {
          preset: 'custom',
          from: '2026-06-01',
          to: '2026-06-05',
        },
      );

      // Both sessions contribute to hour 9 -> cumulative 60 minutes
      expect(result.data.heatmap[9].actualMinutes).toBe(60);
      // Other hours should remain 0
      expect(result.data.heatmap[10].actualMinutes).toBe(0);
    });
  });

  // B3: Summary occupancy rate uses only booked hours of rooms with actual data as denominator
  describe('buildComparisonResponse – B3 summary occupancy rate', () => {
    it('B3 – summary.roomOccupancyRate uses only booked hours of rooms with hasActualData=true', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockConfigService.getOperatingHoursPerDay.mockResolvedValue(8);

      const roomWithActualId = '00000000-0000-0000-0000-000000000010';
      const roomNoActualId = '00000000-0000-0000-0000-000000000011';

      // Room 1: 2 hours booked, 1 hour actual (occupancy = 50%)
      // Room 2: 10 hours booked, NO actual data
      // Wrong: occupancy = 1h / (2h + 10h) * 100 = 8.3%
      // Correct: occupancy = 1h / 2h * 100 = 50% (only denominator from rooms with actual data)
      const bookedMap = new Map<string, number>();
      bookedMap.set(roomWithActualId, 120); // 120 min = 2h
      bookedMap.set(roomNoActualId, 600); // 600 min = 10h

      const actualMap = new Map<
        string,
        { actualMinutes: number; hasActualData: boolean }
      >();
      actualMap.set(roomWithActualId, {
        actualMinutes: 60,
        hasActualData: true,
      }); // 1h actual

      mockRepo.getBookedAggregate.mockResolvedValue(bookedMap);
      mockRepo.getActualAggregate.mockResolvedValue(actualMap);
      mockRepo.listRoomsForComparison.mockResolvedValue([
        { id: roomWithActualId, roomName: 'Room With Data' },
        { id: roomNoActualId, roomName: 'Room No Data' },
      ]);
      mockRepo.getRoomTrend.mockResolvedValue([]);

      const result = await service.getComparisonDashboard(
        { userId: mockUserId },
        { preset: 'custom', from: '2026-06-01', to: '2026-06-05' },
      );

      // Summary occupancy: 1h actual / 2h booked (of rooms with actual) * 100 = 50%
      expect(result.data.summary.roomOccupancyRate).toBe(50.0);
      // Total booked includes all rooms
      expect(result.data.summary.totalBookedHours).toBe(12.0); // 2 + 10
    });
  });
});
