/**
 * GAW-001 / UC-105 — hằng cho writer ghi `gate_access_logs` từ sự kiện biển số.
 *
 * - `config_key` đọc từ `system_configs` (nhóm `ivss`): map channel camera → zone / hướng.
 *   Dùng CHUNG khoá với luồng khuôn mặt (một bridge IVSS gửi cả face + vehicle).
 * - `GATE_LOG_SKIPPED_REASONS`: lý do KHÔNG ghi (hoặc đã dedup) gate log, lưu vào
 *   `iot_device_events.payload_json.gateLogSkipped` để chẩn đoán (spec §9.1, QĐ-10).
 */

/** config_key `system_configs`: channel camera → zone_id (UUID). */
export const IVSS_CHANNEL_ZONE_MAP_KEY = 'ivss.channel_zone_map';

/** config_key `system_configs`: channel camera → direction (enter/leave/seen). */
export const IVSS_CHANNEL_DIRECTION_MAP_KEY = 'ivss.channel_direction_map';

/**
 * 6 lý do gate log không được ghi (5) hoặc bị dedup (1):
 * - `zone_unmapped`   — channel chưa map trong `ivss.channel_zone_map` (QĐ-2).
 * - `direction_seen`  — direction resolve ra `seen`, cổng chỉ nhị phân enter/leave (QĐ-4).
 * - `zone_not_gate`   — zone map tồn tại nhưng `zone_type != 'gate'` (QC-4, ghi qua UPDATE).
 * - `plate_too_long`  — biển chuẩn hoá > 16 ký tự, không vừa `varchar(16)` (QC-2).
 * - `bad_utc`         — `evt.utc` méo/lệch giờ (`utcFallback=true`), không có `access_time` tin cậy (QC-8).
 * - `duplicate`       — trùng `UQ_gate_logs_content` (bridge retry), dedup qua UPDATE (QC-1/A.4).
 */
export const GATE_LOG_SKIPPED_REASONS = [
  'zone_unmapped',
  'direction_seen',
  'zone_not_gate',
  'plate_too_long',
  'bad_utc',
  'duplicate',
] as const;

export type GateLogSkippedReason = (typeof GATE_LOG_SKIPPED_REASONS)[number];
