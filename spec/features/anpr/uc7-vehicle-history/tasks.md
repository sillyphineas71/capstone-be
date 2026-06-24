# VHI-001 — tasks.md (UC7 ANPR: lịch sử ra/vào cổng)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-25 | Tạo tasks VHI-001: T0 verify → T1 DTO → T2 VehicleHistoryService (buildFilters+listForUser+listAll) → T3 controller 2 route → T4 wiring → T-GATE. Mỗi task 1 AC, code/test tách. Mirror UC6, plate normalize, bind-index 2 method, route path tách. No-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration, read-only. KHÔNG dùng `VehicleRegistrationService` · KHÔNG đụng route UC1-6 · KHÔNG seed RBAC (owed). UC1-6 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: UC6 query mẫu (`vehicle-unknown.service.ts` — bind động + COUNT) để mirror; UC5 payload **top-level** (`payload_json->>'userId'/'plateNumber'/...`); `normalizePlate` (UC1) cho plate filter; admin-gate UC6 (`PermissionsGuard` + `@RequirePermissions`); `@CurrentUser`; route clash đã rõ (path tách `/anpr/vehicle-history`); `VehicleRegistrationController` + `AnprModule` còn nguyên.
- **AC**: dán xác nhận 5 mục; thiếu/path sai → **DỪNG báo Thiếu Chủ** (không bịa).

## T1 — DTO `ListVehicleHistoryQueryDto` (code) — plan §3, VAL-01, OQ-3/5
- `src/modules/anpr/dto/list-vehicle-history-query.dto.ts`: `page`/`limit` (`@Type(()=>Number) @IsOptional @IsInt @Min(1)`/`@Max(100)` def 1/20), `from?`/`to?` (`@IsOptional @IsISO8601`), `direction?` (`@IsOptional @IsIn(['enter','leave','seen'])`), `plateNumber?` (`@IsOptional @IsString @MaxLength(20)` — raw, service normalize), `matchState?` (`@IsOptional @IsIn(['matched','unmatched'])`).
- **AC**: 7 field; direction/matchState `@IsIn`; from/to `@IsISO8601`; plateNumber raw maxLength 20.

## T2 — Service `VehicleHistoryService` (code) — plan §2, SEC-01/03, DATA-01, OQ-1/5/6 + ràng buộc normalize
- `src/modules/anpr/services/vehicle-history.service.ts`: `@Injectable`, inject `DataSource`.
- **`buildFilters(query, params, where)`** helper: push động `from`→`AND event_time >= $${params.length}`, `to`→`AND event_time <= $${params.length}`, `direction`→`AND payload_json->>'direction' = $${params.length}`, `plateNumber`→**`normalizePlate(query.plateNumber)`** rồi `AND payload_json->>'plateNumber' = $${params.length}`. Trả `{where, params}` (bind index tiếp nối `params` truyền vào).
- **`listForUser(userId, query)`**: base `event_type='ivss_vehicle_event' AND payload_json->>'userId' = $1` (params=[userId]) → buildFilters (filter từ $2) → rows (SELECT KHÔNG userId) + COUNT. 
- **`listAll(query)`**: base `event_type='ivss_vehicle_event'` (params=[]) + `matchState`→`AND payload_json->>'matchState' = $n` → buildFilters → rows (SELECT CÓ `payload_json->>'userId' AS user_id`) + COUNT.
- rows: `SELECT payload_json->>'plateNumber', (payload_json->>'channelId')::int, payload_json->>'direction', payload_json->>'matchState', event_time, payload_json->>'utc' [, payload_json->>'userId' (admin)] FROM iot_device_events WHERE <where> ORDER BY event_time DESC LIMIT $ OFFSET $` (limit/offset SAU filter params). COUNT cùng `where` (KHÔNG limit/offset). meta `{page,limit,total,totalPages:Math.ceil}`. SEC-03 bind. KHÔNG dùng VehicleRegistrationService.
- **AC**: user WHERE `userId=$1`; admin WHERE chỉ event_type; C1 event_type vehicle; plate normalize; bind index liên tục (2 method khác offset); read-only.

## T2b — Service test (mock DataSource) — SEC-01, DATA-01, ràng buộc
- **user-scope**: `listForUser('u1', q)` → SQL `payload_json->>'userId' = $1`, params[0]='u1'; output KHÔNG userId.
- **admin all**: `listAll(q)` → WHERE chỉ event_type; output CÓ userId.
- **C1**: SQL `event_type = 'ivss_vehicle_event'`; KHÔNG `face_verify`/`face_stranger`.
- **plate normalize (cứng)**: filter `plateNumber:'30A-123.45'` → bind param `'30A12345'` (qua normalizePlate).
- **admin matchState**: `listAll({matchState:'unmatched'})` → `payload_json->>'matchState' = $`.
- **bind index 2 method**: `listForUser` (userId=$1, from→$2, direction→$3, plate→$4, LIMIT $5 OFFSET $6) LẪN `listAll` (from→$1...) → assert params đúng thứ tự, $ không lệch; COUNT params = filter params (KHÔNG limit/offset). Test tổ hợp nhiều filter.
- **channelId ::int**; **meta total** (25/20→2); **pagination** page2/limit20→LIMIT 20 OFFSET 20.
- **list rỗng** []+total0; **SEC-03 bind** (giá trị qua param, KHÔNG nối chuỗi); **read-only** (chỉ SELECT/COUNT).
- **AC**: nhánh xanh; coverage ≥80% (gộp T-GATE).

## T3 — Controller 2 route (code) — plan §4, SEC-01, OQ-4/5
- Thêm vào `VehicleRegistrationController` (inject `VehicleHistoryService`), **đặt TRƯỚC route `vehicle-registrations/:id`**:
  - USER: `@Get('vehicle-history')` `@UseGuards(JwtAuthGuard)` `@UsePipes(ValidationPipe{whitelist,transform})` `@CurrentUser() user` `@Query() query` → `listForUser(user.userId, query)` → `{success:true, message:'Vehicle history retrieved', data: items, meta}`.
  - ADMIN: `@Get('admin/vehicle-history')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('anpr.vehicle.history_view')` `@UsePipes(...)` `@Query() query` → `listAll(query)` → envelope+meta.
- KHÔNG đụng route UC1-6.
- **AC**: 2 route đúng path (KHÔNG dưới `:id`); user JwtAuthGuard+@CurrentUser; admin PermissionsGuard+`@RequirePermissions('anpr.vehicle.history_view')`.

## T3b — Controller test (mock service + mock guard) — SEC-01
- user route → `listForUser(currentUserId, query)`; admin route → `listAll(query)`; cả 2 envelope+meta.
- **admin-gate**: assert `__guards__` chứa `PermissionsGuard` + metadata `@RequirePermissions = ['anpr.vehicle.history_view']`; user route chỉ JwtAuthGuard (KHÔNG PermissionsGuard).
- **AC**: assert gọi đúng method + userId từ @CurrentUser (user route) + admin-gate metadata.

## T4 — Module wiring `anpr.module.ts` (code) — plan §5
- providers: thêm `VehicleHistoryService`. controllers giữ nguyên. KHÔNG đổi env/migration.
- **AC**: AppModule compile, 0 circular/UnknownDependencies; controller inject `VehicleHistoryService` OK.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- build=0; eslint touched (service + dto + controller + module + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (**UC1-6 KHÔNG hồi quy + UC7 mới**); coverage **≥80%** `vehicle-history.service.ts`; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies); throwaway xóa. **KHÔNG live, KHÔNG DB, KHÔNG commit.**
- Nếu sửa eslint: **đọc lại file sau khi sửa**, KHÔNG sed/regex hàng loạt làm rỗng assertion.
- In: code đầy đủ file + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: seed permission `anpr.vehicle.history_view` (cùng nhóm `anpr.vehicle.*`) — chưa seed → 403 · pairing enter/leave → "phiên"/dwell · analytics/thống kê · `channelId` filter mở rộng · channel→tên cổng · index hiệu năng (`payload_json->>'userId'`/`event_type` GIN/expression) · real-time push · live khi bridge UC8.
- **AC**: bảng gate đầy đủ + báo cáo: user-scope `userId=$1` (output KHÔNG userId) ✓ · admin all + userId ✓ · C1 event_type (KHÔNG face) ✓ · plate normalize (30A-123.45→30A12345) ✓ · bind index 2 method không lệch ✓ · channelId ::int ✓ · meta total ✓ · pagination ✓ · direction/matchState/from-to validate 400 ✓ · admin-gate history_view ✓ · route path tách (không dưới :id) ✓ · SEC-03 bind + read-only ✓ · KHÔNG VehicleRegistrationService/route-UC1-6/migration ✓ · UC1-6 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC7
- T0 → verify UC6-mẫu/UC5-payload/normalizePlate/admin-gate/route-clash/controller-module còn nguyên
- T1 → DTO query (page/limit/from/to/direction/plateNumber/matchState)
- T2/T2b → `VehicleHistoryService` (buildFilters + listForUser user-scope + listAll admin, plate normalize, bind index)
- T3/T3b → controller 2 route (user /vehicle-history + admin /admin/vehicle-history, path tách)
- T4 → wiring provider `VehicleHistoryService`
- T-GATE → gate + STOP + Owed (seed permission · pairing phiên · analytics · channel filter · index · live)
