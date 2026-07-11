import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { OnTimeRateRepository } from '../repositories/on-time-rate.repository';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryOnTimeRateDto } from '../dto/query-on-time-rate.dto';
import { QueryLateHistoryDto } from '../dto/query-late-history.dto';
import {
  OnTimeRateResponseDto,
  LateHistoryResponseDto,
  TrendPointDto,
  HourBucketDto,
  DepartmentLateItemDto,
  LateMeetingItemDto,
} from '../dto/on-time-rate-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeDepartmentIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class OnTimeRateService {
  private readonly logger = new Logger(OnTimeRateService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: OnTimeRateRepository,
    private readonly configService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator for On-time Attendance Rate (UC-AA-10 / UC-157)
   */
  async getOnTimeRate(
    currentUser: { userId: string },
    query: QueryOnTimeRateDto,
  ): Promise<{ data: OnTimeRateResponseDto; message: string }> {
    const graceMinutes = query.graceMinutes ?? 0;

    // 1. Resolve date range
    const { from, to } = this.resolveDateRange(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate max range days
    await this.validateMaxRange(from, to);

    // 3. Resolve department scope (filters u.department_id of participant)
    const scope = await this.resolveScope(currentUser.userId);

    // 4. Validate department ownership (single select filter)
    this.validateDepartmentOwnership(scope, query.departmentId);

    // Audit log helper
    const logAction = async (totalParticipants: number) => {
      try {
        await this.auditLogsService.logAction({
          userId: currentUser.userId,
          actionType: 'read_analytics_on_time_rate',
          entityType: 'attendance_records',
          metadataJson: {
            viewerUserId: currentUser.userId,
            viewerRole: scope.viewerRole,
            from,
            to,
            departmentId: query.departmentId,
            meetingId: query.meetingId,
            search: query.search,
            graceMinutes,
            resolvedScopeDepartmentIds: scope.scopeDepartmentIds,
            totalRequiredParticipants: totalParticipants,
          },
        });
      } catch (err) {
        this.logger.warn(
          'Failed to write audit log for on-time rate analytics',
          err instanceof Error ? err.message : undefined,
        );
      }
    };

    // 5. Short-circuit if manager has no departments
    if (
      scope.scopeDepartmentIds !== null &&
      scope.scopeDepartmentIds.length === 0
    ) {
      const data = this.buildEmptyResponse(from, to, graceMinutes);
      await logAction(0);
      return { data, message: data.message! };
    }

    const params = {
      from,
      to,
      scopeDepartmentIds: scope.scopeDepartmentIds,
      departmentId: query.departmentId,
      meetingId: query.meetingId,
      search: query.search,
      graceMinutes,
    };

    // 6. Query KPI Totals
    const kpi = await this.repo.getKpiTotals(params);

    // 7. Query trends and breakdowns
    const trendMap = await this.repo.getTrendByWeek(params);
    const hourMap = await this.repo.getLateByHourOfDay(params);
    const deptRows = await this.repo.getLateByDepartment(params);

    const data = this.buildResponse(
      kpi,
      trendMap,
      hourMap,
      deptRows,
      from,
      to,
      graceMinutes,
    );

    await logAction(kpi.totalRequiredParticipants);

    const message =
      kpi.totalRequiredParticipants === 0
        ? 'Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn.'
        : 'Thống kê tỷ lệ tham dự đúng giờ được truy xuất thành công';

    return { data, message };
  }

  /**
   * Orchestrator for Late History Drill-down (UC-AA-10 / UC-157)
   */
  async getLateHistory(
    currentUser: { userId: string },
    targetUserId: string,
    query: QueryLateHistoryDto,
  ): Promise<{ data: LateHistoryResponseDto; message: string }> {
    const graceMinutes = query.graceMinutes ?? 0;

    // 1. Resolve date range
    const { from, to } = this.resolveDateRange(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate max range days
    await this.validateMaxRange(from, to);

    // 3. Resolve viewer scope
    const scope = await this.resolveScope(currentUser.userId);

    // 4. Validate user drill-down ownership & existence
    const user = await this.repo.getUserDetails(targetUserId);
    if (!user) {
      throw new NotFoundException({
        success: false,
        message: 'User not found',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    if (!scope.isAdmin) {
      if (!scope.scopeDepartmentIds?.includes(user.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'User is outside your scope',
          error: { code: 'USER_OUT_OF_SCOPE', details: {} },
        });
      }
    }

    // 5. Query late meetings history
    const meetings = await this.repo.getLateHistory(
      targetUserId,
      from,
      to,
      graceMinutes,
    );

    // Audit log
    try {
      await this.auditLogsService.logAction({
        userId: currentUser.userId,
        actionType: 'read_analytics_on_time_rate_late_history',
        entityType: 'attendance_records',
        metadataJson: {
          viewerUserId: currentUser.userId,
          viewerRole: scope.viewerRole,
          targetUserId,
          from,
          to,
          graceMinutes,
          lateMeetingCount: meetings.length,
        },
      });
    } catch (err) {
      this.logger.warn(
        'Failed to write audit log for late history analytics',
        err instanceof Error ? err.message : undefined,
      );
    }

    const data: LateHistoryResponseDto = {
      user: {
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
      },
      period: { from, to },
      lateMeetings: meetings,
    };

    return {
      data,
      message: 'Lịch sử đi muộn của nhân sự được truy xuất thành công',
    };
  }

  /**
   * Resolve user scope based on roles.
   */
  async resolveScope(userId: string): Promise<ScopeResult> {
    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(userId);

    if (roles.includes('SYSTEM_ADMIN')) {
      return {
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'SYSTEM_ADMIN',
      };
    }
    if (roles.includes('BUSINESS_ADMIN')) {
      return {
        isAdmin: true,
        scopeDepartmentIds: null,
        viewerRole: 'BUSINESS_ADMIN',
      };
    }
    if (roles.includes('MANAGER')) {
      const scopeDepartmentIds =
        await this.repo.getManagerDepartmentIds(userId);
      return { isAdmin: false, scopeDepartmentIds, viewerRole: 'MANAGER' };
    }

    throw new ForbiddenException({
      success: false,
      message: 'You do not have permission to view attendance analytics',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve date range boundaries based on preset.
   */
  resolveDateRange(
    preset?: string,
    from?: string,
    to?: string,
  ): { from: string; to: string } {
    const tzOffset = 7 * 60; // UTC+7
    const now = new Date();
    const localTime = new Date(now.getTime() + tzOffset * 60000);
    const currentYear = localTime.getUTCFullYear();
    const currentMonth = localTime.getUTCMonth(); // 0-indexed
    const currentDay = localTime.getUTCDate();

    const activePreset = preset || 'month';

    if (activePreset === 'day') {
      const todayStr = localTime.toISOString().split('T')[0];
      return { from: todayStr, to: todayStr };
    }

    if (activePreset === 'week') {
      const dayOfWeek = (localTime.getUTCDay() + 6) % 7; // Monday = 0
      const startOfWeek = new Date(
        Date.UTC(currentYear, currentMonth, currentDay - dayOfWeek),
      );
      const endOfWeek = new Date(
        Date.UTC(currentYear, currentMonth, currentDay - dayOfWeek + 6),
      );
      return {
        from: startOfWeek.toISOString().split('T')[0],
        to: endOfWeek.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'month') {
      const firstDay = new Date(Date.UTC(currentYear, currentMonth, 1));
      const lastDay = new Date(Date.UTC(currentYear, currentMonth + 1, 0));
      return {
        from: firstDay.toISOString().split('T')[0],
        to: lastDay.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'quarter') {
      const quarterStartMonth = Math.floor(currentMonth / 3) * 3;
      const firstDay = new Date(Date.UTC(currentYear, quarterStartMonth, 1));
      const lastDay = new Date(Date.UTC(currentYear, quarterStartMonth + 3, 0));
      return {
        from: firstDay.toISOString().split('T')[0],
        to: lastDay.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'custom') {
      if (!from || !to) {
        throw new BadRequestException({
          success: false,
          message: 'Both from and to dates are required for custom preset',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      if (from > to) {
        throw new BadRequestException({
          success: false,
          message: 'from date must be before or equal to to date',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      return { from, to };
    }

    throw new BadRequestException({
      success: false,
      message: 'Invalid preset',
      error: { code: 'VALIDATION_ERROR', details: {} },
    });
  }

  /**
   * Validate date range does not exceed maxRangeDays.
   */
  async validateMaxRange(from: string, to: string): Promise<void> {
    const maxDays = await this.configService.getMaxRangeDays();
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const diffDays = (toMs - fromMs) / 86400000;

    if (diffDays > maxDays) {
      throw new BadRequestException({
        success: false,
        message: `Date range exceeds maximum of ${maxDays} days`,
        error: { code: 'DATE_RANGE_TOO_LARGE', details: { maxDays } },
      });
    }
  }

  /**
   * Validate departmentId is within scope for MANAGER.
   */
  validateDepartmentOwnership(scope: ScopeResult, departmentId?: string): void {
    if (scope.isAdmin || !departmentId) return;

    if (!scope.scopeDepartmentIds?.includes(departmentId)) {
      throw new ForbiddenException({
        success: false,
        message: 'Department is outside your scope',
        error: { code: 'DEPARTMENT_OUT_OF_SCOPE', details: {} },
      });
    }
  }

  /**
   * Build empty response.
   */
  private buildEmptyResponse(
    from: string,
    to: string,
    graceMinutes: number,
  ): OnTimeRateResponseDto {
    const weeks = this.getWeeksInPeriod(from, to);
    const trend: TrendPointDto[] = weeks.map((w) => ({
      period: w,
      onTimeCount: 0,
      lateCount: 0,
      absentCount: 0,
      totalRequiredParticipants: 0,
      onTimeRate: 0,
    }));

    const lateByHourOfDay: HourBucketDto[] = Array.from(
      { length: 24 },
      (_, i) => ({
        hourOfDay: i,
        lateCount: 0,
        totalRequiredParticipants: 0,
        lateRate: 0,
      }),
    );

    return {
      period: { from, to },
      graceMinutes,
      onTimeCount: 0,
      lateCount: 0,
      absentCount: 0,
      totalRequiredParticipants: 0,
      onTimeRate: 0,
      trend,
      lateByHourOfDay,
      lateByDepartment: [],
      message:
        'Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn.',
    };
  }

  /**
   * Build full response.
   */
  private buildResponse(
    kpi: {
      onTimeCount: number;
      lateCount: number;
      absentCount: number;
      totalRequiredParticipants: number;
    },
    trendMap: Map<
      string,
      {
        onTimeCount: number;
        lateCount: number;
        absentCount: number;
        totalRequiredParticipants: number;
      }
    >,
    hourMap: Map<
      number,
      { lateCount: number; totalRequiredParticipants: number }
    >,
    deptRows: Array<{
      departmentId: string;
      departmentName: string;
      lateCount: number;
      totalRequiredParticipants: number;
    }>,
    from: string,
    to: string,
    graceMinutes: number,
  ): OnTimeRateResponseDto {
    const onTimeRate =
      kpi.totalRequiredParticipants > 0
        ? Math.round((kpi.onTimeCount / kpi.totalRequiredParticipants) * 1000) /
          10
        : 0;

    if (kpi.totalRequiredParticipants === 0) {
      return this.buildEmptyResponse(from, to, graceMinutes);
    }

    // 1. Weekly trend points
    const weeks = this.getWeeksInPeriod(from, to);
    const trend: TrendPointDto[] = weeks.map((w) => {
      const pt = trendMap.get(w) || {
        onTimeCount: 0,
        lateCount: 0,
        absentCount: 0,
        totalRequiredParticipants: 0,
      };
      const rate =
        pt.totalRequiredParticipants > 0
          ? Math.round((pt.onTimeCount / pt.totalRequiredParticipants) * 1000) /
            10
          : 0;
      return {
        period: w,
        ...pt,
        onTimeRate: rate,
      };
    });

    // 2. Hour distribution buckets (0-23)
    const lateByHourOfDay: HourBucketDto[] = Array.from(
      { length: 24 },
      (_, i) => {
        const pt = hourMap.get(i) || {
          lateCount: 0,
          totalRequiredParticipants: 0,
        };
        const rate =
          pt.totalRequiredParticipants > 0
            ? Math.round((pt.lateCount / pt.totalRequiredParticipants) * 1000) /
              10
            : 0;
        return {
          hourOfDay: i,
          lateCount: pt.lateCount,
          totalRequiredParticipants: pt.totalRequiredParticipants,
          lateRate: rate,
        };
      },
    );

    // 3. Department breakdown ordered by lateRate DESC
    const lateByDepartment: DepartmentLateItemDto[] = deptRows.map((row) => {
      const rate =
        row.totalRequiredParticipants > 0
          ? Math.round((row.lateCount / row.totalRequiredParticipants) * 1000) /
            10
          : 0;
      return {
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        lateCount: row.lateCount,
        totalRequiredParticipants: row.totalRequiredParticipants,
        lateRate: rate,
      };
    });

    lateByDepartment.sort((a, b) => b.lateRate - a.lateRate);

    return {
      period: { from, to },
      graceMinutes,
      onTimeCount: kpi.onTimeCount,
      lateCount: kpi.lateCount,
      absentCount: kpi.absentCount,
      totalRequiredParticipants: kpi.totalRequiredParticipants,
      onTimeRate,
      trend,
      lateByHourOfDay,
      lateByDepartment,
    };
  }

  /**
   * Helper: get list of weeks boundaries (Mondays) in the date range.
   */
  private getWeeksInPeriod(fromStr: string, toStr: string): string[] {
    const fromDate = new Date(fromStr);
    const startYear = fromDate.getUTCFullYear();
    const startMonth = fromDate.getUTCMonth();
    const startDay = fromDate.getUTCDate();
    const localFrom = new Date(Date.UTC(startYear, startMonth, startDay));

    const dayOfWeek = (localFrom.getUTCDay() + 6) % 7; // Monday = 0
    const currentMonday = new Date(
      Date.UTC(startYear, startMonth, startDay - dayOfWeek),
    );

    const weeks: string[] = [];
    const toTime = new Date(toStr).getTime();

    while (currentMonday.getTime() <= toTime) {
      weeks.push(currentMonday.toISOString().split('T')[0]);
      currentMonday.setUTCDate(currentMonday.getUTCDate() + 7);
    }
    return weeks;
  }
}
