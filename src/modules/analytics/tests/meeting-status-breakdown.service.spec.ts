import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MeetingStatusBreakdownService } from '../services/meeting-status-breakdown.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MeetingStatusBreakdownRepository } from '../repositories/meeting-status-breakdown.repository';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryMeetingStatusBreakdownDto } from '../dto/query-meeting-status-breakdown.dto';

describe('MeetingStatusBreakdownService', () => {
  let service: MeetingStatusBreakdownService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<MeetingStatusBreakdownRepository>;
  let mockConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerDepartmentIds: jest.fn(),
      getStatusCounts: jest.fn(),
    } as unknown as jest.Mocked<MeetingStatusBreakdownRepository>;

    mockConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeetingStatusBreakdownService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: MeetingStatusBreakdownRepository, useValue: mockRepo },
        { provide: DashboardOverviewConfigService, useValue: mockConfigService },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<MeetingStatusBreakdownService>(MeetingStatusBreakdownService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveDateRange', () => {
    it('defaults to month preset boundaries', () => {
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

    it('preset=custom valid range', () => {
      const result = service.resolveDateRange('custom', '2026-06-01', '2026-06-15');
      expect(result).toEqual({ from: '2026-06-01', to: '2026-06-15' });
    });

    it('preset=custom invalid range (from > to) -> BadRequestException', () => {
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

      await expect(service.resolveScope(mockUserId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateDepartmentOwnership', () => {
    it('admin -> passes', () => {
      const scope = { isAdmin: true, scopeDepartmentIds: null };
      expect(() => service.validateDepartmentOwnership(scope, ['any-dept'])).not.toThrow();
    });

    it('MANAGER, departmentId in scope -> passes', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() => service.validateDepartmentOwnership(scope, ['d1'])).not.toThrow();
    });

    it('MANAGER, departmentId out of scope -> ForbiddenException', () => {
      const scope = { isAdmin: false, scopeDepartmentIds: ['d1', 'd2'] };
      expect(() => service.validateDepartmentOwnership(scope, ['d1', 'd3'])).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getStatusBreakdown', () => {
    it('throws validation error (400) before permission check (403) if date range is invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryMeetingStatusBreakdownDto = {
        preset: 'custom',
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(service.getStatusBreakdown({ userId: mockUserId }, query)).rejects.toThrow(BadRequestException);
    });

    it('empty state', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getStatusCounts.mockResolvedValue(new Map());

      const query: QueryMeetingStatusBreakdownDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getStatusBreakdown({ userId: mockUserId }, query);

      expect(result.message).toBe('Không có dữ liệu cuộc họp nào thỏa mãn bộ lọc hiện tại');
      expect(result.data.total).toBe(0);
      expect(result.data.items.length).toBe(4);
      expect(result.data.items[0]).toEqual({ status: 'scheduled', count: 0, percentage: 0 });
    });

    it('happy path with data and rounding', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.meeting.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);

      const countMap = new Map();
      countMap.set('scheduled', 5);
      countMap.set('completed', 3);
      countMap.set('cancelled', 2);
      countMap.set('no_show', 1);
      mockRepo.getStatusCounts.mockResolvedValue(countMap);

      const query: QueryMeetingStatusBreakdownDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getStatusBreakdown({ userId: mockUserId }, query);

      expect(result.message).toBe('Thống kê cuộc họp theo trạng thái được truy xuất thành công');
      expect(result.data.total).toBe(11);
      expect(result.data.items[0]).toEqual({ status: 'scheduled', count: 5, percentage: 45.5 });
      expect(result.data.items[1]).toEqual({ status: 'completed', count: 3, percentage: 27.3 });
      expect(result.data.items[2]).toEqual({ status: 'cancelled', count: 2, percentage: 18.2 });
      expect(result.data.items[3]).toEqual({ status: 'no_show', count: 1, percentage: 9.1 });
      expect(mockAuditLogsService.logAction).toHaveBeenCalled();
    });
  });
});
