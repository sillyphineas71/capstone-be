# VHI-001 — UC7 (ANPR): lịch sử ra/vào cổng (vehicle access history)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-25 | Tạo spec VHI-001 (UC7, UC cuối backend ANPR): user xem lịch sử xe CỦA MÌNH (matched) + admin xem TẤT CẢ lượt ra/vào (matched+unmatched). Query `iot_device_events` event_type='ivss_vehicle_event', filter time/direction/plate, phân trang. MIRROR UC6 (raw SQL JSON + bind động + COUNT). RECON code thật. OQ chờ chốt. | Toàn bộ |
| 2026-06-25 | Thiếu Chủ CHỐT OQ-1…6 + ràng buộc: OQ-1 user-scope `payload_json->>'userId'=$current` (raw SQL) · OQ-2 user chỉ matched của mình · OQ-3 user time+direction+plate, admin thêm `matchState` (channel owed) · OQ-4 `anpr.vehicle.history_view` · OQ-5 output 6 field, admin thêm userId · OQ-6 2 method · RÀNG BUỘC `plateNumber` filter PHẢI normalizePlate trước khi so; path tách `/anpr/vehicle-history`. §7 ĐÃ CHỐT. | §7, §2, §3 |

> **SPEC-ONLY.** Chưa plan/tasks/code. UC5 đã ghi MỌI lượt xe vào `iot_device_events` (matched có `userId` trong payload, unmatched null). UC7 = **xem lịch sử**: (a) user xem xe của mình, (b) admin xem tất cả. **Read-only.** KHÔNG pairing enter/leave thành "phiên" (owed), KHÔNG analytics/dwell (owed), KHÔNG real-time, KHÔNG bridge/camera, KHÔNG migration, KHÔNG sửa UC1-6.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. UC5 payload — dữ liệu UC7 query ([vehicle-resolve.service.ts](../../../../src/modules/anpr/services/vehicle-resolve.service.ts))
- INSERT `iot_device_events`: `event_type='ivss_vehicle_event'`, cột `event_time`. `payload_json` **top-level**: `{ plateRaw, plateNumber, userId(null khi unmatched), channelId, direction('enter'|'leave'|'seen'), matchState('matched'|'unmatched'), eventActionRaw, plateColor, vehicleColor, vehicleType, utc, receivedAt }`.
- ⇒ UC7 lọc `event_type='ivss_vehicle_event'`; user route thêm `payload_json->>'userId' = $current` (chỉ matched của user); admin route lấy tất cả.

### 0.2. UC6 query — KHUÔN MẪU MIRROR TRỰC TIẾP ([vehicle-unknown.service.ts](../../../../src/modules/anpr/services/vehicle-unknown.service.ts))
- Raw SQL `dataSource.manager.query`: WHERE base (literal event_type + matchState) + **time-range build động** (`params.push`; `event_time >= $n`/`<= $n`), `(payload_json->>'channelId')::int`, `ORDER BY event_time DESC LIMIT $ OFFSET $`, **COUNT(*) cùng WHERE** → `meta:{page,limit,total,totalPages}`. Bind index liên tục (params động trước, limit/offset sau). ⇒ UC7 mirror gần trực tiếp, đổi filter (bỏ matchState='unmatched', thêm userId/direction/plateNumber).

### 0.3. UC3 owner-scope ([vehicle-registration.service.ts list]) + @CurrentUser
- UC3 list lọc `where.userId` (repo, theo cột `vehicle_registrations.user_id`). NHƯNG UC7 events KHÔNG có cột user_id — userId nằm trong `payload_json`. ⇒ user route UC7 lọc `payload_json->>'userId' = $current` (KHÔNG repo, raw SQL — KHÁC UC3). `@CurrentUser()` → `{userId}` (UC1-3).

### 0.4. Admin-gate UC1/UC6 ([vehicle-registration.controller.ts])
- `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.unknown_view')` (UC6 admin). ⇒ UC7 admin route mirror với `anpr.vehicle.history_view`.

### 0.5. ⚠ Route ordering (gotcha)
- UC3 có `GET vehicle-registrations/:id` (param). Nếu user history đặt `vehicle-registrations/history` → có thể bị `:id` nuốt ("history" thành id) → **400 ParseUUIDPipe** hoặc match nhầm. ⇒ Đề xuất user path **`/anpr/vehicle-history`** (KHÔNG nested dưới `:id`) — tránh clash; admin **`/anpr/admin/vehicle-history`** (symmetric). [§4]

---

## 1. Scope (UC7)

### TRONG scope
1. **USER route** `GET /api/v1/anpr/vehicle-history`: lịch sử xe CỦA MÌNH — query events `event_type='ivss_vehicle_event' AND payload_json->>'userId' = $current` (chỉ matched của user). `JwtAuthGuard`, userId từ `@CurrentUser`.
2. **ADMIN route** `GET /api/v1/anpr/admin/vehicle-history`: TẤT CẢ lượt ra/vào (matched + unmatched). `PermissionsGuard` + `@RequirePermissions('anpr.vehicle.history_view')`.
3. **Filter** (cả 2): time-range `from`/`to` (event_time), `direction` (enter/leave/seen) optional, `plateNumber` optional. Phân trang mirror UC3/UC6 (page/limit/meta total).
4. **Hiển thị**: user CHỈ matched của mình (unmatched không gắn userId → không thuộc ai); admin thấy cả unmatched (userId null) + matchState.
5. **C1-isolation** + **read-only** + raw SQL JSON bind (mirror UC6).

### NGOÀI scope (owed / UC khác)
- KHÔNG pairing enter/leave thành "phiên" (chỉ list từng event — owed, như face presence). KHÔNG analytics/dwell/count. KHÔNG real-time. KHÔNG bridge/camera. KHÔNG migration. KHÔNG sửa UC1-6.

## 2. DTO (đề xuất — mô tả, KHÔNG code)
`ListVehicleHistoryQueryDto` (mirror UC6 + thêm filter):
- `page`/`limit` (`@Type Number`, default 20 max 100).
- `from?`/`to?` (`@IsOptional @IsISO8601`) — theo `event_time`.
- `direction?` (`@IsOptional @IsIn(['enter','leave','seen'])`).
- `plateNumber?` (`@IsOptional @IsString @MaxLength(16)`) — match `payload_json->>'plateNumber'` (đã normalize). (Cân nhắc normalize input qua `normalizePlate` để khớp — §residual.)
- `whitelist:true`.

## 3. Service (đề xuất — `VehicleHistoryService`, 2 method, raw SQL mirror UC6)
- `src/modules/anpr/services/vehicle-history.service.ts` — inject `DataSource`.
- **`listForUser(userId, query)`**: WHERE `event_type='ivss_vehicle_event' AND payload_json->>'userId' = $userId` + filter động (from/to/direction/plateNumber). (Chỉ matched của user — unmatched userId null KHÔNG khớp.)
- **`listAll(query)`**: WHERE `event_type='ivss_vehicle_event'` + filter động (matched + unmatched). (matchState filter optional cho admin — OQ-3.)
- Cả 2: `SELECT payload_json->>'plateNumber', (payload_json->>'channelId')::int, payload_json->>'direction', payload_json->>'matchState', event_time, payload_json->>'utc' …` `ORDER BY event_time DESC LIMIT $ OFFSET $` + COUNT total → meta. Bind index động (mirror UC6). KHÔNG dùng VehicleRegistrationService.

## 4. Controller (đề xuất — 2 route)
- **USER**: `@Get('vehicle-history')` `@UseGuards(JwtAuthGuard)` `@UsePipes(ValidationPipe)` `@CurrentUser() user` `@Query() query` → `listForUser(user.userId, query)`.
- **ADMIN**: `@Get('admin/vehicle-history')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('anpr.vehicle.history_view')` `@Query() query` → `listAll(query)`.
- Cả 2 trả `{ success:true, message:'Vehicle history retrieved', data: items, meta }` (200). (Thêm vào `VehicleRegistrationController` hoặc controller mới — chốt plan.) **Path `/anpr/vehicle-history`** tránh clash `:id` (§0.5).

## 5. Requirements (EARS)
- **R1**: **WHEN** user gọi `GET /anpr/vehicle-history` **→** trả lịch sử event của xe user (`payload_json->>'userId'=current`, chỉ matched), sort `event_time DESC`, phân trang + meta.
- **R2**: **WHEN** admin (quyền `history_view`) gọi `GET /anpr/admin/vehicle-history` **→** trả TẤT CẢ event vehicle (matched + unmatched).
- **R3 (filter)**: **IF** query có `from`/`to`/`direction`/`plateNumber` **→** lọc thêm tương ứng (bind động, index không lệch).
- **R4 (user-scope SEC)**: **WHILE** user route, CHỈ event có `payload_json->>'userId' = current` — user KHÔNG thấy event user khác / unmatched (biển lạ là việc admin/UC6).
- **R5 (admin SEC)**: **IF** thiếu quyền `anpr.vehicle.history_view` **→** 403; user thường KHÔNG gọi được admin route.
- **R6 (C1-isolation)**: **WHILE** query, CHỈ `event_type='ivss_vehicle_event'` — KHÔNG đụng face.
- **R7 (read-only)**: KHÔNG tạo/sửa/xóa.
- **R8 (rỗng)**: KHÔNG có event → `data:[]` + 200 + `meta.total=0`.
- **R9 (VAL)**: `page`/`limit` sai / `direction` ngoài enum / `from`/`to` không ISO → 400.

## 6. Constitution
- **SEC-01 (user-scope)**: user route lọc cứng `payload_json->>'userId' = current` (từ JWT, KHÔNG query/body) — KHÔNG lộ event user khác. admin route gate `PermissionsGuard` + `@RequirePermissions('anpr.vehicle.history_view')`.
- **ARCH-01**: controller→service→`DataSource` raw SQL (mirror UC6); 2 method `listForUser`/`listAll`; KHÔNG dùng `VehicleRegistrationService`.
- **DATA-01 (C1-isolation)**: CHỈ `event_type='ivss_vehicle_event'`, read-only.
- **DATA-02**: no-migration (đọc `iot_device_events`).
- **SEC-03**: raw SQL bind (userId/from/to/direction/plateNumber/limit/offset).
- **VAL-01**: query DTO validate.

## 7. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 (crux) user-scope — CHỐT**: lọc `payload_json->>'userId' = $current` (raw SQL, KHÔNG JOIN `vehicle_registrations`).
- **OQ-2 user thấy unmatched — CHỐT**: user CHỈ matched của mình (unmatched userId null → tự loại). User KHÔNG thấy biển lạ (việc admin/UC6).
- **OQ-3 filter — CHỐT**: user route = time-range + `direction` + `plateNumber`. Admin route thêm `matchState` optional (`@IsIn(['matched','unmatched'])` — admin lọc chỉ-khớp / chỉ-lạ). `channelId` filter = owed.
- **OQ-4 permission — CHỐT**: `anpr.vehicle.history_view` (owed seed cùng nhóm `anpr.vehicle.*`).
- **OQ-5 output — CHỐT**: `plateNumber/direction/eventTime/utc/channelId/matchState`; **admin route thêm `userId`** (matched events); user route KHÔNG cần userId (đều của mình).
- **OQ-6 service/method — CHỐT**: 1 `VehicleHistoryService` 2 method `listForUser(userId, query)` / `listAll(query)`.

### ⚠ RÀNG BUỘC THÊM (cứng)
- **`plateNumber` filter PHẢI normalize**: nếu query có `plateNumber`, gọi `normalizePlate()` (UC1) TRƯỚC khi so `payload_json->>'plateNumber'` (DB lưu đã normalize từ UC4/UC5). KHÔNG so raw — sẽ trượt. (Test: filter `"30A-123.45"` → query so `"30A12345"`.)
- **Route path tách**: `/anpr/vehicle-history` (user) + `/anpr/admin/vehicle-history` (admin) — KHÔNG đặt dưới `vehicle-registrations/...` (tránh `:id` nuốt — §0.5).

## 8. Residuals / known-gaps
- **Pairing enter/leave → "phiên"** owed: UC7 list từng event; ghép thành lượt vào-ra (dwell time) = owed (như face presence duration).
- **Analytics/thống kê** owed: count theo ngày/cổng, tỷ lệ matched/unmatched = owed (analytics module).
- **plateNumber filter normalize**: input filter nên qua `normalizePlate` (UC1) để khớp `payload_json->>'plateNumber'` (đã normalize) — chốt plan (đề xuất normalize input).
- **Seed permission `anpr.vehicle.history_view`** owed (mirror UC1/UC6 admin permission) — chưa seed → 403.
- **channel→tên cổng** owed: payload chỉ channelId số.
- **Real-time** owed: UC7 pull; push lịch sử/cảnh báo = owed.
- **Live owed**: dữ liệu thật khi bridge (UC8) gửi; UC7 test mock query.
- **Index hiệu năng**: query `payload_json->>'userId'`/`event_type` trên `iot_device_events` lớn — cân nhắc index (GIN/expression) ở owed (không migration trong UC7).

> **STOP.** Spec-only. Chờ Thiếu Chủ review §0 RECON (UC6 mirror + §0.5 route clash) + chốt OQ-1…OQ-6 trước khi plan/tasks. KHÔNG tự code.
