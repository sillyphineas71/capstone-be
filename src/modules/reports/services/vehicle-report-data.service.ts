import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VehicleTrafficStatsService } from '../../gate-access/services/vehicle-traffic-stats.service.js';
import type { VehicleTrafficStatsResponseDto } from '../../gate-access/dto/vehicle-traffic-stats-response.dto.js';

export interface VehicleExportParams {
  from: string;
  to: string;
  filters: {
    vehicleType: string | null;
    zoneId: string | null;
  };
}

export interface VehicleRegistrationExportRow {
  plateRaw: string;
  plateNumber: string;
  vehicleType: string | null;
  status: string;
  note: string | null;
  createdAt: Date;
  ownerEmployeeCode: string | null;
  ownerFullName: string | null;
}

/**
 * VehicleReportDataService — tổng hợp dữ liệu cho UC-128.
 *
 * `listRegistrationsForExport` — MỚI, admin-wide (§0.2 spec: KHÔNG scope theo
 * userId như `VehicleRegistrationService.list()`), tất cả trạng thái trừ đã
 * xóa mềm. KHÔNG áp `filters.zoneId` (§0.3 spec — `vehicle_registrations`
 * không gắn zone).
 *
 * `getTrafficStats` — CHỈ là wrapper mỏng gọi `VehicleTrafficStatsService.getStats()`
 * (UC-114) NGUYÊN VẸN qua DI, KHÔNG fork logic (NFR-004 spec).
 */
@Injectable()
export class VehicleReportDataService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly vehicleTrafficStatsService: VehicleTrafficStatsService,
  ) {}

  async listRegistrationsForExport(
    params: VehicleExportParams,
  ): Promise<VehicleRegistrationExportRow[]> {
    const sqlParams: unknown[] = [params.from, params.to];
    const conditions: string[] = [
      'vr.deleted_at IS NULL',
      'vr.created_at >= $1',
      'vr.created_at <= $2',
    ];

    if (params.filters.vehicleType) {
      sqlParams.push(params.filters.vehicleType);
      conditions.push(`vr.vehicle_type = $${sqlParams.length}`);
    }
    // §0.3: filters.zoneId KHÔNG áp dụng ở đây dù có giá trị — vehicle_registrations
    // không gắn zone.

    const rows: Array<{
      plate_raw: string;
      plate_number: string;
      vehicle_type: string | null;
      status: string;
      note: string | null;
      created_at: Date;
      employee_code: string | null;
      full_name: string | null;
    }> = await this.dataSource.query(
      `SELECT vr.plate_raw, vr.plate_number, vr.vehicle_type, vr.status, vr.note,
              vr.created_at, u.employee_code, u.full_name
         FROM vehicle_registrations vr
         LEFT JOIN users u ON u.id = vr.user_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY vr.created_at DESC`,
      sqlParams,
    );

    return rows.map((r) => ({
      plateRaw: r.plate_raw,
      plateNumber: r.plate_number,
      vehicleType: r.vehicle_type,
      status: r.status,
      note: r.note,
      createdAt: r.created_at,
      ownerEmployeeCode: r.employee_code,
      ownerFullName: r.full_name,
    }));
  }

  async getTrafficStats(
    params: VehicleExportParams,
  ): Promise<VehicleTrafficStatsResponseDto> {
    return this.vehicleTrafficStatsService.getStats({
      from: params.from,
      to: params.to,
      zoneId: params.filters.zoneId ?? undefined,
      vehicleType: params.filters.vehicleType ?? undefined,
      groupBy: 'day',
    });
  }
}
