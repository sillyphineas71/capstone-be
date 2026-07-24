# CDB-001 — tasks.md (UC-126 Zones / SAVP: dashboard điều hành khuôn viên)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks CDB-001: T0 verify → T1 module scaffold → T2 repository → T3 pure functions + test → T4 service → T5 DTO+controller → T6 migration permission → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md. Module `campus-dashboard` là NỀN TẢNG cho UC-119/120 — code cụm này TRƯỚC.

## Thứ tự
T0 → T1 → T2 → T3 → T4 → T5 → T6 → T-GATE.

---

## T0 — RECON-verify — plan §0
- Xác nhận entity/enum path thật (`ZoneEntity`, `ZonePresenceEventEntity`, `GateAccessLogEntity`, `IoTDeviceEntity`, `IoTDeviceType`, `IoTDeviceStatus`); `AuthModule` guard/decorator import path; `SystemConfigEntity` path.
- **AC**: dán xác nhận đủ; thiếu → **DỪNG**.

## T1 — Module `campus-dashboard` (code) — plan §3
- `campus-dashboard.module.ts`, `forFeature` 4 entity, import `AuthModule`.
- **AC**: module compile độc lập (chưa cần controller thật, có thể để rỗng tạm rồi bổ sung ở T5).

## T2 — Repository `CampusDashboardRepository` (code) — plan §4
- `loadZoneHierarchy`, `loadLatestCountEvent`, `loadDevicesByZone`, `countGateLogsToday`, `loadStalenessMinutes`.
- **AC**: 5 method, dùng đúng `IDX_zpe_count` cho `loadLatestCountEvent` (order `eventTime DESC` + `take(1)`, KHÔNG full-scan).

## T3 — Pure functions + test — plan §6, §11
- `resolveOccupancyStatus`, `resolveCameraStatus` + `.spec.ts` đủ nhánh.
- **AC**: coverage 100% 2 file util (thuần logic, không side-effect, dễ đạt 100%); đủ 4 nhánh mỗi hàm như spec §11.

## T4 — Service `DashboardOverviewService` (code) — plan §5
- `getOverview`, group Building→Floor→Zone, gọi repository + pure function.
- **AC**: filter `building`/`floor` hoạt động đúng; `coordinates` luôn `null`; test mock repo đủ case.

## T5 — DTO + Controller (code) — plan §7, §8
- `QueryDashboardOverviewDto`, `DashboardOverviewResponseDto` (+ nested DTO), `DashboardOverviewController` với guard/permission.
- **AC**: route `GET /api/v1/campus-dashboard/overview` hoạt động (test controller mock service); 403 khi thiếu quyền.

## T6 — Migration seed permission (code) — plan §9
- `20260723000008-SeedCampusDashboardOverviewPermission.ts`, gán role Admin/Manager (KHÔNG Employee).
- **AC**: mirror đúng cấu trúc `SeedZoneReadPermission`; KHÔNG chạy migration thật ở bước này (chỉ viết code, "KHÔNG DB thật" theo kỷ luật chung).

## T-GATE — (STOP, KHÔNG commit) — plan §12
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code 10 file mới + 1 file modified + jest + coverage + báo cáo gate.
- **Owed**: gửi Hải đề nghị cột tọa độ `zones` · seed permission + verify RDS thật (đợt sau, sau khi Thiếu Chủ duyệt code).
- **AC**: bảng gate đầy đủ + báo cáo: occupancy status đúng thuật toán kết hợp ✓ · cameraStatus literal đúng ✓ · gateTraffic đếm raw logs ✓ · coordinates luôn null (không lỗi) ✓ · permission gate đúng ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-126
- T0 → verify RECON
- T1 → module scaffold (nền tảng UC-119/120)
- T2 → repository dùng chung
- T3 → pure functions (occupancy/camera status)
- T4 → service getOverview
- T5 → DTO + controller
- T6 → migration permission
- T-GATE → gate + STOP + Owed
