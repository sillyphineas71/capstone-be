# GAL-001 — plan.md (UC-107 Zones: xem & tra cứu lịch sử ra vào cổng)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan GAL-001 sau spec DUYỆT + chốt OQ-1→OQ-8 + quyết định bổ sung `direction`=`enter`/`leave`. Controller/service net-new trong module `zones` (URL KHÔNG dưới `/zones`): `GET /gate-access-logs` (own) + `GET /admin/gate-access-logs` (`zones.gate_log.read`, 3 role). QueryBuilder + `leftJoinAndSelect` (relation zone/user); DTO admin `extends` DTO user; 2 mapper riêng; hằng `GATE_DIRECTIONS`; `plate` normalize+exact; `from`/`to` ISO8601. ⚠ Bảng append-only — **0 chỗ `deletedAt`**. 1 migration seed `zones.gate_log.read` (`20260722000007`). | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại 10 QĐ §7 + 8 OQ đã chốt + quyết định bổ sung §1.1.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **`PaginationMeta` dùng lại**: `export interface PaginationMeta { page; limit; total; totalPages }` tại [zones.service.ts:49](../../../../src/modules/zones/services/zones.service.ts#L49) — **CÓ export**. `GateAccessLogService` import từ đây (cùng module). **CẤM** khai bản mới (QĐ-6).
- **`UserEntity`**: `fullName` (cột `full_name`) [user.entity.ts:55-56](../../../../src/modules/accounts/entities/user.entity.ts), `email` [:44-45](../../../../src/modules/accounts/entities/user.entity.ts) — cho khối `user` của mapper admin.
- **`ZoneEntity`**: `zoneCode` (`zone_code`), `zoneName` (`zone_name`) [zone.entity.ts:26-30](../../../../src/modules/zones/entities/zone.entity.ts) — tên cổng qua join.
- **`GateAccessLogEntity`** [gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts): relation `zone`(ManyToOne), `user`(ManyToOne nullable), `vehicleRegistration`(ManyToOne nullable) đã khai ⇒ `leftJoinAndSelect` được, KHÔNG import module khác. **KHÔNG `@DeleteDateColumn`** ([:68](../../../../src/modules/zones/entities/gate-access-log.entity.ts)).
- **Mẫu mapper `zones`**: `interface ZoneResponse` + `toZoneResponse(entity)` snake_case, KHÔNG trả `deleted_at` [zone-response.dto.ts:8-33](../../../../src/modules/zones/dto/zone-response.dto.ts) — mirror style cho 2 mapper mới.
- **Constants dir tồn tại**: `src/modules/zones/constants/` có `zone-status.constant.ts`, `zone-type.constant.ts` ⇒ thêm `gate-direction.constant.ts` cùng chỗ.
- **Mẫu seed permission**: [20260722000005-SeedZoneAssignDevicePermission.ts](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts) — INSERT 6 cột `(permission_code, permission_name, module_code, action_code, description, is_active)`, `action_code` tường minh, `ON CONFLICT DO NOTHING RETURNING id` + fallback SELECT, `down()` xoá `role_permissions` trước. Cấu trúc `{ code, name, module, action, description }` + mảng `roles`.
- **Tiền lệ own/admin + from/to + plate normalize**: [vehicle-history.service.ts:50-99](../../../../src/modules/anpr/services/vehicle-history.service.ts) (`listForUser`/`listAll`/`applyFilters` bound param, `normalizePlate` trước so) + [list-vehicle-history-query.dto.ts:33-48](../../../../src/modules/anpr/dto/list-vehicle-history-query.dto.ts) (`from`/`to` `@IsISO8601`, `plateNumber` raw).
- **`normalizePlate`**: [normalize-plate.ts:13-18](../../../../src/modules/anpr/utils/normalize-plate.ts) — `String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g,'')`. ⚠ nằm ở module `anpr` — import `zones → anpr` là cạnh mới? Xem §11 kỷ luật (chỉ import 1 pure util, không import module/service — chấp nhận, nêu rõ).
- **Mốc**: migration cuối `20260722000006-SeedAnprVehicleAdminReadPermission.ts` ⇒ UC-107 lấy **`20260722000007`** (T0 đếm lại). Baseline `zones` **8 suite / 131 test** (đối chiếu không hồi quy).
- **`GATE_DIRECTIONS`**: grep xác nhận **chưa có** hằng nào cho gate direction; `gate_access_logs` chưa có DTO/mapper (đúng kỳ vọng).

## 1. Quyết định đã chốt (OQ + §1.1 + Constitution)

**§1.1** `direction`=`enter`/`leave` (hằng `GATE_DIRECTIONS`, bỏ `seen`) · **OQ-1** user `from/to/direction/zone_id`, admin +`user_id`/`plate` · **OQ-2** `from`/`to` ISO8601 · **OQ-3** `plate` normalize→exact · **OQ-4** admin trả `user{user_id,full_name,email}`+cổng+biển, user KHÔNG owner, mapper riêng · **OQ-5** fold cứng `userId` + ràng buộc UC-105 gán `user_id` · **OQ-6** trả `paired_log_id`/`duration_seconds` (NULL tới UC-106) · **OQ-7** 3 role admin.

- **SEC-01**: route user fold cứng `gal.userId`, KHÔNG nhận `user_id`/`plate` (whitelist loại), mapper user KHÔNG owner.
- **SEC-02**: admin gate `JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions('zones.gate_log.read')`; user chỉ `JwtAuthGuard`.
- **SEC-03**: `from`/`to`/`direction`/`zone_id`/`user_id`/`plate` qua **bound param**; `plate` normalize; CẤM nối chuỗi SQL.
- **DATA-01 (⚠ đảo chiều)**: bảng append-only ⇒ **KHÔNG** `deletedAt`/`IsNull()` bất kỳ đâu. Đây là điểm dễ copy sai nhất từ 6 UC trước.
- **ARCH-01**: đọc `gate_access_logs` + relation `zone`/`user` đã khai; KHÔNG gọi service `accounts`/`anpr`. `normalizePlate` là pure util (không phải service) — chấp nhận import.
- **ARCH-02**: `limit` max 100 chặn quét toàn bảng.
- **DATA-03 / no-migration-schema**: migration DUY NHẤT = seed permission; CẤM cột/index/CHECK.

## 2. Constants — `GATE_DIRECTIONS`

File net-new `src/modules/zones/constants/gate-direction.constant.ts`:
```
export const GATE_DIRECTIONS = ['enter', 'leave'] as const;
export type GateDirection = (typeof GATE_DIRECTIONS)[number];
```
- Dùng cho `@IsIn(GATE_DIRECTIONS)` ở DTO. UC-105/UC-106 tái dùng — CẤM rải literal `'enter'`/`'leave'`.

## 3. DTO

### 3.1. `ListGateAccessLogsQueryDto` (route user) — net-new
File `src/modules/zones/dto/list-gate-access-logs-query.dto.ts`:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `page: number = 1` | `page` | `@Type(()=>Number) @IsOptional @IsInt @Min(1)` |
| `limit: number = 20` | `limit` | `@Type(()=>Number) @IsOptional @IsInt @Min(1) @Max(100)` |
| `from?: string` | `from` | `@IsOptional @IsISO8601()` |
| `to?: string` | `to` | `@IsOptional @IsISO8601()` |
| `direction?: string` | `direction` | `@IsOptional @IsIn(GATE_DIRECTIONS)` |
| `zoneId?: string` | `zone_id` | `@Expose({name:'zone_id'}) @IsOptional @IsUUID('4')` |

- Import `GATE_DIRECTIONS` từ constant. **KHÔNG** `user_id`/`plate`/`sort_by`/`include_deleted`.

### 3.2. `AdminListGateAccessLogsQueryDto extends ListGateAccessLogsQueryDto` — net-new
File `src/modules/zones/dto/admin-list-gate-access-logs-query.dto.ts` (khuôn UC-101):

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| *(kế thừa)* | | `page`/`limit`/`from`/`to`/`direction`/`zone_id` |
| `userId?: string` | `user_id` | `@Expose({name:'user_id'}) @IsOptional @IsUUID('4')` |
| `plate?: string` | `plate` | `@IsOptional @IsString @MaxLength(20)` |

- **JSDoc lớp con** đính chính: `user_id`/`plate` chỉ cho route admin đã qua `@RequirePermissions`; route user fold cứng `userId`.

## 4. Service — net-new `GateAccessLogService`

File `src/modules/zones/services/gate-access-log.service.ts`. `@Injectable`, `constructor(@InjectRepository(GateAccessLogEntity) private readonly repo)`. Import `PaginationMeta` từ `../services/zones.service.js` (cùng module), `normalizePlate` từ `anpr/utils`.

> ⚠⚠ **TUYỆT ĐỐI KHÔNG** `deletedAt`/`IsNull()` ở BẤT KỲ truy vấn nào — `gate_access_logs` không có cột `deleted_at` (append-only). Thêm sẽ lỗi SQL "column does not exist".

**Chọn công cụ**: **QueryBuilder cho CẢ 2 method** — vì cả hai cần `leftJoinAndSelect('gal.zone','z')` để trả tên cổng (route user cũng trả `zone_name`). Không dùng `findAndCount` (không tiện join select). (Khác UC-101: ở đó route user không cần join nên giữ `findAndCount`; ở đây cần join tên cổng.)

### 4.1. `listForUser(userId, query)`
```
const qb = this.repo.createQueryBuilder('gal')
  .leftJoinAndSelect('gal.zone', 'z')
  .where('gal.userId = :userId', { userId });            // fold cứng — KHÔNG deletedAt
if (query.from)      qb.andWhere('gal.accessTime >= :from', { from: query.from });
if (query.to)        qb.andWhere('gal.accessTime <= :to', { to: query.to });
if (query.direction) qb.andWhere('gal.direction = :direction', { direction: query.direction });
if (query.zoneId)    qb.andWhere('gal.zoneId = :zoneId', { zoneId: query.zoneId });
const [items, total] = await qb.orderBy('gal.accessTime', 'DESC')
  .skip((page-1)*limit).take(limit).getManyAndCount();
```
- Fold cứng `userId`; filter vắng mặt không lọt `where`; bound param; sort hard-code.

### 4.2. `listAll(query)` — admin, KHÔNG fold
```
const qb = this.repo.createQueryBuilder('gal')
  .leftJoinAndSelect('gal.zone', 'z')
  .leftJoinAndSelect('gal.user', 'u');                   // KHÔNG where userId, KHÔNG deletedAt
if (query.from)      qb.andWhere('gal.accessTime >= :from', { from: query.from });
if (query.to)        qb.andWhere('gal.accessTime <= :to', { to: query.to });
if (query.direction) qb.andWhere('gal.direction = :direction', { direction: query.direction });
if (query.zoneId)    qb.andWhere('gal.zoneId = :zoneId', { zoneId: query.zoneId });
if (query.userId)    qb.andWhere('gal.userId = :uid', { uid: query.userId });
if (query.plate)     qb.andWhere('gal.plateNumber = :plate', { plate: normalizePlate(query.plate) });
const [items, total] = await qb.orderBy('gal.accessTime', 'DESC')
  .skip((page-1)*limit).take(limit).getManyAndCount();
```
- ⚠ Có `where` đầu tiên? `listAll` không có `.where()` fold — dùng `andWhere` từ đầu **hoặc** khởi tạo bằng `.where('1=1')`? **KHÔNG** dùng `1=1` (xấu). Dùng builder rồi `andWhere` — TypeORM chấp nhận `andWhere` khi chưa có `where` (tự thành mệnh đề đầu). T0/code verify hành vi này; nếu cần, method đầu tiên dùng `.where(...)`.
- `plate` normalize trước so **exact** (OQ-3). `gal.user` `ManyToOne` ⇒ join không nhân dòng ⇒ `getManyAndCount` an toàn.
- ⚠ search+filter kết hợp (UC-93): `plate`+`from/to`+`user_id` phải gắn **cả** — test chứng minh.

## 5. Mapper — user + admin

File `src/modules/zones/dto/gate-access-log-response.dto.ts` (2 hàm + 2 interface, mirror `zone-response.dto.ts` style).

### 5.1. `toGateAccessLogResponse` (user)
```
{ id, zone_id, zone_name, direction, access_time,
  plate_number, vehicle_registration_id,
  paired_log_id, duration_seconds }
```
- `zone_name` từ `entity.zone?.zoneName ?? null`. **KHÔNG** khối `user`.

### 5.2. `toAdminGateAccessLogResponse` (admin) — mapper riêng
- Mọi field trên **cộng**:
```
zone_code: entity.zone?.zoneCode ?? null,
user: entity.user ? { user_id: entity.user.id, full_name: entity.user.fullName, email: entity.user.email } : null
```
- **CHỈ** 3 khoá owner. CẤM `phone`/`department`/`username`/`employeeCode`/trạng thái tài khoản (SEC-01). KHÔNG tái dùng để lộ owner ở route user.

## 6. Controller — net-new `GateAccessLogController`

File `src/modules/zones/controllers/gate-access-log.controller.ts`. Pipe `GATE_LOG_PIPE = new ValidationPipe({ whitelist: true, transform: true })` (repo không có global pipe — mirror `ZONE_PIPE`).

```text
GET /api/v1/gate-access-logs         → listForUser  (JwtAuthGuard; @CurrentUser userId)
GET /api/v1/admin/gate-access-logs   → listAll      (JwtAuthGuard + PermissionsGuard + zones.gate_log.read)
```
- `@Controller()` prefix rỗng (KHÔNG `'zones'` — QĐ-2); route path đầy đủ `gate-access-logs` / `admin/gate-access-logs`. `api/v1` set ở `main.ts`.
- **User**: `@Get('gate-access-logs')` · `@UseGuards(JwtAuthGuard)` · `@UsePipes(GATE_LOG_PIPE)` · `@CurrentUser() user` · `@Query() ListGateAccessLogsQueryDto` → `{success, message:'Gate access logs retrieved successfully', data: items.map(toGateAccessLogResponse), meta}`.
- **Admin**: `@Get('admin/gate-access-logs')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('zones.gate_log.read')` · `@UsePipes(GATE_LOG_PIPE)` · `@Query() AdminListGateAccessLogsQueryDto` → `data: items.map(toAdminGateAccessLogResponse)`.
- Thứ tự khai: `admin/gate-access-logs` vs `gate-access-logs` — segment đầu literal khác (`admin` ≠ `gate-access-logs`) ⇒ KHÔNG xung đột; KHÔNG có route `:id`.
- ⚠ Thiếu `@RequirePermissions` = endpoint hở im lặng (`PermissionsGuard` return true khi không metadata).

**HTTP status**: 200 (list/rỗng) · 400 (limit>100/page<1/from|to sai ISO8601/user_id không UUID/direction ngoài enum) · 401 · 403 (admin thiếu permission).

## 7. Module wiring — `zones.module.ts` (Modified, tối thiểu)

Thay đổi **chính xác**:
- `controllers: [ZonesController, GateAccessLogController]` — thêm `GateAccessLogController`.
- `providers: [ZonesService, ZonesAuditRepository, GateAccessLogService]` — thêm `GateAccessLogService`.
- Thêm 2 import class net-new.
- **KHÔNG** đổi `imports` (`forFeature([Zone, GateAccessLog, ZonePresenceEvent])` đã có `GateAccessLogEntity`; `AuthModule` đã có cho guard; `IotModule` giữ nguyên). **KHÔNG** đụng `ZonesService`/`ZonesController`/`ZonesAuditRepository`.

## 8. File list

### Net-new
**Code (6)**
- `src/modules/zones/constants/gate-direction.constant.ts`
- `src/modules/zones/dto/list-gate-access-logs-query.dto.ts`
- `src/modules/zones/dto/admin-list-gate-access-logs-query.dto.ts`
- `src/modules/zones/dto/gate-access-log-response.dto.ts` (2 mapper)
- `src/modules/zones/services/gate-access-log.service.ts`
- `src/modules/zones/controllers/gate-access-log.controller.ts`
- `src/database/migrations/20260722000007-SeedGateLogReadPermission.ts` — seed `zones.gate_log.read` (`module_code='zones'`, `action_code='read'`), **3 role** `SYSTEM_ADMIN`/`BUSINESS_ADMIN`/`MANAGER`; mirror `20260722000005`. ⚠ số thứ tự verify T0.

**Test (4)**
- `list-gate-access-logs-query.dto.spec.ts`
- `admin-list-gate-access-logs-query.dto.spec.ts`
- `gate-access-log-response.dto.spec.ts` (2 mapper)
- `gate-access-log.service.spec.ts`
- (+ controller spec — xem Modified? controller net-new nên spec cũng net-new) `gate-access-log.controller.spec.ts`

### Modified
- `src/modules/zones/zones.module.ts` — thêm 1 controller + 1 provider + 2 import (§7).

> Tổng ~**7 net-new code + 5 net-new test + 1 modified** = ~13 file. **0 migration schema**. `ZonesService`/`ZonesController`/`ZonesAuditRepository`/entity/`app.module.ts`/`data-source.ts` **KHÔNG đổi**.

## 9. Test (mock repo — KHÔNG DB)

Mock `createQueryBuilder` chainable: `leftJoinAndSelect`/`where`/`andWhere`/`orderBy`/`skip`/`take` → `mockReturnThis()`, `getManyAndCount` → `[[],0]`.

**`gate-access-log.service.spec.ts`**
- ⭐ **KHÔNG có `deletedAt`**: assert **không** `andWhere`/`where` nào chứa chuỗi `deleted` (cả 2 method) — chốt chặn append-only.
- `listForUser`: fold cứng `where('gal.userId = :userId', {userId})`; `leftJoinAndSelect('gal.zone','z')` được gọi; **KHÔNG** join `gal.user`.
- `listAll`: **KHÔNG** fold userId (không có `gal.userId = :userId` từ current); LUÔN join `gal.zone` **và** `gal.user`.
- `from`/`to`: `andWhere('gal.accessTime >= :from', {from})` / `<= :to`.
- `direction`: `andWhere('gal.direction = :direction', {direction:'enter'})`.
- `zone_id`: `andWhere('gal.zoneId = :zoneId', {...})`.
- admin `user_id`: `andWhere('gal.userId = :uid', {uid})`.
- admin `plate`: normalize → `andWhere('gal.plateNumber = :plate', {plate:'29A123'})` (gõ `29a-123`).
- **search+filter kết hợp**: `{plate:'29A', from, userId}` → cả 3 `andWhere` gắn.
- filter vắng mặt KHÔNG lọt: chỉ gửi `direction` → không `andWhere` cho from/to/zone_id.
- sort `orderBy('gal.accessTime','DESC')`; skip/take đúng; list rỗng → `items:[]`, `meta.total=0`, totalPages=0.

**`gate-access-log-response.dto.spec.ts`**
- user mapper: có `zone_name`, `paired_log_id`, `duration_seconds`, `plate_number`; **KHÔNG** khối `user`.
- admin mapper: có `user{user_id,full_name,email}` + `zone_code`; **KHÔNG** `phone`/`department`/`username`/`status` tài khoản; `entity.user` null → `user: null`.
- cả 2: `paired_log_id`/`duration_seconds` NULL vẫn trả (không nổ).

**DTO specs**
- user DTO: `from`/`to` phải ISO8601 (sai → `isIso8601`); `direction` ngoài `['enter','leave']` → `isIn`; `zone_id` không UUID → `isUuid`; whitelist loại `user_id`/`plate` (SEC-01).
- admin DTO: `extends` đủ field cha + `user_id`/`plate`; `user_id` không UUID → `isUuid`; `limit=101`→max.

**`gate-access-log.controller.spec.ts`**
- user route gọi `service.listForUser(currentUser.userId, query)`; envelope + mapper user; guard chỉ `JwtAuthGuard`; **KHÔNG** `PERMISSIONS_KEY`.
- admin route gọi `service.listAll(query)`; `PERMISSIONS_KEY = ['zones.gate_log.read']`; guard `JwtAuthGuard`+`PermissionsGuard`; data qua mapper admin (có `user`).
- list rỗng → `200` + `data:[]` + `meta.total=0`.

**Nguyên tắc**: 100% mock; KHÔNG DB/migration/e2e.

## 10. Gate (STOP, KHÔNG commit)

- `npm run build` = 0 error; eslint **chỉ file touched** = 0 rule mới (KHÔNG `npm run lint` trần).
- `npx jest src/modules/zones` xanh — **131 test cũ không hồi quy** (baseline T0) + test mới.
- Coverage `GateAccessLogService` ≥80%.
- **DI-proof**: `NestFactory.create(AppModule, {preview:true})` — 0 `UnknownDependenciesException`, 0 circular (module có controller/provider mới).
- **KHÔNG** `migration:run` (kể cả local), **KHÔNG** RDS, **KHÔNG** live smoke, **KHÔNG** commit.
- **Bàn giao**: gọi `GET /admin/gate-access-logs` local cần seed `20260722000007` trước; thiếu → 403. Bảng `gate_access_logs` hiện **rỗng** (writer UC-105 chưa xây) — list trả `[]`.
- **Owed**: writer UC-105 (ingest + gán `user_id` + ghi `direction` enter/leave + `plate_number` chuẩn hoá) · UC-106 (ghép cặp — ghi `paired_log_id`/`duration_seconds`) · index cho `direction`/`plate` một phần nếu dữ liệu lớn · global exception filter · Swagger · 5 file `spec/global/` rỗng.

## 11. Kỷ luật

- **(a) ⚠ BẢNG APPEND-ONLY — CẤM `deletedAt`/`IsNull()`** ở mọi truy vấn UC-107 (`gate_access_logs` không có cột `deleted_at`). Điểm dễ copy sai nhất từ UC-90→94/UC-101. Test assert trực tiếp "không chuỗi `deleted`".
- **(b) `direction` = `enter`/`leave`** qua hằng `GATE_DIRECTIONS`; 0 chỗ `'in'`/`'out'`. **Ràng buộc UC-105**: writer PHẢI ghi `'enter'`/`'leave'` (không CHECK ở DB — ép application).
- **(c) Ràng buộc UC-105 về `user_id`** (OQ-5): writer PHẢI gán `user_id` khi biển resolve được về xe đã đăng ký (dùng `VehicleResolveService`). Không gán ⇒ lượt đi xe của user biến mất khỏi lịch sử "của tôi".
- **(d) UC-107 chỉ ĐỌC** `paired_log_id`/`duration_seconds` — UC-106 mới GHI. Tuyệt đối không tính/ghi 2 field này ở UC-107.
- **(e) URL KHÔNG dưới `/zones`** dù module là `zones` (QĐ-2): sở hữu module ≠ tiền tố URL. Controller prefix rỗng.
- **(f) Đọc tên cổng/người qua RELATION** (`leftJoinAndSelect`), KHÔNG import `AccountsModule`/`AnprModule`. `normalizePlate` là pure util (không service) — import chấp nhận.
- **(g) `PaginationMeta` dùng lại** bản export `zones.service.ts:49` — CẤM bản mới.
- **(h) No-migration-schema**: migration duy nhất = seed permission; CẤM cột/index/CHECK.
- **(i) Không đụng** `ZonesService`/`ZonesController`/`ZonesAuditRepository`/entity/UC-90→94/UC-101.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
