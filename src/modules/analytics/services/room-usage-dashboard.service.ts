import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import {
  RoomUsageDashboardRepository,
  RoomUsageQueryParams,
} from '../repositories/room-usage-dashboard.repository';
import { RoomUsageConfigService } from './room-usage-config.service';
import { DashboardOverviewConfigService } from './dashboard-overview-config.service';
import { QueryRoomUsageDashboardDto } from '../dto/query-room-usage-dashboard.dto';
import { QueryRoomDetailDto } from '../dto/query-room-detail.dto';
import {
  RoomUsageDashboardResponseDto,
  RoomDetailResponseDto,
  RoomComparisonItemDto,
  RoomUsageSummaryDto,
  HeatmapBucketDto,
  RoomDetailMeetingDto,
} from '../dto/room-usage-response.dto';

interface ScopeResult {
  isAdmin: boolean;
  scopeRoomIds: string[] | null;
  viewerRole?: string;
}

@Injectable()
export class RoomUsageDashboardService {
  private readonly logger = new Logger(RoomUsageDashboardService.name);

  constructor(
    private readonly authzRepo: AuthzReadRepository,
    private readonly repo: RoomUsageDashboardRepository,
    private readonly configService: RoomUsageConfigService,
    private readonly dashboardConfigService: DashboardOverviewConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Orchestrator for Room Usage Dashboard (UC-AA-02 / UC-149)
   */
  async getComparisonDashboard(
    currentUser: { userId: string },
    query: QueryRoomUsageDashboardDto,
  ): Promise<{ data: RoomUsageDashboardResponseDto; message: string }> {
    // 1. Resolve date range
    const { from, to } = this.resolveDateRange(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate max range days
    await this.validateMaxRange(from, to);

    // 3. Resolve room scope
    const scope = await this.resolveScope(currentUser.userId, from, to);

    // Audit log helper
    const logAction = async (roomCount: number) => {
      try {
        await this.auditLogsService.logAction({
          userId: currentUser.userId,
          actionType: 'read_analytics_room_dashboard',
          entityType: 'rooms',
          metadataJson: {
            viewerUserId: currentUser.userId,
            viewerRole: scope.viewerRole,
            from,
            to,
            roomId: query.roomId,
            siteName: query.siteName,
            resolvedScopeRoomIds: scope.scopeRoomIds,
            roomCount,
          },
        });
      } catch (err) {
        this.logger.warn(
          'Failed to write audit log for room usage dashboard',
          err instanceof Error ? err.message : undefined,
        );
      }
    };

    // 4. Short-circuit if manager has no rooms in scope
    if (scope.scopeRoomIds !== null && scope.scopeRoomIds.length === 0) {
      const data = this.buildEmptyComparisonResponse(from, to);
      await logAction(0);
      return {
        data,
        message: 'Thống kê sử dụng phòng họp được truy xuất thành công',
      };
    }

    const params: RoomUsageQueryParams = {
      from,
      to,
      scopeRoomIds: scope.scopeRoomIds,
      roomId: query.roomId,
      siteName: query.siteName,
    };

    // 5. Query aggregate bookings & actual usages
    const bookedMap = await this.repo.getBookedAggregate(params);
    const actualMap = await this.repo.getActualAggregate(params);

    // 6. List active rooms
    const activeRooms = await this.repo.listRoomsForComparison(params);

    // 7. Get daily trend
    const trend = await this.repo.getRoomTrend(from, to, scope.scopeRoomIds);

    // 8. Build response
    const operatingHours = await this.configService.getOperatingHoursPerDay();
    const data = this.buildComparisonResponse(
      activeRooms,
      bookedMap,
      actualMap,
      trend,
      from,
      to,
      operatingHours,
    );

    await logAction(data.rooms.length);

    return {
      data,
      message: 'Thống kê sử dụng phòng họp được truy xuất thành công',
    };
  }

  /**
   * Orchestrator for Room Detail (UC-AA-02 / UC-149 detail)
   */
  async getRoomDetail(
    currentUser: { userId: string },
    roomId: string,
    query: QueryRoomDetailDto,
  ): Promise<{ data: RoomDetailResponseDto; message: string }> {
    // 1. Resolve date range
    const { from, to } = this.resolveDateRange(
      query.preset,
      query.from,
      query.to,
    );

    // 2. Validate max range days
    await this.validateMaxRange(from, to);

    // 3. Resolve room scope
    const scope = await this.resolveScope(currentUser.userId, from, to);

    // 4. Check target room existence
    const room = await this.repo.getRoom(roomId);
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Room not found',
        error: { code: 'ROOM_NOT_FOUND', details: {} },
      });
    }

    // 5. Validate MANAGER scope
    if (!scope.isAdmin) {
      if (!scope.scopeRoomIds?.includes(roomId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Room is outside your scope for the selected period',
          error: { code: 'ROOM_OUT_OF_SCOPE', details: {} },
        });
      }
    }

    const params: RoomUsageQueryParams = {
      from,
      to,
      scopeRoomIds: [roomId],
      roomId,
    };

    // 6. Query aggregate bookings & actual usages for single room
    const bookedMap = await this.repo.getBookedAggregate(params);
    const actualMap = await this.repo.getActualAggregate(params);

    // 7. Get meetings list
    const meetings = await this.repo.getRoomMeetingsList(roomId, from, to);

    // 8. Compute heatmap from raw usages
    const rawUsages = await this.repo.getRoomUsagesRaw(roomId, from, to);
    const heatmap = this.computeHeatmap(rawUsages);

    // 9. Build response
    const operatingHours = await this.configService.getOperatingHoursPerDay();
    const data = this.buildDetailResponse(
      room,
      bookedMap.get(roomId) ?? 0,
      actualMap.get(roomId),
      heatmap,
      meetings,
      from,
      to,
      operatingHours,
    );

    // B4: Audit log fires AFTER successful response building (FR-034)
    try {
      await this.auditLogsService.logAction({
        userId: currentUser.userId,
        actionType: 'read_analytics_room_detail',
        entityType: 'rooms',
        metadataJson: {
          viewerUserId: currentUser.userId,
          viewerRole: scope.viewerRole,
          roomId,
          from,
          to,
        },
      });
    } catch (err) {
      this.logger.warn(
        'Failed to write audit log for room detail analytics',
        err instanceof Error ? err.message : undefined,
      );
    }

    return {
      data,
      message: 'Thông tin chi tiết phòng họp được truy xuất thành công',
    };
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
      message: 'You do not have permission to view room usage analytics',
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
    const activePreset = preset || 'month';

    // L1/L3: Use Intl.DateTimeFormat to obtain the current local date in Asia/Ho_Chi_Minh
    // avoiding the fragile manual UTC+7 offset arithmetic that is incorrect for DST-aware code.
    const tz = 'Asia/Ho_Chi_Minh';
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = fmt.format(new Date()); // 'YYYY-MM-DD' in local time

    const [cy, cm, cd] = todayStr.split('-').map(Number);

    if (activePreset === 'day') {
      return { from: todayStr, to: todayStr };
    }

    if (activePreset === 'week') {
      // Find Monday of the current week
      const dayOfWeek =
        (new Date(Date.UTC(cy, cm - 1, cd)).getUTCDay() + 6) % 7; // Monday = 0
      const startOfWeek = new Date(Date.UTC(cy, cm - 1, cd - dayOfWeek));
      const endOfWeek = new Date(Date.UTC(cy, cm - 1, cd - dayOfWeek + 6));
      return {
        from: startOfWeek.toISOString().split('T')[0],
        to: endOfWeek.toISOString().split('T')[0],
      };
    }

    if (activePreset === 'month') {
      const firstDay = new Date(Date.UTC(cy, cm - 1, 1));
      const lastDay = new Date(Date.UTC(cy, cm, 0)); // day 0 of next month = last day of this month
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
    // L1: Parse calendar dates by splitting ISO string directly — avoid UTC parse ambiguity
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const fromDate = new Date(Date.UTC(fy, fm - 1, fd));
    const toDate = new Date(Date.UTC(ty, tm - 1, td));
    const diffDays = (toDate.getTime() - fromDate.getTime()) / 86400000;

    if (diffDays > maxDays) {
      throw new BadRequestException({
        success: false,
        message: `Date range exceeds maximum of ${maxDays} days`,
        error: { code: 'DATE_RANGE_TOO_LARGE', details: { maxDays } },
      });
    }
  }

  /**
   * Build empty comparison response.
   */
  private buildEmptyComparisonResponse(
    from: string,
    to: string,
  ): RoomUsageDashboardResponseDto {
    return {
      period: { from, to },
      summary: {
        reservationUtilizationRate: 0,
        roomOccupancyRate: 0,
        totalBookedHours: 0,
        actualUsedHours: 0,
      },
      rooms: [],
      trend: [],
    };
  }

  /**
   * Build full comparison response.
   */
  private buildComparisonResponse(
    activeRooms: Array<{ id: string; roomName: string }>,
    bookedMap: Map<string, number>,
    actualMap: Map<string, { actualMinutes: number; hasActualData: boolean }>,
    trend: Array<{ date: string; meetingCount: number }>,
    from: string,
    to: string,
    operatingHours: number,
  ): RoomUsageDashboardResponseDto {
    // L1: Parse calendar dates directly to avoid UTC midnight ambiguity
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const fromDate = new Date(Date.UTC(fy, fm - 1, fd));
    const toDate = new Date(Date.UTC(ty, tm - 1, td));
    const days =
      Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
    const capacityHours = operatingHours * days;

    let totalBookedMinutes = 0;
    let totalActualMinutes = 0;
    // B3: Track booked minutes only for rooms with actual data (for accurate occupancy denominator)
    let totalBookedMinutesForActual = 0;
    let actualRoomCount = 0;

    const rooms: RoomComparisonItemDto[] = activeRooms.map((room) => {
      const bookedMinutes = bookedMap.get(room.id) ?? 0;
      totalBookedMinutes += bookedMinutes;

      const actualObj = actualMap.get(room.id);
      const bookedHours = Math.round((bookedMinutes / 60) * 10) / 10;

      const reservationUtilizationRate =
        capacityHours > 0
          ? Math.round((bookedHours / capacityHours) * 1000) / 10
          : 0;

      let actualHours: number | null = null;
      let roomOccupancyRate: number | null = null;
      let hasActualData = false;

      if (actualObj) {
        hasActualData = true;
        actualRoomCount++;
        totalActualMinutes += actualObj.actualMinutes;
        // B3: Only accumulate booked minutes for rooms that have actual data
        totalBookedMinutesForActual += bookedMinutes;
        actualHours = Math.round((actualObj.actualMinutes / 60) * 10) / 10;
        roomOccupancyRate =
          bookedHours > 0
            ? Math.round((actualHours / bookedHours) * 1000) / 10
            : 0;
      }

      return {
        roomId: room.id,
        roomName: room.roomName,
        bookedHours,
        actualHours,
        reservationUtilizationRate,
        roomOccupancyRate,
        hasActualData,
      };
    });

    const totalBookedHours = Math.round((totalBookedMinutes / 60) * 10) / 10;
    const totalActualUsedHours =
      Math.round((totalActualMinutes / 60) * 10) / 10;

    const totalCapacity = capacityHours * activeRooms.length;
    const summaryReservationRate =
      totalCapacity > 0
        ? Math.round((totalBookedHours / totalCapacity) * 1000) / 10
        : 0;

    // B3: Use booked hours of only rooms with actual data as denominator for occupancy rate
    const totalBookedHoursForActual =
      Math.round((totalBookedMinutesForActual / 60) * 10) / 10;
    const summaryOccupancyRate =
      totalBookedHoursForActual > 0
        ? Math.round(
            (totalActualUsedHours / totalBookedHoursForActual) * 1000,
          ) / 10
        : 0;

    const summary: RoomUsageSummaryDto = {
      reservationUtilizationRate: summaryReservationRate,
      roomOccupancyRate: actualRoomCount > 0 ? summaryOccupancyRate : null,
      totalBookedHours,
      actualUsedHours: actualRoomCount > 0 ? totalActualUsedHours : null,
    };

    return {
      period: { from, to },
      summary,
      rooms,
      trend,
    };
  }

  /**
   * Build single room detail response.
   */
  private buildDetailResponse(
    room: {
      id: string;
      roomName: string;
      siteName: string | null;
      areaName: string | null;
      capacity: number;
    },
    bookedMinutes: number,
    actualObj: { actualMinutes: number; hasActualData: boolean } | undefined,
    heatmap: HeatmapBucketDto[],
    meetings: RoomDetailMeetingDto[],
    from: string,
    to: string,
    operatingHours: number,
  ): RoomDetailResponseDto {
    // L1: Parse calendar dates directly to avoid UTC midnight ambiguity
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const fromDate = new Date(Date.UTC(fy, fm - 1, fd));
    const toDate = new Date(Date.UTC(ty, tm - 1, td));
    const days =
      Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
    const capacityHours = operatingHours * days;

    const bookedHours = Math.round((bookedMinutes / 60) * 10) / 10;

    const reservationUtilizationRate =
      capacityHours > 0
        ? Math.round((bookedHours / capacityHours) * 1000) / 10
        : 0;

    let actualHours: number | null = null;
    let roomOccupancyRate: number | null = null;
    let hasActualData = false;

    if (actualObj) {
      hasActualData = true;
      actualHours = Math.round((actualObj.actualMinutes / 60) * 10) / 10;
      roomOccupancyRate =
        bookedHours > 0
          ? Math.round((actualHours / bookedHours) * 1000) / 10
          : 0;
    }

    return {
      room: {
        roomId: room.id,
        roomName: room.roomName,
        siteName: room.siteName,
        areaName: room.areaName,
        capacity: room.capacity,
      },
      period: { from, to },
      bookedHours,
      actualHours,
      reservationUtilizationRate,
      roomOccupancyRate,
      hasActualData,
      heatmap,
      meetings,
    };
  }

  /**
   * Compute Heatmap hourly distribution (0-23) based on actual duration overlaps.
   * L2: Enforces complete atomic pairs — never mixes actualStartTime with lastPresenceAt.
   */
  computeHeatmap(rawUsages: any[]): HeatmapBucketDto[] {
    const heatmap: Record<number, number> = {};
    for (let h = 0; h < 24; h++) {
      heatmap[h] = 0;
    }

    const tzOffset = 7 * 60 * 60 * 1000; // GMT+7 in ms

    for (const rbu of rawUsages) {
      // L2: Use only complete atomic pairs; never cross-mix actual vs presence
      let startRaw: Date | string | null = null;
      let endRaw: Date | string | null = null;

      if (rbu.actualStartTime != null && rbu.actualEndTime != null) {
        startRaw = rbu.actualStartTime;
        endRaw = rbu.actualEndTime;
      } else if (rbu.firstPresenceAt != null && rbu.lastPresenceAt != null) {
        startRaw = rbu.firstPresenceAt;
        endRaw = rbu.lastPresenceAt;
      }

      if (!startRaw || !endRaw) continue;

      const start = new Date(startRaw);
      const end = new Date(endRaw);
      if (start >= end) continue;

      // Hourly overlap calculation in Asia/Ho_Chi_Minh (UTC+7)
      const startMs = start.getTime();
      const endMs = end.getTime();

      // Truncate start to start of the current hour in local time (UTC+7)
      const startLocalMs = startMs + tzOffset;
      const truncatedLocalMs = Math.floor(startLocalMs / 3600000) * 3600000;
      let currentHourStartMs = truncatedLocalMs - tzOffset;

      while (currentHourStartMs < endMs) {
        const currentHourEndMs = currentHourStartMs + 3600000;

        const overlapStartMs = Math.max(startMs, currentHourStartMs);
        const overlapEndMs = Math.min(endMs, currentHourEndMs);

        const overlapMinutes = Math.max(
          0,
          (overlapEndMs - overlapStartMs) / 60000,
        );

        if (overlapMinutes > 0) {
          const localHour = new Date(
            currentHourStartMs + tzOffset,
          ).getUTCHours();
          heatmap[localHour] += Math.round(overlapMinutes * 10) / 10;
        }

        currentHourStartMs = currentHourEndMs;
      }
    }

    return Array.from({ length: 24 }, (_, i) => ({
      hourOfDay: i,
      actualMinutes: Math.round(heatmap[i] * 10) / 10,
    }));
  }
}
