# GAL-001 — tasks.md (UC-107 Zones: xem & tra cứu lịch sử ra vào cổng)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks GAL-001 sau plan DUYỆT + đóng 2 điểm ngỏ: T0 verify → T1/T1b constant `GATE_DIRECTIONS` → T2/T2b DTO user → T3/T3b DTO admin `extends` → T4/T4b mapper (user+admin) → T5/T5b service (QueryBuilder, **KHÔNG deletedAt**) → T6/T6b controller (URL không dưới `/zones`) → T7 module wiring → T8 migration seed `zones.gate_log.read` (**3 role**) → T-GATE. **Đóng**: (2.1) `listAll` dùng `andWhere` từ đầu — hợp lệ, cấm `.where('1=1')`; (2.2) `normalizePlate` import chéo `zones→anpr/utils` có chủ đích, cấm viết lại. | Toàn bộ |
| 2026-07-23 | Bổ sung làm rõ `deletedAt` của **bảng được JOIN**: `zones`/`users` CÓ soft-delete và cả 2 method đều `leftJoinAndSelect` chúng. **CHỐT: KHÔNG lọc `z.deletedAt`/`u.deletedAt`** — `gate_access_logs` là log lịch sử append-only, phải giữ tên cổng/người kể cả khi zone/user đã xoá mềm (khác truy vấn VẬN HÀNH của UC-92/93/94). Cập nhật T5 (comment tại chỗ), T5b (case ⭐ phủ cả `gal`/`z`/`u`), §Kỷ luật (bảng phân biệt vận hành vs lịch sử), residual (FE không phân biệt cổng còn hoạt động vs đã xoá). | T5, T5b, Kỷ luật |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại 10 QĐ (spec §7), 8 OQ đã chốt, `direction`=`enter`/`leave`, plan §11. **KHÔNG** sửa `ZonesService`/`ZonesController`/`ZonesAuditRepository`/entity/`app.module.ts`/`data-source.ts`, hay file nào của module `anpr` (kể cả `normalize-plate.ts`). **KHÔNG** migration schema/CHECK. **KHÔNG** `PaginationMeta` bản mới. **KHÔNG** audit (read-only).

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T5b → T6 → T6b → T7 → T8 → T-GATE.

> **Phụ thuộc**: constant `GATE_DIRECTIONS` (T1) trước DTO (T2 dùng `@IsIn`) · DTO user (T2) trước DTO admin (T3 `extends`) · DTO + mapper (T2/T3/T4) trước service (T5) trước controller (T6) · controller/service net-new trước wiring (T7) · migration (T8) độc lập nhưng **cùng commit** với controller (thiếu seed = 403).
>
> **KHÔNG có task audit** — read-only. **KHÔNG có task migration schema** — chỉ seed permission.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu. Dán xác nhận từng mục kèm bằng chứng (path + trích ngắn). **Thiếu / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **Baseline test module `zones`**: `npx jest src/modules/zones` — **kỳ vọng 8 suite / 131 test**. Lệch → ghi nhận và báo **trước khi** code. Con số đối chiếu không hồi quy ở T-GATE.
2. **`GateAccessLogEntity`** ([gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts)): xác nhận **KHÔNG có `@DeleteDateColumn`** (chỉ `@CreateDateColumn`); tên property chính xác: `accessTime`, `plateNumber`, `pairedLogId`, `durationSeconds`, `zoneId`, `userId`, `vehicleRegistrationId`, `direction`; relation `zone`/`user` là `@ManyToOne`.
3. **`PaginationMeta`** [zones.service.ts:49](../../../../src/modules/zones/services/zones.service.ts#L49) — có `export`, đúng 4 field (`page`/`limit`/`total`/`totalPages`) ⇒ **dùng lại**, cấm bản mới.
4. **`normalizePlate`** [normalize-plate.ts:13-18](../../../../src/modules/anpr/utils/normalize-plate.ts) — đường dẫn import chính xác từ `zones` sang `anpr/utils`; hàm vẫn `String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g,'')`.
5. **`UserEntity`** `fullName`(cột `full_name`)/`email` ([user.entity.ts:44-45,55-56](../../../../src/modules/accounts/entities/user.entity.ts)) · **`ZoneEntity`** `zoneCode`/`zoneName` ([zone.entity.ts:26-30](../../../../src/modules/zones/entities/zone.entity.ts)) — tên property cho `leftJoinAndSelect`.
6. **`zones.module.ts`** ([zones.module.ts:38-52](../../../../src/modules/zones/zones.module.ts)) — hiện `imports:[forFeature(...), AuthModule, IotModule]`, `controllers:[ZonesController]`, `providers:[ZonesService, ZonesAuditRepository]` → biết dòng nào thêm ở T7.
7. **Migration cuối thực tế**: đếm `src/database/migrations/` — kỳ vọng cuối `20260722000006` ⇒ UC-107 lấy **`20260722000007`**. Nếu đã có `...0007*` → lấy số kế tiếp, **ghi rõ**.
8. **Mẫu seed** [20260722000005-SeedZoneAssignDevicePermission.ts](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts) — 6 cột `(permission_code, permission_name, module_code, action_code, description, is_active)`, `action_code` tường minh, `ON CONFLICT (permission_code) DO NOTHING RETURNING id` + fallback SELECT, `down()` xoá `role_permissions` trước.

- **AC**: dán xác nhận đủ **8 mục** kèm bằng chứng; mục 1 ghi con số baseline; mục 2 khẳng định **KHÔNG `@DeleteDateColumn`**; mục 7 chốt timestamp.

## T1 — Constant `GATE_DIRECTIONS` (code) — plan §2, §1.1
File net-new `src/modules/zones/constants/gate-direction.constant.ts`:
```
export const GATE_DIRECTIONS = ['enter', 'leave'] as const;
export type GateDirection = (typeof GATE_DIRECTIONS)[number];
```
- JSDoc: khớp từ vựng `iot_device_events.direction` / `ListVehicleHistoryQueryDto:42` / IVSS `channel_direction_map`. **Ràng buộc UC-105**: writer PHẢI ghi `'enter'`/`'leave'`, **CẤM** `'in'`/`'out'`. Bỏ `'seen'` (cổng chỉ vào/ra).
- **AC**: đúng 2 giá trị `['enter','leave']`, có `as const` + type `GateDirection`; JSDoc ghi ràng buộc UC-105; đặt cùng thư mục `zone-status.constant.ts`.

## T1b — Test constant (gộp vào test DTO user cũng được — nêu rõ)
- Có thể assert `GATE_DIRECTIONS` = `['enter','leave']` trong test DTO (T2b) hoặc file riêng. **AC**: có ít nhất 1 assert giá trị hằng đúng 2 phần tử, không chứa `'seen'`/`'in'`/`'out'`.

## T2 — DTO user `ListGateAccessLogsQueryDto` (code) — plan §3.1, OQ-1/2, SEC-01
File net-new `src/modules/zones/dto/list-gate-access-logs-query.dto.ts`:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `page: number = 1` | `page` | `@Type(()=>Number) @IsOptional @IsInt @Min(1)` |
| `limit: number = 20` | `limit` | `@Type(()=>Number) @IsOptional @IsInt @Min(1) @Max(100)` |
| `from?: string` | `from` | `@IsOptional @IsISO8601()` |
| `to?: string` | `to` | `@IsOptional @IsISO8601()` |
| `direction?: string` | `direction` | `@IsOptional @IsIn(GATE_DIRECTIONS)` |
| `zoneId?: string` | `zone_id` | `@Expose({name:'zone_id'}) @IsOptional @IsUUID('4')` |

- Import `GATE_DIRECTIONS`. **CẤM** `user_id`/`plate`/`sort_by`/`include_deleted`.
- **AC**: đúng 6 field; `direction` dùng `@IsIn(GATE_DIRECTIONS)` (không literal); `zone_id` `@Expose` + `@IsUUID('4')`; `from`/`to` `@IsISO8601`; 0 field cấm.

## T2b — Test DTO user — plan §9
File net-new `list-gate-access-logs-query.dto.spec.ts` (`plainToInstance` + `validate`; whitelist qua `ValidationPipe.transform`):
- query rỗng `{}` → 0 lỗi (default page/limit).
- `from`/`to` sai định dạng → `isIso8601`; đúng ISO8601 → 0 lỗi.
- `direction='in'` (từ vựng cũ) → **lỗi `isIn`**; `direction='enter'` → 0 lỗi (chứng minh chốt enter/leave).
- `zone_id` không UUID → `isUuid`.
- `limit=101` → `max`; `page=0` → `min`.
- **SEC-01 whitelist**: `ValidationPipe({whitelist:true,transform:true}).transform({user_id, plate, direction:'enter'})` → loại `user_id`/`plate`, giữ `direction`.
- **AC**: các case xanh; case `direction='in'` bị loại + case whitelist loại `user_id`/`plate` bắt buộc.

## T3 — DTO admin `AdminListGateAccessLogsQueryDto extends` (code) — plan §3.2, OQ-1/3
File net-new `src/modules/zones/dto/admin-list-gate-access-logs-query.dto.ts`:
```
export class AdminListGateAccessLogsQueryDto extends ListGateAccessLogsQueryDto {
  // @Expose({name:'user_id'}) @IsOptional @IsUUID('4')
  userId?: string;
  // @IsOptional @IsString @MaxLength(20)
  plate?: string;
}
```
- JSDoc đính chính: `user_id`/`plate` chỉ cho route admin đã qua `@RequirePermissions`; route user (lớp cha) vẫn fold cứng `userId`.
- **AC**: `extends ListGateAccessLogsQueryDto`; đúng 2 field mới với decorator nêu trên; có JSDoc; 0 field cấm.

## T3b — Test DTO admin — plan §9
File net-new `admin-list-gate-access-logs-query.dto.spec.ts`:
- `extends`: instance có đủ field cha (`page`/`limit`/`from`/`to`/`direction`/`zone_id`) + `user_id`/`plate`.
- `user_id` không UUID → `isUuid`; UUID hợp lệ → 0 lỗi.
- `plate` 21 ký tự → `maxLength`.
- kế thừa ràng buộc cha: `limit=101` → `max`.
- **AC**: case `extends` (đủ field cha+con) + case `user_id` isUuid bắt buộc.

## T4 — Mapper (code) — plan §5, OQ-4, SEC-01
File net-new `src/modules/zones/dto/gate-access-log-response.dto.ts` (2 interface + 2 hàm, mirror `zone-response.dto.ts`).
- **`toGateAccessLogResponse` (user)**: `id`, `zone_id`, `zone_name` (`entity.zone?.zoneName ?? null`), `direction`, `access_time`, `plate_number`, `vehicle_registration_id`, `paired_log_id`, `duration_seconds`. **KHÔNG** khối `user`.
- **`toAdminGateAccessLogResponse` (admin)**: mọi field trên **cộng** `zone_code` (`entity.zone?.zoneCode ?? null`) + `user: entity.user ? { user_id, full_name, email } : null`. **CHỈ** 3 khoá owner — **CẤM** `phone`/`department`/`username`/`employeeCode`/trạng thái tài khoản.
- **AC**: 2 hàm; user KHÔNG có `user`; admin có `user{user_id,full_name,email}` + `zone_code`; `gal.zone`/`gal.user` null → trả `null` không nổ; `paired_log_id`/`duration_seconds` luôn có mặt (dù NULL).

## T4b — Test mapper — plan §9
File net-new `gate-access-log-response.dto.spec.ts`:
- user mapper: output có `zone_name`/`paired_log_id`/`duration_seconds`/`plate_number`; **`not.toHaveProperty('user')`**.
- admin mapper: có `user.user_id`/`full_name`/`email` + `zone_code`; **`not.toHaveProperty`** cho `phone`/`department`/`username`/`employeeCode`/`passwordHash` trong khối owner; `entity.user` null → `user: null`.
- cả 2: `paired_log_id`/`duration_seconds` NULL vẫn trả (không nổ).
- **AC**: 3 nhóm case; case route user không có `user` + case field nhạy cảm bị loại bắt buộc.

## T5 — Service `GateAccessLogService` (code) — plan §4, §2.1, §2.2
File net-new `src/modules/zones/services/gate-access-log.service.ts`. `@Injectable`, `@InjectRepository(GateAccessLogEntity) repo`. Import `PaginationMeta` từ `../services/zones.service.js` (cùng module), `normalizePlate` từ `anpr/utils` (import chéo có chủ đích — §2.2).

> ⚠⚠ **TUYỆT ĐỐI KHÔNG** `deletedAt`/`IsNull()` ở BẤT KỲ truy vấn nào.
> - Trên `gal` (`gate_access_logs`): cột `deleted_at` **không tồn tại** → thêm = lỗi SQL "column does not exist".
> - Trên `z` (`zones`) và `u` (`users`): cột `deleted_at` **CÓ tồn tại nhưng CỐ Ý KHÔNG lọc** — đây là log lịch sử append-only, phải giữ tên cổng/người kể cả khi zone/user đã xoá mềm. Thêm `z.deletedAt IS NULL` sẽ ẩn log của cổng đã lưu trữ — sai đúng lúc cần truy vết. Phân biệt VẬN HÀNH (UC-92/93/94: CÓ lọc) vs LỊCH SỬ (UC-107: KHÔNG lọc). **Thêm comment tại chỗ** ở 2 `leftJoinAndSelect` giải thích lý do.

- **`listForUser(userId, query)`**: QueryBuilder `gal` · `.leftJoinAndSelect('gal.zone','z')` · `.where('gal.userId = :userId', {userId})` (fold cứng) · filter (guard `if`, bound param): `from`→`gal.accessTime >= :from`, `to`→`<= :to`, `direction`→`gal.direction = :direction`, `zoneId`→`gal.zoneId = :zoneId` · `.orderBy('gal.accessTime','DESC').skip().take().getManyAndCount()`.
- **`listAll(query)`**: QueryBuilder + `.leftJoinAndSelect('gal.zone','z').leftJoinAndSelect('gal.user','u')` · **KHÔNG** `.where()` fold — dùng `andWhere` từ đầu (§2.1 — HỢP LỆ, **CẤM** `.where('1=1')`) · filter như trên **cộng** `userId`→`gal.userId = :uid`, `plate`→`normalizePlate(plate)` rồi `gal.plateNumber = :plate` **exact** · `orderBy accessTime DESC`, `getManyAndCount()`.
- Cả hai: dùng lại `PaginationMeta`; trả `{ items, meta: { page, limit, total, totalPages: Math.ceil(total/limit) } }`.
- **AC**: 0 chỗ `deletedAt`/`IsNull()`; `listForUser` fold cứng + join zone (KHÔNG join user); `listAll` KHÔNG fold + join zone+user + `andWhere` từ đầu (KHÔNG `.where('1=1')`); `plate` normalize trước so exact; filter vắng mặt không lọt; sort hard-code; 0 `PaginationMeta` mới.

## T5b — Test service — plan §9
Thêm `gate-access-log.service.spec.ts` (mock `createQueryBuilder` chainable: `leftJoinAndSelect`/`where`/`andWhere`/`orderBy`/`skip`/`take` → `mockReturnThis()`, `getManyAndCount` → `[[],0]`):
- ⭐ **KHÔNG có `deletedAt`** (phủ CẢ 3 bảng): assert KHÔNG lần gọi `where`/`andWhere` nào chứa chuỗi `deleted` (cả 2 method). Case này bảo vệ đồng thời: `gal.deletedAt` (cột không tồn tại) **VÀ** `z.deletedAt`/`u.deletedAt` (cột CÓ tồn tại nhưng cố ý không lọc — log lịch sử). Gặp test đỏ đừng nới ra — đó là chủ ý.
- `listForUser`: `where('gal.userId = :userId', {userId})`; `leftJoinAndSelect('gal.zone','z')` gọi; **KHÔNG** `leftJoinAndSelect('gal.user',...)`.
- `listAll`: KHÔNG fold userId (không `where`/`andWhere` `gal.userId` từ current khi client không gửi); LUÔN join `gal.zone` **và** `gal.user`.
- `from`/`to`/`direction`/`zone_id`: mỗi cái → `andWhere` đúng chuỗi + bound param.
- admin `user_id`: `andWhere('gal.userId = :uid', {uid})`.
- admin `plate` normalize: gửi `'29a-123'` → `andWhere('gal.plateNumber = :plate', {plate:'29A123'})`.
- **search+filter kết hợp** (UC-93): `{plate:'29A', from, userId}` → cả 3 `andWhere` gắn.
- filter vắng mặt không lọt: chỉ gửi `direction` → không `andWhere` cho from/to/zone_id.
- sort `orderBy('gal.accessTime','DESC')`; skip/take đúng; list rỗng → `items:[]`, `meta.total=0`, `totalPages=0`.
- **AC**: case KHÔNG-`deletedAt` + plate-normalize + search-kết-hợp bắt buộc; coverage `GateAccessLogService` ≥80%.

## T6 — Controller `GateAccessLogController` (code) — plan §6, OQ-7, SEC-02
File net-new `src/modules/zones/controllers/gate-access-log.controller.ts`. `GATE_LOG_PIPE = new ValidationPipe({ whitelist: true, transform: true })` (khai tường minh — repo không global pipe).
- `@Controller()` **prefix rỗng** (URL KHÔNG dưới `/zones` — QĐ-2); `api/v1` set ở `main.ts`.
- **User** `@Get('gate-access-logs')` · `@UseGuards(JwtAuthGuard)` · `@UsePipes(GATE_LOG_PIPE)` · `@CurrentUser() user` · `@Query() ListGateAccessLogsQueryDto` → `{success:true, message:'Gate access logs retrieved successfully', data: items.map(toGateAccessLogResponse), meta}`.
- **Admin** `@Get('admin/gate-access-logs')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('zones.gate_log.read')` · `@UsePipes(GATE_LOG_PIPE)` · `@Query() AdminListGateAccessLogsQueryDto` → `data: items.map(toAdminGateAccessLogResponse)`.
- Thứ tự khai: `admin/gate-access-logs` vs `gate-access-logs` segment đầu literal khác ⇒ KHÔNG xung đột; KHÔNG route `:id`.
- ⚠ Thiếu `@RequirePermissions` = endpoint hở im lặng.
- **AC**: 2 route đúng guard/pipe/DTO/mapper; route user KHÔNG permission (chỉ `JwtAuthGuard`); route admin gate `zones.gate_log.read`; URL không dưới `/zones`; user dùng mapper user, admin dùng mapper admin.

## T6b — Test controller — plan §9
File net-new `gate-access-log.controller.spec.ts`:
- user route gọi `service.listForUser(currentUser.userId, query)`; envelope + mapper user; `data[0]` **not.toHaveProperty('user')`**; guard chỉ `JwtAuthGuard`; `Reflect.getMetadata(PERMISSIONS_KEY, controller.<userHandler>)` **undefined**.
- admin route gọi `service.listAll(query)`; `PERMISSIONS_KEY = ['zones.gate_log.read']`; guard `JwtAuthGuard`+`PermissionsGuard`; `data[0]` có khối `user`.
- list rỗng → `200` + `data:[]` + `meta.total=0`.
- **AC**: case metadata permission (cả 2 handler) + case route user không `user` + không hồi quy bắt buộc.

## T7 — Module wiring `zones.module.ts` (code) — plan §7
- `controllers: [ZonesController, GateAccessLogController]` (thêm).
- `providers: [ZonesService, ZonesAuditRepository, GateAccessLogService]` (thêm).
- Thêm 2 import class net-new.
- **Giữ nguyên** `imports` (`forFeature`, `AuthModule`, `IotModule`), `exports`, `ZonesService`/`ZonesAuditRepository`/`ZonesController`.
- **AC**: `GateAccessLogController` trong `controllers`, `GateAccessLogService` trong `providers`; `imports`/`exports` không đổi; 0 đụng `ZonesService`/`ZonesController`.

## T8 — Migration seed permission (code) — plan §8, OQ-7, SEC-02
- File: **`src/database/migrations/20260722000007-SeedGateLogReadPermission.ts`** (timestamp chốt T0), class `SeedGateLogReadPermission20260722000007` + field `name` trùng tên class.
- **Đặt trong `migrations/`, KHÔNG `src/database/seeds/`** (folder `seeds/` không có runner — AGENTS.md §5.5 rule 4).
- Mirror [20260722000005](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts):
  - `permission = { code:'zones.gate_log.read', name:<ASCII không dấu>, module:'zones', action:'read', description:<ASCII không dấu> }`; INSERT đúng **6 cột**, `action_code='read'` **tường minh**.
  - ⚠ **`roles` đúng 3 phần tử**: `['SYSTEM_ADMIN','BUSINESS_ADMIN','MANAGER']` (OQ-7). **KHÁC CẢ HAI tiền lệ**: `zones.zone.read` dùng **4 role** (+`EMPLOYEE`); các thao tác ghi zone và `anpr.vehicle.admin_read` dùng **2 role**. **CẤM copy nhầm** mảng 4 hoặc 2 phần tử. **CẤM** `ADMIN`/`INTERNAL_USER` (mã lỗi thời → im lặng không insert).
  - `up()` idempotent: INSERT `ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id` → return nếu vẫn không có → vòng lặp `role_permissions` `ON CONFLICT DO NOTHING`.
  - `down()`: xoá `role_permissions` **trước**, rồi `permissions`.
- Chỉ tạo file, **KHÔNG chạy** `migration:run`.
- **AC**: đúng tên/vị trí; `permission_code='zones.gate_log.read'`, `module_code='zones'`, `action_code='read'`; **đúng 3 role** (không 4, không 2); `up()` chạy lại không lỗi/không nhân bản; `down()` đúng thứ tự.

## T-GATE — (STOP, KHÔNG commit) — plan §10
- `npm run build` = **0 error**.
- eslint **chỉ file đã chạm** = **0 rule mới** (**KHÔNG `npm run lint` trần** — script đó `--fix` toàn repo). File có lỗi nền → chứng minh pre-existing bằng `git show HEAD:<file>`.
- `npx jest src/modules/zones` **xanh** — **131 test cũ không hồi quy**, đối chiếu baseline T0 mục 1. Test cũ fail → **DỪNG, báo cáo, KHÔNG sửa test cho qua**.
- Coverage `GateAccessLogService` **≥80%**.
- **DI-proof**: `AppModule` compile **preview mode** — 0 `UnknownDependenciesException`, 0 circular (module wiring có đổi). Throwaway xoá sạch.
- **KHÔNG** `migration:run` (kể cả local) · **KHÔNG** RDS · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file + kết quả jest (tách test cũ/mới) + coverage + DI-proof.
- **Bàn giao**: gọi `GET /api/v1/admin/gate-access-logs` local cần seed `20260722000007` trước; thiếu → **403** (không phải lỗi code). Bảng `gate_access_logs` **chưa có dữ liệu** (writer UC-105 chưa xây) ⇒ response `data: []`.
- **Owed**: `paired_log_id`/`duration_seconds` luôn NULL (chờ UC-106) · giả định writer ghi `plate_number` chuẩn hoá · `IDX_gate_logs_unpaired` chỉ index `user_id` ⇒ lượt xe (`user_id` NULL) không có index unpaired · **`normalizePlate` import chéo `zones→anpr/utils` — nguồn DUY NHẤT chuẩn hoá biển, CẤM viết lại; chuyển sang `src/common/utils/` khi có consumer thứ ba (KHÔNG ở UC-107 — sẽ phải sửa 4+ file `anpr` vừa land UC-101)** · **log trỏ tới zone/user đã xoá mềm vẫn trả tên bình thường (KHÔNG cờ `zone_deleted`) — FE hiện KHÔNG phân biệt cổng còn hoạt động vs đã lưu trữ** · `direction` không CHECK ở DB, ép application · ánh xạ số hiệu UC mới↔cũ · Project Overview FE-18 còn ghi "phê duyệt" xe · global exception filter · Swagger · 5 file `spec/global/` rỗng.
- **AC**: bảng gate + báo cáo tick: **0 chỗ `deletedAt`** (assert có test) ✓ · `direction`=`enter`/`leave`, 0 chỗ `in`/`out` ✓ · `listAll` `andWhere` từ đầu, 0 `.where('1=1')` ✓ · `plate` normalize trước exact ✓ · route user KHÔNG trả `user`, admin trả `full_name`+`email` không field nhạy cảm ✓ · migration **3 role** ✓ · URL không dưới `/zones` ✓ · 0 migration schema ✓ · 0 `PaginationMeta` mới ✓ · 131 test cũ không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-107
- **T0** → baseline 131 test · entity KHÔNG DeleteDateColumn · PaginationMeta export · normalizePlate path · UserEntity/ZoneEntity fields · module hiện trạng · timestamp `...0007` · mẫu seed
- **T1/T1b** → `GATE_DIRECTIONS = ['enter','leave']` (ràng buộc UC-105)
- **T2/T2b** → DTO user (from/to/direction/zone_id, KHÔNG user_id/plate) + whitelist SEC-01 + `direction='in'` bị loại
- **T3/T3b** → DTO admin `extends` (+user_id/plate) + JSDoc đính chính
- **T4/T4b** → mapper user (KHÔNG owner) + admin (`user{user_id,full_name,email}`) + field nhạy cảm bị loại
- **T5/T5b** → service QueryBuilder 2 method (**0 deletedAt**, andWhere từ đầu, plate normalize+exact) + test search-kết-hợp
- **T6/T6b** → controller 2 route (URL không dưới `/zones`), permission gate + metadata test
- **T7** → wiring `zones.module.ts` (+1 controller +1 provider)
- **T8** → migration seed `zones.gate_log.read` → **3 role** (khác 4 của zone-read, khác 2 của admin_register)
- **T-GATE** → gate + 131 test không hồi quy + DI-proof + STOP + bàn giao + Owed (gồm nợ `normalizePlate` import chéo)
