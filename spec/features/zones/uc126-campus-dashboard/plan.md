# CDB-001 — plan.md (UC-126 Zones / SAVP: dashboard điều hành khuôn viên)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan CDB-001 cùng lượt với spec. Module mới `campus-dashboard` (scaffold dùng chung UC-119/120), 1 migration seed permission mới, KHÔNG DDL bảng/cột. | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `ZoneEntity`/`ZonePresenceEventEntity`/`GateAccessLogEntity` đã `forFeature` trong `ZonesModule`; `IoTDeviceEntity` đã `forFeature` trong `IotModule` — `campus-dashboard` PHẢI tự `forFeature` lại cả 4 entity (import class trực tiếp), mirror `restricted-zone`/`crowd-alert`.
- `SystemConfigEntity` — dùng `dataSource.getRepository(SystemConfigEntity)` đọc `STALENESS_MINUTES`, mirror UC-116/124.
- Xác nhận `IoTDeviceType`/`IoTDeviceStatus` enum export từ `iot-device.entity.ts` (đã đọc — có sẵn, xem spec §0.2).
- Xác nhận `PermissionsGuard`/`JwtAuthGuard`/`RequirePermissions`/`CurrentUser` import path (mirror `zones.controller.ts`).
- 1 migration mới (seed permission), 0 DDL bảng/cột.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (7 quyết định: tọa độ blocked, 2 metric tách biệt, thuật toán `resolveOccupancyStatus`, gateTraffic raw logs, `cameraStatus.overall`, module tự forFeature, auto-refresh client-side). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi, KHÔNG migration DDL
0 thay đổi schema. 1 migration mới CHỈ seed permission (§6).

## 3. Module mới — `campus-dashboard` (scaffold dùng chung UC-119/120)
```
src/modules/campus-dashboard/campus-dashboard.module.ts
```
- `imports: [AuthModule, TypeOrmModule.forFeature([ZoneEntity, ZonePresenceEventEntity, GateAccessLogEntity, IoTDeviceEntity])]`.
- `controllers: [DashboardOverviewController]` (UC-119/120 thêm controller vào mảng này sau — KHÔNG tạo module riêng).
- `providers: [DashboardOverviewService, CampusDashboardRepository]` (repository dùng chung cho cả 3 cụm — xem §4).
- `exports: []` (không module nào khác cần inject ngược).

## 4. Repository dùng chung — `CampusDashboardRepository` (file mới)
```
src/modules/campus-dashboard/repositories/campus-dashboard.repository.ts
```
Các method HELPER dùng chung cho UC-126/119/120 (tránh trùng lặp query khi UC-119/120 code sau):
- `async loadZoneHierarchy(filter: {building?: string; floor?: string}): Promise<ZoneEntity[]>` — `where: {deletedAt: IsNull(), ...filter}`, order `building, floor, zoneName`.
- `async loadLatestCountEvent(zoneId: string): Promise<ZonePresenceEventEntity | null>` — `find({where: {zoneId, eventType: 'count'}, order: {eventTime: 'DESC'}, take: 1})[0] ?? null` (tận dụng `IDX_zpe_count`).
- `async loadDevicesByZone(zoneIds: string[]): Promise<IoTDeviceEntity[]>` — `find({where: {zoneId: In(zoneIds)}})`.
- `async countGateLogsToday(zoneId: string, direction: 'in' | 'out', startOfDay: Date): Promise<number>` — `count({where: {zoneId, direction, accessTime: MoreThanOrEqual(startOfDay)}})`.
- `async loadStalenessMinutes(): Promise<number>` — đọc `system_configs` (`config_group='campus_dashboard'`, `config_key='campus_dashboard.occupancy_staleness_minutes'`), fallback `15` nếu thiếu dòng (KHÔNG tự seed dòng mặc định, mirror cách `loadClosingHour` UC-116 làm — fallback code-side).

## 5. Service — `DashboardOverviewService` (file mới)
```
src/modules/campus-dashboard/services/dashboard-overview.service.ts
```
- Constructor: `private readonly repo: CampusDashboardRepository`.
- `async getOverview(query: {building?: string; floor?: string}): Promise<DashboardOverviewResponseDto>`:
  1. `const zones = await this.repo.loadZoneHierarchy(query);`
  2. `const staleness = await this.repo.loadStalenessMinutes();`
  3. `const devices = await this.repo.loadDevicesByZone(zones.map(z => z.id));`
  4. Với mỗi zone: `const latestEvent = await this.repo.loadLatestCountEvent(zone.id);` → `resolveOccupancyStatus(zone, devices.filter(d => d.zoneId === zone.id), latestEvent, staleness)` (pure function, xem §6) → `resolveCameraStatus(devicesInZone)` (pure function) → `countGateLogsToday` cho `in`/`out`.
  5. Group kết quả theo `building` → `floor` → mảng zone, trả `DashboardOverviewResponseDto`.
- `HEARTBEAT_TYPES = [IoTDeviceType.FACE_SERVER, IoTDeviceType.DOOR_CAMERA]` (const module-level, mirror spec §2.3).

## 6. Pure functions (test độc lập, KHÔNG cần mock DB)
```
src/modules/campus-dashboard/utils/resolve-occupancy-status.util.ts
src/modules/campus-dashboard/utils/resolve-camera-status.util.ts
```
- `resolveOccupancyStatus(devicesInZone, latestEvent, stalenessMinutes, now): {status: 'ok' | 'no_data'; count: number | null}` — thuật toán spec §2.3 nguyên văn.
- `resolveCameraStatus(devicesInZone): {online, offline, disabled, maintenance, overall}` — thuật toán spec §2.5.

## 7. DTO
```
src/modules/campus-dashboard/dto/query-dashboard-overview.dto.ts   (building?, floor? — optional string filter)
src/modules/campus-dashboard/dto/dashboard-overview-response.dto.ts (ZoneOverviewDto, FloorOverviewDto, BuildingOverviewDto, DashboardOverviewResponseDto)
```
`ZoneOverviewDto`: `{zoneId, zoneCode, zoneName, zoneType, coordinates: null, occupancy: {count, status}, gateTraffic: {entriesToday, exitsToday}, cameraStatus: {online, offline, disabled, maintenance, overall}}`.

## 8. Controller
```
src/modules/campus-dashboard/controllers/dashboard-overview.controller.ts
```
- `GET /api/v1/campus-dashboard/overview` — `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('campus_dashboard.overview.read')`, `@Query() query: QueryDashboardOverviewDto` → gọi service → trả response chuẩn `{success, message, data}` (mirror convention §8.1 AGENTS.md).

## 9. Migration mới — seed permission
```
src/database/migrations/20260723000008-SeedCampusDashboardOverviewPermission.ts
```
- Mirror `20260722000004-SeedZoneReadPermission.ts` — seed `campus_dashboard.overview.read`, gán role `SYSTEM_ADMIN`/`BUSINESS_ADMIN`/`MANAGER` (KHÔNG `EMPLOYEE`, đúng SRS PRE-1 "Admin/Manager").

## 10. File list
### Net-new (10 file)
- `src/modules/campus-dashboard/campus-dashboard.module.ts`
- `src/modules/campus-dashboard/repositories/campus-dashboard.repository.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/services/dashboard-overview.service.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/utils/resolve-occupancy-status.util.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/utils/resolve-camera-status.util.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/controllers/dashboard-overview.controller.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/dto/query-dashboard-overview.dto.ts`
- `src/modules/campus-dashboard/dto/dashboard-overview-response.dto.ts`
- `src/database/migrations/20260723000008-SeedCampusDashboardOverviewPermission.ts`
### Modified (1 file)
- `src/app.module.ts` (đăng ký `CampusDashboardModule`)
> Tổng **10 net-new + 1 modified**. 0 entity, 1 migration (seed permission only).

## 11. Test (mock repo — KHÔNG DB)
- `resolveOccupancyStatus`: đủ 4 nhánh (heartbeat device online → 'ok' bất kể event cũ; heartbeat device không online → 'no_data'; không có heartbeat device + event mới → 'ok'; không có heartbeat device + event cũ/không có → 'no_data'); `count` KHÔNG BAO GIỜ tự ý trả `0` khi không có event (trả `null`).
- `resolveCameraStatus`: đủ 4 nhánh `overall` (`no_device`/`online`/`degraded`/`offline`).
- `DashboardOverviewService.getOverview`: group đúng Building→Floor→Zone; filter `building`/`floor` hoạt động đúng; `coordinates` LUÔN `null`.
- Controller: guard/permission áp dụng đúng (403 khi thiếu quyền).
- Coverage **≥80%** file mới.

## 12. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: gửi Hải đề nghị thêm cột tọa độ `zones` (chặn phần GIS thật của UC-126/120) · seed permission + verify RDS thật (theo đúng convention "KHÔNG live, KHÔNG DB thật" ở giai đoạn spec/code).

## 13. Kỷ luật
- **DATA-01**: Module 100% READ-ONLY, không INSERT/UPDATE/DELETE bảng nào.
- **SEC-01**: route PHẢI có `@RequirePermissions`.
- KHÔNG tự code UC-119/120/121 ở đây (chỉ scaffold module).

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
