import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { normalizePlate } from '../utils/normalize-plate.js';
import type { ListVehicleHistoryQueryDto } from '../dto/list-vehicle-history-query.dto.js';

interface HistoryRow {
  plate_number: string | null;
  channel_id: number | null;
  direction: string | null;
  match_state: string | null;
  event_time: Date;
  utc: string | null;
  user_id?: string | null;
}
interface CountRow {
  total: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface VehicleHistoryItem {
  plateNumber: string | null;
  channelId: number | null;
  direction: string | null;
  matchState: string | null;
  eventTime: Date;
  utc: string | null;
  userId?: string | null; // CHỈ admin (listAll)
}

const EVENT_TYPE = 'ivss_vehicle_event';

/**
 * VehicleHistoryService (VHI-001 / UC7) — lịch sử ra/vào cổng (read-only).
 *
 * 2 method: listForUser (xe CỦA MÌNH, payload_json->>'userId'=current) / listAll (admin, tất cả).
 * Raw SQL mirror UC6 (bind index động + COUNT). DATA-01 C1-isolation: CHỈ event_type='ivss_vehicle_event'.
 * Ràng buộc: plateNumber filter qua normalizePlate (UC1) TRƯỚC khi so (DB lưu đã normalize).
 * SEC-03 bind tham số. KHÔNG dùng VehicleRegistrationService.
 */
@Injectable()
export class VehicleHistoryService {
  constructor(private readonly dataSource: DataSource) {}

  /** USER: chỉ event matched của current user. Output KHÔNG userId. */
  async listForUser(
    userId: string,
    query: ListVehicleHistoryQueryDto,
  ): Promise<{ items: VehicleHistoryItem[]; meta: PaginationMeta }> {
    const params: unknown[] = [userId];
    let where = `event_type = '${EVENT_TYPE}' AND payload_json->>'userId' = $1`;
    where = this.applyFilters(query, params, where);
    return this.paginate(where, params, query, false);
  }

  /** ADMIN: tất cả event vehicle (matched + unmatched). Output CÓ userId. */
  async listAll(
    query: ListVehicleHistoryQueryDto,
  ): Promise<{ items: VehicleHistoryItem[]; meta: PaginationMeta }> {
    const params: unknown[] = [];
    let where = `event_type = '${EVENT_TYPE}'`;
    if (query.matchState) {
      params.push(query.matchState);
      where += ` AND payload_json->>'matchState' = $${params.length}`;
    }
    where = this.applyFilters(query, params, where);
    return this.paginate(where, params, query, true);
  }

  /** Filter động (mutate params): from/to/direction/plateNumber(normalized). Bind index tiếp nối. */
  private applyFilters(
    query: ListVehicleHistoryQueryDto,
    params: unknown[],
    where: string,
  ): string {
    if (query.from) {
      params.push(query.from);
      where += ` AND event_time >= $${params.length}`;
    }
    if (query.to) {
      params.push(query.to);
      where += ` AND event_time <= $${params.length}`;
    }
    if (query.direction) {
      params.push(query.direction);
      where += ` AND payload_json->>'direction' = $${params.length}`;
    }
    if (query.plateNumber) {
      // Ràng buộc: normalize TRƯỚC khi so (DB lưu đã normalize từ UC4/UC5).
      params.push(normalizePlate(query.plateNumber));
      where += ` AND payload_json->>'plateNumber' = $${params.length}`;
    }
    return where;
  }

  private async paginate(
    where: string,
    params: unknown[],
    query: ListVehicleHistoryQueryDto,
    includeUserId: boolean,
  ): Promise<{ items: VehicleHistoryItem[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    // total: COUNT cùng WHERE (KHÔNG limit/offset).
    const countRows: CountRow[] = await this.dataSource.manager.query(
      `SELECT COUNT(*)::int AS total FROM iot_device_events WHERE ${where}`,
      params,
    );
    const total = countRows[0]?.total ?? 0;

    // rows: limit/offset SAU filter params → bind index liên tục.
    const userIdCol = includeUserId
      ? `, payload_json->>'userId' AS user_id`
      : '';
    const rows: HistoryRow[] = await this.dataSource.manager.query(
      `SELECT payload_json->>'plateNumber'        AS plate_number,
              (payload_json->>'channelId')::int   AS channel_id,
              payload_json->>'direction'          AS direction,
              payload_json->>'matchState'         AS match_state,
              event_time,
              payload_json->>'utc'                AS utc${userIdCol}
         FROM iot_device_events
        WHERE ${where}
        ORDER BY event_time DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      items: rows.map((r) => {
        const item: VehicleHistoryItem = {
          plateNumber: r.plate_number,
          channelId: r.channel_id,
          direction: r.direction,
          matchState: r.match_state,
          eventTime: r.event_time,
          utc: r.utc,
        };
        if (includeUserId) item.userId = r.user_id ?? null;
        return item;
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
