# VTS-001 — tasks.md (UC-114 Gate Access / SAVP: thống kê lưu lượng phương tiện)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | **[REVISE]** Viết lại T2/T2b theo raw SQL (`DataSource.manager.query`) thay vì QueryBuilder+entity. T0 RECON-verify đổi mục tiêu xác nhận (bảng `iot_device_events`/payload thay vì `gate_access_logs`). T1/T3/T3b/T4/T5/T-GATE cấu trúc giữ nguyên, nội dung field đổi theo spec/plan mới. | Toàn bộ (rewrite) |
| 2026-07-23 | Tạo tasks VTS-001 bản đầu (dùng `gate_access_logs`) — đã thay thế. | (đã thay thế ở dòng trên) |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Phụ thuộc module `gate-access` (GAP-001 + GAH-001) chỉ để dùng chung module wiring — KHÔNG phụ thuộc dữ liệu 2 feature đó. Mỗi task 1 AC. Code vs test tách.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T5 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận cột thật `iot_device_events`: `event_type` (varchar, KHÔNG ràng enum DB), `event_time` (timestamptz), `zone_id` (uuid nullable, LUÔN NULL cho vehicle event hiện tại), `payload_json` (jsonb, có `plateNumber/userId/channelId/direction/matchState/vehicleType/utc`). Xác nhận `direction` payload chỉ nhận `'enter'|'leave'|'seen'`. Xác nhận migration mới nhất `20260723000002` (VTS-001 vẫn dùng `20260723000003`, KHÔNG đổi). Xác nhận 4 role lõi tồn tại.
- **AC**: dán xác nhận đủ 5 mục; thiếu/sai → **DỪNG báo Thiếu Chủ**.

## T1 — DTO ×4 (code) — plan §4
- `vehicle-traffic-stats-query.dto.ts`: `from`/`to` bắt buộc ISO8601, `zone_id?`, `vehicle_type?`, `group_by?` (`@IsIn(['day','hour'])`).
- `vehicle-traffic-stats-summary.dto.ts`: `total_events/total_matched/total_unmatched/total_enter/total_leave/total_seen/unique_vehicles`.
- `vehicle-traffic-stats-bucket.dto.ts`: `bucket/enter/leave/seen`.
- `vehicle-traffic-stats-response.dto.ts`: `{summary, series}`.
- **AC**: 4 DTO đúng field theo spec §4 (đã đổi tên field so với bản `in/out` cũ).

## T2 — Service `VehicleTrafficStatsService` (code) — plan §5
- Constructor CHỈ nhận `DataSource` (KHÔNG `@InjectRepository`).
- `buildWhere(query)`: `event_type = 'ivss_vehicle_event'` là điều kiện ĐẦU, `event_time BETWEEN`, optional `zone_id`/`payload_json->>'vehicleType'`, bind param nối tiếp.
- `getStats(query)`: validate `from<=to` → 400; raw SQL summary (`COUNT(*) FILTER`) + raw SQL series (`GROUP BY bucket, direction`) → `pivotSeries`.
- `bucketExpr(groupBy)`: 2 nhánh cố định.
- `pivotSeries(rawRows)`: gộp `enter/leave/seen` theo bucket, thiếu = 0.
- **AC**: 1 method public + 2 helper private; `event_type='ivss_vehicle_event'` LUÔN có mặt; KHÔNG `@InjectRepository` nào trong file.

## T2b — Service test (mock `DataSource.manager.query`) — plan §9
- `getStats`: `from > to` → 400, KHÔNG gọi `manager.query`.
- `buildWhere`: filter `zoneId`/`vehicleType` đúng khi có/không; param index đúng thứ tự.
- `bucketExpr`: 2 nhánh, KHÔNG nhánh thứ 3.
- `pivotSeries`: bucket thiếu 1-2 hướng → 0; không dữ liệu → summary 0/series rỗng, KHÔNG throw.
- **AC**: toàn bộ nhánh xanh; assert `event_type='ivss_vehicle_event'` có mặt trong CẢ HAI raw query (summary + series).

## T3 — Controller `VehicleTrafficStatsController` (code) — plan §6
- `@Controller('gate-access/admin')`. `@Get('vehicle-traffic-stats')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('gate_access.stats.read')` → envelope `{success, message, data:{summary, series}}`, KHÔNG `meta`.
- **AC**: route đúng method/path/guard/permission — KHÔNG đổi so với bản trước (route/permission giữ nguyên dù đổi nguồn dữ liệu).

## T3b — Controller test (mock service + mock guard) — plan §9
- Route gọi đúng service method; guard + permission string đúng.
- **AC**: assert guard/permission; envelope đúng shape.

## T4 — Migration permission (code) — plan §7 — KHÔNG đổi nội dung so với bản trước
- `20260723000003-SeedGateAccessStatsReadPermission.ts`: GIỮ NGUYÊN nội dung (permission `gate_access.stats.read`, 3 role).
- **AC**: `up()` idempotent; `down()` chỉ xóa permission này (không đổi từ bản trước).

## T5 — Wiring `gate-access.module.ts` (code) — plan §3
- Thêm `VehicleTrafficStatsService`/`VehicleTrafficStatsController`. `imports` KHÔNG đổi.
- **AC**: `AppModule` compile được (DI-proof).

## T-GATE — (STOP, KHÔNG commit) — plan §10
- build=0; eslint file mới/touched 0 warning mới; `npx jest src/modules/gate-access` xanh (GAP-001/GAH-001 KHÔNG hồi quy); coverage **≥80%** file mới; DI-proof compile `AppModule`. **KHÔNG live, KHÔNG DB thật, KHÔNG commit.**
- In: code đầy đủ 7 file mới + 1 file modified + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: báo Hải sửa `VehicleResolveService` ghi `zone_id` · cache/pre-aggregate · UC-128 renderer · channelId→zone mapping thay thế.
- **AC**: bảng gate đầy đủ + báo cáo: nguồn đúng `iot_device_events`/`ivss_vehicle_event` ✓ · `from>to` chặn 400 ✓ · filter zone/vehicle_type đúng cú pháp (dù zone hiện luôn rỗng, đã ghi residual) ✓ · vocabulary enter/leave/seen đúng, KHÔNG lẫn in/out ✓ · group_by 2 nhánh cố định, không SQL injection ✓ · route admin-gated đúng permission (GIỮ NGUYÊN) ✓ · GAP-001/GAH-001 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-114
- T0 → verify RECON đủ để code (bảng/payload mới)
- T1 → 4 DTO (field đổi tên theo vocabulary enter/leave/seen)
- T2/T2b → service raw SQL (buildWhere/getStats/bucketExpr/pivotSeries)
- T3/T3b → controller 1 route (route/permission KHÔNG đổi)
- T4 → migration permission (KHÔNG đổi nội dung)
- T5 → wiring module
- T-GATE → gate + STOP + Owed (báo Hải sửa zone_id)
