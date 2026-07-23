# GAL-001 — UC-107 (Zones): Xem & tra cứu lịch sử ra vào cổng

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec GAL-001 (UC-107, FT-20 SCMPTS): đọc `gate_access_logs` — 2 route own/admin (`GET /gate-access-logs`, `GET /admin/gate-access-logs`) trong module `zones`, controller/service net-new, KHÔNG đụng `ZonesController`/`ZonesService`. RECON đã xác minh trước (§0). 10 quyết định đã chốt (§7). ⚠ Bảng **append-only, KHÔNG soft-delete** — cấm `deletedAt` (QĐ-4). | Toàn bộ |
| 2026-07-23 | Thiếu Chủ chốt OQ-1→OQ-8 (§8 → ĐÃ CHỐT). **(i) Quyết định bổ sung** (ngoài OQ): thống nhất từ vựng `direction` = **`'enter'`/`'leave'`** (KHÔNG `'in'`/`'out'`) — khớp `iot_device_events`/`ListVehicleHistoryQueryDto`/IVSS channel map; khai hằng dùng chung `GATE_DIRECTIONS`; ràng buộc lên writer UC-105; KHÔNG thêm CHECK (ép ở application). **(ii) OQ-5 chốt KHÁC đề xuất agent**: KHÔNG chấp nhận residual "lượt xe không hiện ở route own" — thay bằng **ràng buộc lên UC-105** phải gán `user_id` khi biển resolve được (repo đã có `VehicleResolveService`). Cập nhật §2/§3/§4/§5/§9. | §2, §3, §4, §5, §8, §9 |

> **SPEC-ONLY.** Chưa plan/tasks/code. RECON đối chiếu độc lập trên code thật (§0). 10 quyết định đã chốt ở §7 — **KHÔNG mở lại**. Đọc-thuần (read-only): KHÔNG ghi, KHÔNG audit, KHÔNG migration schema. Kế thừa convention `zones`/`anpr` (envelope `{success, message, data, meta}`, `ValidationPipe({whitelist,transform})`, filter vắng mặt không lọt `where`, bound param SEC-03).
> ⚠⚠ **ĐIỂM DỄ SAI NHẤT: `gate_access_logs` KHÔNG có `deleted_at`** (append-only audit log). TUYỆT ĐỐI **KHÔNG** copy `deletedAt: IsNull()` từ UC-90→94/UC-101 vào bất kỳ truy vấn nào của UC-107. Xem QĐ-4 và R8.

---

## 0. RECON findings (đã đọc CODE THẬT — đã xác minh, không kiểm lại)

### 0.1. `GateAccessLogEntity` — cấu trúc ([gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts))
- `@Entity('gate_access_logs')` ([:30-31](../../../../src/modules/zones/entities/gate-access-log.entity.ts)), module **`zones`**.
- **13 cột**: `id` · `zoneId`(NOT NULL) · `deviceId`/`eventId`/`userId`/`vehicleRegistrationId`(uuid nullable) · `plateNumber` varchar(16) nullable · `direction` varchar(10) NOT NULL · `accessTime` timestamptz · `pairedLogId` uuid nullable (self-FK) · `durationSeconds` int nullable · `metadataJson` jsonb · `createdAt`.
- ⚠⚠ **CHỈ `@CreateDateColumn` ([:68](../../../../src/modules/zones/entities/gate-access-log.entity.ts)), KHÔNG `@DeleteDateColumn`** — comment [:19](../../../../src/modules/zones/entities/gate-access-log.entity.ts) *"KHÔNG soft-delete: đây là audit log"*. Append-only.
- **6 `@ManyToOne`** ([:71-103](../../../../src/modules/zones/entities/gate-access-log.entity.ts)): `zone`(RESTRICT) · `device`/`event`/`user`/`vehicleRegistration`(SET NULL) · `pairedLog` self-FK(SET NULL). ⇒ lấy tên cổng/người/biển bằng `leftJoinAndSelect` qua relation, KHÔNG import module khác.
- ⚠ `direction` varchar(10) **không CHECK** ([migration:25](../../../../src/database/migrations/20260721000004-CreateGateAccessLogsTable.ts)) — `'in'`/`'out'` chỉ là quy ước; writer (UC-105) chưa tồn tại nên giá trị thực chưa chốt (xem OQ).

### 0.2. Index ([20260721000004:47-66](../../../../src/database/migrations/20260721000004-CreateGateAccessLogsTable.ts))
| Index | Cột | Phục vụ |
| :--- | :--- | :--- |
| `IDX_gate_logs_user_time` | `(user_id, access_time DESC)` | Route user: log của mình theo thời gian |
| `IDX_gate_logs_zone_time` | `(zone_id, access_time DESC)` | Filter theo cổng + thời gian |
| `IDX_gate_logs_plate` | `(plate_number)` | Filter theo biển |
| `IDX_gate_logs_unpaired` | `(user_id, direction) WHERE paired_log_id IS NULL` | (UC-106 pairing — KHÔNG thuộc UC-107) |
- ⇒ **Dùng index**: `user_id`+`access_time` (route user), `zone_id`+`access_time`, `plate_number` exact. **Sequential scan**: `direction` đơn lẻ, `access_time` không kèm user/zone.

### 0.3. Trạng thái bảng
- **Chưa có** service/controller/DTO/mapper nào cho `gate_access_logs`; **chưa có code GHI** (writer = UC-105, chưa xây) — grep toàn repo chỉ thấy entity + migration + 2 comment ở `zones.service.ts:355,362`.
- Entity **đã đăng ký** `TypeOrmModule.forFeature` ([zones.module.ts:40-44](../../../../src/modules/zones/zones.module.ts)).

### 0.4. `PaginationMeta` (dùng lại — QĐ-6)
- **Đã export** `export interface PaginationMeta { page; limit; total; totalPages }` tại [zones.service.ts:49](../../../../src/modules/zones/services/zones.service.ts#L49) (từ UC-93). ⇒ import dùng lại, **CẤM** khai bản mới.

### 0.5. Field hiển thị qua relation
- `UserEntity`: `fullName` (cột `full_name`) + `email` ([user.entity.ts:44-45,55-56](../../../../src/modules/accounts/entities/user.entity.ts)).
- `ZoneEntity`: `zoneCode` (`zone_code`) + `zoneName` (`zone_name`) + `zoneType` ([zone.entity.ts:26-33](../../../../src/modules/zones/entities/zone.entity.ts)). (Zone CÓ soft-delete, nhưng UC-107 không lọc theo zone soft-delete — xem OQ/residual.)
- `VehicleRegistrationEntity`: `plateNumber`/`plateRaw` ([vehicle-registration.entity.ts:30-34](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts)).

### 0.6. Tiền lệ own/admin split — `uc7-vehicle-history` ⭐ (khuôn chính)
- [ListVehicleHistoryQueryDto](../../../../src/modules/anpr/dto/list-vehicle-history-query.dto.ts): 1 DTO chung 2 route — `page`/`limit`/`from`/`to`(`@IsISO8601`)/`direction`(`@IsIn`)/`plateNumber`(`@MaxLength(20)`, raw→normalize)/`matchState`(admin-only).
- [vehicle-history.service.ts:50-99](../../../../src/modules/anpr/services/vehicle-history.service.ts): `listForUser(userId, query)` fold cứng user; `listAll(query)` không fold; `applyFilters` gắn từng điều kiện bằng **bound param** ($n); `plateNumber` → `normalizePlate()` **TRƯỚC** khi so ([:93-96](../../../../src/modules/anpr/services/vehicle-history.service.ts)).
- ⚠ Khác biệt: history dùng **raw SQL** trên `iot_device_events`; UC-107 dùng **QueryBuilder + relation** trên `gate_access_logs` (có FK thật). direction history = `enter/leave/seen`; gate = `in/out` (quy ước).

### 0.7. Mẫu seed permission ([20260722000005-SeedZoneAssignDevicePermission.ts](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts))
- INSERT 6 cột `(permission_code, permission_name, module_code, action_code, description, is_active)`, `action_code` tường minh, `ON CONFLICT (permission_code) DO NOTHING RETURNING id` + fallback SELECT, `down()` xoá `role_permissions` trước. Permission `zones` hiện dạng 3 tầng dấu chấm (`zones.zone.*`).

### 0.8. Mốc
- Migration cuối: `20260722000006-SeedAnprVehicleAdminReadPermission.ts` ⇒ UC-107 lấy **`20260722000007`** (T0 đếm lại).
- Baseline: `zones` **8 suite / 131 test** (con số đối chiếu không hồi quy).
- `zones → iot` một chiều vĩnh viễn ([zones.module.ts:30-31](../../../../src/modules/zones/zones.module.ts)); UC-107 không phát sinh cạnh mới (đọc qua relation).

---

## 1. Scope (UC-107)

### TRONG scope
1. **`GateAccessLogService`** net-new (module `zones`): `listForUser(userId, query)` (fold cứng `userId`) + `listAll(query)` (không fold).
2. **`GateAccessLogController`** net-new: `GET /api/v1/gate-access-logs` (của mình) + `GET /api/v1/admin/gate-access-logs` (admin — mọi log).
3. **DTO** query (own) + query admin (thêm filter chủ nhân/biển) — cấu trúc chốt ở plan.
4. **Mapper** response (own không lộ chủ nhân; admin trả kèm tên cổng/người/biển).
5. **1 migration seed permission** `zones.gate_log.read` (route admin).
6. Đăng ký `GateAccessLogController` + `GateAccessLogService` vào `zones.module.ts` (thêm controller/provider — thay đổi tối thiểu, xem §5).
7. Unit test (mock repo, không DB).

### NGOÀI scope
- **KHÔNG** ghi `gate_access_logs` (UC-105 writer — chưa xây). UC-107 chỉ **ĐỌC**.
- **KHÔNG** ghép cặp in/out (UC-106): chỉ **đọc** `paired_log_id`/`duration_seconds`, không tính/không ghi.
- **KHÔNG** đụng `zone_presence_events` (FT-21).
- **KHÔNG** sửa `ZonesService`/`ZonesController`/`ZonesAuditRepository`/`ZoneEntity`/`GateAccessLogEntity`.
- **KHÔNG** migration schema (không cột/index dù seq scan) — migration duy nhất = seed permission.
- **KHÔNG** soft-delete/`deletedAt` (bảng không có — QĐ-4).
- **KHÔNG** audit (read-only — QĐ-10).
- **KHÔNG** khai `PaginationMeta` bản mới.

## 2. DTO

### 2.1. `ListGateAccessLogsQueryDto` (route user) — net-new
Mirror `ListVehicleHistoryQueryDto`. Bộ filter cụ thể chờ OQ-1; khung đề xuất:

| Property | Field API | Ràng buộc đề xuất | Index? |
| :--- | :--- | :--- | :--- |
| `page` / `limit` | `page`/`limit` | `@Type(()=>Number) @IsOptional @IsInt @Min(1)` (+`@Max(100)` cho limit) | — |
| `from?` | `from` | `@IsOptional @IsISO8601()` (khoảng `access_time`) | ✅ với `user_id` |
| `to?` | `to` | `@IsOptional @IsISO8601()` | ✅ với `user_id` |
| `direction?` | `direction` | `@IsOptional @IsIn(GATE_DIRECTIONS)` — **`['enter','leave']`** (ĐÃ CHỐT §1.1, bỏ `'seen'`) | ❌ seq scan |
| `zoneId?` | `zone_id` | `@Expose({name:'zone_id'}) @IsOptional @IsUUID('4')` | ✅ nếu lọc theo zone |
- **KHÔNG** `user_id`/`plate` ở route user (SEC-01 — chỉ log của mình). **KHÔNG** `sort_by`/`include_deleted`.
- `GATE_DIRECTIONS` khai hằng dùng chung trong `src/modules/zones/constants/` (UC-105/UC-106 tái dùng) — CẤM rải chuỗi literal.

### 2.2. `AdminListGateAccessLogsQueryDto` (route admin) — net-new
`extends` DTO user (khuôn UC-101) + filter chủ nhân/biển (ĐÃ CHỐT OQ-1):

| Field API | Property | Ràng buộc | Index? |
| :--- | :--- | :--- | :--- |
| *(kế thừa)* `page`/`limit`/`from`/`to`/`direction`/`zone_id` | | như lớp cha | — |
| `user_id` | `userId` | `@Expose({name:'user_id'}) @IsOptional @IsUUID('4')` | ✅ |
| `plate` | `plate` | `@IsOptional @IsString @MaxLength(20)` — service `normalizePlate()` → so **exact** (ĐÃ CHỐT OQ-3) | ✅ `IDX_gate_logs_plate` |

## 3. Service — net-new `GateAccessLogService`

`@Injectable`, inject `@InjectRepository(GateAccessLogEntity)`. Dùng lại `PaginationMeta` (import từ `zones.service.ts` cùng module — KHÔNG xuyên module). Khuôn 2 method (RECON §0.6).

### 3.1. `listForUser(userId, query)`
- QueryBuilder `gal`, `leftJoinAndSelect('gal.zone','z')` (tên cổng); **fold cứng** `where('gal.userId = :userId', { userId })`.
- ⚠⚠ **KHÔNG** `deletedAt IS NULL` — bảng append-only (QĐ-4/R8).
- Filter (chỉ thêm khi có giá trị — cấm `undefined` lọt `where`): `from`→`gal.accessTime >= :from`; `to`→`gal.accessTime <= :to`; `direction`→`gal.direction = :direction`; `zoneId`→`gal.zoneId = :zoneId`. Mọi giá trị **bound param**.
- `orderBy('gal.accessTime','DESC')` (hard-code — QĐ-5) → `skip/take` → `getManyAndCount()`.

### 3.2. `listAll(query)` — admin, KHÔNG fold
- QueryBuilder + **LUÔN** `leftJoinAndSelect('gal.zone','z')` + `leftJoinAndSelect('gal.user','u')` (ĐÃ CHỐT OQ-4 — response admin luôn cần tên cổng + chủ nhân). `vehicle_registration_id` trả thẳng (không bắt buộc join `vr` — `plate_number` đã snapshot trên log).
- Filter như §3.1 **cộng** `userId`→`gal.userId = :uid` (exact) và `plate`→`normalizePlate(plate)` rồi `gal.plateNumber = :plate` **exact** (ĐÃ CHỐT OQ-3, dùng `IDX_gate_logs_plate`).
- **KHÔNG** fold userId; **KHÔNG** `deletedAt`. `orderBy accessTime DESC`, `getManyAndCount()`.
- ⚠ **Search kết hợp filter** (bài học UC-93): nếu có `plate`/`user_id` kèm `from/to`, QueryBuilder phải gắn **cả**; test phải chứng minh.
- ✅ An toàn phân trang: `gal.zone`/`gal.user` là `@ManyToOne` (không nhân dòng) ⇒ `getManyAndCount()` + `skip/take` đúng.

## 4. Mapper — response (ĐÃ CHỐT OQ-4 — mapper riêng cho từng route)

- **Route user** `toGateAccessLogResponse`: `id`, `zone_id`, `zone_name` (qua join), `direction`, `access_time`, `plate_number` (của chính mình), `paired_log_id`, `duration_seconds`, `vehicle_registration_id`. **KHÔNG** khối `user`/owner (thừa — đều của chính mình, SEC-01).
- **Route admin** `toAdminGateAccessLogResponse`: mọi field trên **cộng** `user: { user_id, full_name, email }` (CHỈ 3 khoá — CẤM `phone`/`department`/`username`/trạng thái tài khoản, mirror UC-101 OQ-3) + `zone_code`. **Mapper riêng**, KHÔNG sửa/không tái dùng mapper user để lộ owner.
- Cả 2 mapper **CÓ** trả `paired_log_id`/`duration_seconds` (ĐÃ CHỐT OQ-6) — hiện luôn NULL cho tới UC-106.

## 5. Controller — net-new `GateAccessLogController`

```text
GET /api/v1/gate-access-logs         → listForUser (JwtAuthGuard, fold userId từ JWT)
GET /api/v1/admin/gate-access-logs   → listAll (JwtAuthGuard + PermissionsGuard + zones.gate_log.read)
```
- URL **KHÔNG** dưới `/zones` (QĐ-2): log ra/vào cổng không phải resource "zone". `@Controller()` prefix rỗng hoặc tách — chốt ở plan; `api/v1` set ở `main.ts`.
- Route admin gate `@RequirePermissions('zones.gate_log.read')` (QĐ-7); route user chỉ `JwtAuthGuard`.
- ⚠ Thứ tự khai: `admin/gate-access-logs` và `gate-access-logs` khác literal prefix segment đầu (`admin` ≠ `gate-access-logs`) ⇒ **không xung đột** (đính chính UC-101). Không có route `:id` trong UC-107 nên không có bẫy nuốt route.
- **`zones.module.ts` thêm**: `controllers: [ZonesController, GateAccessLogController]`, `providers: [..., GateAccessLogService]`. KHÔNG đổi imports (relation không cần import module khác).

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| List thành công (user/admin) | `200` | — |
| List rỗng | `200` + `data:[]`, `meta.total=0` | — |
| Query sai (`limit>100`, `page<1`, `from/to` không ISO8601, `user_id` không UUID) | `400` | (Nest validation) |
| Chưa đăng nhập | `401` | — |
| Route admin thiếu permission | `403` | `FORBIDDEN` (guard) |

## 6. Requirements (EARS)

- **R1**: **WHEN** người dùng đã xác thực gọi `GET /gate-access-logs` **→** hệ thống trả **chỉ log có `gal.userId = current`**, khớp filter được gửi, sort `access_time DESC`, kèm `meta`.
- **R2**: **WHEN** admin có permission gọi `GET /admin/gate-access-logs` **→** hệ thống trả log của **mọi người** (không fold `userId`), áp filter được gửi.
- **R3**: **WHILE** dựng truy vấn, filter **không được gửi** KHÔNG được đưa vào `WHERE` (kể cả `undefined`).
- **R4 (SEC-03)**: mọi giá trị filter (`from`/`to`/`direction`/`zone_id`/`user_id`/`plate`) qua **bound param**; CẤM nội suy chuỗi vào SQL.
- **R5 (SEC-01)**: route user **KHÔNG** nhận `user_id`/`plate`; kể cả client lén gửi, `whitelist` loại và query vẫn fold cứng `userId` từ JWT.
- **R6 (SEC-02)**: route admin PHẢI qua `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('zones.gate_log.read')`; thiếu → `403`, KHÔNG trả dữ liệu.
- **R7**: **WHERE** danh sách rỗng **→** `200` + `data: []`, `meta.total = 0` (KHÔNG 404).
- **R8 (⚠ crux)**: **WHILE** MỌI truy vấn của UC-107, **KHÔNG** thêm điều kiện `deleted_at`/soft-delete — bảng `gate_access_logs` **không có cột đó** (append-only). Thêm sẽ gây lỗi SQL "column does not exist".
- **R9**: **IF** `limit > 100` / `page < 1` / `from`/`to` sai ISO8601 / `user_id` không UUID **→** `400`, KHÔNG truy vấn DB.
- **R10**: `paired_log_id`/`duration_seconds` được **đọc và trả** nguyên trạng (do UC-106 ghi; hiện luôn NULL) — UC-107 KHÔNG tính toán chúng.

## 7. QUYẾT ĐỊNH ĐÃ CHỐT

1. **Module sở hữu** = `zones`; đọc tên người/biển qua **relation** (`leftJoinAndSelect`), KHÔNG import `AccountsModule`/`AnprModule`, không cạnh module mới.
2. **Controller riêng** `GateAccessLogController`, URL **KHÔNG dưới `/zones`**: `GET /api/v1/gate-access-logs` + `GET /api/v1/admin/gate-access-logs`.
3. **2 method** `listForUser`/`listAll`, phân biệt admin bằng **permission** (khuôn ANPR).
4. **⚠ KHÔNG soft-delete**: bảng append-only, TUYỆT ĐỐI không thêm `deletedAt: IsNull()`.
5. **Sort** `access_time DESC` hard-code; client không chọn sort.
6. **Phân trang** `page`/`limit` 1/20 max 100; **dùng lại `PaginationMeta`** đã export (zones.service.ts:49); cấm bản mới.
7. **Permission** admin route `zones.gate_log.read` (module_code `zones`, action_code `read`); route user chỉ `JwtAuthGuard`.
8. **Migration** chỉ seed permission, `20260722000007` (đếm lại T0); KHÔNG schema.
9. **Phạm vi**: KHÔNG đụng UC-105/UC-106/`zone_presence_events`; chỉ ĐỌC `paired_log_id`/`duration_seconds`.
10. **Audit**: KHÔNG (read-only).

## 8. OPEN QUESTIONS — ĐÃ CHỐT

> **Quyết định bổ sung (ngoài OQ) — §1.1 thống nhất `direction`**: `gate_access_logs.direction` dùng **`'enter'`/`'leave'`** (KHÔNG `'in'`/`'out'`), khớp `iot_device_events`/`ListVehicleHistoryQueryDto:42`/IVSS channel map. Khai hằng `GATE_DIRECTIONS = ['enter','leave']` trong `src/modules/zones/constants/`; **bỏ `'seen'`** (cổng chỉ vào/ra). KHÔNG thêm CHECK vào DB — ép ở application. **Ràng buộc lên writer UC-105**: PHẢI ghi `'enter'`/`'leave'`.

- **OQ-1 (crux) — Bộ filter cho từng route.** *Đề xuất*:
  - **User**: `from`/`to` (`access_time`, **dùng index** với `user_id`), `direction`, `zone_id`. **KHÔNG** `user_id`/`plate`.
  - **Admin**: kế thừa cha + `user_id` (exact, **dùng index**) + `plate` (exact, **dùng `IDX_gate_logs_plate`**).
  - Index: `from/to` + `user_id`/`zone_id` dùng được `IDX_gate_logs_user_time`/`zone_time`; `direction` đơn lẻ = **seq scan**; `plate` exact = index.
  → **CHỐT như đề xuất.** User: `from`/`to`/`direction`/`zone_id` (KHÔNG `user_id`/`plate`). Admin: kế thừa + `user_id` (exact) + `plate` (exact).
- **OQ-2 — Tên tham số khoảng thời gian.** *Đề xuất*: **`from`/`to`** với `@IsISO8601()` — **có tiền lệ** trực tiếp [ListVehicleHistoryQueryDto:33-39](../../../../src/modules/anpr/dto/list-vehicle-history-query.dto.ts). Kiểu: chuỗi ISO8601, service so `>= :from`/`<= :to` trên `accessTime`.
  → **CHỐT: `from`/`to`** với `@IsOptional() @IsISO8601()`.
- **OQ-3 (crux) — `plate` filter có normalize không?** *Bối cảnh*: cột `plate_number` varchar(16) do **writer UC-105 (chưa tồn tại)** ghi. Tiền lệ `vehicle_history`/`vehicle_registrations` lưu **đã normalize** và filter normalize trước khi so ([vehicle-history.service.ts:93-96](../../../../src/modules/anpr/services/vehicle-history.service.ts)). *Đề xuất*: **giả định writer ghi chuẩn hoá** ⇒ `plate` filter cũng `normalizePlate()` trước khi so exact (nhất quán ANPR). **Rủi ro**: nếu writer ghi thô thì filter lệch — ghi residual.
  → **CHỐT: nhận RAW → `normalizePlate()` → so EXACT (`=`)**, dùng `IDX_gate_logs_plate`. KHÔNG `ILIKE` partial (tra lượt của một xe cụ thể, không duyệt danh mục). Residual: giả định writer UC-105 ghi `plate_number` đã chuẩn hoá.
- **OQ-4 (crux) — Response trả kèm gì?** *Đề xuất*:
  - **Admin**: `leftJoinAndSelect` trả **tên cổng** (`zone_code`/`zone_name`), **chủ nhân** (`user: {user_id, full_name, email}`), **biển** (`plate_number` + link `vehicle_registration_id`). *Đánh đổi*: lộ dữ liệu `accounts`/`anpr` qua endpoint `zones` — nhưng chỉ cho admin có permission (đúng tiền lệ UC-101 OQ-3, chỉ `full_name`+`email`). Mapper riêng admin.
  - **User**: trả **tên cổng** (tiện) nhưng **KHÔNG** khối `user`/owner (đều của mình — thừa; SEC-01). `plate_number` của chính mình: trả.
  → **CHỐT: admin CÓ trả khối `user: {user_id, full_name, email}`** (CHỈ 3 khoá, CẤM field nhạy cảm khác) + tên cổng + biển. User KHÔNG có khối `user`. Mapper riêng cho mỗi route.
- **OQ-5 (crux nghiệp vụ) — Route user hiển thị gì khi `user_id` NULL?** Log **xe** có thể `user_id` NULL (chỉ `plate_number`). Nếu người dùng lái xe qua cổng mà writer **không** gán `user_id` (chỉ match biển), thì route "của tôi" (fold `gal.userId = current`) **sẽ KHÔNG thấy lượt đi xe của mình**. *Giả định*: writer UC-105 chưa tồn tại ⇒ chưa biết có gán `user_id` cho lượt xe không. *Đề xuất*: giữ fold cứng `userId` cho v1 (đúng SEC-01); ghi **residual** rằng lượt xe-không-user không hiện ở route own.
  → **CHỐT — KHÁC đề xuất agent**: KHÔNG chấp nhận residual bị động đó. Giữ fold cứng `userId` (đúng SEC-01) **VÀ** biến thành **ràng buộc chủ động lên UC-105**: *writer PHẢI gán `user_id` khi biển số resolve được về xe đã đăng ký (repo đã có `VehicleResolveService` làm đúng biển→`vehicle_registrations`→chủ xe). Không gán ⇒ lượt đi xe của người dùng biến mất khỏi lịch sử "của tôi".* Đây là thời điểm duy nhất còn sửa được (writer chưa xây).
- **OQ-6 — Trả `paired_log_id`/`duration_seconds`?** *Đề xuất*: **có trả** (FE hiển thị "đang trong khuôn viên" vs "đã ra" + thời lượng).
  → **CHỐT: CÓ trả** (cả 2 route). Residual: hiện **luôn NULL** tới khi UC-106 xong. UC-107 chỉ ĐỌC, TUYỆT ĐỐI KHÔNG GHI 2 field này.
- **OQ-7 — Role đọc route admin.** *Tiền lệ*: `zones.zone.read` chốt **4 role**; thao tác ghi zone **2 role**; ANPR admin_read **2 role**.
  → **CHỐT: 3 role** — `SYSTEM_ADMIN` + `BUSINESS_ADMIN` + `MANAGER`. KHÔNG `EMPLOYEE` (dữ liệu ra/vào toàn khuôn viên nhạy cảm hơn danh mục zone).
- **OQ-8 — Mâu thuẫn prompt vs luật**: → **XÁC NHẬN KHÔNG có mâu thuẫn mới**. Các lệch đã biết (4 role thật, error envelope thiếu `timestamp`/`path`, chưa Swagger, 5 file `spec/global/` rỗng) giữ nguyên.

## 9. Residuals / known-gaps

- **⚠ Bảng append-only, không `deleted_at`**: mọi truy vấn UC-107 KHÔNG có `deletedAt` — khác hẳn 6 UC trước. Đã nêu R8 + QĐ-4 + header.
- **Writer UC-105 chưa tồn tại**: `gate_access_logs` hiện **rỗng** trên thực tế; UC-107 đọc bảng chưa có dữ liệu. Test bằng mock repo (không DB). `direction` **ĐÃ CHỐT `'enter'`/`'leave'`** (§1.1) — DTO `@IsIn(GATE_DIRECTIONS)` phải khớp; writer UC-105 bị ràng buộc ghi đúng bộ này.
- **`user_id` NULL cho lượt xe** (OQ-5 đã chốt): KHÔNG chấp nhận như residual bị động — thành **ràng buộc lên UC-105** (writer phải gán `user_id` khi biển resolve được qua `VehicleResolveService`). Nếu writer vi phạm, lượt đi xe của người dùng biến mất khỏi lịch sử "của tôi".
- **`plate_number` dạng lưu chưa chắc** (OQ-3): filter `normalizePlate()` + so exact dựa trên **giả định writer UC-105 ghi `plate_number` đã chuẩn hoá** (mirror ANPR). Nếu writer ghi thô → filter lệch; cần đồng bộ khi xây UC-105.
- **`paired_log_id`/`duration_seconds` luôn NULL** cho tới UC-106; response vẫn trả 2 field (OQ-6).
- **`IDX_gate_logs_unpaired` chỉ index `(user_id, direction)`**: lượt xe (`user_id` NULL) không nằm trong index unpaired — ảnh hưởng UC-106 (ghép cặp theo biển), không ảnh hưởng UC-107 (chỉ đọc), nhưng ghi để UC-106 biết.
- **Zone soft-delete vs log**: `zones` có `deleted_at` nhưng `gate_access_logs.zone_id` FK RESTRICT + zone xoá mềm ⇒ log vẫn trỏ tới zone đã xoá mềm. UC-107 `leftJoinAndSelect zone` vẫn join được (hàng zones còn tồn tại). **KHÔNG** lọc `z.deletedAt IS NULL` (sẽ ẩn log của zone đã lưu trữ — không mong muốn cho audit). Ghi nhận là chủ ý.
- **`plate` exact vs partial**: nếu OQ-3 chốt exact thì không tra được một phần biển; partial `ILIKE` mất index. Đánh đổi để plan.
- **Seq scan** cho `direction` đơn lẻ, `from/to` không kèm user/zone — chấp nhận (bảng nhỏ giai đoạn đầu), index bổ sung là task riêng (QĐ-8 cấm schema ở UC này).
- **Nợ hệ thống**: global exception filter, Swagger, 5 file `spec/global/` rỗng — giữ nguyên.

---

> **STOP.** Spec-only. OQ-1→OQ-8 **ĐÃ CHỐT** (§8) + quyết định bổ sung `direction`=`enter`/`leave` (§1.1/§8). 10 QĐ §7 KHÔNG mở lại. Đã sang bước **plan** ([plan.md](./plan.md)). Chưa viết code/`tasks.md`, chưa chạy migration/seed/test/build, chưa commit.
