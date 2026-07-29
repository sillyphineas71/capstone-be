# CDB-RS-001 — tasks.md (Zones / campus-dashboard: Tổng hợp dashboard theo vai trò)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo tasks CDB-RS-001: T0 verify → T1 repository mới → T2 service manager-summary → T3 service employee-summary → T4 service business-admin-summary → T5 DTO+controller (3 endpoint) → T6 module wiring → T7 migration ×3 → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md. Module `campus-dashboard` ĐÃ TỒN TẠI (CDB-001/UC-119/UC-120) — feature này CHỈ mở rộng, KHÔNG scaffold lại.

## Thứ tự
T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T-GATE.

---

## T0 — RECON-verify — plan §0
- Xác nhận entity/path thật export được từ module gốc: `UserEntity` (accounts), `MeetingRequestEntity`+`DepartmentEntity` (meetings/accounts), `AttendanceRecordEntity`+`MeetingEntity`+`MeetingParticipantEntity` (meetings/attendance), `SecurityAlertEntity` (alerts), `VehicleRegistrationEntity` (anpr).
- Xác nhận tên cột thật: `meeting_participants.is_required` (hay tên khác?) dùng cho on-time §5.1.3; enum `MeetingStatus`/cột status thật của `meetings` (loại `cancelled` khỏi `meetingsToday`).
- Xác nhận `system_configs` đã có key `analytics.on_time_grace_minutes` chưa (SELECT thật hoặc đọc migration seed liên quan) — quyết định fallback `0` áp dụng nếu chưa có.
- `ls src/database/migrations | sort | tail` lại để xác nhận timestamp `20260729000003` chưa bị chiếm.
- **AC**: dán xác nhận đủ (path + tên cột + timestamp) trước khi sang T1; thiếu bất kỳ mục nào → **DỪNG**, hỏi lại Thiếu Chủ thay vì đoán.

## T1 — `CampusDashboardRepository` — thêm 2 method — plan §4.1
- `loadAllZonesWithLatestOccupancy()`, `countGateLogsAllZonesToday(direction, startOfDay)`.
- **AC**: 2 method mới, KHÔNG sửa method cũ đã có (`loadZoneHierarchy` v.v. giữ nguyên); test mock repo xác nhận không phá test cũ của CDB-001/119/120 (`npx jest src/modules/campus-dashboard/repositories` xanh trước/sau).

## T2 — `ManagerSummaryService` (code + test) — plan §5.1
- `getSummary(managerId)`: `teamPresenceToday`, `pendingMeetingRequestsCount` (2 nhánh điều kiện, DISTINCT không đếm trùng), `onTimeRateThisWeek` (đọc `system_configs` fallback 0, tính đúng công thức, `sampleSize=0` an toàn), `teamZoneSecurityAlerts` cố định `{value:null, note:'not_available'}`.
- **AC**: đủ test case ở plan §11 (team rỗng, pending 2 nhánh không trùng lặp, sampleSize=0 không chia 0/không NaN).

## T3 — `EmployeeSummaryService` (code + test) — plan §5.2
- `getSummary(userId)`: `gateAccessToday` sort ASC theo `accessTime`, `vehicleStatus` (null-safe), `meetingsToday` loại `cancelled`.
- **AC**: `vehicleStatus=null` khi chưa có xe; `meetingsToday` không đếm meeting đã hủy — test riêng case này.

## T4 — `BusinessAdminSummaryService` (code + test) — plan §5.3
- `getSummary()`: `gateTrafficToday`, `securityAlertsBySeverity` (đủ 4 key kể cả `0`), `zoneOccupancy` (SUM + đếm zone có/không dữ liệu, TÁI DÙNG `resolveOccupancyStatus`), `vehicleControlHitsToday`.
- **AC**: `securityAlertsBySeverity` KHÔNG thiếu key nào dù DB không có alert mức đó; `zoneOccupancy` loại đúng zone `no_data` khỏi SUM nhưng vẫn đếm vào `totalZoneCount`.

## T5 — DTO + Controller ×3 (code + test) — plan §7, §8
- 3 DTO response, 3 controller (`manager-summary`, `employee-summary`, `business-admin-summary`), guard/permission đúng role đã chốt spec §2.1.
- **AC**: 3 route hoạt động (test controller mock service); 403 đúng khi role không khớp (test riêng case "role gần đúng" — MANAGER gọi `business-admin-summary` phải 403, KHÔNG lọt qua vì nhầm tưởng MANAGER có quyền cao hơn).

## T6 — Module wiring — plan §3
- Sửa `campus-dashboard.module.ts`: thêm `forFeature` entity mới (T0 xác nhận path), thêm 3 controller + 3 provider vào mảng hiện có.
- **AC**: `AppModule` DI-proof (compile + bootstrap test không lỗi vòng phụ thuộc); KHÔNG ảnh hưởng 3 controller/service cũ (CDB-001/119/120) — chạy lại toàn bộ `npx jest src/modules/campus-dashboard` phải xanh (cũ + mới).

## T7 — Migration seed permission ×3 (code) — plan §9
- 3 file mirror `SeedCampusDashboardOverviewPermission`, roles đúng bảng plan §9.
- **AC**: idempotent (`ON CONFLICT DO NOTHING`) đúng pattern; KHÔNG chạy migration thật ở bước này (chỉ viết code, "KHÔNG DB thật" theo kỷ luật chung).

## T-GATE — (STOP, KHÔNG commit) — plan §12
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh (toàn bộ, cũ + mới); coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: 12 file mới + 2 file modified + jest + coverage + báo cáo gate.
- **Owed**: seed permission + verify RDS thật (đợt sau) · báo Thiếu Chủ riêng gap `iot.device.read` thiếu `BUSINESS_ADMIN` (ngoài scope, xem spec §6).
- **AC**: bảng gate đầy đủ + báo cáo: `pendingMeetingRequestsCount` đúng 2-nhánh không trùng ✓ · `onTimeRateThisWeek` đúng công thức + an toàn sampleSize=0 ✓ · `zoneOccupancy` loại đúng no_data ✓ · `securityAlertsBySeverity` đủ 4 key ✓ · permission-role đúng cho cả 3 route (kể cả case role gần đúng bị chặn) ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope CDB-RS-001
- T0 → verify RECON (entity path, tên cột, system_configs key, migration timestamp)
- T1 → repository method tổng hợp toàn trường
- T2 → service manager-summary
- T3 → service employee-summary
- T4 → service business-admin-summary
- T5 → DTO + controller ×3
- T6 → wiring module (mở rộng, không tạo mới)
- T7 → migration permission ×3
- T-GATE → gate + STOP + Owed
