/**
 * VehicleTrafficStatsSummaryDto (VTS-001 / UC-114) — tổng hợp trên `iot_device_events`
 * (`event_type='ivss_vehicle_event'`). Vocabulary `enter/leave/seen` — ĐÚNG payload thật
 * (KHÔNG dùng `in/out` của `gate_access_logs`).
 */
export class VehicleTrafficStatsSummaryDto {
  total_events: number;
  total_matched: number;
  total_unmatched: number;
  total_enter: number;
  total_leave: number;
  total_seen: number;
  unique_vehicles: number;
}
