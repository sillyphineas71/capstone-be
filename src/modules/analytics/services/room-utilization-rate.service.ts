import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { RoomUtilizationRateRepository } from '../repositories/room-utilization-rate.repository';
import { RoomUsageConfigService } from './room-usage-config.service';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryRoomUtilizationRateDto } from '../dto/query-room-utilization-rate.dto';
import {
  RoomUtilizationRateResponseDto,
  MetricPairDto,
  HoursPairDto,
  TrendBucketDto,
} from '../dto/room-utilization-rate-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeRoomIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class RoomUtilizationRateService {
  private readonly logger = new Logger(RoomUtilizationRateService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: RoomUtilizationRateRepository,
    private readonly configService: RoomUsageConfigService,
    private readonly dashboardConfigService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator for Room Utilization Rate Analytics (UC-AA-08 / UC-155)
   */
  async getUtilizationRate(
    currentUser: { userId: string },
    query: QueryRoomUtilizationRateDto,
  ): Promise<{ data: RoomUtilizationRateResponseDto; message: string }> {
    // 1. Resolve current period
    const currentPeriod = this.resolveCurrentPeriod(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate max range days on current period only
    await this.validateMaxRange(currentPeriod.from, currentPeriod.to);

    // 3. Resolve comparison period
    const comparisonPeriod = this.resolveComparisonPeriod(
      query.comparisonMode,
      currentPeriod.from,
      currentPeriod.to,
      query.comparisonFrom,
      query.comparisonTo,
    );

    // 4. Resolve scope
    const scope = await this.resolveScope(
      currentUser.userId,
      currentPeriod.from,
      currentPeriod.to,
    );

    // 5. Check roomId validity and ownership if roomId filter is provided
    if (query.roomId) {
      const room = await this.repo.getRoom(query.roomId);
      if (!room) {
        throw new NotFoundException({
          success: false,
          message: 'Room not found',
          error: { code: 'ROOM_NOT_FOUND', details: {} },
        });
      }
      if (!scope.isAdmin && !scope.scopeRoomIds?.includes(query.roomId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Room is outside your scope',
          error: { code: 'ROOM_OUT_OF_SCOPE', details: {} },
        });
      }
    }

    // Audit Log
    try {
      await this.auditLogsService.logAction({
        userId: currentUser.userId,
        actionType: 'read_analytics_room_utilization_rate',
        entityType: 'rooms',
        metadataJson: {
          viewerUserId: currentUser.userId,
          viewerRole: scope.viewerRole,
          from: currentPeriod.from,
          to: currentPeriod.to,
          comparisonMode: query.comparisonMode || 'previous_period',
          comparisonFrom: comparisonPeriod.from,
          comparisonTo: comparisonPeriod.to,
          roomId: query.roomId,
          resolvedScopeRoomIds: scope.scopeRoomIds,
        },
      });
    } catch (err) {
      this.logger.warn(
        'Failed to write audit log for room utilization rate',
        err instanceof Error ? err.message : undefined,
      );
    }

    // 6. Enforce granularity
    const currentFromDate = new Date(currentPeriod.from);
    const currentToDate = new Date(currentPeriod.to);
    const days =
      Math.round(
        (currentToDate.getTime() - currentFromDate.getTime()) / 86400000,
      ) + 1;

    const activeGranularity: 'day' | 'week' =
      (query.granularity as 'day' | 'week') || (days <= 31 ? 'day' : 'week');

    // Short-circuit if manager has no rooms in scope
    if (scope.scopeRoomIds !== null && scope.scopeRoomIds.length === 0) {
      return {
        data: this.buildEmptyResponse(currentPeriod, comparisonPeriod),
        message: 'Thống kê tỷ lệ sử dụng phòng được truy xuất thành công',
      };
    }

    // 7. Get Summary Aggregates for both periods
    const currentAgg = await this.repo.getPeriodAggregate(
      scope.scopeRoomIds,
      query.roomId,
      currentPeriod.from,
      currentPeriod.to,
    );

    const compAgg = await this.repo.getPeriodAggregate(
      scope.scopeRoomIds,
      query.roomId,
      comparisonPeriod.from,
      comparisonPeriod.to,
    );

    const comparisonHasNoData = compAgg.bookedMinutesSum === 0;

    // 8. Compute summary metrics
    const operatingHours = await this.configService.getOperatingHoursPerDay();
    const currentCapacityHours =
      operatingHours * days * currentAgg.activeRoomCount;
    const compCapacityHours = operatingHours * days * compAgg.activeRoomCount;

    const currentBookedHours =
      Math.round((currentAgg.bookedMinutesSum / 60) * 10) / 10;
    const compBookedHours =
      Math.round((compAgg.bookedMinutesSum / 60) * 10) / 10;

    const currentActualHours =
      Math.round((currentAgg.actualMinutesSum / 60) * 10) / 10;
    const compActualHours =
      Math.round((compAgg.actualMinutesSum / 60) * 10) / 10;

    const currentUtilRate =
      currentCapacityHours > 0
        ? (currentBookedHours / currentCapacityHours) * 100
        : 0;
    const compUtilRate =
      compCapacityHours > 0 ? (compBookedHours / compCapacityHours) * 100 : 0;

    const currentOccupancyRate =
      currentAgg.hasActualData && currentBookedHours > 0
        ? (currentActualHours / currentBookedHours) * 100
        : null;
    const compOccupancyRate =
      compAgg.hasActualData && compBookedHours > 0
        ? (compActualHours / compBookedHours) * 100
        : null;

    const reservationUtilizationRate: MetricPairDto = {
      current: Math.round(currentUtilRate * 10) / 10,
      comparison: Math.round(compUtilRate * 10) / 10,
      deltaPercent: this.calculateDelta(currentUtilRate, compUtilRate),
    };

    const roomOccupancyRate: MetricPairDto = {
      current:
        currentOccupancyRate !== null
          ? Math.round(currentOccupancyRate * 10) / 10
          : null,
      comparison:
        compOccupancyRate !== null
          ? Math.round(compOccupancyRate * 10) / 10
          : null,
      deltaPercent: this.calculateDelta(
        currentOccupancyRate,
        compOccupancyRate,
      ),
    };

    const bookedHours: HoursPairDto = {
      current: currentBookedHours,
      comparison: compBookedHours,
    };

    const actualHours: HoursPairDto = {
      current: currentActualHours,
      comparison: compActualHours,
    };

    const availableHours: HoursPairDto = {
      current: Math.round(currentCapacityHours * 10) / 10,
      comparison: Math.round(compCapacityHours * 10) / 10,
    };

    // 9. Compute daily/weekly trend
    const trend = await this.computeTrendBuckets(
      scope.scopeRoomIds,
      query.roomId,
      currentPeriod.from,
      comparisonPeriod.from,
      days,
      activeGranularity,
      operatingHours,
      comparisonHasNoData,
    );

    // 10. Construct response messages
    let message = 'Thống kê tỷ lệ sử dụng phòng được truy xuất thành công';
    if (currentAgg.bookedMinutesSum === 0) {
      message =
        'Không tìm thấy dữ liệu vận hành hợp lệ của chu kỳ hiện tại được chọn.';
    } else if (comparisonHasNoData) {
      message =
        'Không tìm thấy dữ liệu vận hành hợp lệ của chu kỳ đối chiếu được chọn.';
    }

    const data: RoomUtilizationRateResponseDto = {
      currentPeriod,
      comparisonPeriod,
      comparisonHasNoData,
      summary: {
        reservationUtilizationRate,
        roomOccupancyRate,
        bookedHours,
        actualHours,
        availableHours,
      },
      trend,
      message,
    };

    return { data, message };
  }

  /**
   * Resolve user scope based on roles and dates.
   */
  async resolveScope(
    userId: string,
    from: string,
    to: string,
  ): Promise<ScopeResult> {
    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(userId);

    if (roles.includes('SYSTEM_ADMIN')) {
      return { isAdmin: true, scopeRoomIds: null, viewerRole: 'SYSTEM_ADMIN' };
    }
    if (roles.includes('BUSINESS_ADMIN')) {
      return {
        isAdmin: true,
        scopeRoomIds: null,
        viewerRole: 'BUSINESS_ADMIN',
      };
    }
    if (roles.includes('MANAGER')) {
      const scopeRoomIds = await this.repo.getManagerRoomIds(userId, from, to);
      return { isAdmin: false, scopeRoomIds, viewerRole: 'MANAGER' };
    }

    throw new ForbiddenException({
      success: false,
      message: 'You do not have permission to view room utilization analytics',
      error: { code: 'PERMISSION_DENIED', details: {} },
    });
  }

  /**
   * Resolve current period based on preset.
   */
  resolveCurrentPeriod(
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
      const quarterIndex = Math.floor(currentMonth / 3); // 0-3
      const firstMonth = quarterIndex * 3;
      const lastMonth = firstMonth + 2;
      const firstDay = new Date(Date.UTC(currentYear, firstMonth, 1));
      const lastDay = new Date(Date.UTC(currentYear, lastMonth + 1, 0));
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
    const maxDays = await this.dashboardConfigService.getMaxRangeDays();
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
   * Shift dates back by one calendar year.
   */
  shiftYearBack(dateStr: string): string {
    const parts = dateStr.split('-');
    const year = parseInt(parts[0], 10) - 1;
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    let targetDay = day;
    if (month === 1 && day === 29) {
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      if (!isLeap) {
        targetDay = 28;
      }
    }

    const mm = String(month + 1).padStart(2, '0');
    const dd = String(targetDay).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  /**
   * Resolve comparison period.
   */
  resolveComparisonPeriod(
    mode?: string,
    currentFrom?: string,
    currentTo?: string,
    comparisonFrom?: string,
    comparisonTo?: string,
  ): { from: string; to: string } {
    const activeMode = mode || 'previous_period';

    if (activeMode === 'previous_period') {
      const currentFromDate = new Date(currentFrom!);
      const currentToDate = new Date(currentTo!);
      const diffMs = currentToDate.getTime() - currentFromDate.getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const days = Math.round(diffMs / oneDayMs) + 1;

      const compToDate = new Date(currentFromDate.getTime() - oneDayMs);
      const compFromDate = new Date(
        compToDate.getTime() - (days - 1) * oneDayMs,
      );

      return {
        from: compFromDate.toISOString().split('T')[0],
        to: compToDate.toISOString().split('T')[0],
      };
    }

    if (activeMode === 'same_period_last_year') {
      return {
        from: this.shiftYearBack(currentFrom!),
        to: this.shiftYearBack(currentTo!),
      };
    }

    if (activeMode === 'custom') {
      if (!comparisonFrom || !comparisonTo) {
        throw new BadRequestException({
          success: false,
          message:
            'Both comparisonFrom and comparisonTo dates are required for custom comparison mode',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }
      if (comparisonFrom > comparisonTo) {
        throw new BadRequestException({
          success: false,
          message:
            'comparisonFrom date must be before or equal to comparisonTo date',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }

      const currentDays =
        Math.round(
          (new Date(currentTo!).getTime() - new Date(currentFrom!).getTime()) /
            86400000,
        ) + 1;
      const compDays =
        Math.round(
          (new Date(comparisonTo).getTime() -
            new Date(comparisonFrom).getTime()) /
            86400000,
        ) + 1;
      if (currentDays !== compDays) {
        throw new BadRequestException({
          success: false,
          message:
            'Comparison period must have the same duration as the current period',
          error: { code: 'VALIDATION_ERROR', details: {} },
        });
      }

      return { from: comparisonFrom, to: comparisonTo };
    }

    throw new BadRequestException({
      success: false,
      message: 'Invalid comparison mode',
      error: { code: 'VALIDATION_ERROR', details: {} },
    });
  }

  /**
   * Helper to calculate delta percentage between current and comparison values.
   */
  private calculateDelta(
    current: number | null,
    comparison: number | null,
  ): number | null {
    if (current === null || comparison === null || comparison === 0) {
      return null;
    }
    const delta = ((current - comparison) / comparison) * 100;
    return Math.round(delta * 10) / 10;
  }

  /**
   * Build empty response.
   */
  private buildEmptyResponse(
    currentPeriod: { from: string; to: string },
    comparisonPeriod: { from: string; to: string },
  ): RoomUtilizationRateResponseDto {
    const emptyPair = () => ({
      current: 0,
      comparison: 0,
      deltaPercent: null as number | null,
    });
    return {
      currentPeriod,
      comparisonPeriod,
      comparisonHasNoData: true,
      summary: {
        reservationUtilizationRate: emptyPair(),
        roomOccupancyRate: {
          current: null,
          comparison: null,
          deltaPercent: null,
        },
        bookedHours: { current: 0, comparison: 0 },
        actualHours: { current: 0, comparison: 0 },
        availableHours: { current: 0, comparison: 0 },
      },
      trend: [],
      message:
        'Không tìm thấy dữ liệu vận hành hợp lệ của chu kỳ hiện tại được chọn.',
    };
  }

  /**
   * Compute daily/weekly trend buckets.
   */
  private async computeTrendBuckets(
    scopeRoomIds: string[] | null,
    roomIdFilter: string | undefined,
    currentFrom: string,
    comparisonFrom: string,
    days: number,
    granularity: 'day' | 'week',
    operatingHours: number,
    comparisonHasNoData: boolean,
  ): Promise<TrendBucketDto[]> {
    const trend: TrendBucketDto[] = [];

    if (granularity === 'day') {
      for (let i = 0; i < days; i++) {
        const curDate = new Date(
          new Date(currentFrom).getTime() + i * 86400000,
        );
        const curStr = curDate.toISOString().split('T')[0];

        const compDate = new Date(
          new Date(comparisonFrom).getTime() + i * 86400000,
        );
        const compStr = compDate.toISOString().split('T')[0];

        const curAgg = await this.repo.getPeriodAggregate(
          scopeRoomIds,
          roomIdFilter,
          curStr,
          curStr,
        );
        const compAgg = await this.repo.getPeriodAggregate(
          scopeRoomIds,
          roomIdFilter,
          compStr,
          compStr,
        );

        const curCapacity = operatingHours * 1 * curAgg.activeRoomCount;
        const compCapacity = operatingHours * 1 * compAgg.activeRoomCount;

        const curBookedHours = curAgg.bookedMinutesSum / 60;
        const compBookedHours = compAgg.bookedMinutesSum / 60;

        const curUtil =
          curCapacity > 0 ? (curBookedHours / curCapacity) * 100 : 0;
        const compUtil =
          compCapacity > 0 ? (compBookedHours / compCapacity) * 100 : 0;

        const curOcc =
          curAgg.hasActualData && curBookedHours > 0
            ? (curAgg.actualMinutesSum / 60 / curBookedHours) * 100
            : null;
        const compOcc =
          compAgg.hasActualData && compBookedHours > 0
            ? (compAgg.actualMinutesSum / 60 / compBookedHours) * 100
            : null;

        trend.push({
          index: `Ngày ${i + 1}`,
          current: {
            reservationUtilizationRate: Math.round(curUtil * 10) / 10,
            roomOccupancyRate:
              curOcc !== null ? Math.round(curOcc * 10) / 10 : null,
          },
          comparison: {
            reservationUtilizationRate: comparisonHasNoData
              ? 0
              : Math.round(compUtil * 10) / 10,
            roomOccupancyRate: comparisonHasNoData
              ? 0
              : compOcc !== null
                ? Math.round(compOcc * 10) / 10
                : null,
          },
        });
      }
    } else {
      const numWeeks = Math.ceil(days / 7);
      for (let i = 0; i < numWeeks; i++) {
        const startOffset = i * 7;
        const endOffset = Math.min(days - 1, (i + 1) * 7 - 1);
        const weekDays = endOffset - startOffset + 1;

        const curFromDate = new Date(
          new Date(currentFrom).getTime() + startOffset * 86400000,
        );
        const curToDate = new Date(
          new Date(currentFrom).getTime() + endOffset * 86400000,
        );
        const curFromStr = curFromDate.toISOString().split('T')[0];
        const curToStr = curToDate.toISOString().split('T')[0];

        const compFromDate = new Date(
          new Date(comparisonFrom).getTime() + startOffset * 86400000,
        );
        const compToDate = new Date(
          new Date(comparisonFrom).getTime() + endOffset * 86400000,
        );
        const compFromStr = compFromDate.toISOString().split('T')[0];
        const compToStr = compToDate.toISOString().split('T')[0];

        const curAgg = await this.repo.getPeriodAggregate(
          scopeRoomIds,
          roomIdFilter,
          curFromStr,
          curToStr,
        );
        const compAgg = await this.repo.getPeriodAggregate(
          scopeRoomIds,
          roomIdFilter,
          compFromStr,
          compToStr,
        );

        const curCapacity = operatingHours * weekDays * curAgg.activeRoomCount;
        const compCapacity =
          operatingHours * weekDays * compAgg.activeRoomCount;

        const curBookedHours = curAgg.bookedMinutesSum / 60;
        const compBookedHours = compAgg.bookedMinutesSum / 60;

        const curUtil =
          curCapacity > 0 ? (curBookedHours / curCapacity) * 100 : 0;
        const compUtil =
          compCapacity > 0 ? (compBookedHours / compCapacity) * 100 : 0;

        const curOcc =
          curAgg.hasActualData && curBookedHours > 0
            ? (curAgg.actualMinutesSum / 60 / curBookedHours) * 100
            : null;
        const compOcc =
          compAgg.hasActualData && compBookedHours > 0
            ? (compAgg.actualMinutesSum / 60 / compBookedHours) * 100
            : null;

        trend.push({
          index: `Tuần ${i + 1}`,
          current: {
            reservationUtilizationRate: Math.round(curUtil * 10) / 10,
            roomOccupancyRate:
              curOcc !== null ? Math.round(curOcc * 10) / 10 : null,
          },
          comparison: {
            reservationUtilizationRate: comparisonHasNoData
              ? 0
              : Math.round(compUtil * 10) / 10,
            roomOccupancyRate: comparisonHasNoData
              ? 0
              : compOcc !== null
                ? Math.round(compOcc * 10) / 10
                : null,
          },
        });
      }
    }

    return trend;
  }
}
