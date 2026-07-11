import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MeetingAverageDurationService } from '../services/meeting-average-duration.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MeetingAverageDurationRepository } from '../repositories/meeting-average-duration.repository';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryMeetingAverageDurationDto } from '../dto/query-meeting-average-duration.dto';

describe('MeetingAverageDurationService', () => {
  let service: MeetingAverageDurationService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<MeetingAverageDurationRepository>;
  let mockConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerDepartmentIds: jest.fn(),
      getAverageDurationByBucket: jest.fn(),
      getAverageDurationSummary: jest.fn(),
    } as unknown as jest.Mocked<MeetingAverageDurationRepository>;

    mockConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingAverageDurationService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: MeetingAverageDurationRepository, useValue: mockRepo },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<MeetingAverageDurationService>(
      MeetingAverageDurationService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1', 'dept-2']);

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: false,
        scopeDepartmentIds: ['dept-1', 'dept-2'],
        viewerRole: 'MANAGER',
      });
      expect(mockRepo.getManagerDepartmentIds).toHaveBeenCalledWith(mockUserId);
    });

    it('MANAGER with 0 departments -> empty scope (no error)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.meeting.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue([]);

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: false,
        scopeDepartmentIds: [],
        viewerRole: 'MANAGER',
      });
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

  describe('resolveDateRange', () => {
    it('missing from/to -> default boundaries of current month (GMT+7)', async () => {
      const query: QueryMeetingAverageDurationDto = {};
      const result = await service.resolveDateRange(query);

      const now = new Date();
      const tzOffset = 7 * 60;
      const localTime = new Date(now.getTime() + tzOffset * 60000);
      const year = localTime.getUTCFullYear();
      const month = localTime.getUTCMonth();
      const firstDay = new Date(Date.UTC(year, month, 1))
        .toISOString()
        .split('T')[0];
      const lastDay = new Date(Date.UTC(year, month + 1, 0))
        .toISOString()
        .split('T')[0];

      expect(result.from).toBe(firstDay);
      expect(result.to).toBe(lastDay);
    });

    it('from > to -> BadRequestException', async () => {
      const query: QueryMeetingAverageDurationDto = {
        from: '2026-07-01',
        to: '2026-06-01',
      };
      await expect(service.resolveDateRange(query)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('from = to -> passes', async () => {
      const query: QueryMeetingAverageDurationDto = {
        from: '2026-06-15',
        to: '2026-06-15',
      };
      const result = await service.resolveDateRange(query);
      expect(result.from).toBe('2026-06-15');
      expect(result.to).toBe('2026-06-15');
    });
  });

  describe('validateMaxRange', () => {
    it('range within max -> passes', async () => {
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-06-30'),
      ).resolves.toBeUndefined();
    });

    it('range exceeds max -> BadRequestException', async () => {
      mockConfigService.getMaxRangeDays.mockResolvedValue(30);
      await expect(
        service.validateMaxRange('2026-01-01', '2026-07-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateDepartmentOwnership', () => {
    it('admin -> passes', () => {
      const scope = { isAdmin: true, scopeDepartmentIds: null };
      expect(() =>
        service.validateDepartmentOwnership(scope, ['any-dept']),
      ).not.toThrow();
    });

    it('no departmentIds -> passes', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, undefined),
      ).not.toThrow();
    });

    it('MANAGER, departmentId in scope -> passes', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, ['d1']),
      ).not.toThrow();
    });

    it('MANAGER, departmentId out of scope -> ForbiddenException', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, ['d1', 'd3']),
      ).toThrow(ForbiddenException);
    });
  });

  describe('generateBuckets', () => {
    it('granularity=day', () => {
      const result = service.generateBuckets('2026-06-01', '2026-06-03', 'day');
      expect(result).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    });

    it('granularity=month', () => {
      const result = service.generateBuckets(
        '2026-05-15',
        '2026-07-10',
        'month',
      );
      expect(result).toEqual(['2026-05', '2026-06', '2026-07']);
    });

    it('granularity=quarter', () => {
      const result = service.generateBuckets(
        '2026-05-15',
        '2026-10-10',
        'quarter',
      );
      expect(result).toEqual(['2026-Q2', '2026-Q3', '2026-Q4']);
    });

    it('granularity=week', () => {
      // 2026-05-01 is Friday (week 18).
      // Week 18 Monday is 2026-04-27.
      // 2026-05-10 is Sunday (week 19).
      const result = service.generateBuckets(
        '2026-05-01',
        '2026-05-10',
        'week',
      );
      expect(result).toEqual(['2026-W18', '2026-W19']);
    });
  });

  describe('getAverageDuration', () => {
    it('empty state (no meetings found)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getAverageDurationByBucket.mockResolvedValue(new Map());
      mockRepo.getAverageDurationSummary.mockResolvedValue({
        plannedAvg: null,
        actualAvg: null,
        count: 0,
      });

      const query: QueryMeetingAverageDurationDto = {
        from: '2026-06-01',
        to: '2026-06-15',
        granularity: 'day',
      };

      const result = await service.getAverageDuration(
        { userId: mockUserId },
        query,
      );

      expect(result.message).toBe(
        'Không có dữ liệu thời lượng cuộc họp nào cho bộ lọc hiện tại',
      );
      expect(result.data.summary).toEqual({
        plannedAverageMinutes: null,
        actualAverageMinutes: null,
        completedMeetingCount: 0,
      });
      expect(result.data.series.length).toBe(15);
      expect(result.data.series[0].plannedAverageMinutes).toBeNull();
      expect(result.data.series[0].actualAverageMinutes).toBeNull();
      expect(result.data.series[0].completedMeetingCount).toBe(0);
      expect(mockAuditLogsService.logAction).toHaveBeenCalled();
    });

    it('happy path with data', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);

      const bucketResults = new Map();
      bucketResults.set('2026-06-01', {
        plannedAvg: 60.25,
        actualAvg: 55.44,
        count: 2,
      });
      mockRepo.getAverageDurationByBucket.mockResolvedValue(bucketResults);
      mockRepo.getAverageDurationSummary.mockResolvedValue({
        plannedAvg: 60.25,
        actualAvg: 55.44,
        count: 2,
      });

      const query: QueryMeetingAverageDurationDto = {
        from: '2026-06-01',
        to: '2026-06-01',
        granularity: 'day',
      };

      const result = await service.getAverageDuration(
        { userId: mockUserId },
        query,
      );

      expect(result.message).toBe(
        'Thống kê thời lượng trung bình cuộc họp được truy xuất thành công',
      );
      expect(result.data.summary).toEqual({
        plannedAverageMinutes: 60.3,
        actualAverageMinutes: 55.4,
        completedMeetingCount: 2,
      });
      expect(result.data.series[0]).toEqual({
        period: '2026-06-01',
        plannedAverageMinutes: 60.3,
        actualAverageMinutes: 55.4,
        completedMeetingCount: 2,
      });
    });

    it('throws validation error (400) before permission check (403) if date range is invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryMeetingAverageDurationDto = {
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(
        service.getAverageDuration({ userId: mockUserId }, query),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
