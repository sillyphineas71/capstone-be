/**
 * ZPW-001 / UC-109 — hằng cho writer ghi `zone_presence_events` (vòng `appear`).
 *
 * - `config_key` đọc từ `system_configs`: map channel camera KHU VỰC → zone (UUID).
 *   KEY RIÊNG với `ivss.channel_zone_map` (UC-105, cổng) — camera một-vai-một-channel (QĐ-2).
 * - `PRESENCE_ZONE_TYPES`: loại zone hợp lệ cho `appear` (QC-5) — chỉ khu vực, KHÔNG gate/room.
 * - `PRESENCE_SKIPPED_REASONS`: lý do KHÔNG ghi presence, lưu vào
 *   `iot_device_events.payload_json.presenceSkipped` để chẩn đoán (giống `gateLogSkipped` UC-105).
 */

/** config_key `system_configs`: channel camera khu vực → zone_id (UUID). */
export const IVSS_CHANNEL_PRESENCE_ZONE_MAP_KEY =
  'ivss.channel_presence_zone_map';

/** Loại zone chấp nhận cho `appear` (QC-5). Gate/room bị từ chối → zone_wrong_type. */
export const PRESENCE_ZONE_TYPES = ['corridor', 'lobby', 'parking'] as const;
export type PresenceZoneType = (typeof PRESENCE_ZONE_TYPES)[number];

/**
 * 3 lý do không ghi `appear` (còn hiệu lực):
 * - `zone_unmapped`       — channel chưa có key trong `channel_presence_zone_map` (QĐ-2).
 * - `bad_utc`             — `evt.utc` méo/lệch (`utcFallback=true`), không có `event_time` tin cậy.
 * - `zone_wrong_type`     — zone map trỏ tồn tại nhưng `zone_type ∉ PRESENCE_ZONE_TYPES` (QC-5).
 *
 * [FIX 2026-08-19] `unmatched_identity` KHÔNG còn được set nữa — trước đây userId=null (người
 * lạ hoàn toàn) bị chặn không cho ghi `appear` với lý do "restricted-zone coi NULL = vi phạm",
 * nhưng điều đó lại khiến `isViolation()` không bao giờ nhận được input null để đánh giá (mâu
 * thuẫn logic). Giờ mirror đúng hành vi Room: userId=null vẫn ghi `appear` (userId=null),
 * restricted-zone-intrusion tự xử lý null đúng như code đã sẵn có. Giữ lại giá trị trong union
 * type/mảng bên dưới để không phá kiểu dữ liệu cũ đang lưu trong `iot_device_events.payload_json`
 * (dữ liệu lịch sử trước fix vẫn có thể mang giá trị này).
 */
export const PRESENCE_SKIPPED_REASONS = [
  'zone_unmapped',
  'unmatched_identity',
  'bad_utc',
  'zone_wrong_type',
] as const;
export type PresenceSkippedReason = (typeof PRESENCE_SKIPPED_REASONS)[number];
