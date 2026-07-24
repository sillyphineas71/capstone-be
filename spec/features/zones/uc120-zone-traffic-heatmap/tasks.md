# ZTH-001 — tasks.md (UC-120 Zones / SAVP: phân tích lưu lượng + heatmap khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks ZTH-001: T0 verify tiên quyết UC-126 → T1 service (getTraffic/relativeDensity/validateRange) → T1b test → T2 DTO+controller → T3 migration permission → T-GATE. | Toàn bộ |

> Map: spec.md, plan.md. **Điều kiện tiên quyết: `../uc126-campus-dashboard/` xong trước (module `campus-dashboard` + `CampusDashboardRepository` đã tồn tại).**

## Thứ tự
T0 → T1 → T1b → T2 → T3 → T-GATE.

---

## T0 — RECON-verify + xác nhận tiên quyết — plan §0
- Xác nhận `CampusDashboardRepository.loadZoneHierarchy` tồn tại thật (từ UC-126); xác nhận cú pháp QueryBuilder raw aggregate (`date_trunc`, `GROUP BY`) hoạt động đúng với TypeORM version repo đang dùng.
- **AC**: dán xác nhận đủ; thiếu tiên quyết → **DỪNG**.

## T1 — Service `ZoneTrafficHeatmapService` (code) — plan §3
- `getTraffic`, `validateRange`, tính `relativeDensity`.
- **AC**: `series` group đúng theo giờ; `heatmap` group đúng theo zone (toàn range); `relativeDensity` không NaN khi mọi `peakOccupancy=0`.

## T1b — Test — plan §8
- Đủ case: range >31 ngày, filter không khớp zone nào, relativeDensity tính đúng (nhiều zone), tất cả peak=0, coordinates luôn null.
- **AC**: toàn bộ nhánh xanh; coverage ≥80%.

## T2 — DTO + Controller (code) — plan §4, §5
- `QueryZoneTrafficDto`, `TrafficResponseDto` (+ nested), `ZoneTrafficHeatmapController`, thêm vào `campus-dashboard.module.ts`.
- **AC**: route `GET /api/v1/campus-dashboard/zones/traffic` hoạt động; guard/permission đúng.

## T3 — Migration seed permission (code) — plan §6
- `20260723000010-SeedCampusDashboardTrafficPermission.ts`.
- **AC**: mirror đúng cấu trúc migration UC-119; KHÔNG chạy thật.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh (UC-126+119+120 cùng module, KHÔNG hồi quy); coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật, KHÔNG commit.
- In: code 7 file mới + 1 file modified + jest + coverage + báo cáo gate.
- **Owed**: tọa độ BLOCKED (kế thừa UC-126) · `groupBy` tùy chỉnh (nếu cần sau).
- **AC**: bảng gate đầy đủ + báo cáo: series/heatmap đúng số liệu ✓ · relativeDensity đúng công thức + không NaN ✓ · coordinates null không lỗi ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-120
- T0 → verify tiên quyết UC-126
- T1/T1b → service getTraffic + relativeDensity
- T2 → DTO + controller
- T3 → migration permission
- T-GATE → gate + STOP + Owed

---

## Toàn Bước 4 — thứ tự code khuyến nghị (tổng hợp 4 cụm)
1. `uc126-campus-dashboard` (scaffold module `campus-dashboard`, BẮT BUỘC làm trước).
2. `uc119-zone-presence-timeline` + `uc120-zone-traffic-heatmap` — độc lập nhau, có thể code song song SAU khi (1) xong.
3. `uc121-crowd-alert` — độc lập hoàn toàn, module riêng, có thể code song song với (1)/(2)/(3) bất kỳ lúc nào (chỉ phụ thuộc UC-122/123 đã xong từ Bước 3).
