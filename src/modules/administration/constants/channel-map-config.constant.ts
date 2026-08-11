/**
 * CHANNEL_MAP_CONFIG_KEYS (F7, recon R4/R5) — 7 key `system_configs` dạng chấm mà trước
 * đây CHỈ set được qua seed DB, chưa có API ghi. KHÔNG được gộp vào
 * `SYSTEM_CONFIG_ALLOWLIST` (system-config-allowlist.ts) — header file đó đã ghi rõ
 * "2 hệ tên key KHÔNG được trộn": allowlist quản 9 key phẳng (không dấu chấm) do FE
 * SystemSettings.jsx CRUD qua PATCH /system-configurations, còn 7 key ở đây do các
 * service nội bộ (ivss/gate-access/face-access) đọc trực tiếp — trộn vào sẽ vỡ ranh giới
 * đã document. Thêm lý do kỹ thuật: 4 key map đọc cột `config_json` (jsonb), trong khi
 * `SystemConfigService.upsert()` hiện CHỈ ghi cột `config_value` (text) — ghi qua allowlist
 * sẽ không có tác dụng gì với các reader thật.
 *
 * Endpoint riêng: GET/PATCH /system-configurations/channel-maps
 * (ChannelMapConfigController/Service) — KHÔNG đụng SystemConfigController/Service.
 *
 * 2 loại value:
 * - 'map'      → config_json = {"<channelId số>": "<uuid|direction>"}
 * - 'threshold' → config_value = "<số nguyên dương>"
 */

export type ChannelMapConfigKind = 'map' | 'threshold';

/** Loại giá trị bên trong 1 map — quyết định cách validate từng entry. */
export type MapEntryKind = 'room_uuid' | 'zone_uuid' | 'direction';

export interface ChannelMapConfigEntry {
  key: string;
  kind: ChannelMapConfigKind;
  /** Chỉ áp dụng khi kind='map'. */
  mapEntryKind?: MapEntryKind;
  configGroup: string;
  description: string;
  /**
   * [FIX 2026-08-11] Key map ĐỐI NGHỊCH — 1 channel KHÔNG được xuất hiện đồng thời ở CẢ
   * key này lẫn `conflictsWithKey` (1 camera chỉ nên đóng 1 vai: phòng họp HOẶC khu vực
   * hiện diện). Khai 2 CHIỀU (cả 2 entry trỏ nhau) để `ChannelMapConfigService` chặn được
   * dù admin sửa key nào trước. Trước đây chỉ có `logger.warn()` lúc ĐỌC ở
   * `ivss-presence-ingestion.service.ts` — đây là chặn LƯU tại nguồn, không thay thế WARN
   * đó (vẫn giữ làm lưới bắt bù dữ liệu cũ trót ghi trước khi có validate này).
   */
  conflictsWithKey?: string;
}

export const CHANNEL_MAP_CONFIG_ENTRIES: readonly ChannelMapConfigEntry[] = [
  {
    key: 'ivss.channel_room_map',
    kind: 'map',
    mapEntryKind: 'room_uuid',
    configGroup: 'ivss',
    conflictsWithKey: 'ivss.channel_presence_zone_map',
    description:
      'Channel camera IVSS → phòng họp (room_id). Đọc bởi ivss-occupancy-ingest.service.ts, ivss-presence-ingestion.service.ts.',
  },
  {
    key: 'ivss.channel_direction_map',
    kind: 'map',
    mapEntryKind: 'direction',
    configGroup: 'ivss',
    description:
      'Channel camera IVSS → hướng đi cổng (enter/leave/seen). Đọc bởi vehicle-resolve.service.ts, ivss-presence-ingestion.service.ts.',
  },
  {
    key: 'ivss.channel_presence_zone_map',
    kind: 'map',
    mapEntryKind: 'zone_uuid',
    configGroup: 'ivss',
    conflictsWithKey: 'ivss.channel_room_map',
    description:
      'Channel camera IVSS → zone hiện diện (zone_id). Đọc bởi ivss-presence-ingestion.service.ts, ivss-occupancy-ingest.service.ts, vehicle-control-alert.service.ts.',
  },
  {
    key: 'ivss.channel_zone_map',
    kind: 'map',
    mapEntryKind: 'zone_uuid',
    configGroup: 'ivss',
    description:
      'Channel camera IVSS → zone cổng (zone_id). Đọc bởi vehicle-resolve.service.ts (gate).',
  },
  {
    key: 'ivss.presence.gap_threshold_seconds',
    kind: 'threshold',
    configGroup: 'ivss',
    description:
      'Ngưỡng (giây) gộp phiên hiện diện trong 1 cuộc họp. Đọc bởi ivss-presence-query.service.ts. Mặc định code 120.',
  },
  {
    key: 'campus.journey.gap_threshold_seconds',
    kind: 'threshold',
    configGroup: 'campus',
    description:
      'Ngưỡng (giây) gộp phiên hành trình trong ngày. Đọc bởi user-journey.service.ts. Mặc định code 600. KHÔNG dùng chung với ivss.presence.*.',
  },
  {
    key: 'attendance.late_grace_minutes',
    kind: 'threshold',
    configGroup: 'attendance',
    description:
      'Số phút ân hạn trước khi điểm danh bằng khuôn mặt bị tính muộn. Đọc bởi face-attendance.service.ts.',
  },
] as const;

export const CHANNEL_MAP_CONFIG_KEYS: readonly string[] =
  CHANNEL_MAP_CONFIG_ENTRIES.map((e) => e.key);

export function findChannelMapConfigEntry(
  key: string,
): ChannelMapConfigEntry | undefined {
  return CHANNEL_MAP_CONFIG_ENTRIES.find((e) => e.key === key);
}
