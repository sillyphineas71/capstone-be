# VHI-001 — plan.md (UC7 ANPR: lịch sử ra/vào cổng)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-25 | Tạo plan VHI-001 sau spec DUYỆT + chốt OQ-1…6. `VehicleHistoryService` 2 method (listForUser/listAll) raw SQL mirror UC6 + filter time/direction/plate-normalized (admin matchState). 2 route /anpr/vehicle-history + /anpr/admin/vehicle-history. No-migration, read-only. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON (đọc CODE THẬT, xác nhận đủ để code)
- **UC6 query mẫu** ([vehicle-unknown.service.ts](../../../../src/modules/anpr/services/vehicle-unknown.service.ts)): raw SQL, WHERE base + **time-range bind động** (`params.push`, `$${params.length}`), `(payload_json->>'channelId')::int`, `ORDER BY event_time DESC LIMIT $ OFFSET $`, **COUNT(*) cùng WHERE** → `meta{page,limit,total,totalPages}`, bind index liên tục. ⇒ UC7 mirror, đổi/thêm filter.
- **UC5 payload path** ([vehicle-resolve.service.ts](../../../../src/modules/anpr/services/vehicle-resolve.service.ts)): top-level `userId`/`plateNumber`/`channelId`/`direction`/`matchState`/`utc` + cột `event_time`. ⇒ JSON path `payload_json->>'...'`.
- **normalizePlate** ([normalize-plate.ts](../../../../src/modules/anpr/utils/normalize-plate.ts)): `normalizePlate(raw)` → chuẩn. ⇒ filter `plateNumber` PHẢI qua hàm này (DB lưu đã normalize từ UC4/UC5).
- **Admin-gate UC6** ([vehicle-registration.controller.ts]): `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.unknown_view')`. ⇒ UC7 admin mirror với `history_view`. `@CurrentUser()` cho user route (UC1-3).
- **Route clash (§0.5 spec)**: `vehicle-registrations/:id` nuốt "history" → UC7 dùng path tách `/anpr/vehicle-history` + `/anpr/admin/vehicle-history` (KHÔNG nested `:id`).
- **AnprModule/controller**: thêm provider `VehicleHistoryService` + 2 route vào `VehicleRegistrationController` (đã `@Controller('anpr')` + có admin precedent) — KHÔNG controller mới.

## 1. Quyết định đã chốt (OQ + ràng buộc + Constitution)
OQ-1 user-scope `payload_json->>'userId'=$current` (raw SQL) · OQ-2 user chỉ matched của mình · OQ-3 user time+direction+plate / admin thêm `matchState` (channel owed) · OQ-4 `anpr.vehicle.history_view` · OQ-5 output 6 field + admin thêm userId · OQ-6 2 method.
- **Ràng buộc**: `plateNumber` filter qua `normalizePlate` TRƯỚC khi so; path tách `/anpr/vehicle-history`.
- **SEC-01** user-scope lọc cứng `payload_json->>'userId'=$current` (từ JWT); admin gate `history_view`. **SEC-03** raw SQL bind. **ARCH-01** controller→service→DataSource raw, 2 method, KHÔNG VehicleRegistrationService. **DATA-01 (C1)** CHỈ `event_type='ivss_vehicle_event'`, read-only. **DATA-02** no-migration. **VAL-01** query DTO.

## 2. Service — `VehicleHistoryService` (2 method, raw SQL mirror UC6)
`src/modules/anpr/services/vehicle-history.service.ts` — inject `DataSource`. **Helper chung** `buildFilters(query, baseParams, baseWhere)` → push filter động (from/to/direction/plate-normalized) trả `{where, params}`; rows + COUNT dùng chung.
- **`listForUser(userId, query)`**: base `event_type='ivss_vehicle_event' AND payload_json->>'userId' = $1` (userId bind $1) + filter động. Output KHÔNG userId.
- **`listAll(query)`**: base `event_type='ivss_vehicle_event'` + filter động (+ `matchState` nếu có: `payload_json->>'matchState' = $n`). Output thêm `userId` (`payload_json->>'userId'`).
- Filter động (mirror UC6): `from`→`event_time >= $n`, `to`→`event_time <= $n`, `direction`→`payload_json->>'direction' = $n`, `plateNumber`→`payload_json->>'plateNumber' = $n` với **`normalizePlate(query.plateNumber)`**. Bind index liên tục; rows thêm `LIMIT $ OFFSET $` SAU filter params; COUNT cùng WHERE (KHÔNG limit/offset).
- `meta{page,limit,total,totalPages:Math.ceil}`. SEC-03 bind. Read-only (SELECT/COUNT).

## 3. DTO — `ListVehicleHistoryQueryDto` (1 DTO chung)
`src/modules/anpr/dto/list-vehicle-history-query.dto.ts`: `page`/`limit` (`@Type Number` def 1/20, max 100), `from?`/`to?` (`@IsOptional @IsISO8601`), `direction?` (`@IsOptional @IsIn(['enter','leave','seen'])`), `plateNumber?` (`@IsOptional @IsString @MaxLength(20)` — raw, service normalize), `matchState?` (`@IsOptional @IsIn(['matched','unmatched'])`).
- **1 DTO chung** cho cả 2 route (đơn giản; `listForUser` BỎ QUA `matchState` — chỉ `listAll` dùng). user gửi matchState → vô hại (không lọc).

## 4. Controller — 2 route (thêm vào `VehicleRegistrationController`)
- **USER**: `@Get('vehicle-history')` `@UseGuards(JwtAuthGuard)` `@UsePipes(ValidationPipe{whitelist,transform})` `@CurrentUser() user` `@Query() query` → `listForUser(user.userId, query)` → `{success:true, message:'Vehicle history retrieved', data: items, meta}`.
- **ADMIN**: `@Get('admin/vehicle-history')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('anpr.vehicle.history_view')` `@UsePipes(...)` `@Query() query` → `listAll(query)` → envelope+meta.
- Inject `VehicleHistoryService`. **Đặt 2 route history TRƯỚC route `vehicle-registrations/:id`** trong file (an toàn dù path đã tách). KHÔNG đụng route UC1-3/6.

## 5. Module wiring — `anpr.module.ts` (Modified)
- providers: thêm `VehicleHistoryService`. controllers giữ nguyên. KHÔNG đổi env/migration.

## 6. File list
### Net-new
- `src/modules/anpr/services/vehicle-history.service.ts` (+ `.spec.ts`)
- `src/modules/anpr/dto/list-vehicle-history-query.dto.ts`
### Modified
- `src/modules/anpr/controllers/vehicle-registration.controller.ts` (+ 2 route + inject) (+ `.spec.ts` thêm test)
- `src/modules/anpr/anpr.module.ts` (+ provider `VehicleHistoryService`)
> Tổng **3 net-new (2 code + 1 spec) + 3 modified** (controller + controller.spec + module). 0 migration. 0 đổi env. 0 đụng logic UC1-6.

## 7. Test (mock DataSource — KHÔNG DB)
- **user-scope (SEC)**: `listForUser('u1', q)` → SQL WHERE `payload_json->>'userId' = $1` + param `'u1'`; KHÔNG trả event user khác/unmatched (userId null tự loại).
- **admin all**: `listAll(q)` → WHERE chỉ `event_type` (matched + unmatched); output có `userId`.
- **C1-isolation**: SQL chứa `event_type = 'ivss_vehicle_event'`; KHÔNG `face_verify`/`face_stranger`.
- **filter time/direction/plate**: from/to → `event_time >=`/`<=`; direction → `payload_json->>'direction' = $`; **plate normalize** — filter `"30A-123.45"` → param `"30A12345"` (qua normalizePlate).
- **admin matchState filter**: `listAll({matchState:'unmatched'})` → `payload_json->>'matchState' = $`.
- **bind index đúng (nhiều filter)**: tổ hợp (userId + from + direction + plate + limit/offset) → `$1..$n` liên tục, không lệch; COUNT cùng filter params (KHÔNG limit/offset).
- **meta total** (COUNT, total=25 limit=20→2); **pagination** page2/limit20 → LIMIT 20 OFFSET 20.
- **output field**: user KHÔNG có userId; admin CÓ userId; cả 2 có plateNumber/direction/eventTime/utc/channelId/matchState; channelId `::int`.
- **list rỗng** []+total0; **validate** (direction sai/from-to không ISO/limit>100) → 400; **SEC-03 bind** (giá trị qua param); **read-only** (chỉ SELECT/COUNT).
- **controller**: user route JwtAuthGuard + userId từ @CurrentUser; admin route PermissionsGuard + `@RequirePermissions('anpr.vehicle.history_view')` (metadata).
- **UC1-6 KHÔNG hồi quy**: `jest src/modules/anpr` xanh.
- Coverage **≥80%** `vehicle-history.service.ts`.

## 8. Gate (STOP, KHÔNG commit)
- build=0; eslint touched (service + dto + controller + module + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (UC1-6 + UC7); coverage ≥80% service mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies). **KHÔNG live, KHÔNG DB.**
- **Owed (ghi, KHÔNG chạy)**: seed permission `anpr.vehicle.history_view` (cùng nhóm `anpr.vehicle.*`) — chưa seed → 403 · pairing enter/leave → "phiên"/dwell · analytics/thống kê · matchState (đã có)/`channelId` filter mở rộng · channel→tên cổng · index hiệu năng (`payload_json->>'userId'`/`event_type`, GIN/expression) · real-time push · live khi bridge UC8.

## 9. Kỷ luật
- **No-migration** (đọc iot_device_events). **C1-isolation** `event_type='ivss_vehicle_event'` — KHÔNG nhiễm face. **User-scope** `payload_json->>'userId'=current` (từ JWT). **Plate filter normalize** (normalizePlate trước khi so). **Read-only** (SELECT/COUNT). **SEC-03** raw SQL bind. **Route path tách** `/anpr/vehicle-history` (tránh `:id`).
- KHÔNG pairing/analytics (owed) · KHÔNG dùng VehicleRegistrationService · KHÔNG đụng UC1-6/route khác · KHÔNG seed RBAC.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang tasks. KHÔNG code.
