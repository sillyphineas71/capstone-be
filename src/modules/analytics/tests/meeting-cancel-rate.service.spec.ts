import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MeetingCancelRateService } from '../services/meeting-cancel-rate.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MeetingCancelRateRepository } from '../repositories/meeting-cancel-rate.repository';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryMeetingCancelRateDto } from '../dto/query-meeting-cancel-rate.dto';

describe('MeetingCancelRateService', () => {
  let service: MeetingCancelRateService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<MeetingCancelRateRepository>;
  let mockConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerDepartmentIds: jest.fn(),
      findUserIdByEmail: jest.fn(),
      getCancelRateSummary: jest.fn(),
      getCancelRateSeries: jest.fn(),
      getTopOrganizers: jest.fn(),
      getTopDepartments: jest.fn(),
    } as unknown as jest.Mocked<MeetingCancelRateRepository>;

    mockConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingCancelRateService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: MeetingCancelRateRepository, useValue: mockRepo },
        { provide: DashboardOverviewConfigService, useValue: mockConfigService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<MeetingCancelRateService>(MeetingCancelRateService);
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
      expect(result).toEqual({ isAdmin: true, scopeDepartmentIds: null, viewerRole: 'SYSTEM_ADMIN' });
    });

    it('BUSINESS_ADMIN -> isAdmin=true, scopeDepartmentIds=null', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({ isAdmin: true, scopeDepartmentIds: null, viewerRole: 'BUSINESS_ADMIN' });
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

    it('no valid role -> ForbiddenException', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: ['analytics.meeting.read'],
      });

      await expect(service.resolveScope(mockUserId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resolvePresetRange', () => {
    it('defaults to month_current boundaries', () => {
      const result = service.resolvePresetRange();
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
      expect(new Date(result.from).getUTCDate()).toBe(1);
    });

    it('month_previous boundaries', () => {
      const result = service.resolvePresetRange('month_previous');
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
      const prevDate = new Date(result.from);
      expect(prevDate.getUTCDate()).toBe(1);
    });

    it('quarter boundaries', () => {
      const result = service.resolvePresetRange('quarter');
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
    });

    it('custom valid range -> returns unmodified range', () => {
      const result = service.resolvePresetRange('custom', '2026-06-01', '2026-06-15');
      expect(result).toEqual({ from: '2026-06-01', to: '2026-06-15' });
    });

    it('custom invalid range (from > to) -> BadRequestException', () => {
      expect(() =>
        service.resolvePresetRange('custom', '2026-06-15', '2026-06-01'),
      ).toThrow(BadRequestException);
    });

    it('custom missing dates -> BadRequestException', () => {
      expect(() => service.resolvePresetRange('custom', undefined, '2026-06-01')).toThrow(
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

  describe('validateDepartmentOwnership', () => {
    it('admin -> passes', () => {
      const scope = { isAdmin: true, scopeDepartmentIds: null };
      expect(() =>
        service.validateDepartmentOwnership(scope, ['any-dept']),
      ).not.toThrow();
    });

    it('MANAGER, departmentIds in scope -> passes', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, ['d1']),
      ).not.toThrow();
    });

    it('MANAGER, departmentIds out of scope -> ForbiddenException', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() =>
        service.validateDepartmentOwnership(scope, ['d1', 'd3']),
      ).toThrow(ForbiddenException);
    });
  });

  describe('generateBuckets', () => {
    it('granularity=month', () => {
      const result = service.generateBuckets('2026-05-15', '2026-07-10', 'month');
      expect(result).toEqual(['2026-05', '2026-06', '2026-07']);
    });

    it('granularity=week', () => {
      const result = service.generateBuckets('2026-05-01', '2026-05-10', 'week');
      expect(result).toEqual(['2026-W18', '2026-W19']);
    });
  });

  describe('getCancelRate', () => {
    it('throws validation error (400) before permission check (403) if date range is invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryMeetingCancelRateDto = {
        preset: 'custom',
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(service.getCancelRate({ userId: mockUserId }, query)).rejects.toThrow(BadRequestException);
    });

    it('empty state (no meetings found)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getCancelRateSummary.mockResolvedValue({ totalMeetingCount: 0, cancelledCount: 0 });
      mockRepo.getCancelRateSeries.mockResolvedValue(new Map());
      mockRepo.getTopOrganizers.mockResolvedValue([]);
      mockRepo.getTopDepartments.mockResolvedValue([]);

      const query: QueryMeetingCancelRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
        granularity: 'week',
      };

      const result = await service.getCancelRate({ userId: mockUserId }, query);

      expect(result.message).toBe('Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại');
      expect(result.data.totalMeetingCount).toBe(0);
      expect(result.data.cancelledCount).toBe(0);
      expect(result.data.cancelRate).toBe(0);
      expect(result.data.series.length).toBe(1);
      expect(result.data.series[0].totalCount).toBe(0);
      expect(result.data.topOrganizers).toEqual([]);
      expect(result.data.topDepartments).toEqual([]);
    });

    it('organizerEmail doesn not match any user -> empty response', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.findUserIdByEmail.mockResolvedValue(null); // No user found

      const query: QueryMeetingCancelRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
        organizerEmail: 'nonexistent@company.com',
      };

      const result = await service.getCancelRate({ userId: mockUserId }, query);

      expect(result.message).toBe('Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại');
      expect(result.data.totalMeetingCount).toBe(0);
      expect(mockRepo.getCancelRateSummary).not.toHaveBeenCalled();
    });

    it('MANAGER role -> topDepartments is always empty', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.meeting.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1']);
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getCancelRateSummary.mockResolvedValue({ totalMeetingCount: 10, cancelledCount: 2 });
      mockRepo.getCancelRateSeries.mockResolvedValue(new Map());
      mockRepo.getTopOrganizers.mockResolvedValue([]);

      const query: QueryMeetingCancelRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getCancelRate({ userId: mockUserId }, query);

      expect(result.data.topDepartments).toEqual([]);
      expect(mockRepo.getTopDepartments).not.toHaveBeenCalled();
    });

    it('BUSINESS_ADMIN role -> populates topDepartments', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getCancelRateSummary.mockResolvedValue({ totalMeetingCount: 10, cancelledCount: 2 });
      mockRepo.getCancelRateSeries.mockResolvedValue(new Map());
      mockRepo.getTopOrganizers.mockResolvedValue([]);
      mockRepo.getTopDepartments.mockResolvedValue([
        { departmentId: 'dept-1', departmentName: 'Engineering', organizedCount: 5, cancelledCount: 2 },
      ]);

      const query: QueryMeetingCancelRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getCancelRate({ userId: mockUserId }, query);

      expect(result.data.topDepartments.length).toBe(1);
      expect(result.data.topDepartments[0]).toEqual({
        departmentId: 'dept-1',
        departmentName: 'Engineering',
        organizedCount: 5,
        cancelledCount: 2,
        cancelRate: 40.0,
      });
      expect(mockRepo.getTopDepartments).toHaveBeenCalled();
    });
  });
});
