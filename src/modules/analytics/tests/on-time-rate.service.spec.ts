import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { OnTimeRateService } from '../services/on-time-rate.service';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { OnTimeRateRepository } from '../repositories/on-time-rate.repository';
import { DashboardOverviewConfigService } from '../services/dashboard-overview-config.service';
import { QueryOnTimeRateDto } from '../dto/query-on-time-rate.dto';
import { QueryLateHistoryDto } from '../dto/query-late-history.dto';

describe('OnTimeRateService', () => {
  let service: OnTimeRateService;
  let mockAuthzRepo: jest.Mocked<AuthzReadRepository>;
  let mockRepo: jest.Mocked<OnTimeRateRepository>;
  let mockConfigService: jest.Mocked<DashboardOverviewConfigService>;
  let mockAuditLogsService: jest.Mocked<AuditLogsService>;

  const mockUserId = '00000000-0000-0000-0000-000000000001';
  const mockTargetId = '00000000-0000-0000-0000-000000000002';

  beforeEach(async () => {
    mockAuthzRepo = {
      getEffectiveRolesAndPermissions: jest.fn(),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    mockRepo = {
      getManagerDepartmentIds: jest.fn(),
      getUserDetails: jest.fn(),
      getKpiTotals: jest.fn(),
      getTrendByWeek: jest.fn(),
      getLateByHourOfDay: jest.fn(),
      getLateByDepartment: jest.fn(),
      getLateHistory: jest.fn(),
      checkDepartmentExists: jest.fn(),
      getLateByUsers: jest.fn(),
      getUserProfileForStats: jest.fn(),
      getPersonalKpiTotals: jest.fn(),
      getPersonalTrendByWeek: jest.fn(),
    } as unknown as jest.Mocked<OnTimeRateRepository>;

    mockConfigService = {
      getMaxRangeDays: jest.fn(),
    } as unknown as jest.Mocked<DashboardOverviewConfigService>;

    mockAuditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditLogsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnTimeRateService,
        { provide: AuthzReadRepository, useValue: mockAuthzRepo },
        { provide: OnTimeRateRepository, useValue: mockRepo },
        {
          provide: DashboardOverviewConfigService,
          useValue: mockConfigService,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
      ],
    }).compile();

    service = module.get<OnTimeRateService>(OnTimeRateService);
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
        permissions: ['analytics.attendance.read'],
      });

      const result = await service.resolveScope(mockUserId);
      expect(result).toEqual({
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'SYSTEM_ADMIN',
      });
    });

    it('MANAGER -> queries departments', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.attendance.read'],
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
      expect(() => service.validateDepartmentOwnership(scope, 'd2')).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getOnTimeRate', () => {
    it('throws validation error (400) before permission check (403) if date range is invalid', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });

      const query: QueryOnTimeRateDto = {
        preset: 'custom',
        from: '2026-07-01',
        to: '2026-06-01',
      };

      await expect(
        service.getOnTimeRate({ userId: mockUserId }, query),
      ).rejects.toThrow(BadRequestException);
    });

    it('empty state (totalRequiredParticipants = 0)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.attendance.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateByHourOfDay.mockResolvedValue(new Map());
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      const query: QueryOnTimeRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getOnTimeRate({ userId: mockUserId }, query);

      expect(result.message).toBe(
        'Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn.',
      );
      expect(result.data.onTimeCount).toBe(0);
      expect(result.data.totalRequiredParticipants).toBe(0);
      expect(result.data.onTimeRate).toBe(0);
      expect(result.data.trend.length).toBeGreaterThan(0);
      expect(result.data.lateByHourOfDay.length).toBe(24);
    });

    it('happy path with rounding including absentCount in rate formula', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.attendance.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getKpiTotals.mockResolvedValue({
        onTimeCount: 385,
        lateCount: 50,
        absentCount: 32,
        totalRequiredParticipants: 467,
      });

      const trendMap = new Map();
      trendMap.set('2026-06-01', {
        onTimeCount: 385,
        lateCount: 50,
        absentCount: 32,
        totalRequiredParticipants: 467,
      });

      const hourMap = new Map();
      hourMap.set(9, { lateCount: 5, totalRequiredParticipants: 100 });

      mockRepo.getTrendByWeek.mockResolvedValue(trendMap);
      mockRepo.getLateByHourOfDay.mockResolvedValue(hourMap);
      mockRepo.getLateByDepartment.mockResolvedValue([
        {
          departmentId: 'd1',
          departmentName: 'Dept 1',
          lateCount: 10,
          onTimeCount: 35,
          totalRequiredParticipants: 50,
        },
      ]);

      const query: QueryOnTimeRateDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-05',
      };

      const result = await service.getOnTimeRate({ userId: mockUserId }, query);

      expect(result.message).toBe(
        'Thống kê tỷ lệ tham dự đúng giờ được truy xuất thành công',
      );
      expect(result.data.totalRequiredParticipants).toBe(467);
      expect(result.data.onTimeRate).toBe(82.4); // 385 / 467 * 100 = 82.44
      expect(result.data.trend[0].onTimeRate).toBe(82.4);
      expect(result.data.lateByHourOfDay[9].lateRate).toBe(5.0);
      expect(result.data.lateByDepartment[0].lateRate).toBe(20.0);
      // [FIX 2026-08-13] onTimeRate per dept tính qua onTimeCount thật, không suy từ 100-lateRate.
      expect(result.data.lateByDepartment[0].onTimeRate).toBe(70.0); // 35/50*100
    });
  });

  describe('getLateHistory', () => {
    it('throws NotFoundException if target user does not exist', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.attendance.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getUserDetails.mockResolvedValue(null);

      const query: QueryLateHistoryDto = {};

      await expect(
        service.getLateHistory({ userId: mockUserId }, mockTargetId, query),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException if MANAGER targets a user outside their scope', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.attendance.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['d1']);
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getUserDetails.mockResolvedValue({
        id: mockTargetId,
        fullName: 'Target User',
        email: 'target@co.com',
        departmentId: 'd2', // outside MANAGER scope
      });

      const query: QueryLateHistoryDto = {};

      await expect(
        service.getLateHistory({ userId: mockUserId }, mockTargetId, query),
      ).rejects.toThrow(ForbiddenException);
    });

    it('happy path for user late history', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: ['analytics.attendance.read'],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getUserDetails.mockResolvedValue({
        id: mockTargetId,
        fullName: 'Target User',
        email: 'target@co.com',
        departmentId: 'd1',
      });
      mockRepo.getLateHistory.mockResolvedValue([
        {
          meetingId: 'm1',
          meetingTitle: 'Meeting 1',
          scheduledStartTime: new Date('2026-06-01T09:00:00Z'),
          checkInTime: new Date('2026-06-01T09:10:00Z'),
          lateMinutes: 10,
        },
      ]);

      const query: QueryLateHistoryDto = {
        preset: 'custom',
        from: '2026-06-01',
        to: '2026-06-30',
        graceMinutes: 5,
      };

      const result = await service.getLateHistory(
        { userId: mockUserId },
        mockTargetId,
        query,
      );

      expect(result.message).toBe(
        'Lịch sử đi muộn của nhân sự được truy xuất thành công',
      );
      expect(result.data.user.fullName).toBe('Target User');
      expect(result.data.lateMeetings.length).toBe(1);
      expect(result.data.lateMeetings[0].meetingTitle).toBe('Meeting 1');
      expect(result.data.lateMeetings[0].lateMinutes).toBe(10);
    });
  });

  describe('getOnTimeRateByUsers', () => {
    it('happy path for MANAGER viewing users in scope', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.attendance.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1']);
      mockRepo.checkDepartmentExists.mockResolvedValue(true);
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
      mockRepo.getLateByUsers.mockResolvedValue({
        items: [
          {
            userId: 'u1',
            fullName: 'Nguyen Van A',
            email: 'a@co.com',
            avatarUrl: null,
            employeeCode: 'EMP001',
            departmentId: 'dept-1',
            departmentName: 'Phong IT',
            lateCount: 2,
            onTimeCount: 8,
            absentCount: 0,
            totalRequired: 10,
            lateRate: 20.0,
          },
        ],
        total: 1,
      });

      const query = {
        preset: 'month',
        departmentId: 'dept-1',
        page: 1,
        limit: 10,
      };

      const result = await service.getOnTimeRateByUsers(
        { userId: mockUserId },
        query,
      );

      expect(result.message).toBe(
        'Thống kê tỷ lệ tham dự đúng giờ theo nhân sự được truy xuất thành công',
      );
      expect(result.data.items).toHaveLength(1);
      expect(result.data.total).toBe(1);
      expect(result.data.totalPages).toBe(1);
      expect(result.data.items[0].fullName).toBe('Nguyen Van A');
    });

    it('throws NotFoundException (404) if departmentId does not exist', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.attendance.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1']);
      mockRepo.checkDepartmentExists.mockResolvedValue(false);
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);

      const query = {
        departmentId: '00000000-0000-0000-0000-000000000099',
      };

      await expect(
        service.getOnTimeRateByUsers({ userId: mockUserId }, query),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException (403) if MANAGER passes departmentId outside scope', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.attendance.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue(['dept-1']);
      mockRepo.checkDepartmentExists.mockResolvedValue(true);
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);

      const query = {
        departmentId: 'dept-2', // outside scope
      };

      await expect(
        service.getOnTimeRateByUsers({ userId: mockUserId }, query),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException (403) if role is EMPLOYEE (no analytics permission)', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['EMPLOYEE'],
        permissions: [],
      });
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);

      await expect(
        service.getOnTimeRateByUsers({ userId: mockUserId }, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('MANAGER with 0 departments returns empty state short-circuit', async () => {
      mockAuthzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['MANAGER'],
        permissions: ['analytics.attendance.read'],
      });
      mockRepo.getManagerDepartmentIds.mockResolvedValue([]); // 0 departments
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);

      const result = await service.getOnTimeRateByUsers(
        { userId: mockUserId },
        {},
      );

      expect(result.data.items).toEqual([]);
      expect(result.data.total).toBe(0);
      expect(result.data.totalPages).toBe(0);
      expect(result.message).toBe(
        'Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn.',
      );
    });
  });

  describe('getPersonalStats (GET /analytics/attendance/on-time-rate/me)', () => {
    const baseProfile = {
      id: mockUserId,
      fullName: 'Nguyen Van A',
      email: 'a@co.com',
      employeeCode: 'EMP001',
      avatarUrl: null,
      departmentId: 'd1',
      departmentName: 'Phong IT',
    };

    beforeEach(() => {
      mockConfigService.getMaxRangeDays.mockResolvedValue(366);
    });

    it('userId luôn lấy từ currentUser (JWT), không nhận từ query — gọi đúng userId cho mọi repo call', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 8,
        lateCount: 2,
        absentCount: 0,
        totalRequiredParticipants: 10,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([
        {
          departmentId: 'd1',
          departmentName: 'Phong IT',
          lateCount: 5,
          onTimeCount: 45,
          totalRequiredParticipants: 60,
        },
      ]);

      const query = { preset: 'month' as const };
      await service.getPersonalStats({ userId: mockUserId }, query);

      expect(mockRepo.getUserProfileForStats).toHaveBeenCalledWith(mockUserId);
      expect(mockRepo.getPersonalKpiTotals).toHaveBeenCalledWith(
        mockUserId,
        expect.any(String),
        expect.any(String),
        5, // graceMinutes mặc định
      );
      expect(mockRepo.getLateHistory).toHaveBeenCalledWith(
        mockUserId,
        expect.any(String),
        expect.any(String),
        5,
      );
    });

    it('graceMinutes mặc định = 5 khi không truyền (hardcode, không đọc config)', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.graceMinutes).toBe(5);
      expect(mockConfigService.getMaxRangeDays).toHaveBeenCalled(); // validateMaxRange vẫn tái dùng
    });

    it('graceMinutes truyền vào query được tôn trọng (không bị ghi đè bởi default)', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        { graceMinutes: 0 },
      );
      expect(result.data.graceMinutes).toBe(0);
    });

    it('throws NotFoundException nếu user (từ JWT) không còn tồn tại', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(null);

      await expect(
        service.getPersonalStats({ userId: mockUserId }, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('totalRequired=0 -> summary.onTimeRate=null và lateRate=null (không phải 0)', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.summary.totalRequired).toBe(0);
      expect(result.data.summary.onTimeRate).toBeNull();
      expect(result.data.summary.lateRate).toBeNull();
    });

    it('totalRequired>0 -> summary.onTimeRate tính đúng (không null)', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 8,
        lateCount: 2,
        absentCount: 0,
        totalRequiredParticipants: 10,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.summary.onTimeRate).toBe(80.0);
      expect(result.data.summary.lateRate).toBe(20.0);
    });

    it('user không có departmentId -> departmentAvg=null, KHÔNG gọi getLateByDepartment', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue({
        ...baseProfile,
        departmentId: null,
        departmentName: null,
      });
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.departmentAvg).toBeNull();
      expect(mockRepo.getLateByDepartment).not.toHaveBeenCalled();
    });

    it('phòng ban chưa có dữ liệu điểm danh (totalRequiredParticipants=0) -> departmentAvg=null', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([]); // không có dòng nào trả về

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.departmentAvg).toBeNull();
    });

    it('departmentAvg.onTimeRate tính qua onTimeCount thật — KHÔNG suy từ 100-lateRate (case có absent)', async () => {
      // Phòng ban: 50 lượt bắt buộc, 30 late, 10 on_time, 10 absent.
      // 100 - lateRate(=60%) = 40% -- SAI vì gộp nhầm 10 absent vào "đúng giờ".
      // Đúng: onTimeRate = 10/50*100 = 20%.
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([
        {
          departmentId: 'd1',
          departmentName: 'Phong IT',
          lateCount: 30,
          onTimeCount: 10,
          totalRequiredParticipants: 50,
        },
      ]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.departmentAvg).toEqual({
        departmentId: 'd1',
        departmentName: 'Phong IT',
        onTimeRate: 20.0,
      });
      // Xác nhận KHÔNG phải kết quả sai của công thức 100-lateRate (40%).
      expect(result.data.departmentAvg?.onTimeRate).not.toBe(40.0);
    });

    it('departmentAvg query lọc đúng departmentId của user (không lộ department khác)', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      await service.getPersonalStats({ userId: mockUserId }, {});

      expect(mockRepo.getLateByDepartment).toHaveBeenCalledWith(
        expect.objectContaining({
          departmentId: 'd1',
          scopeDepartmentIds: null,
        }),
      );
    });

    it('recentLate[] tái dùng nguyên vẹn getLateHistory() đã có', async () => {
      const lateMeetings = [
        {
          meetingId: 'm1',
          meetingTitle: 'Họp giao ban',
          scheduledStartTime: new Date('2026-06-10T08:00:00+07:00'),
          checkInTime: new Date('2026-06-10T08:10:00+07:00'),
          lateMinutes: 10,
        },
      ];
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 1,
        absentCount: 0,
        totalRequiredParticipants: 1,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue(lateMeetings);
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.recentLate).toEqual(lateMeetings);
    });

    it('response giữ đúng contract: userId/fullName/email/employeeCode/departmentName/avatarUrl từ profile', async () => {
      mockRepo.getUserProfileForStats.mockResolvedValue(baseProfile);
      mockRepo.getPersonalKpiTotals.mockResolvedValue({
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      });
      mockRepo.getPersonalTrendByWeek.mockResolvedValue(new Map());
      mockRepo.getLateHistory.mockResolvedValue([]);
      mockRepo.getLateByDepartment.mockResolvedValue([]);

      const result = await service.getPersonalStats(
        { userId: mockUserId },
        {},
      );
      expect(result.data.userId).toBe(mockUserId);
      expect(result.data.fullName).toBe('Nguyen Van A');
      expect(result.data.email).toBe('a@co.com');
      expect(result.data.employeeCode).toBe('EMP001');
      expect(result.data.departmentName).toBe('Phong IT');
      expect(result.data.avatarUrl).toBeNull();
    });
  });
});
