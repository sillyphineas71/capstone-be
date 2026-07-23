# VPL-002 — plan.md (UC-101 ANPR: xem & tra cứu phương tiện)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan VPL-002 (UC-101) sau spec DUYỆT + chốt OQ-1→OQ-5. Route user `GET /anpr/vehicle-registrations` thêm filter `plate`+`vehicle_type`; route admin mới `GET /anpr/admin/vehicle-registrations` (không fold user, +`user_id`/`owner`). `listAll()` net-new **luôn** `leftJoinAndSelect('vr.user')`; mapper riêng `toAdminVehicleRegistrationResponse`; DTO admin **`extends`** DTO user. 1 migration seed permission `anpr.vehicle.admin_read` (2 role). **RECON làm rõ QĐ-12**: cột thật bảng `permissions` + chốt mirror pattern zone-seed 1-file. | Toàn bộ |
| 2026-07-23 | **ĐIỀU CHỈNH (Thiếu Chủ)**: `list()` route user **GIỮ `findAndCount`** + toán tử `ILike` (repo đã dùng `ILike` ở roles/users/permissions.service) thay vì đổi sang QueryBuilder — route user không join/`OR` nên không cần. **Hệ quả**: bỏ hẳn việc viết lại 6 test cũ VPL-001 (service.spec.ts:230-267) — chúng không vỡ, chỉ **thêm** case `plate`/`vehicle_type`. `listAll()` (admin) vẫn QueryBuilder (thật sự cần join+`OR`). Thêm residual: `owner` không normalize ⇒ `%`/`_` thành wildcard LIKE (không phải lỗ hổng). Cập nhật §0.6/§3.1/§3.2/§7.1/§7.4/§8/§9. | §0.6, §3, §7, §8, §9 |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại 12 QĐ §7 + 5 OQ đã chốt.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

### 0.1. ⭐ QĐ-12 — cách seed permission (điểm dễ sai nhất) — ĐÃ LÀM RÕ

**Cột thật bảng `permissions`** (không có migration `CREATE TABLE permissions` bằng raw SQL — bảng tạo qua bootstrap/entity-sync sớm; nhưng ~130 file seed **đồng nhất** dùng đúng 6 cột):
```
permission_code, permission_name, module_code, action_code, description, is_active
```
Bằng chứng: [20260720000005-BackfillRolePermissions.ts:820](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts) và [20260722000005-SeedZoneAssignDevicePermission.ts:41](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts) — cùng danh sách cột.

**`action_code` là BẮT BUỘC (NOT NULL trên thực tế)**: **mọi** file seed đều truyền `action_code` — không file nào bỏ trống. Hai cách điền `action_code` cùng tồn tại, **KHÔNG mâu thuẫn về cột**, chỉ khác cách suy giá trị:
- Backfill gộp: `action_code = e.code.split('.').pop()` — derive segment cuối của code ([:823](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts)). Với `anpr.vehicle.admin_read` → `admin_read`.
- Zone seed 1-file: truyền **tường minh** `action: 'assign_device'` ([:26-33,42](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts)).

→ **CHỐT dạng file seed UC-101**: **mirror zone-seed 1-file** ([20260722000005](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts)) — 1 permission / 1 file, `action_code` **tường minh** = `'admin_read'`, `module_code = 'anpr'`. KHÔNG dùng dạng backfill (backfill là migration vá lỗi lịch sử gộp ~130 permission, không phải khuôn cho permission mới). Idempotent: `INSERT ... ON CONFLICT (permission_code) DO NOTHING RETURNING id` + fallback `SELECT id`, rồi `INSERT INTO role_permissions ... ON CONFLICT (role_id, permission_id) DO NOTHING`. `down()` xoá `role_permissions` trước, `permissions` sau.

- **3 permission ANPR hiện có** (`admin_register`, `history_view`, `unknown_view`) đều **2 role** `BUSINESS_ADMIN`+`SYSTEM_ADMIN` ([20260720000005:178-195](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts)) ⇒ `admin_read` theo đúng bộ 2 role này (QĐ-11). **KHÔNG** tái dùng `admin_register` (khác hành động: đăng ký hộ ≠ đọc danh sách).

### 0.2. Xác nhận entity/field
- **`UserEntity`**: `email` varchar(255) ([user.entity.ts:44-45](../../../../src/modules/accounts/entities/user.entity.ts)); `fullName` map cột `full_name` varchar(255) ([:55-56](../../../../src/modules/accounts/entities/user.entity.ts)). ⇒ `owner` filter dùng property TypeORM `u.fullName` / `u.email` trong QueryBuilder.
- **`VehicleRegistrationEntity.user` là `@ManyToOne`** ([vehicle-registration.entity.ts:55-57](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts), `onDelete:'CASCADE'`, `@JoinColumn({name:'user_id'})`) ⇒ `leftJoinAndSelect('vr.user','u')` **KHÔNG nhân dòng** → `getManyAndCount()` + `skip/take` đúng (OQ-3).
- **`vehicleType`** varchar(50) nullable, KHÔNG enum ([:36-37](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts)) ⇒ filter exact, DTO KHÔNG `@IsIn` (QĐ-5).

### 0.3. `list()` hiện tại & `PaginationMeta`
- [vehicle-registration.service.ts:121-148](../../../../src/modules/anpr/services/vehicle-registration.service.ts): `findAndCount`, `where={userId, deletedAt:IsNull()}` + optional `status`, `order:{createdAt:'DESC'}`, `skip/take`, trả `{items, meta}`.
- `PaginationMeta` **đã export** [:17-22](../../../../src/modules/anpr/services/vehicle-registration.service.ts) ⇒ dùng lại, **CẤM** khai bản thứ ba (QĐ-9).
- `normalizePlate` [normalize-plate.ts:13-18](../../../../src/modules/anpr/utils/normalize-plate.ts) — dùng cho `plate` search.

### 0.4. Controller & imports
- [vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts): `@Controller('anpr')`, `REGISTER_PIPE` [:33](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts). Import **đã có** `Get`, `Query`, `Param`, `ParseUUIDPipe`, `toVehicleRegistrationResponse`, `ListVehicleRegistrationsQueryDto` ([:1-31](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)) ⇒ chỉ **thêm import** `AdminListVehicleRegistrationsQueryDto` + `toAdminVehicleRegistrationResponse`.
- Route admin đã có tiền lệ: `admin/vehicle-history`, `admin/unknown-vehicles`, `POST admin/vehicle-registrations`. **Chưa có** `GET admin/vehicle-registrations`.

### 0.5. Mốc & số thứ tự
- **Migration cuối thực tế = `20260722000005`** (`SeedZoneAssignDevicePermission`) ⇒ **UC-101 lấy `20260722000006-SeedAnprVehicleAdminReadPermission.ts`**. (Không còn UC zone nào tranh số — cụm zone đã xong tới ...0005.) T0 tasks verify lại thư mục.
- **Baseline test module `anpr` = 8 suite** (8 file `*.spec.ts`), ~96–100 `it`. **T0 PHẢI đếm lại chính xác bằng `npx jest src/modules/anpr`** trước khi sửa — con số dùng để chứng minh không hồi quy.

### 0.6. ⚠ RỦI RO HỒI QUY (đã soi test thật)
Test `list()` cũ **assert trực tiếp trên `repo.findAndCount.mock.calls`** — [vehicle-registration.service.spec.ts:230-267](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts) (≥6 `it`): SEC fold `userId`, phân trang skip/take, `status` filter, `status` không lọt when absent, list rỗng. Mock repo khai `findAndCount: jest.fn()` [:22](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts).
→ Nếu đổi `list()` sang QueryBuilder thì `findAndCount` không còn được gọi ⇒ các test này VỠ.
→ **ĐÃ TRÁNH (điều chỉnh §2)**: `list()` **giữ `findAndCount`** + toán tử `ILike` cho `plate` (không cần join/`OR`). `findAndCount` vẫn được gọi ⇒ **6 test cũ KHÔNG đụng, KHÔNG vỡ**; chỉ **thêm** case cho `plate`/`vehicle_type`. Phát hiện này vẫn có giá trị (chặn hướng đi sai). Chi tiết §7.4.

## 1. Quyết định đã chốt (OQ + Constitution)

**OQ-1** route admin không xung đột `:id` (literal prefix khác) — vẫn khai trước cho nhất quán · **OQ-2** `owner` = `fullName` OR `email`, KHÔNG normalize · **OQ-3** admin **luôn** `leftJoinAndSelect`, chỉ trả `full_name`+`email`, mapper riêng · **OQ-4** DTO admin **`extends`** DTO user · **OQ-5** không mâu thuẫn luật mới.

**12 QĐ §7 (không mở lại)**: route admin 2-method · search normalize+ILIKE · leading wildcard→seq scan chấp nhận · lọc chủ xe admin-only · `list()`→QueryBuilder · `vehicle_type` exact không enum · filter user +`plate`/`vehicle_type` · sort `createdAt DESC` hard-code · xe xoá mềm ẩn cả admin · `PaginationMeta` dùng lại · permission `admin_read` 2 role · seed đọc schema thật (đã làm §0.1).

- **SEC-01**: route user fold cứng `vr.userId`, KHÔNG nhận `user_id`/`owner` (whitelist loại). Mapper user KHÔNG owner.
- **SEC-02**: route admin `JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions('anpr.vehicle.admin_read')`; route user chỉ `JwtAuthGuard`.
- **SEC-03**: `plate`/`owner`/`user_id`/`status`/`vehicleType` qua **bound param**; `plate` normalize; CẤM nối chuỗi SQL.
- **DATA-01**: read-only; `deletedAt IS NULL` **tường minh** cả 2 method.
- **ARCH-01**: `owner` join qua **relation `vr.user`** đã khai — KHÔNG gọi service `accounts`, KHÔNG raw JOIN rời.
- **ARCH-02**: `limit` max 100 chặn quét toàn bảng.
- **DATA-03 / no-migration-schema**: migration DUY NHẤT = seed permission; CẤM thêm cột/index dù seq scan.

## 2. DTO

### 2.1. `ListVehicleRegistrationsQueryDto` — **Modified** (route user)
File [list-vehicle-registrations-query.dto.ts](../../../../src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts). Thêm **2 field** (giữ `page`/`limit`/`status`):

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `plate?: string` | `plate` | `@IsOptional @IsString @MaxLength(20)` |
| `vehicleType?: string` | `vehicle_type` | `@Expose({name:'vehicle_type'}) @IsOptional @IsString @MaxLength(50)` — **KHÔNG** `@IsIn` (QĐ-5) |

- Thêm import `IsString`, `MaxLength` (class-validator), `Expose` (class-transformer). **KHÔNG** thêm `user_id`/`owner`/`sort_by`.
- ⚠ `@Expose({name})` cần `ValidationPipe` transform — `REGISTER_PIPE` đã có `transform:true`. (Đối chiếu tiền lệ zone `@Expose({name:'zone_type'})`.)

### 2.2. `AdminListVehicleRegistrationsQueryDto extends ListVehicleRegistrationsQueryDto` — **net-new** (route admin)
File mới `admin-list-vehicle-registrations-query.dto.ts`. `extends` lớp cha (kế thừa `page`/`limit`/`status`/`plate`/`vehicle_type`) + 2 field:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `userId?: string` | `user_id` | `@Expose({name:'user_id'}) @IsOptional @IsUUID('4')` |
| `owner?: string` | `owner` | `@IsOptional @IsString @MaxLength(255)` |

- **JSDoc BẮT BUỘC** (OQ-4): nêu rõ `user_id`/`owner` chỉ cho route admin đã qua `@RequirePermissions`; route user vẫn fold cứng `userId` từ JWT — đính chính comment SEC-01 của lớp cha vốn chỉ đúng cho lớp cha.
- **KHÔNG** `sort`/`include_deleted`.

## 3. Service — method sửa/thêm trong `VehicleRegistrationService`

File [vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts) (**Modified** — chỉ đụng `list()` + thêm `listAll()`; KHÔNG sửa `register`/`loadOwned`/`getDetail`/`updateMetadata`/`setStatus`/`softDeleteOwned`). Import: **giữ** `IsNull` + `FindOptionsWhere` (đang dùng ở `list()`/`loadOwned`); **thêm** `ILike` (typeorm) cho `list()`; `normalizePlate` đã import.

### 3.1. `list(userId, query)` — **GIỮ `findAndCount`** + toán tử `ILike`, chỉ THÊM 2 filter (điều chỉnh §2 — huỷ đổi QueryBuilder)
> ⚠ **KHÔNG đổi sang QueryBuilder.** Route user không join, không `OR` ⇒ `ILike` trong `where` object là đủ. Giữ `findAndCount` ⇒ **6 test cũ VPL-001 không vỡ** (vẫn assert `findAndCount.mock.calls[0][0].where`). Đây là cải tiến so với plan gốc §0.6.
```
const page = query.page ?? 1; const limit = query.limit ?? 20;
const where: FindOptionsWhere<VehicleRegistrationEntity> = { userId, deletedAt: IsNull() };
if (query.status)      where.status      = query.status;                          // exact
if (query.vehicleType) where.vehicleType = query.vehicleType;                     // exact
if (query.plate)       where.plateNumber = ILike(`%${normalizePlate(query.plate)}%`); // partial, normalize
const [items, total] = await this.repo.findAndCount({
  where, order: { createdAt: 'DESC' }, skip: (page-1)*limit, take: limit,
});
return { items, meta: { page, limit, total, totalPages: Math.ceil(total/limit) } };
```
- **KHÔNG** join `user` (SEC-01 — không cần owner). Fold cứng `userId`, `deletedAt: IsNull()`, sort, shape `{items, meta}` — **y hệt VPL-001**, chỉ cộng 2 key `where`.
- Filter vắng mặt **không** vào `where` (guard `if`). `plate` normalize trước `ILike`; `normalizePlate` strip `[^A-Z0-9]` ⇒ `%`/`_` người dùng không thể thành wildcard (tự vệ sinh).

### 3.2. `listAll(query)` — **net-new** (route admin), **GIỮ QueryBuilder**, **LUÔN** join (OQ-3)
> QueryBuilder thật sự cần ở đây: `leftJoinAndSelect` + `OR` trên 2 cột đã join — `ILike` trong `where` object không làm được `OR`. Là method net-new nên KHÔNG có test cũ để vỡ.
```
const page = query.page ?? 1; const limit = query.limit ?? 20;
const qb = this.repo.createQueryBuilder('vr')
  .leftJoinAndSelect('vr.user', 'u')                  // LUÔN — không nhánh điều kiện
  .where('vr.deletedAt IS NULL');                     // KHÔNG fold userId
if (query.status) qb.andWhere('vr.status = :status', { status: query.status });
if (query.vehicleType) qb.andWhere('vr.vehicleType = :vt', { vt: query.vehicleType });
if (query.plate) qb.andWhere('vr.plateNumber ILIKE :p', { p: `%${normalizePlate(query.plate)}%` });
if (query.userId) qb.andWhere('vr.userId = :uid', { uid: query.userId });    // exact, dùng index
if (query.owner) qb.andWhere('(u.fullName ILIKE :o OR u.email ILIKE :o)', { o: `%${query.owner}%` }); // KHÔNG normalize
qb.orderBy('vr.createdAt', 'DESC').skip((page-1)*limit).take(limit);
const [items, total] = await qb.getManyAndCount();
return { items, meta: { page, limit, total, totalPages: Math.ceil(total/limit) } };
```
- `owner` khớp **cả** `fullName` LẪN `email`, **KHÔNG** normalize (OQ-2). `plate` **CÓ** normalize.
- ⚠ **Residual**: `owner` không normalize ⇒ nếu người dùng gõ `%`/`_` thì thành wildcard LIKE (`owner=%` khớp mọi người). **KHÔNG** phải lỗ hổng (vẫn bound param, không SQL injection) — chỉ hành vi lạ; ghi Owed §8, KHÔNG xử ở UC này.
- ⚠ `getManyAndCount()` an toàn vì `vr.user` `ManyToOne` (§0.2) — KHÔNG thêm collection-join.
- Return type dùng lại `{ items: VehicleRegistrationEntity[]; meta: PaginationMeta }`.

## 4. Mapper — admin response

File mới `admin-vehicle-registration-response.dto.ts` (hoặc thêm export vào file response hiện có — **CHỐT: file riêng** để không đụng `toVehicleRegistrationResponse`).

`toAdminVehicleRegistrationResponse(vr: VehicleRegistrationEntity)` = mọi field của `toVehicleRegistrationResponse` **cộng** khối owner:
```
owner: vr.user ? { user_id: vr.user.id, full_name: vr.user.fullName, email: vr.user.email } : null
```
- **CHỈ** `user_id`+`full_name`+`email`. CẤM `phone`/`department`/`status` tài khoản/`username`/`employeeCode` (SEC-01).
- **KHÔNG** import/sửa `toVehicleRegistrationResponse` (route user tuyệt đối không owner). Nếu muốn tránh lặp thân mapper: cho phép gọi lại `toVehicleRegistrationResponse(vr)` rồi spread thêm `owner` — nhưng **KHÔNG** sửa hàm gốc.

## 5. Controller — route

File [vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts) (**Modified**). Thêm import `AdminListVehicleRegistrationsQueryDto`, `toAdminVehicleRegistrationResponse`.

```
GET /api/v1/anpr/admin/vehicle-registrations   → listAll (admin)   [net-new]
GET /api/v1/anpr/vehicle-registrations         → list   (user, đã có — chỉ đổi DTO nhận filter)
```
- **Route admin** (khai trong nhóm admin, TRƯỚC `@Get('vehicle-registrations/:id')`):
  `@Get('admin/vehicle-registrations')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('anpr.vehicle.admin_read')` · `@UsePipes(REGISTER_PIPE)` · `@Query() query: AdminListVehicleRegistrationsQueryDto`
  → `{ success:true, message:'Vehicle registrations retrieved successfully', data: items.map(toAdminVehicleRegistrationResponse), meta }`.
- **Route user** (`@Get('vehicle-registrations')` đã có): chỉ đổi kiểu `@Query()` sang DTO đã mở rộng; response giữ `toVehicleRegistrationResponse` (KHÔNG owner). Guard/permission **không đổi**.
- **Comment thứ tự khai (OQ-1)**: ghi rõ tiêu chí đúng — xung đột route chỉ khi **cùng literal prefix + `:param` ở vị trí khác biệt**, KHÔNG phải "cùng số segment". `admin/vehicle-registrations` vs `vehicle-registrations/:id` **không** xung đột (segment đầu literal khác); đặt trước chỉ cho nhất quán. Mirror đính chính ở [zones.controller.ts:108-111](../../../../src/modules/zones/controllers/zones.controller.ts).
- **KHÔNG** `@HttpCode` (GET mặc định 200); route user **giữ** `@CurrentUser` (cần userId), route admin **không** cần `@CurrentUser`.

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| List thành công (user/admin) | `200` | — |
| List rỗng | `200` + `data:[]`, `meta.total=0` | — |
| Query sai (`limit>100`/`page<1`/`status` ngoài enum/`user_id` không UUID) | `400` | (Nest validation) |
| Chưa đăng nhập | `401` | — |
| Route admin thiếu permission | `403` | `FORBIDDEN` (guard) |

## 6. File list

### Net-new
**Code (3)**
- `src/modules/anpr/dto/admin-list-vehicle-registrations-query.dto.ts` — `AdminListVehicleRegistrationsQueryDto extends ListVehicleRegistrationsQueryDto`.
- `src/modules/anpr/dto/admin-vehicle-registration-response.dto.ts` — `toAdminVehicleRegistrationResponse` (owner: full_name+email).
- `src/database/migrations/20260722000006-SeedAnprVehicleAdminReadPermission.ts` — seed `anpr.vehicle.admin_read` (`module_code='anpr'`, `action_code='admin_read'`), 2 role `BUSINESS_ADMIN`+`SYSTEM_ADMIN`; mirror [20260722000005](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts). ⚠ số thứ tự verify lại T0.

**Test (2)**
- `src/modules/anpr/dto/admin-list-vehicle-registrations-query.dto.spec.ts`
- (mở rộng) list DTO spec — nếu chưa có file riêng cho list DTO thì thêm case vào spec DTO hiện có; T0 kiểm tra tồn tại `list-vehicle-registrations-query.dto.spec.ts`.

### Modified
- `src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts` — thêm `plate`+`vehicle_type`.
- `src/modules/anpr/services/vehicle-registration.service.ts` — `list()` GIỮ `findAndCount` + thêm `ILike` cho `plate`/`vehicleType`; thêm `listAll()` (QueryBuilder).
- `src/modules/anpr/services/vehicle-registration.service.spec.ts` — **CHỈ THÊM** case `plate`/`vehicle_type` cho `list()` (KHÔNG đụng 6 test cũ) + thêm `describe('listAll')`.
- `src/modules/anpr/controllers/vehicle-registration.controller.ts` — thêm route admin + 2 import.
- `src/modules/anpr/controllers/vehicle-registration.controller.spec.ts` — thêm test route admin + cập nhật mock `service.listAll`.

> Tổng **5 net-new (3 code + 2 test) + 5 modified (3 code + 2 test)** ≈ **10 file**. **0 migration schema**. `vehicle-registration.entity.ts`, `vehicle-registration-response.dto.ts` (mapper user), `normalize-plate.ts`, `anpr.module.ts`, `app.module.ts`, `data-source.ts`, uc1/uc2/uc4/uc5/uc6/uc7 **KHÔNG đổi**.

## 7. Test (mock repo — KHÔNG DB)

- **`list()` (user)**: mock `findAndCount` (đã có sẵn) — assert trên `repo.findAndCount.mock.calls[0][0].where`.
- **`listAll()` (admin)**: mock `createQueryBuilder` trả object chainable — `where`/`andWhere`/`leftJoinAndSelect`/`orderBy`/`skip`/`take` đều `jest.fn().mockReturnThis()`, `getManyAndCount: jest.fn().mockResolvedValue([[], 0])`.

### 7.1. `list()` (user) — GIỮ `findAndCount` + `ILike`, chỉ THÊM case (KHÔNG đụng test cũ)
- `plate` normalize đúng: `list('u1', {plate:'29a-123'})` → `where.plateNumber` là `ILike('%29A123%')` (chứng minh normalize, KHÔNG `%29a-123%`). Assert bằng so shape của `ILike` (kiểm `_type==='ilike'`/`_value==='%29A123%'`, hoặc so `ILike('%29A123%')`).
- `vehicle_type` exact: `{vehicleType:'car'}` → `where.vehicleType === 'car'`.
- filter kết hợp `status`+`vehicleType`+`plate` → `where` có đủ 3 key + `userId` + `deletedAt`.
- filter vắng mặt KHÔNG lọt `where` (chỉ gửi `plate` → `'status' in where === false`, `'vehicleType' in where === false`).
- **fold cứng `userId`** + `deletedAt: IsNull()`: luôn có trong `where`.
- **KHÔNG** join `user`: `createQueryBuilder` **không** được gọi trong `list()`.
- sort `order:{createdAt:'DESC'}`; `skip`/`take` đúng.

### 7.2. `listAll()` (admin)
- **KHÔNG** fold `userId`: assert `where` KHÔNG chứa `vr.userId = :userId` từ current user (chỉ có khi client gửi filter `user_id`).
- **LUÔN** join: `leftJoinAndSelect('vr.user','u')` được gọi **kể cả** không gửi `owner`.
- `user_id` exact: `{userId:'u9'}` → `andWhere('vr.userId = :uid', {uid:'u9'})`.
- `owner` khớp cả 2 cột: `{owner:'nguyen'}` → `andWhere('(u.fullName ILIKE :o OR u.email ILIKE :o)', {o:'%nguyen%'})`; **KHÔNG** normalize (giữ nguyên hoa/thường/dấu cách).
- **search + filter kết hợp** (bài học UC-93): `{plate:'29A', userId:'u9', status:'active'}` → assert **cả** `ILIKE` **lẫn** 2 `andWhere` filter đều gắn.
- `deletedAt IS NULL` tường minh.

### 7.3. Mapper admin
- `toAdminVehicleRegistrationResponse` với `vr.user` set → output có `owner.full_name`+`owner.email`+`owner.user_id`, **KHÔNG** có `phone`/`department`/`username`/`status` tài khoản.
- `vr.user` null → `owner: null` (không nổ).

### 7.4. Không hồi quy `list()` — GIỮ NGUYÊN test cũ (điều chỉnh §2)
- 6 test cũ [service.spec.ts:230-267](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts) assert `repo.findAndCount.mock.calls` — **KHÔNG đụng, KHÔNG viết lại**. Vì `list()` giữ `findAndCount`, chúng vẫn xanh nguyên trạng.
- Chỉ **THÊM** case mới (§7.1) cho `plate`/`vehicle_type` trên cùng khuôn `findAndCount`. Mock repo [:22](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts) đã có `findAndCount` — **KHÔNG** cần thêm `createQueryBuilder` cho nhánh `list()`.
- Chạy full `npx jest src/modules/anpr` xanh: 8 suite cũ + case mới; đối chiếu số baseline đếm ở T0.

### 7.5. DTO
- `AdminListVehicleRegistrationsQueryDto`: `extends` hoạt động — instance có đủ `page`/`limit`/`status`/`plate`/`vehicle_type` (cha) + `user_id`/`owner` (con).
- `user_id` không phải UUID → lỗi `isUuid`; `limit=101`→`max`; `page=0`→`min`.
- **whitelist route user**: `ValidationPipe({whitelist:true}).transform({user_id, owner, plate})` trên `ListVehicleRegistrationsQueryDto` (lớp CHA) → loại `user_id`/`owner`, giữ `plate` (SEC-01).
- `@Expose({name:'vehicle_type'})`/`{name:'user_id'}`: gửi snake_case → map đúng property camelCase sau transform.

### 7.6. Controller
- Route admin gọi `service.listAll(query)` 1 lần; envelope + `data` qua `toAdminVehicleRegistrationResponse`; `meta` ngang `data`.
- Metadata `PERMISSIONS_KEY` route admin = `['anpr.vehicle.admin_read']`; guard có `JwtAuthGuard`+`PermissionsGuard`. Route user **KHÔNG** có `PERMISSIONS_KEY` (giữ nguyên).
- Route user vẫn gọi `service.list(currentUser.userId, query)` — không hồi quy.
- **Không hồi quy**: test route `POST`/`PATCH`/`DELETE`/`admin/vehicle-history`/`admin/unknown-vehicles` cũ vẫn xanh.

**Nguyên tắc**: 100% mock repo/service; KHÔNG DB/migration/e2e.

## 8. Gate (STOP, KHÔNG commit)

- `npm run build` = 0 error; eslint trên **~10 file touched** = 0 rule mới (chứng minh pre-existing bằng `git show HEAD:<file>` nếu file có lỗi nền).
- `npx jest src/modules/anpr` xanh — **gồm test `list()` viết lại + toàn bộ test cũ**. T0 đếm baseline trước (kỳ vọng 8 suite / ~96–100 test).
- Coverage `VehicleRegistrationService` ≥80% (cả `list` mới + `listAll`).
- **DI-proof**: `NestFactory.create(AppModule, {preview:true})` — 0 `UnknownDependenciesException`, 0 circular (module không đổi wiring nhưng service/controller sửa nên vẫn chạy).
- **KHÔNG** `migration:run` (kể cả local), **KHÔNG** chạm RDS, **KHÔNG** live smoke, **KHÔNG** commit.
- **Bàn giao**: gọi `GET /api/v1/anpr/admin/vehicle-registrations` local cần chạy seed `20260722000006` trước; thiếu → **403** (không phải lỗi code).
- **Owed**: index cho `plate`/`owner`/`vehicle_type`/`status` khi dữ liệu lớn (`pg_trgm`/btree) · chuẩn hoá `vehicle_type` (enum + migrate dữ liệu cũ) · **`owner` không normalize ⇒ `%`/`_` thành wildcard LIKE** (§3.2 — không phải lỗ hổng, chỉ hành vi lạ) · dọn `PaginationMeta` trùng 2 bản · ánh xạ số hiệu UC mới↔cũ · Project Overview FE-18 còn ghi "phê duyệt" xe (đã chốt bỏ duyệt) · global exception filter · Swagger · 5 file `spec/global/` rỗng · ranh giới `anpr`↔`accounts` khi lộ owner.

## 9. Kỷ luật

- **ĐÍNH CHÍNH LUẬT ROUTE (áp dụng mọi UC sau)**: xung đột thứ tự khai route xảy ra khi **cùng literal prefix + có `:param` ở vị trí segment khác biệt** — **KHÔNG phải** "cùng số segment". Ví dụ: `vehicle-registrations/summary` vs `vehicle-registrations/:id` → **xung đột** (cùng prefix); `admin/vehicle-registrations` vs `vehicle-registrations/:id` → **không** (segment đầu literal khác). Vẫn khai static-trước-động cho nhất quán, kèm comment nêu tiêu chí đúng.
- **`getManyAndCount()` + `leftJoinAndSelect` an toàn CHỈ vì `vr.user` là `ManyToOne`** (không nhân dòng). Nếu sau thêm `OneToMany` (vd ảnh xe) vào cùng query → nhân dòng → **phá phân trang**; phải tách count query. Ghi để người sau biết.
- **`list()` fold cứng `userId` + KHÔNG join `user`**; **`listAll()` KHÔNG fold + LUÔN join**. Đừng trộn hai hành vi.
- **Mapper**: route user `toVehicleRegistrationResponse` (KHÔNG owner) — CẤM sửa; route admin `toAdminVehicleRegistrationResponse` (owner = full_name+email, CẤM field nhạy cảm khác).
- **`plate` CÓ normalize** (biển số) · **`owner` KHÔNG normalize** (tên người). Cả hai **bound param**, cấm nối chuỗi.
- **Route user dùng `findAndCount` + `ILike`; route admin dùng QueryBuilder** (cần join + `OR`). **Đừng đồng bộ hoá hai method cho "nhất quán"** — mỗi bên chọn công cụ vừa đủ. `list()` giữ `findAndCount` chính là để 6 test cũ VPL-001 không phải viết lại.
- **DTO admin `extends` DTO user** — DTO user không đổi ⇒ route user không thể nhận `user_id`/`owner`. JSDoc lớp con đính chính comment SEC-01 của lớp cha.
- **Seed permission**: mirror zone-seed 1-file, `action_code` tường minh `'admin_read'`, 2 role; đặt trong `migrations/` (không `seeds/`). Cùng commit với controller (thiếu → 403).
- **`PaginationMeta` dùng lại bản export** (service.ts:17-22) — CẤM bản thứ ba.
- **No-migration-schema**: cấm thêm cột/index dù seq scan; migration duy nhất = seed permission.
- **Không đụng** uc1/uc2/uc4/uc5/uc6/uc7, entity, mapper user, `normalize-plate.ts`, module wiring, `app.module.ts`, `data-source.ts`.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
