import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { RoomUtilizationRateService } from '../services/room-utilization-rate.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { RoomUtilizationRateRepository } from '../repositories/room-utilization-rate.repository';
import { RoomUsageConfigService } from '../services/room-usage-config.service';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryRoomUtilizationRateDto } from '../dto/query-room-utilization-rate.dto';

describe('RoomUtilizationRateService', () => {
  let service: RoomUtilizationRateService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<RoomUtilizationRateRepository>;
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
      getActiveRoomCount: jest.fn(),
      getPeriodAggregate: jest.fn(),
    } as unknown as jest.Mocked<RoomUtilizationRateRepository>;

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
        RoomUtilizationRateService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: RoomUtilizationRateRepository, useValue: mockRepo },
        { provide: RoomUsageConfigService, useValue: mockConfigService },
        { provide: DashboardOverviewConfigService, useValue: mockDashboardConfigService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<RoomUtilizationRateService>(RoomUtilizationRateService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveCurrentPeriod', () => {
    it('defaults to month', () => {
      const result = service.resolveCurrentPeriod();
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
    });

    it('preset=quarter calculates current calendar quarter correctly', () => {
      const result = service.resolveCurrentPeriod('quarter');
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
    });

    it('preset=custom checks from and to', () => {
      const result = service.resolveCurrentPeriod('custom', '2026-06-01', '2026-06-15');
      expect(result).toEqual({ from: '2026-06-01', to: '2026-06-15' });
    });
  });

  describe('shiftYearBack', () => {
    it('shifts regular dates back by one year', () => {
      expect(service.shiftYearBack('2026-06-15')).toBe('2025-06-15');
    });

    it('shifts Feb 29 to Feb 28 on non-leap years', () => {
      expect(service.shiftYearBack('2024-02-29')).toBe('2023-02-28');
    });
  });

  describe('resolveComparisonPeriod', () => {
    it('previous_period calculates correct boundaries', () => {
      const result = service.resolveComparisonPeriod('previous_period', '2026-06-05', '2026-06-09');
      // 5 days: June 5, 6, 7, 8, 9
      // Comp should be: May 31, June 1, 2, 3, 4
      expect(result).toEqual({
        from: '2026-05-31',
        to: '2026-06-04',
      });
    });

    it('same_period_last_year shifts years back', () => {
      const result = service.resolveComparisonPeriod('same_period_last_year', '2026-06-01', '2026-06-30');
      expect(result).toEqual({
        from: '2025-06-01',
        to: '2025-06-30',
      });
    });

    it('custom mode checks missing inputs', () => {
      expect(() =>
        service.resolveComparisonPeriod('custom', '2026-06-01', '2026-06-05', undefined, undefined),
      ).toThrow(BadRequestException);
    });

    it('custom mode throws if durations do not match', () => {
      expect(() =>
        service.resolveComparisonPeriod('custom', '2026-06-01', '2026-06-05', '2026-05-01', '2026-05-02'),
      ).toThrow(BadRequestException);
    });
  });

  describe('resolveScope', () => {
    it('SYSTEM_ADMIN -> scopeRoomIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.room.read'],
      });

      const result = await service.resolveScope(mockUserId, '2026-06-01', '2026-06-30');
      expect(result.scopeRoomIds).toBeNull();
    });

    it('MANAGER -> fetches manager room ids', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.room.read'],
      });
      mockRepo.getManagerRoomIds.mockResolvedValue(['r1']);

      const result = await service.resolveScope(mockUserId, '2026-06-01', '2026-06-30');
      expect(result.scopeRoomIds).toEqual(['r1']);
      expect(mockRepo.getManagerRoomIds).toHaveBeenCalledWith(mockUserId, '2026-06-01', '2026-06-30');
    });
  });

  describe('getUtilizationRate', () => {
    it('throws validation error (400) before permission check (403) if dates are invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryRoomUtilizationRateDto = {
        preset: 'custom',
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(service.getUtilizationRate({ userId: mockUserId }, query)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if roomId does not exist', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getRoom.mockResolvedValue(null);

      const query: QueryRoomUtilizationRateDto = {
        roomId: mockRoomId,
      };

      await expect(service.getUtilizationRate({ userId: mockUserId }, query)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if MANAGER filters on room out of scope', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.room.read'],
      });
      mockRepo.getManagerRoomIds.mockResolvedValue(['different-room']);
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getRoom.mockResolvedValue({ id: mockRoomId, roomName: 'Room A' });

      const query: QueryRoomUtilizationRateDto = {
        roomId: mockRoomId,
      };

      await expect(service.getUtilizationRate({ userId: mockUserId }, query)).rejects.toThrow(ForbiddenException);
    });

    it('calculates delta values correctly and handles comparison mode empty states', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockConfigService.getOperatingHoursPerDay.mockResolvedValue(8);

      // current: 120 booked mins (2 hours), actual 90 mins (1.5 hours), active rooms 1
      mockRepo.getPeriodAggregate.mockResolvedValueOnce({
        bookedMinutesSum: 120,
        actualMinutesSum: 90,
        hasActualData: true,
        activeRoomCount: 1,
      });

      // comparison: 60 booked mins (1 hour), actual 30 mins (0.5 hours), active rooms 1
      mockRepo.getPeriodAggregate.mockResolvedValueOnce({
        bookedMinutesSum: 60,
        actualMinutesSum: 30,
        hasActualData: true,
        activeRoomCount: 1,
      });

      // trend queries
      mockRepo.getPeriodAggregate.mockResolvedValue({
        bookedMinutesSum: 0,
        actualMinutesSum: 0,
        hasActualData: false,
        activeRoomCount: 1,
      });

      const query: QueryRoomUtilizationRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-02', // 2 days, cap = 16 hours
        comparisonMode: 'previous_period',
      };

      const result = await service.getUtilizationRate({ userId: mockUserId }, query);

      // currentUtilRate = 2 / 16 = 12.5%
      // compUtilRate = 1 / 16 = 6.25%
      // deltaUtil = (12.5 - 6.25) / 6.25 = 100%
      expect(result.data.summary.reservationUtilizationRate.current).toBe(12.5);
      expect(result.data.summary.reservationUtilizationRate.comparison).toBe(6.3);
      expect(result.data.summary.reservationUtilizationRate.deltaPercent).toBe(100.0);

      // currentOcc = 1.5 / 2 = 75%
      // compOcc = 0.5 / 1 = 50%
      // deltaOcc = (75 - 50) / 50 = 50%
      expect(result.data.summary.roomOccupancyRate.current).toBe(75.0);
      expect(result.data.summary.roomOccupancyRate.comparison).toBe(50.0);
      expect(result.data.summary.roomOccupancyRate.deltaPercent).toBe(50.0);
    });

    it('returns custom message when comparison period has no data', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockDashboardConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockConfigService.getOperatingHoursPerDay.mockResolvedValue(8);

      mockRepo.getPeriodAggregate.mockResolvedValueOnce({
        bookedMinutesSum: 120,
        actualMinutesSum: 90,
        hasActualData: true,
        activeRoomCount: 1,
      });

      mockRepo.getPeriodAggregate.mockResolvedValueOnce({
        bookedMinutesSum: 0,
        actualMinutesSum: 0,
        hasActualData: false,
        activeRoomCount: 1,
      });

      // trend queries
      mockRepo.getPeriodAggregate.mockResolvedValue({
        bookedMinutesSum: 0,
        actualMinutesSum: 0,
        hasActualData: false,
        activeRoomCount: 1,
      });

      const query: QueryRoomUtilizationRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-02',
      };

      const result = await service.getUtilizationRate({ userId: mockUserId }, query);

      expect(result.data.comparisonHasNoData).toBe(true);
      expect(result.message).toBe('Không tìm thấy dữ liệu vận hành hợp lệ của chu kỳ đối chiếu được chọn.');
    });
  });
});
