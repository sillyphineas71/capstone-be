import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { normalizePlate } from '../utils/normalize-plate.js';
import type { ListVehicleHistoryQueryDto } from '../dto/list-vehicle-history-query.dto.js';

interface HistoryRow {
  id: string;
  plate_number: string | null;
  channel_id: number | null;
  direction: string | null;
  match_state: string | null;
  event_time: Date;
  utc: string | null;
  is_blacklisted: boolean;
  list_type: string | null;
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
  /** iot_device_events.id — FE dùng để gọi GET ivss/device-events/:id/snapshot (404 nếu không có ảnh). */
  id: string;
  plateNumber: string | null;
  channelId: number | null;
  direction: string | null;
  matchState: string | null;
  eventTime: Date;
  utc: string | null;
  /**
   * true nếu event này có 1 security_alerts.alert_type='vehicle_control_match' gắn qua
   * source_event_id (recon 2026-08-08, R1-R3). GIỚI HẠN ĐÃ BIẾT: evaluate() throttle
   * 300s/plate (vehicle-control-alert.service.ts) — sự kiện bị throttle trong cùng cửa
   * sổ sẽ có isBlacklisted=false dù xe thực sự đang trong control-list (không có alert
   * riêng gắn với event_id của chính nó). KHÔNG cố sửa throttle ở đây.
   */
  isBlacklisted: boolean;
  /** security_alerts.payload_json->>'listType' ('blocklist'|'watchlist'); null nếu isBlacklisted=false. */
  listType: string | null;
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
 *
 * isBlacklisted/listType (recon 2026-08-08, R1-R3): LEFT JOIN security_alerts qua FK
 * source_event_id → iot_device_events.id (KHÔNG match theo plateNumber+thời gian).
 * KHÔNG đụng luồng ghi (onVehicleEvent()/evaluate() — vehicle-control-alert.service.ts)
 * — chỉ sửa tầng đọc. Giới hạn ĐÃ BIẾT, KHÔNG cố sửa ở đây: evaluate() throttle 300s/plate
 * → sự kiện bị throttle trong cùng cửa sổ có isBlacklisted=false dù xe đang trong
 * control-list (alert gắn với event_id của lần match GẦN NHẤT trước đó, không phải event
 * này). COUNT query (paginate()) KHÔNG cần JOIN (isBlacklisted không phải filter, chỉ
 * hiển thị) — `where` dùng chung cho cả COUNT lẫn rows nên PHẢI prefix
 * `iot_device_events.` trên MỌI cột (bắt buộc cho id/payload_json vì security_alerts
 * cũng có 2 cột cùng tên — để trần sau JOIN sẽ ném lỗi ambiguous; giữ prefix luôn cho
 * event_type/event_time để nhất quán, dù 2 cột đó hiện chưa trùng tên).
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
    let where = `iot_device_events.event_type = '${EVENT_TYPE}' AND iot_device_events.payload_json->>'userId' = $1`;
    where = this.applyFilters(query, params, where);
    return this.paginate(where, params, query, false);
  }

  /** ADMIN: tất cả event vehicle (matched + unmatched). Output CÓ userId. */
  async listAll(
    query: ListVehicleHistoryQueryDto,
  ): Promise<{ items: VehicleHistoryItem[]; meta: PaginationMeta }> {
    const params: unknown[] = [];
    let where = `iot_device_events.event_type = '${EVENT_TYPE}'`;
    if (query.matchState) {
      params.push(query.matchState);
      where += ` AND iot_device_events.payload_json->>'matchState' = $${params.length}`;
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
      where += ` AND iot_device_events.event_time >= $${params.length}`;
    }
    if (query.to) {
      params.push(query.to);
      where += ` AND iot_device_events.event_time <= $${params.length}`;
    }
    if (query.direction) {
      params.push(query.direction);
      where += ` AND iot_device_events.payload_json->>'direction' = $${params.length}`;
    }
    if (query.plateNumber) {
      // Ràng buộc: normalize TRƯỚC khi so (DB lưu đã normalize từ UC4/UC5).
      params.push(normalizePlate(query.plateNumber));
      where += ` AND iot_device_events.payload_json->>'plateNumber' = $${params.length}`;
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
    // recon 2026-08-08 (R1-R3): LEFT JOIN security_alerts qua FK source_event_id →
    // iot_device_events.id (KHÔNG match theo plateNumber+thời gian — FK sẵn có, chính
    // xác hơn). `iot_device_events.` prefix BẮT BUỘC trên id/payload_json (KHÔNG chỉ
    // để rõ ràng) — security_alerts CŨNG có cột id + payload_json, để trần sẽ ném lỗi
    // "column reference is ambiguous" khi đã JOIN.
    const userIdCol = includeUserId
      ? `, iot_device_events.payload_json->>'userId' AS user_id`
      : '';
    const rows: HistoryRow[] = await this.dataSource.manager.query(
      `SELECT iot_device_events.id,
              iot_device_events.payload_json->>'plateNumber'        AS plate_number,
              (iot_device_events.payload_json->>'channelId')::int   AS channel_id,
              iot_device_events.payload_json->>'direction'          AS direction,
              iot_device_events.payload_json->>'matchState'         AS match_state,
              iot_device_events.event_time,
              iot_device_events.payload_json->>'utc'                AS utc,
              sa.id IS NOT NULL                                     AS is_blacklisted,
              sa.payload_json->>'listType'                          AS list_type${userIdCol}
         FROM iot_device_events
         LEFT JOIN security_alerts sa
                ON sa.source_event_id = iot_device_events.id
               AND sa.alert_type = 'vehicle_control_match'
        WHERE ${where}
        ORDER BY iot_device_events.event_time DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      items: rows.map((r) => {
        const item: VehicleHistoryItem = {
          id: r.id,
          plateNumber: r.plate_number,
          channelId: r.channel_id,
          direction: r.direction,
          matchState: r.match_state,
          eventTime: r.event_time,
          utc: r.utc,
          isBlacklisted: r.is_blacklisted,
          listType: r.list_type,
        };
        if (includeUserId) item.userId = r.user_id ?? null;
        return item;
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
