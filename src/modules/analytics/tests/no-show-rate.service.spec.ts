import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { NoShowRateService } from '../services/no-show-rate.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { NoShowRateRepository } from '../repositories/no-show-rate.repository';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryNoShowRateDto } from '../dto/query-no-show-rate.dto';

describe('NoShowRateService', () => {
  let service: NoShowRateService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<NoShowRateRepository>;
  let mockConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerDepartmentIds: jest.fn(),
      getManagerRoomIds: jest.fn(),
      findUserIdByEmail: jest.fn(),
      getKpiAggregate: jest.fn(),
      getRoomRanking: jest.fn(),
      getDepartmentRanking: jest.fn(),
      getOrganizerRanking: jest.fn(),
    } as unknown as jest.Mocked<NoShowRateRepository>;

    mockConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoShowRateService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: NoShowRateRepository, useValue: mockRepo },
        { provide: DashboardOverviewConfigService, useValue: mockConfigService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<NoShowRateService>(NoShowRateService);
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

    it('preset=quarter', () => {
      const result = service.resolveDateRange('quarter');
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
    });

    it('preset=custom valid', () => {
      const result = service.resolveDateRange('custom', '2026-06-01', '2026-06-15');
      expect(result).toEqual({ from: '2026-06-01', to: '2026-06-15' });
    });

    it('preset=custom invalid (from > to) -> BadRequestException', () => {
      expect(() => service.resolveDateRange('custom', '2026-06-15', '2026-06-01')).toThrow(
        BadRequestException,
      );
    });

    it('preset=custom missing date -> BadRequestException', () => {
      expect(() => service.resolveDateRange('custom', undefined, '2026-06-01')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateMaxRange', () => {
    it('passes if range <= maxDays', async () => {
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-06-30'),
      ).resolves.toBeUndefined();
    });

    it('throws if range > maxDays', async () => {
      mockConfigService.getMaxRangeDays.mockResolvedValue(30);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-07-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveScope', () => {
    it('SYSTEM_ADMIN -> scopeDepartmentIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.room.read'],
      });

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({ isAdmin: true, scopeDepartmentIds: null, viewerRole: 'SYSTEM_ADMIN' });
    });

    it('MANAGER -> queries departments', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.room.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1']);

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: false,
        scopeDepartmentIds: ['dept-1'],
        viewerRole: 'MANAGER',
      });
    });
  });

  describe('validateDepartmentOwnership', () => {
    it('MANAGER, departmentId out of scope -> ForbiddenException', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1'] };
      expect(() => service.validateDepartmentOwnership(scope, ['d2'])).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('validateRoomOwnership', () => {
    it('MANAGER, roomId out of scope -> ForbiddenException', () => {
      expect(() => service.validateRoomOwnership(['r1'], 'r2')).toThrow(ForbiddenException);
    });
  });

  describe('getNoShowRate', () => {
    it('throws validation error (400) before permission check (403) if date range is invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryNoShowRateDto = {
        preset: 'custom',
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(service.getNoShowRate({ userId: mockUserId }, query)).rejects.toThrow(BadRequestException);
    });

    it('empty state (no-show count = 0)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getKpiAggregate.mockResolvedValue({ totalBookings: 10, noShowCount: 0 });

      const query: QueryNoShowRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getNoShowRate({ userId: mockUserId }, query);

      expect(result.message).toBe(
        'Tuyệt vời! Không ghi nhận trường hợp lãng phí phòng họp nào trong khoảng thời gian này.',
      );
      expect(result.data.noShowCount).toBe(0);
      expect(result.data.totalBookings).toBe(10);
      expect(result.data.noShowRate).toBe(0);
      expect(result.data.ranking.items).toEqual([]);
    });

    it('organizerEmail doesn not match any user -> empty response', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.findUserIdByEmail.mockResolvedValue(null);

      const query: QueryNoShowRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
        organizerEmail: 'wrong@comp.com',
      };

      const result = await service.getNoShowRate({ userId: mockUserId }, query);

      expect(result.data.totalBookings).toBe(0);
      expect(mockRepo.getKpiAggregate).not.toHaveBeenCalled();
    });

    it('happy path with data', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.room.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getKpiAggregate.mockResolvedValue({ totalBookings: 20, noShowCount: 5 });
      mockRepo.getRoomRanking.mockResolvedValue([
        { id: 'r1', name: 'Room 1', totalBookings: 5, noShowCount: 3, fullCount: 1 },
      ]);

      const query: QueryNoShowRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
        rankBy: 'room',
        page: 1,
        limit: 10,
      };

      const result = await service.getNoShowRate({ userId: mockUserId }, query);

      expect(result.message).toBe('Thống kê tỷ lệ no-show được truy xuất thành công');
      expect(result.data.noShowCount).toBe(5);
      expect(result.data.totalBookings).toBe(20);
      expect(result.data.noShowRate).toBe(25.0);
      expect(result.data.ranking.items.length).toBe(1);
      expect(result.data.ranking.items[0]).toEqual({
        id: 'r1',
        name: 'Room 1',
        email: undefined,
        totalBookings: 5,
        noShowCount: 3,
        noShowRate: 60.0,
        lowSampleSize: false,
      });
      expect(mockAuditLogsService.logAction).toHaveBeenCalled();
    });
  });
});
