import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MeetingCountByPeriodService } from '../services/meeting-count-by-period.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MeetingCountByPeriodRepository } from '../repositories/meeting-count-by-period.repository';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryMeetingCountByPeriodDto } from '../dto/query-meeting-count-by-period.dto';

describe('MeetingCountByPeriodService', () => {
  let service: MeetingCountByPeriodService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<MeetingCountByPeriodRepository>;
  let mockConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerDepartmentIds: jest.fn(),
      countMeetingsByBucket: jest.fn(),
    } as unknown as jest.Mocked<MeetingCountByPeriodRepository>;

    mockConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingCountByPeriodService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: MeetingCountByPeriodRepository, useValue: mockRepo },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<MeetingCountByPeriodService>(
      MeetingCountByPeriodService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveDateRange', () => {
    it('defaults to current month boundaries', () => {
      const result = service.resolveDateRange();
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
      expect(new Date(result.from).getUTCDate()).toBe(1);
    });

    it('custom valid range', () => {
      const result = service.resolveDateRange('2026-06-01', '2026-06-15');
      expect(result).toEqual({ from: '2026-06-01', to: '2026-06-15' });
    });

    it('custom invalid range (from > to) -> BadRequestException', () => {
      expect(() =>
        service.resolveDateRange('2026-06-15', '2026-06-01'),
      ).toThrow(BadRequestException);
    });

    it('custom missing one date -> BadRequestException', () => {
      expect(() => service.resolveDateRange(undefined, '2026-06-01')).toThrow(
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
    it('SYSTEM_ADMIN -> isAdmin=true, scopeDepartmentIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'SYSTEM_ADMIN',
      });
    });

    it('BUSINESS_ADMIN -> isAdmin=true, scopeDepartmentIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'BUSINESS_ADMIN',
      });
    });

    it('MANAGER -> queries departments', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.meeting.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1']);

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: false,
        scopeDepartmentIds: ['dept-1'],
        viewerRole: 'MANAGER',
      });
      expect(mockRepo.getManagerDepartmentIds).toHaveBeenCalledWith(mockUserId);
    });

    it('no valid role -> ForbiddenException', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: ['analytics.meeting.read'],
      });

      await expect(service.resolveScope(mockUserId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('validateDepartmentOwnership', () => {
    it('admin -> passes', () => {
      const scope = { isAdmin: true, scopeDepartmentIds: null };
      expect(() =>
        service.validateDepartmentOwnership(scope, 'any-dept'),
      ).not.toThrow();
    });

    it('MANAGER, departmentId in scope -> passes', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, 'd1'),
      ).not.toThrow();
    });

    it('MANAGER, departmentId out of scope -> ForbiddenException', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() => service.validateDepartmentOwnership(scope, 'd3')).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('generateBuckets', () => {
    it('granularity=month', () => {
      const result = service.generateBuckets(
        '2026-05-15',
        '2026-07-10',
        'month',
      );
      expect(result).toEqual(['2026-05', '2026-06', '2026-07']);
    });

    it('granularity=week', () => {
      const result = service.generateBuckets(
        '2026-05-01',
        '2026-05-10',
        'week',
      );
      expect(result).toEqual(['2026-W18', '2026-W19']);
    });
  });

  describe('getCountByPeriod', () => {
    it('throws validation error (400) before permission check (403) if date range is invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryMeetingCountByPeriodDto = {
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(
        service.getCountByPeriod({ userId: mockUserId }, query),
      ).rejects.toThrow(BadRequestException);
    });

    it('empty state', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.countMeetingsByBucket.mockResolvedValue(new Map());

      const query: QueryMeetingCountByPeriodDto = {
        from: '2026-06-01',
        to: '2026-06-05',
        granularity: 'week',
      };

      const result = await service.getCountByPeriod(
        { userId: mockUserId },
        query,
      );

      expect(result.message).toBe(
        'Không tìm thấy dữ liệu cuộc họp nào thỏa mãn các tiêu chí lọc hiện tại',
      );
      expect(result.data.total).toBe(0);
      expect(result.data.series.length).toBe(1);
      expect(result.data.series[0]).toEqual({ period: '2026-W23', count: 0 });
    });

    it('happy path with data', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);

      const countMap = new Map();
      countMap.set('2026-06', 5);
      mockRepo.countMeetingsByBucket.mockResolvedValue(countMap);

      const query: QueryMeetingCountByPeriodDto = {
        from: '2026-06-01',
        to: '2026-06-01',
        granularity: 'month',
      };

      const result = await service.getCountByPeriod(
        { userId: mockUserId },
        query,
      );

      expect(result.message).toBe(
        'Thống kê số lượng cuộc họp được truy xuất thành công',
      );
      expect(result.data.total).toBe(5);
      expect(result.data.series[0]).toEqual({ period: '2026-06', count: 5 });
      expect(mockAuditLogsService.logAction).toHaveBeenCalled();
    });
  });
});
