import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { GateAccessLogEntity } from '../../zones/entities/gate-access-log.entity.js';
import { VehicleRegistrationEntity } from '../../anpr/entities/vehicle-registration.entity.js';
import type {
  EmployeeSummaryResponseDto,
  EmployeeVehicleStatusDto,
  GateAccessTodayItemDto,
} from '../dto/employee-summary-response.dto.js';

/** startOfDay theo server local timezone (mirror pattern UC-126 §2.4). */
function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function endOfDay(dayStart: Date): Date {
  return new Date(
    dayStart.getFullYear(),
    dayStart.getMonth(),
    dayStart.getDate(),
    23,
    59,
    59,
    999,
  );
}

/**
 * EmployeeSummaryService (CDB-RS-001) — dashboard "của chính tôi", mọi role đăng nhập.
 * Module 100% READ-ONLY (DATA-01) — không INSERT/UPDATE/DELETE bảng nào.
 *
 * ARCH-02: KHÔNG import `AnprModule`/`MeetingsModule` — chỉ inject entity trực tiếp
 * (`VehicleRegistrationEntity` CHỈ để SELECT, không đụng file nào trong `src/modules/anpr/`).
 */
@Injectable()
export class EmployeeSummaryService {
  constructor(
    @InjectRepository(GateAccessLogEntity)
    private readonly gateLogRepo: Repository<GateAccessLogEntity>,
    @InjectRepository(VehicleRegistrationEntity)
    private readonly vehicleRepo: Repository<VehicleRegistrationEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getSummary(userId: string): Promise<EmployeeSummaryResponseDto> {
    const now = new Date();
    const todayStart = startOfDay(now);

    const [gateAccessToday, vehicleStatus, meetingsToday] = await Promise.all([
      this.loadGateAccessToday(userId, todayStart),
      this.loadVehicleStatus(userId),
      this.countMeetingsToday(userId, todayStart),
    ]);

    return { gateAccessToday, vehicleStatus, meetingsToday };
  }

  private async loadGateAccessToday(
    userId: string,
    todayStart: Date,
  ): Promise<GateAccessTodayItemDto[]> {
    const logs = await this.gateLogRepo.find({
      where: { userId, accessTime: MoreThanOrEqual(todayStart) },
      order: { accessTime: 'ASC' },
    });
    return logs.map((log) => ({
      direction: log.direction,
      accessTime: log.accessTime.toISOString(),
    }));
  }

  /** spec §2.7: field `status` literal (active/disabled) — KHÔNG bịa `approvalStatus`. */
  private async loadVehicleStatus(
    userId: string,
  ): Promise<EmployeeVehicleStatusDto | null> {
    const rows = await this.vehicleRepo.find({
      where: { userId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const vehicle = rows[0];
    if (!vehicle) return null;
    return { plateNumber: vehicle.plateNumber, status: vehicle.status };
  }

  /** Loại `status='cancelled'` khỏi số đếm (spec §3 mục employee-summary). */
  private async countMeetingsToday(
    userId: string,
    todayStart: Date,
  ): Promise<number> {
    const rows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(DISTINCT m.id)::text AS count
       FROM meeting_participants mp
       INNER JOIN meetings m ON m.id = mp.meeting_id
       WHERE mp.user_id = $1
         AND m.deleted_at IS NULL
         AND m.status <> 'cancelled'
         AND m.start_time >= $2
         AND m.start_time <= $3`,
      [userId, todayStart, endOfDay(todayStart)],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
