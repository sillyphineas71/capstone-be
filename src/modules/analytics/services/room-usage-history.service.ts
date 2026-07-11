import { Injectable, Logger } from '@nestjs/common';
import { RoomUsageDashboardService } from './room-usage-dashboard.service.js';
import { RoomUsageHistoryConfigService } from './room-usage-history-config.service.js';
import { RoomUsageConfigService } from './room-usage-config.service.js';
import {
  RoomUsageHistoryRepository,
  RawSessionRow,
  RoomUsageHistoryParams,
} from '../repositories/room-usage-history.repository.js';
import { QueryRoomUsageHistoryDto } from '../dto/query-room-usage-history.dto.js';
import {
  RoomUsageHistoryResponseDto,
  RoomUsageHistorySessionDto,
  SessionStatus,
} from '../dto/room-usage-history-response.dto.js';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/**
 * RoomUsageHistoryService — orchestrator cho UC-RUM-04.
 *
 * Tái dùng nguyên `RoomUsageDashboardService.resolveScope/resolveDateRange/
 * validateMaxRange` (UC-AA-02, cùng module) — KHÔNG viết lại (§0.1 spec.md).
 */
@Injectable()
export class RoomUsageHistoryService {
  private readonly logger = new Logger(RoomUsageHistoryService.name);

  constructor(
    private readonly dashboardService: RoomUsageDashboardService,
    private readonly configService: RoomUsageHistoryConfigService,
    private readonly roomUsageConfigService: RoomUsageConfigService,
    private readonly repo: RoomUsageHistoryRepository,
  ) {}

  async getUsageHistory(
    currentUser: { userId: string },
    query: QueryRoomUsageHistoryDto,
  ): Promise<{
    data: RoomUsageHistoryResponseDto;
    message: string;
    total: number;
  }> {
    // FR-005/FR-006/FR-007: mặc định preset='month' (CL-4 đã chốt 2026-07-10)
    const { from, to } = this.dashboardService.resolveDateRange(
      query.preset,
      query.from,
      query.to,
    );

    await this.dashboardService.validateMaxRange(from, to);

    const scope = await this.dashboardService.resolveScope(
      currentUser.userId,
      from,
      to,
    );

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sortBy = query.sortBy ?? 'reservedStartTime';
    const sortOrder = query.sortOrder ?? 'desc';

    const params: RoomUsageHistoryParams = {
      from,
      to,
      scopeRoomIds: scope.scopeRoomIds,
      roomId: query.roomId,
      siteName: query.siteName,
      areaName: query.areaName,
    };

    // FR-014/FR-035: Manager không có phòng nào trong scope -> tra rong, khong loi.
    const [rawRows, total, summary, activeRoomCount, operatingHoursPerDay] =
      await Promise.all([
        this.repo.getSessionsPage(params, sortBy, sortOrder, page, limit),
        this.repo.getSessionsCount(params),
        this.repo.getSummaryAggregate(params),
        this.repo.getActiveRoomCount(params),
        this.roomUsageConfigService.getOperatingHoursPerDay(),
      ]);

    const lateCancellationThresholdMinutes =
      await this.configService.getLateCancellationThresholdMinutes();
    const now = new Date();

    let sessions: RoomUsageHistorySessionDto[] = rawRows.map((row) =>
      this.toSessionDto(row, lateCancellationThresholdMinutes, now),
    );

    // sessionStatus la derive tu JS (khong phai cot SQL that) - khi sortBy=sessionStatus
    // ap dung lai sort chinh xac tren gia tri da derive (SQL chi sort xap xi theo rb.status).
    if (sortBy === 'sessionStatus') {
      sessions = sessions.sort((a, b) =>
        sortOrder === 'asc'
          ? a.sessionStatus.localeCompare(b.sessionStatus)
          : b.sessionStatus.localeCompare(a.sessionStatus),
      );
    }

    // FR-032: reservationUtilizationRate = bookedHours / availableHours * 100,
    // dung cong thuc availableHours = operatingHours * days * activeRoomCount
    // (tai dung nguyen tac UC-AA-02/UC-AA-08 — khong dinh nghia lai cong thuc).
    const days = this.daysInRange(from, to);
    const availableHours = operatingHoursPerDay * days * activeRoomCount;
    const reservationUtilizationRate =
      availableHours > 0
        ? Math.round((summary.totalReservedHours / availableHours) * 1000) / 10
        : 0;

    const data: RoomUsageHistoryResponseDto = {
      period: { from, to },
      summary: {
        totalReservedHours: summary.totalReservedHours,
        totalActualHours: summary.totalActualHours,
        noShowCount: summary.noShowCount,
        reservationUtilizationRate,
        roomOccupancyRate:
          summary.totalActualHours !== null && summary.totalReservedHours > 0
            ? Math.round(
                (summary.totalActualHours / summary.totalReservedHours) * 1000,
              ) / 10
            : null,
      },
      sessions,
    };

    const message =
      total === 0
        ? `Không có dữ liệu sử dụng phòng họp nào được ghi nhận trong khoảng thời gian từ ${from} đến ${to}.`
        : 'Lịch sử sử dụng phòng họp được truy xuất thành công';

    return { data, message, total };
  }

  private daysInRange(from: string, to: string): number {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const fromDate = new Date(Date.UTC(fy, fm - 1, fd));
    const toDate = new Date(Date.UTC(ty, tm - 1, td));
    return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  }

  /** FR-DATA-002: thứ tự derive sessionStatus. Pure function — dễ unit test. */
  toSessionDto(
    row: RawSessionRow,
    lateCancellationThresholdMinutes: number,
    now: Date,
  ): RoomUsageHistorySessionDto {
    return {
      roomId: row.room_id,
      roomName: row.room_name,
      meetingId: row.meeting_id,
      meetingTitle: row.meeting_title,
      hostName: row.host_name,
      reservedStartTime: row.reserved_start_time,
      reservedEndTime: row.reserved_end_time,
      actualStartTime: row.actual_start_time,
      actualEndTime: row.actual_end_time,
      sessionStatus: this.deriveSessionStatus(
        row,
        lateCancellationThresholdMinutes,
        now,
      ),
    };
  }

  deriveSessionStatus(
    row: RawSessionRow,
    lateCancellationThresholdMinutes: number,
    now: Date,
  ): SessionStatus {
    if (row.booking_status === 'cancelled') {
      const reservedStart = new Date(row.reserved_start_time).getTime();
      const cancelledAt = new Date(row.booking_updated_at).getTime();
      const minutesBeforeStart = (reservedStart - cancelledAt) / 60000;
      return minutesBeforeStart <= lateCancellationThresholdMinutes
        ? 'cancelled_late'
        : 'cancelled';
    }

    if (row.usage_status) {
      const map: Record<string, SessionStatus> = {
        completed: 'completed',
        no_show: 'no_show',
        early_empty: 'early_empty',
        released: 'released',
        not_started: 'not_started',
        in_use: 'in_progress',
      };
      return map[row.usage_status] ?? 'not_started';
    }

    const reservedEnd = new Date(row.reserved_end_time).getTime();
    if (reservedEnd < now.getTime()) {
      return 'pending_evaluation';
    }
    return 'not_started';
  }
}
