# ZTH-001 — plan.md (UC-120 Zones / SAVP: phân tích lưu lượng + heatmap khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ZTH-001 cùng lượt với spec. THÊM controller/service/dto vào module `campus-dashboard` — KHÔNG tạo module mới, KHÔNG DDL. | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2. **Điều kiện tiên quyết: `../uc126-campus-dashboard/` xong trước.**

## 0. RECON bổ sung
- Xác nhận `CampusDashboardRepository.loadZoneHierarchy` (UC-126) đã tồn tại thật, dùng lại NGUYÊN VẸN.
- Xác nhận cú pháp TypeORM QueryBuilder cho `date_trunc('hour', event_time)` + `GROUP BY` (raw SQL fragment qua `.select()`/`.addSelect()`/`.groupBy()`).
- 0 migration DDL, 1 migration seed permission mới.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (7 quyết định: 1 endpoint 2 hình thức, relativeDensity tương đối giữa zone, hourBucket granularity giờ, tọa độ null kế thừa UC-126, EX1 không cần logic riêng BE, range max 31 ngày, filter building/floor tái dùng repository UC-126). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi
0 thay đổi schema.

## 3. Service mới — `ZoneTrafficHeatmapService`
```
src/modules/campus-dashboard/services/zone-traffic-heatmap.service.ts
```
- Constructor: `@InjectRepository(ZonePresenceEventEntity)`, `private readonly repo: CampusDashboardRepository`.
- `async getTraffic(from, to, building?, floor?): Promise<TrafficResponseDto>`:
  1. `this.validateRange(from, to);` (COPY logic từ `ZonePresenceTimelineService.validateRange` — CÙNG hằng số 31 ngày, KHÔNG viết lại khác giá trị — cân nhắc factor ra `shared/date-range.util.ts` nếu trùng y hệt code, xem §3b).
  2. `const zones = await this.repo.loadZoneHierarchy({building, floor}); const zoneIds = zones.map(z => z.id); if (zoneIds.length === 0) return {series: [], heatmap: []};`
  3. `series` — QueryBuilder: `.select("zone_id", "zoneId").addSelect("date_trunc('hour', event_time)", "hourBucket").addSelect("AVG(occupancy_count)", "avgOccupancy").addSelect("MAX(occupancy_count)", "peakOccupancy").where("zone_id IN (:...zoneIds)", {zoneIds}).andWhere("event_type = 'count'").andWhere("event_time BETWEEN :from AND :to", {from, to}).groupBy("zone_id, hourBucket").orderBy("hourBucket", "ASC").getRawMany()`.
  4. `heatmap` (toàn range, không bucket giờ) — QueryBuilder tương tự nhưng CHỈ `GROUP BY zone_id` (bỏ `hourBucket`), thêm `MAX(event_time) FILTER (WHERE occupancy_count = peak) AS "peakAt"` (raw SQL — nếu Postgres không hỗ trợ `FILTER` trực tiếp trong 1 câu đơn giản kèm alias vừa tính, tách 2 bước: query aggregate trước, sau đó query riêng tìm `eventTime` của bản ghi có `occupancyCount = peakOccupancy` mỗi zone — quyết định cụ thể khi code, KHÔNG quan trọng về mặt spec).
  5. Tính `relativeDensity` (§2.2 spec) ở TẦNG CODE (JS), sau khi có toàn bộ `heatmap` rows: `const maxPeak = Math.max(0, ...heatmapRows.map(r => r.peakOccupancy ?? 0)); heatmapRows.map(r => ({...r, relativeDensity: maxPeak === 0 ? 0 : (r.peakOccupancy ?? 0) / maxPeak, coordinates: null}))`.
  6. Trả `{series, heatmap}`.
- `private validateRange(from, to): void` — mirror `ZonePresenceTimelineService.validateRange` (31 ngày) — quyết định KHÔNG factor chung ở đợt này (2 file nhỏ, trùng lặp chấp nhận được, tránh over-engineer 1 helper dùng 2 chỗ theo nguyên tắc "3 dòng tương tự tốt hơn abstraction sớm").

## 4. DTO
```
src/modules/campus-dashboard/dto/query-zone-traffic.dto.ts     (from, to bắt buộc; building?, floor? optional)
src/modules/campus-dashboard/dto/zone-traffic-response.dto.ts  (TrafficSeriesPointDto, ZoneHeatmapDto, TrafficResponseDto)
```

## 5. Controller — thêm route vào module `campus-dashboard`
```
src/modules/campus-dashboard/controllers/zone-traffic-heatmap.controller.ts
```
- `GET /api/v1/campus-dashboard/zones/traffic` — `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('campus_dashboard.traffic.read')`, `@Query() query: QueryZoneTrafficDto`.
- Đăng ký thêm vào `controllers: []` của `campus-dashboard.module.ts` (đã có `DashboardOverviewController` + `ZonePresenceTimelineController`, THÊM `ZoneTrafficHeatmapController`).

## 6. Migration mới — seed permission
```
src/database/migrations/20260723000010-SeedCampusDashboardTrafficPermission.ts
```
- Mirror migration UC-119 (`...000009`), seed `campus_dashboard.traffic.read`, role Admin/Manager.

## 7. File list
### Net-new (7 file)
- `src/modules/campus-dashboard/services/zone-traffic-heatmap.service.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/controllers/zone-traffic-heatmap.controller.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/dto/query-zone-traffic.dto.ts`
- `src/modules/campus-dashboard/dto/zone-traffic-response.dto.ts`
- `src/database/migrations/20260723000010-SeedCampusDashboardTrafficPermission.ts`
### Modified (1 file)
- `src/modules/campus-dashboard/campus-dashboard.module.ts` (thêm controller/provider vào mảng có sẵn)
> Tổng **7 net-new + 1 modified**. 0 entity, 1 migration (seed permission only).

## 8. Test (mock repo — KHÔNG DB)
- `getTraffic`: range >31 ngày → 400; không zone nào khớp filter → `{series: [], heatmap: []}`; `relativeDensity` tính đúng (mock nhiều zone, kiểm tra zone peak cao nhất = 1.0, zone thấp hơn = tỉ lệ đúng); tất cả `peakOccupancy=0` → `relativeDensity=0` (không NaN); `coordinates` luôn `null`.
- Coverage **≥80%** file mới.

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh (UC-126+119+120 cùng module, KHÔNG hồi quy); coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: tọa độ BLOCKED (kế thừa UC-126) · `groupBy=day|hour` tùy chỉnh (nếu team cần sau).

## 10. Kỷ luật
- **DATA-01**: KHÔNG ghi bảng nào — module 100% READ-ONLY.
- **PERF-01**: tận dụng `IDX_zpe_count`, range tối đa 31 ngày.
- KHÔNG tự code UC-119/121/126 ở đây (chỉ thêm vào module đã scaffold).

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md (SAU khi UC-126 xong). KHÔNG tự code.
