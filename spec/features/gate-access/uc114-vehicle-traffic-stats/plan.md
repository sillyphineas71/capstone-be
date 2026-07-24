# VTS-001 — plan.md (UC-114 Gate Access / SAVP: thống kê lưu lượng phương tiện)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | **[REVISE]** Viết lại toàn bộ theo nguồn dữ liệu mới `iot_device_events` (raw SQL, mirror `VehicleHistoryService`) thay vì `gate_access_logs` (QueryBuilder cũ). Đổi migration timestamp không đổi (`20260723000003`, permission không đổi). File list/test/gate viết lại theo cách tiếp cận raw SQL. | Toàn bộ (rewrite) |
| 2026-07-23 | Tạo plan VTS-001 bản đầu (dùng `gate_access_logs`) — đã thay thế. | (đã thay thế ở dòng trên) |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)
- `iot_device_events` KHÔNG có TypeORM entity phủ đủ `event_type='ivss_vehicle_event'` (enum `IoTDeviceEventType` thiếu giá trị này) — bắt buộc raw SQL qua `DataSource.manager.query()`, mirror CHÍNH XÁC `VehicleHistoryService` (cùng bảng, cùng event_type).
- `payload_json` là `jsonb` — mọi field đọc qua `payload_json->>'key'` (text extraction), ép kiểu khi cần số (`(payload_json->>'channelId')::int`, ở đây KHÔNG cần vì UC-114 không dùng channelId).
- Cột `event_time` (không phải trong payload) dùng để filter `from`/`to` VÀ bucket — xác nhận tên cột đúng `event_time` (timestamptz), KHÔNG nhầm `created_at`.
- Cột `zone_id` tồn tại nhưng luôn NULL cho vehicle event (spec §0.3) — filter vẫn viết đúng cú pháp `zone_id = $n`, KHÔNG bỏ qua điều kiện dù biết hiện tại luôn rỗng khi có filter.
- Migration mới nhất tại thời điểm viết plan: `20260723000002` (GAH-001, KHÔNG đổi vì bản rewrite này KHÔNG cần migration schema mới). VTS-001 GIỮ NGUYÊN timestamp `20260723000003` cho migration permission (chưa từng chạy, an toàn đổi nội dung service phía sau).
- `DataSource` đã dùng sẵn ở nhiều service khác trong `anpr` — inject trực tiếp vào `VehicleTrafficStatsService`, KHÔNG cần thêm gì vào `imports` của `gate-access.module.ts` (NestJS tự cung cấp `DataSource` toàn cục qua `TypeOrmModule`).

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §1 (nguồn = `iot_device_events`) + §2 (zone_id filter giữ nguyên dù chưa có tác dụng, vocabulary enter/leave/seen, vehicleType từ payload không JOIN, group_by/from-to giữ nguyên, bucket theo event_time). Constitution đầy đủ ở spec §8. Plan KHÔNG mở lại.

## 2. Entity — KHÔNG đổi, KHÔNG dùng entity cho bảng nguồn
`IoTDeviceEventEntity` KHÔNG được inject/dùng ở feature này (raw SQL). KHÔNG thêm cột, KHÔNG migration schema DDL.

## 3. Module `gate-access` (modified — bổ sung so với GAP-001/GAH-001)
```
src/modules/gate-access/gate-access.module.ts
```
- Thêm `VehicleTrafficStatsService` vào `providers`.
- Thêm `VehicleTrafficStatsController` vào `controllers`.
- `imports`/`TypeOrmModule.forFeature` **KHÔNG đổi** — service mới dùng `DataSource` (global provider), KHÔNG cần entity mới.

## 4. DTO (4 file mới — KHÔNG đổi so với bản trước, chỉ đổi field trong summary/bucket)
- `dto/vehicle-traffic-stats-query.dto.ts`: `from`/`to` (bắt buộc, ISO8601), `zone_id?`, `vehicle_type?`, `group_by?` (`@IsIn(['day','hour'])`).
- `dto/vehicle-traffic-stats-summary.dto.ts`: `total_events, total_matched, total_unmatched, total_enter, total_leave, total_seen, unique_vehicles`.
- `dto/vehicle-traffic-stats-bucket.dto.ts`: `bucket, enter, leave, seen`.
- `dto/vehicle-traffic-stats-response.dto.ts`: `{summary, series}`.

## 5. Service — `VehicleTrafficStatsService` (file mới, raw SQL mirror `VehicleHistoryService`)
```
src/modules/gate-access/services/vehicle-traffic-stats.service.ts
```
- Constructor: `constructor(private readonly dataSource: DataSource) {}`.
- `async getStats(query: VehicleTrafficStatsQueryDto): Promise<VehicleTrafficStatsResponseDto>`:
  1. Validate `new Date(query.from) <= new Date(query.to)` → sai → `throw new BadRequestException({code:'INVALID_DATE_RANGE', message:'Khoảng thời gian không hợp lệ'})`.
  2. `const {where, params} = this.buildWhere(query);`
  3. Summary:
  ```ts
  const summaryRows = await this.dataSource.manager.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'matched')::int AS matched,
       COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'unmatched')::int AS unmatched,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'enter')::int AS enter_count,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'leave')::int AS leave_count,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'seen')::int AS seen_count,
       COUNT(DISTINCT payload_json->>'plateNumber')::int AS unique_vehicles
     FROM iot_device_events WHERE ${where}`,
    params,
  );
  ```
  4. Series:
  ```ts
  const bucketExpr = groupBy === 'hour'
    ? "to_char(event_time, 'YYYY-MM-DD HH24:00')"
    : "to_char(event_time, 'YYYY-MM-DD')";
  const seriesRows = await this.dataSource.manager.query(
    `SELECT ${bucketExpr} AS bucket, payload_json->>'direction' AS direction, COUNT(*)::int AS cnt
       FROM iot_device_events WHERE ${where}
      GROUP BY bucket, direction ORDER BY bucket ASC`,
    params,
  );
  ```
  5. `pivotSeries(seriesRows)`: `Map<bucket, {enter,leave,seen}>`, thiếu hướng = `0`, trả mảng theo thứ tự SQL đã sort.
  6. Trả `{summary: {...}, series: pivotSeries(seriesRows)}`.
- `private buildWhere(query): {where: string; params: unknown[]}`:
  ```ts
  const params: unknown[] = [];
  let where = `event_type = 'ivss_vehicle_event'`;
  params.push(query.from); where += ` AND event_time >= $${params.length}`;
  params.push(query.to);   where += ` AND event_time <= $${params.length}`;
  if (query.zoneId) { params.push(query.zoneId); where += ` AND zone_id = $${params.length}`; }
  if (query.vehicleType) { params.push(query.vehicleType); where += ` AND payload_json->>'vehicleType' = $${params.length}`; }
  return { where, params };
  ```
  Mirror CHÍNH XÁC `applyFilters` của `VehicleHistoryService` (bind index nối tiếp, KHÔNG nội suy chuỗi).

## 6. Controller — `VehicleTrafficStatsController` (file mới) — KHÔNG đổi so với bản trước
```
src/modules/gate-access/controllers/vehicle-traffic-stats.controller.ts
```
- `@Controller('gate-access/admin')`. `@Get('vehicle-traffic-stats')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('gate_access.stats.read')` `@UsePipes(ValidationPipe({whitelist:true, transform:true}))` → `getStats(query)` → envelope `{success, message, data: {summary, series}}` (KHÔNG `meta`).

## 7. Migration permission — KHÔNG đổi
```
src/database/migrations/20260723000003-SeedGateAccessStatsReadPermission.ts
```
Nội dung GIỮ NGUYÊN như bản trước (permission `gate_access.stats.read`, roles `SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER`) — đổi nguồn dữ liệu KHÔNG ảnh hưởng permission.

## 8. File list
### Net-new (6 file)
- `src/modules/gate-access/dto/vehicle-traffic-stats-query.dto.ts`
- `src/modules/gate-access/dto/vehicle-traffic-stats-summary.dto.ts`
- `src/modules/gate-access/dto/vehicle-traffic-stats-bucket.dto.ts`
- `src/modules/gate-access/dto/vehicle-traffic-stats-response.dto.ts`
- `src/modules/gate-access/services/vehicle-traffic-stats.service.ts` (+ `.spec.ts`)
- `src/modules/gate-access/controllers/vehicle-traffic-stats.controller.ts` (+ `.spec.ts`)
- `src/database/migrations/20260723000003-SeedGateAccessStatsReadPermission.ts`
### Modified (1 file)
- `src/modules/gate-access/gate-access.module.ts`: thêm 2 provider/controller vào danh sách tương ứng. `imports` KHÔNG đổi.
> Tổng **7 net-new + 1 modified**. 0 thay đổi entity/schema. 1 migration (permission-only, KHÔNG đổi so với bản trước).

## 9. Test (mock `DataSource.manager.query` — KHÔNG DB)
- `getStats`: `from > to` → 400, KHÔNG gọi `dataSource.manager.query`.
- `buildWhere`: LUÔN có `event_type = 'ivss_vehicle_event'` là điều kiện đầu; `zoneId`/`vehicleType` chỉ thêm khi có giá trị; bind param index tăng dần đúng thứ tự.
- `bucketExpr`: đúng 2 nhánh (`day`/`hour`), KHÔNG nhánh thứ 3.
- `pivotSeries`: bucket thiếu 1/2 hướng → hướng thiếu = `0`; nhiều bucket giữ thứ tự SQL.
- Không dữ liệu khớp filter → `summary` toàn 0, `series: []`, KHÔNG throw.
- Coverage **≥80%** file mới.

## 10. Gate (STOP, KHÔNG commit)
- build=0; eslint file mới 0 warning mới; `npx jest src/modules/gate-access` xanh (GAP-001/GAH-001 KHÔNG hồi quy); coverage ≥80% file mới; DI-proof compile `AppModule`. **KHÔNG live, KHÔNG DB thật.**
- **Owed (ghi, KHÔNG chạy)**: báo Hải cập nhật `VehicleResolveService` ghi `zone_id` thật cho vehicle event · cache/pre-aggregate · UC-128 renderer (Bước 5) · channelId→zone mapping thay thế.

## 11. Kỷ luật
- **DATA-01/02 (crux)**: READ-ONLY tuyệt đối trên `iot_device_events`; `event_type = 'ivss_vehicle_event'` LUÔN là điều kiện đầu tiên trong MỌI query.
- **SEC-03**: bind tham số cho MỌI filter động; `bucketExpr` CHỈ 2 chuỗi cố định.
- **ARCH-01**: chấp nhận cross-module raw-SQL read (`gate-access` đọc bảng của `iot`) — mirror tiền lệ `VehicleHistoryService`, KHÔNG coi là vi phạm boundary.
- KHÔNG tự sửa `VehicleResolveService` (ghi zone_id) — báo Hải, KHÔNG tự làm.

> **STOP.** Plan-only (viết lại cùng lượt với spec sau khi Thiếu Chủ chốt nguồn dữ liệu). Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
