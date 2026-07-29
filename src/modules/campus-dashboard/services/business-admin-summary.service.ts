import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { SecurityAlertEntity } from '../../alerts/entities/security-alert.entity.js';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { resolveOccupancyStatus } from '../utils/resolve-occupancy-status.util.js';
import type {
  BusinessAdminSummaryResponseDto,
  SecurityAlertsBySeverityDto,
  ZoneOccupancySummaryDto,
} from '../dto/business-admin-summary-response.dto.js';

const VEHICLE_CONTROL_MATCH_ALERT_TYPE = 'vehicle_control_match';

/** startOfDay theo server local timezone (mirror pattern UC-126 §2.4). */
function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * BusinessAdminSummaryService (CDB-RS-001) — dashboard tổng hợp toàn tổ chức cho
 * BUSINESS_ADMIN/SYSTEM_ADMIN. Module 100% READ-ONLY (DATA-01).
 *
 * ARCH-02: KHÔNG import `AlertsModule` — chỉ inject `SecurityAlertEntity` trực tiếp
 * (đọc read-only, không đụng file nào trong `src/modules/alerts/`).
 */
@Injectable()
export class BusinessAdminSummaryService {
  constructor(
    private readonly repo: CampusDashboardRepository,
    @InjectRepository(SecurityAlertEntity)
    private readonly alertRepo: Repository<SecurityAlertEntity>,
  ) {}

  async getSummary(): Promise<BusinessAdminSummaryResponseDto> {
    const now = new Date();
    const todayStart = startOfDay(now);

    const [
      gateTrafficToday,
      securityAlertsBySeverity,
      zoneOccupancy,
      vehicleControlHitsToday,
    ] = await Promise.all([
      this.computeGateTrafficToday(todayStart),
      this.computeSecurityAlertsBySeverity(todayStart),
      this.computeZoneOccupancy(now),
      this.countVehicleControlHitsToday(todayStart),
    ]);

    return {
      gateTrafficToday,
      securityAlertsBySeverity,
      zoneOccupancy,
      vehicleControlHitsToday,
    };
  }

  private async computeGateTrafficToday(
    todayStart: Date,
  ): Promise<{ entriesToday: number; exitsToday: number }> {
    const [entriesToday, exitsToday] = await Promise.all([
      this.repo.countGateLogsAllZonesToday('enter', todayStart),
      this.repo.countGateLogsAllZonesToday('leave', todayStart),
    ]);
    return { entriesToday, exitsToday };
  }

  /** GROUP BY severity trong ngày — luôn đủ 4 key kể cả khi DB không có alert mức đó. */
  private async computeSecurityAlertsBySeverity(
    todayStart: Date,
  ): Promise<SecurityAlertsBySeverityDto> {
    const rows: Array<{ severity: string; count: string }> =
      await this.alertRepo
        .createQueryBuilder('sa')
        .select('sa.severity', 'severity')
        .addSelect('COUNT(*)', 'count')
        .where('sa.triggeredAt >= :todayStart', { todayStart })
        .groupBy('sa.severity')
        .getRawMany();

    const result: SecurityAlertsBySeverityDto = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const row of rows) {
      if (row.severity in result) {
        result[row.severity as keyof SecurityAlertsBySeverityDto] = Number(
          row.count,
        );
      }
    }
    return result;
  }

  /**
   * SUM occupancy mới nhất mỗi zone (chỉ zone `status='ok'`, TÁI DÙNG
   * `resolveOccupancyStatus` của CDB-001) — mỗi zone lấy tại thời điểm gần nhất RIÊNG,
   * KHÔNG phải snapshot đồng thời toàn trường (spec §6 residual).
   */
  private async computeZoneOccupancy(
    now: Date,
  ): Promise<ZoneOccupancySummaryDto> {
    const stalenessMinutes = await this.repo.loadStalenessMinutes();
    const zonesData = await this.repo.loadAllZonesWithLatestOccupancy();

    let totalCount = 0;
    let zonesWithDataCount = 0;
    for (const { devicesInZone, latestEvent } of zonesData) {
      const occupancy = resolveOccupancyStatus(
        devicesInZone,
        latestEvent,
        stalenessMinutes,
        now,
      );
      if (occupancy.status === 'ok') {
        zonesWithDataCount += 1;
        totalCount += occupancy.count ?? 0;
      }
    }

    return {
      totalCount,
      zonesWithDataCount,
      totalZoneCount: zonesData.length,
    };
  }

  /** spec §2.6: đếm qua `security_alerts`, KHÔNG đọc trực tiếp `anpr`/`gate-access`. */
  private async countVehicleControlHitsToday(
    todayStart: Date,
  ): Promise<number> {
    return this.alertRepo.count({
      where: {
        alertType: VEHICLE_CONTROL_MATCH_ALERT_TYPE,
        triggeredAt: MoreThanOrEqual(todayStart),
      },
    });
  }
}
