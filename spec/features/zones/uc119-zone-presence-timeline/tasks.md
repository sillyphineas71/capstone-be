# ZPT-001 — tasks.md (UC-119 Zones / SAVP: timeline & thời gian lưu lại theo khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks ZPT-001: T0 verify tiên quyết UC-126 → T1 service (getTimeline/pairEnterExit/validateRange) → T1b test → T2 DTO+controller → T3 migration permission → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md. **Điều kiện tiên quyết: `../uc126-campus-dashboard/` xong trước (module `campus-dashboard` đã tồn tại).**

## Thứ tự
T0 → T1 → T1b → T2 → T3 → T-GATE.

---

## T0 — RECON-verify + xác nhận tiên quyết — plan §0
- Xác nhận `campus-dashboard.module.ts` tồn tại thật (build/test xanh từ UC-126).
- **AC**: dán xác nhận đủ; thiếu tiên quyết → **DỪNG**.

## T1 — Service `ZonePresenceTimelineService` (code) — plan §3
- `getTimeline`, `pairEnterExit`, `validateRange`.
- **AC**: 3 method; `pairEnterExit` đúng thuật toán FIFO đè-enter-mới (spec §2.3); range >31 ngày bị chặn.

## T1b — Test — plan §8
- Đủ case `pairEnterExit` (đơn/nhiều cặp, enter cuối ongoing, enter đè enter) + `getTimeline` (404 zone, 400 range, EX1 rỗng, có/không userId, personDataAvailable).
- **AC**: toàn bộ nhánh xanh; coverage ≥80%.

## T2 — DTO + Controller (code) — plan §4, §5
- `QueryZoneTimelineDto`, `ZoneTimelineResponseDto`, `ZonePresenceTimelineController`, thêm vào `campus-dashboard.module.ts`.
- **AC**: route `GET /api/v1/campus-dashboard/zones/:zoneId/timeline` hoạt động; guard/permission đúng.

## T3 — Migration seed permission (code) — plan §6
- `20260723000009-SeedCampusDashboardTimelinePermission.ts`.
- **AC**: mirror đúng cấu trúc migration UC-126; KHÔNG chạy thật.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh (UC-126+UC-119 cùng module, KHÔNG hồi quy); coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code 7 file mới + 1 file modified + jest + coverage + báo cáo gate.
- **Owed**: residual ghép cặp giới hạn trong tập kết quả (spec §6).
- **AC**: bảng gate đầy đủ + báo cáo: 404/400/EX1 đúng ✓ · ghép cặp FIFO đúng ✓ · personDataAvailable đúng BR1 ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-119
- T0 → verify tiên quyết UC-126
- T1/T1b → service getTimeline + pairEnterExit
- T2 → DTO + controller
- T3 → migration permission
- T-GATE → gate + STOP + Owed
