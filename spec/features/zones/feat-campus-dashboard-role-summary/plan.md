# CDB-RS-001 — plan.md (Zones / campus-dashboard: Tổng hợp dashboard theo vai trò)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo plan CDB-RS-001 cùng lượt với spec. Mở rộng module `campus-dashboard` đã có (KHÔNG module mới), 3 migration seed permission mới, KHÔNG DDL bảng/cột. | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `CampusDashboardModule` (`campus-dashboard.module.ts`) hiện `forFeature([ZoneEntity, ZonePresenceEventEntity, GateAccessLogEntity, IoTDeviceEntity])`, `imports: [AuthModule]`, `controllers: [DashboardOverviewController, ZonePresenceTimelineController, ZoneTrafficHeatmapController]` (đã có UC-119/120), `providers: [CampusDashboardRepository, DashboardOverviewService, ZonePresenceTimelineService, ZoneTrafficHeatmapService, ...]` — **feature này CHỈ thêm entity mới cần `forFeature`** (xem dưới), thêm 3 controller/3 service vào mảng, KHÔNG tạo module.
- **Entity CẦN THÊM vào `forFeature`** (chưa có trong module hiện tại): `UserEntity` (module `accounts`), `MeetingRequestEntity` + `DepartmentEntity` (module `meetings`/`accounts` — cho điều kiện §spec 2.2), `AttendanceRecordEntity` + `MeetingEntity`/`MeetingParticipantEntity` (module `meetings`/`attendance` — cho on-time §spec 2.3, meetings-today employee-summary), `SecurityAlertEntity` (module `alerts` — đã dùng ở UC-121/122/123, path `../../../../src/modules/alerts/entities/security-alert.entity.ts`), `VehicleRegistrationEntity` (module `anpr` — CHỈ import entity để SELECT, KHÔNG import `AnprModule`, mirror nguyên tắc ARCH-02 spec §5).
- **XÁC NHẬN LẠI TRƯỚC KHI CODE (T0 bắt buộc)**: entity nào ở trên có sẵn export public từ module gốc (`export * from './xxx.entity.js'` hoặc import trực tiếp path) — 1 vài entity có thể chưa export ra ngoài module, cần kiểm tra thật, KHÔNG giả định.
- `system_configs` — kiểm tra thật có tồn tại key `analytics.on_time_grace_minutes` chưa (dùng `dataSource.getRepository(SystemConfigEntity)`, mirror cách `loadStalenessMinutes` CDB-001 đọc `campus_dashboard.occupancy_staleness_minutes`) — nếu chưa có dòng nào, fallback code-side `0` (spec §2.3).
- Xác nhận `PermissionsGuard`/`JwtAuthGuard`/`RequirePermissions`/`CurrentUser` import path — mirror 3 controller đã có trong `campus-dashboard`.
- 0 DDL bảng/cột. 3 migration mới (seed permission).

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (10 quyết định: permission/role riêng từng endpoint, điều kiện team 2 nhánh cho pending-request nhưng 1 nhánh cho presence, on-time dùng chung ngưỡng nhưng viết query riêng, zone occupancy toàn trường = SUM per-zone mới nhất, vehicle control hits = COUNT security_alerts, employee vehicle status literal, 2 field bị loại hẳn khỏi response). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi schema, KHÔNG migration DDL
0 thay đổi schema. 3 migration mới CHỈ seed permission (§9).

## 3. Module — mở rộng `campus-dashboard` đã có (KHÔNG tạo module mới)
```
src/modules/campus-dashboard/campus-dashboard.module.ts   (SỬA — thêm forFeature entity mới + 3 controller + 3 provider)
```
- `forFeature` thêm: `UserEntity, MeetingRequestEntity, DepartmentEntity, AttendanceRecordEntity, MeetingEntity, MeetingParticipantEntity, SecurityAlertEntity, VehicleRegistrationEntity` (xem RECON §0 — xác nhận path thật ở T0).
- `controllers` thêm: `ManagerSummaryController, EmployeeSummaryController, BusinessAdminSummaryController`.
- `providers` thêm: `ManagerSummaryService, EmployeeSummaryService, BusinessAdminSummaryService` — mỗi service TỰ inject repository riêng qua `@InjectRepository` cho entity ngoài phạm vi `CampusDashboardRepository` gốc (KHÔNG nhét hết vào `CampusDashboardRepository` — file đó giữ đúng vai trò "zone/presence/gate/device" theo CDB-001, entity mới thuộc domain khác dùng repository riêng theo service, mirror convention module chuẩn CLAUDE.md §6.1).

## 4. Repository

### 4.1. `CampusDashboardRepository` (file đã có — THÊM method mới, KHÔNG sửa method cũ)
```
src/modules/campus-dashboard/repositories/campus-dashboard.repository.ts
```
- `async loadAllZonesWithLatestOccupancy(): Promise<Array<{zone: ZoneEntity; latestEvent: ZonePresenceEventEntity | null; devicesInZone: IoTDeviceEntity[]}>>` — mirror logic per-zone của `getOverview` (CDB-001 plan §5) nhưng trả MẢNG cho TOÀN BỘ zone active, dùng cho `businessAdminSummary.zoneOccupancy` (sau đó áp `resolveOccupancyStatus` từng zone rồi SUM ở service).
- `async countGateLogsAllZonesToday(direction: 'in' | 'out', startOfDay: Date): Promise<number>` — biến thể KHÔNG filter `zoneId` của `countGateLogsToday` đã có.

### 4.2. Repository mới riêng cho entity ngoài phạm vi zone/device (đặt trong service luôn, KHÔNG tạo file repository riêng — 1-2 query/service không đủ phức tạp để tách lớp riêng, mirror mức độ đơn giản `NotificationReadStateService` không có repository riêng)
- `ManagerSummaryService` tự query `UserEntity`, `MeetingRequestEntity`, `DepartmentEntity`, `AttendanceRecordEntity`/`MeetingEntity`/`MeetingParticipantEntity`, `GateAccessLogEntity` (đã `forFeature` sẵn từ CDB-001).
- `EmployeeSummaryService` tự query `GateAccessLogEntity`, `VehicleRegistrationEntity`, `MeetingEntity`/`MeetingParticipantEntity`.
- `BusinessAdminSummaryService` gọi `CampusDashboardRepository` (§4.1) + tự query `SecurityAlertEntity`.

## 5. Service

### 5.1. `ManagerSummaryService.getSummary(managerId: string)`
```
src/modules/campus-dashboard/services/manager-summary.service.ts
```
1. `teamPresenceToday`: `teamUserIds = SELECT id FROM users WHERE direct_manager_id = :managerId`; `totalCount = teamUserIds.length`; `presentCount = COUNT DISTINCT gate_access_logs.user_id WHERE user_id IN (teamUserIds) AND direction='in' AND access_time >= startOfDay`.
2. `pendingMeetingRequestsCount`: `COUNT meeting_requests JOIN users requester ON requester.id = meeting_requests.requested_by WHERE approval_status='pending' AND (requester.direct_manager_id = :managerId OR requester.department_id IN (SELECT id FROM departments WHERE manager_user_id = :managerId))` (spec R2, mirror `meetings.service.ts:5245-5253` — KHÔNG copy nguyên query builder của module khác qua import, viết lại query tương đương trong service này theo ARCH-02).
3. `onTimeRateThisWeek`: đọc `graceMinutes` từ `system_configs` (fallback `0`) → query `attendance_records` JOIN `meeting_participants`/`meetings` WHERE participant thuộc `teamUserIds`, `is_required=true` (xác nhận field thật ở T0), `meetings.start_time >= now-7d` → `onTimeCount` (check-in time <= start_time + graceMinutes) / `totalRequiredParticipants` * 100, làm tròn 1 chữ số thập phân (mirror `Math.round(x*1000)/10` của `on-time-rate.service.ts`).
4. `teamZoneSecurityAlerts`: luôn `{value: null, note: 'not_available'}` (spec §2.8).

### 5.2. `EmployeeSummaryService.getSummary(userId: string)`
```
src/modules/campus-dashboard/services/employee-summary.service.ts
```
1. `gateAccessToday`: `gate_access_logs WHERE user_id = :userId AND access_time >= startOfDay ORDER BY access_time ASC`.
2. `vehicleStatus`: `vehicle_registrations WHERE user_id = :userId AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1` → `null` nếu không có.
3. `meetingsToday`: đếm `meeting_participants JOIN meetings WHERE user_id = :userId AND meetings.start_time::date = today` (xác nhận tên cột/enum meeting status thật ở T0 — có tính `cancelled` meeting vào đếm không? Mặc định LOẠI `status='cancelled'`, ghi rõ trong code comment).

### 5.3. `BusinessAdminSummaryService.getSummary()`
```
src/modules/campus-dashboard/services/business-admin-summary.service.ts
```
1. `gateTrafficToday`: `{entriesToday: countGateLogsAllZonesToday('in', startOfDay), exitsToday: countGateLogsAllZonesToday('out', startOfDay)}`.
2. `securityAlertsBySeverity`: `security_alerts WHERE triggered_at >= startOfDay GROUP BY severity` → map về `{low, medium, high, critical}` (thiếu severity nào thì `0`).
3. `zoneOccupancy`: `loadAllZonesWithLatestOccupancy()` → map từng zone qua `resolveOccupancyStatus` (TÁI DÙNG pure function CDB-001, import từ `utils/resolve-occupancy-status.util.ts`) → SUM `count` của zone có `status='ok'`, đếm `zonesWithDataCount`/`totalZoneCount`.
4. `vehicleControlHitsToday`: `COUNT security_alerts WHERE alert_type='vehicle_control_match' AND triggered_at >= startOfDay`.

## 6. Pure functions
KHÔNG thêm pure function mới — TÁI DÙNG `resolveOccupancyStatus`/`resolveCameraStatus` đã có từ CDB-001 (`utils/resolve-occupancy-status.util.ts`, không cần cho occupancy toàn trường vì không cần cameraStatus tổng hợp ở summary này, chỉ cần occupancy).

## 7. DTO
```
src/modules/campus-dashboard/dto/manager-summary-response.dto.ts
src/modules/campus-dashboard/dto/employee-summary-response.dto.ts
src/modules/campus-dashboard/dto/business-admin-summary-response.dto.ts
```
- `ManagerSummaryResponseDto`: `{teamPresenceToday: {presentCount, totalCount}, pendingMeetingRequestsCount: number, onTimeRateThisWeek: {rate: number, sampleSize: number}, teamZoneSecurityAlerts: {value: null, note: 'not_available'}}`.
- `EmployeeSummaryResponseDto`: `{gateAccessToday: Array<{direction: 'in'|'out', accessTime: string}>, vehicleStatus: {plateNumber: string, status: string} | null, meetingsToday: number}`.
- `BusinessAdminSummaryResponseDto`: `{gateTrafficToday: {entriesToday, exitsToday}, securityAlertsBySeverity: {low, medium, high, critical}, zoneOccupancy: {totalCount: number, zonesWithDataCount: number, totalZoneCount: number}, vehicleControlHitsToday: number}`.
- Không endpoint nào cần query DTO (không tham số) — mirror `manager-summary`/`employee-summary`/`business-admin-summary` đều lấy theo `req.user`, không filter thêm.

## 8. Controller
```
src/modules/campus-dashboard/controllers/manager-summary.controller.ts
src/modules/campus-dashboard/controllers/employee-summary.controller.ts
src/modules/campus-dashboard/controllers/business-admin-summary.controller.ts
```
- `GET /api/v1/campus-dashboard/manager-summary` — `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('campus_dashboard.manager_summary.read')`, `@CurrentUser() user` → `getSummary(user.userId)`.
- `GET /api/v1/campus-dashboard/employee-summary` — `@RequirePermissions('campus_dashboard.employee_summary.read')`, tương tự lấy `user.userId`.
- `GET /api/v1/campus-dashboard/business-admin-summary` — `@RequirePermissions('campus_dashboard.business_admin_summary.read')`, không tham số.
- Cả 3 trả `{success, message, data}` chuẩn (mirror `dashboard-overview.controller.ts`).

## 9. Migration mới — seed 3 permission
```
src/database/migrations/20260729000003-SeedCampusDashboardManagerSummaryPermission.ts
src/database/migrations/20260729000004-SeedCampusDashboardEmployeeSummaryPermission.ts
src/database/migrations/20260729000005-SeedCampusDashboardBusinessAdminSummaryPermission.ts
```
- Mirror CHÍNH XÁC cấu trúc `20260723000008-SeedCampusDashboardOverviewPermission.ts` (INSERT permission `ON CONFLICT DO NOTHING RETURNING id` → fallback SELECT nếu đã tồn tại → loop INSERT `role_permissions` `ON CONFLICT DO NOTHING`).
- Roles: `manager_summary` → `['MANAGER']`; `employee_summary` → `['SYSTEM_ADMIN','BUSINESS_ADMIN','MANAGER','EMPLOYEE']`; `business_admin_summary` → `['BUSINESS_ADMIN','SYSTEM_ADMIN']`.
- **Xác nhận timestamp trước khi code (T0)**: `20260729000001`/`000002` đã dùng (`RenameAvatarPermissionsToBiometric`, `SeedAvatarPhotoUpdatePermission`) — file mới bắt đầu từ `000003`, nhưng PHẢI `ls src/database/migrations` lại ngay trước khi tạo file thật (có thể có commit khác chen giữa).

## 10. File list
### Net-new (12 file)
- `src/modules/campus-dashboard/services/manager-summary.service.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/services/employee-summary.service.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/services/business-admin-summary.service.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/controllers/manager-summary.controller.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/controllers/employee-summary.controller.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/controllers/business-admin-summary.controller.ts` (+ `.spec.ts`)
- `src/modules/campus-dashboard/dto/manager-summary-response.dto.ts`
- `src/modules/campus-dashboard/dto/employee-summary-response.dto.ts`
- `src/modules/campus-dashboard/dto/business-admin-summary-response.dto.ts`
- `src/database/migrations/20260729000003-SeedCampusDashboardManagerSummaryPermission.ts`
- `src/database/migrations/20260729000004-SeedCampusDashboardEmployeeSummaryPermission.ts`
- `src/database/migrations/20260729000005-SeedCampusDashboardBusinessAdminSummaryPermission.ts`
### Modified (2 file)
- `src/modules/campus-dashboard/campus-dashboard.module.ts` (thêm forFeature entity + controller + provider)
- `src/modules/campus-dashboard/repositories/campus-dashboard.repository.ts` (thêm 2 method §4.1)
> Tổng **12 net-new + 2 modified**. 0 entity, 3 migration (seed permission only).

## 11. Test (mock repo/DataSource — KHÔNG DB thật)
- `ManagerSummaryService`: `teamPresenceToday` đúng khi có/không có thành viên team; `pendingMeetingRequestsCount` đúng cả 2 nhánh điều kiện (direct report / department manager) VÀ hợp cả 2 (không đếm trùng nếu 1 người vừa direct report vừa cùng phòng ban — dùng `DISTINCT`/query 1 lần, KHÔNG 2 query rồi cộng); `onTimeRateThisWeek` đúng công thức, `sampleSize=0` → `rate=0` (không chia 0); `teamZoneSecurityAlerts` luôn đúng shape `{value:null, note:'not_available'}`.
- `EmployeeSummaryService`: `vehicleStatus=null` khi chưa đăng ký xe; `gateAccessToday` sort đúng thứ tự; `meetingsToday` loại đúng `cancelled`.
- `BusinessAdminSummaryService`: `securityAlertsBySeverity` đủ 4 mức kể cả mức không có alert nào (`0`, không thiếu key); `zoneOccupancy` SUM đúng, loại đúng zone `no_data`; `vehicleControlHitsToday` đếm đúng theo `alertType`.
- Controller: guard/permission áp dụng đúng theo role đã chốt (403 khi role sai, kể cả role "gần đúng" như MANAGER gọi `business-admin-summary`).
- Coverage **≥80%** file mới.

## 12. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/campus-dashboard` xanh; coverage ≥80%; DI-proof `AppModule` (đặc biệt xác nhận entity mới `forFeature` không gây lỗi vòng phụ thuộc). KHÔNG live, KHÔNG DB thật.
- **Owed**: seed permission + verify RDS thật (đợt sau, sau khi Thiếu Chủ duyệt code) · báo Thiếu Chủ riêng về gap `iot.device.read` thiếu `BUSINESS_ADMIN` (spec §6, ngoài scope feature này).

## 13. Kỷ luật
- **DATA-01**: 100% READ-ONLY.
- **SEC-01**: route PHẢI có `@RequirePermissions` đúng role đã chốt spec §2.1.
- **ARCH-02**: KHÔNG import `MeetingsModule`/`AnalyticsModule`/`AnprModule` — chỉ import entity trực tiếp.
- KHÔNG code `unified-feed`, KHÔNG đụng `gate-access`/`anpr` module code.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
