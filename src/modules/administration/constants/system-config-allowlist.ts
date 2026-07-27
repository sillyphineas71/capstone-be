import { SystemConfigValueType } from '../entities/system-config.entity.js';

/**
 * SYSTEM_CONFIG_ALLOWLIST (BE-09) — nguồn sự thật DUY NHẤT cho 9 key phẳng mà FE
 * `SystemSettings.jsx` quản trị (`SystemSettings.jsx:28-38`).
 *
 * [Quyết định 2026-07-27, PLAN_THUC_THI_P1 §0.2/§1] Đây là hệ tên key THỨ HAI, độc
 * lập với 5 key có dấu chấm mà BE nội bộ đọc trực tiếp (`no_show.auto_release_enabled`,
 * `recording.retention_days_default`, `org.timezone_default`,
 * `gate_access.closing_hour_local`, `analytics.dashboard_max_range_days`) — 2 hệ tên
 * KHÔNG được trộn lẫn. Endpoint `/system-configurations` (controller mới) CHỈ đọc/ghi
 * đúng 9 key trong allowlist này; key ngoài allowlist → 400. KHÔNG đụng 5 key chấm sẵn
 * có — đang được `dashboard-overview-config.service.ts`, `gate-log-pairing.service.ts`
 * và no-show detection đọc qua service riêng của chúng.
 */
export interface SystemConfigAllowlistEntry {
  key: string;
  valueType: SystemConfigValueType.BOOLEAN | SystemConfigValueType.NUMBER;
  configGroup: string;
  description: string;
  /** Chỉ áp dụng cho valueType=NUMBER. */
  min?: number;
  max?: number;
  defaultValue: string;
}

export const SYSTEM_CONFIG_ALLOWLIST: readonly SystemConfigAllowlistEntry[] = [
  {
    key: 'is_auto_release_enabled',
    valueType: SystemConfigValueType.BOOLEAN,
    configGroup: 'no_show',
    description: 'Bật/tắt tự động giải phóng phòng khi phát hiện no-show',
    defaultValue: 'true',
  },
  {
    key: 'no_show_threshold_minutes',
    valueType: SystemConfigValueType.NUMBER,
    configGroup: 'no_show',
    description: 'Số phút chờ trước khi đánh dấu no-show',
    min: 1,
    max: 120,
    defaultValue: '10',
  },
  {
    key: 'grace_minutes',
    valueType: SystemConfigValueType.NUMBER,
    configGroup: 'no_show',
    description: 'Thời gian ân hạn (đếm ngược cảnh báo) trước khi giải phóng phòng',
    min: 1,
    max: 120,
    defaultValue: '5',
  },
  {
    key: 'is_early_release_enabled',
    valueType: SystemConfigValueType.BOOLEAN,
    configGroup: 'room_utilization',
    description: 'Bật/tắt phát hiện phòng trống sớm (early vacancy)',
    defaultValue: 'true',
  },
  {
    key: 'early_departure_threshold_minutes',
    valueType: SystemConfigValueType.NUMBER,
    configGroup: 'room_utilization',
    description: 'Ngưỡng phút để phát hiện phòng trống sớm',
    min: 1,
    max: 120,
    defaultValue: '10',
  },
  {
    key: 'is_host_warning_enabled',
    valueType: SystemConfigValueType.BOOLEAN,
    configGroup: 'meeting',
    description: 'Bật/tắt cảnh báo cho host khi cuộc họp có vấn đề',
    defaultValue: 'true',
  },
  {
    key: 'recording_retention_days',
    valueType: SystemConfigValueType.NUMBER,
    configGroup: 'recording',
    description: 'Số ngày lưu trữ file ghi âm/ghi hình trước khi xóa',
    min: 1,
    max: 3650,
    defaultValue: '90',
  },
  {
    key: 'is_recording_consent_required',
    valueType: SystemConfigValueType.BOOLEAN,
    configGroup: 'recording',
    description: 'Bắt buộc xin sự đồng ý trước khi ghi âm/ghi hình',
    defaultValue: 'true',
  },
  {
    key: 'overrun_grace_minutes',
    valueType: SystemConfigValueType.NUMBER,
    configGroup: 'meeting',
    description: 'Thời gian ân hạn (phút) trước khi coi cuộc họp là quá giờ',
    min: 1,
    max: 120,
    defaultValue: '10',
  },
] as const;

export const SYSTEM_CONFIG_ALLOWED_KEYS: readonly string[] =
  SYSTEM_CONFIG_ALLOWLIST.map((e) => e.key);

export function findAllowlistEntry(
  key: string,
): SystemConfigAllowlistEntry | undefined {
  return SYSTEM_CONFIG_ALLOWLIST.find((e) => e.key === key);
}
