# VPL-002 — tasks.md (UC-101 ANPR: xem & tra cứu phương tiện)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks VPL-002 sau plan DUYỆT + điều chỉnh §2: T0 verify → T1/T1b DTO user mở rộng (`plate`+`vehicle_type`) → T2/T2b DTO admin `extends` → T3/T3b mapper admin → T4/T4b service (`list()` **GIỮ `findAndCount`+`ILike`**, `listAll()` QueryBuilder) → T5/T5b controller route admin → T6 migration seed `anpr.vehicle.admin_read` (**2 role**, `action_code` tường minh) → T-GATE. **KHÔNG task viết lại test cũ** — `list()` giữ `findAndCount` ⇒ 6 test cũ VPL-001 (service.spec.ts:230-267) không vỡ, chỉ **THÊM** case. **KHÔNG task wiring** (`AnprModule` không phát sinh dependency). | Toàn bộ |
| 2026-07-23 | Review code phát hiện 2 điểm, sửa trước khi thực thi: (1) **T5 route user = 0 dòng thay đổi** — controller đã khai `@Query() query: ListVehicleRegistrationsQueryDto`, T1 thêm field vào chính class đó nên tên type không đổi ⇒ route user không cần sửa dòng nào (bỏ chữ "đổi kiểu @Query" gây sửa vô cớ). (2) **Thêm case SEC-01 chiều ngược vào T5b**: assert response route **user KHÔNG có khoá `owner`** + `service.listAll` KHÔNG được gọi ở route user — chốt chặn rẻ chống rò dữ liệu `accounts`. | T5, T5b |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại 12 QĐ (spec §7), 5 OQ đã chốt, plan §9. **KHÔNG** sửa `toVehicleRegistrationResponse`, `normalize-plate.ts`, `vehicle-registration.entity.ts`, `anpr.module.ts`, `app.module.ts`, `data-source.ts`, hay spec/plan/tasks của `uc1`→`uc7`. **KHÔNG** migration schema (cấm thêm cột/index). **KHÔNG** khai `PaginationMeta` bản thứ ba. **KHÔNG** enum/constant cho `vehicle_type`.

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T5b → T6 → T-GATE.

> **Phụ thuộc**: `ListVehicleRegistrationsQueryDto` mở rộng (T1) trước DTO admin (T2 `extends` nó) và trước service (T4 nhận DTO) · mapper admin (T3) trước controller (T5 gọi) · service (T4) trước controller (T5 gọi `list`/`listAll`) · migration (T6) độc lập nhưng **cùng commit** với controller (thiếu seed = 403).
>
> **KHÔNG có task wiring module** — `anpr.module.ts` đã đủ (service/controller đã đăng ký từ uc1). **KHÔNG có task audit** — UC-101 read-only.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu tiên. Dán xác nhận từng mục kèm bằng chứng (path + trích ngắn). **Thiếu / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **Baseline test module `anpr`**: đếm suite/test thực tế `npx jest src/modules/anpr` — **kỳ vọng 8 suite / 100 test**. Lệch → ghi nhận và báo **trước khi** code. Con số dùng đối chiếu không hồi quy ở T-GATE.
2. **`ILike` dùng được** (điều kiện sống còn của điều chỉnh §2): xác nhận `import { ILike } from 'typeorm'` + cách dùng trong `where` object tại [roles.service.ts:78,82](../../../../src/modules/accounts/services/roles.service.ts), [users.service.ts:1686-1688](../../../../src/modules/accounts/services/users.service.ts), [permissions.service.ts](../../../../src/modules/accounts/services/permissions.service.ts). Nếu version typeorm hiện tại **không** hỗ trợ `ILike` trong `findAndCount` where → **DỪNG, báo cáo** (toàn bộ điều chỉnh §2 phụ thuộc điểm này).
3. **Test cũ `list()`**: xác nhận vị trí [vehicle-registration.service.spec.ts:230-267](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts) (≥6 `it` assert `repo.findAndCount.mock.calls[0][0].where`) và mock repo khai `findAndCount: jest.fn()` [:22](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts) — để chắc chắn **KHÔNG** phải đụng vào (chỉ thêm case).
4. **DTO hiện có**: [list-vehicle-registrations-query.dto.ts](../../../../src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts) đúng 3 field (`page`/`limit`/`status`). Kiểm tra **có file `list-vehicle-registrations-query.dto.spec.ts` không** → quyết định T1b thêm case vào file cũ hay tạo file mới; **ghi rõ**.
5. **`UserEntity`**: `fullName` map cột `full_name` ([user.entity.ts:55-56](../../../../src/modules/accounts/entities/user.entity.ts)) + `email` ([:44-45](../../../../src/modules/accounts/entities/user.entity.ts)) tồn tại; **`VehicleRegistrationEntity.user` là `@ManyToOne`** ([vehicle-registration.entity.ts:55-57](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts)).
6. **`toVehicleRegistrationResponse`**: chữ ký + shape hiện tại ([vehicle-registration-response.dto.ts](../../../../src/modules/anpr/dto/vehicle-registration-response.dto.ts)) — để mapper admin mirror đúng style và **KHÔNG** đụng bản cũ.
7. **Controller**: import **đã có** (`Get`, `Query`, `Param`, `ParseUUIDPipe`, `CurrentUser`, guards, `RequirePermissions`) và hằng `REGISTER_PIPE` ([vehicle-registration.controller.ts:1-33](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)); thứ tự khai route hiện tại (nhóm admin: `admin/vehicle-history`, `admin/unknown-vehicles`; `vehicle-registrations`, `vehicle-registrations/:id`). Xác nhận **thiếu** 2 import: `AdminListVehicleRegistrationsQueryDto`, `toAdminVehicleRegistrationResponse` → T5 bổ sung.
8. **Migration cuối thực tế**: đếm `src/database/migrations/` — **kỳ vọng file cuối `20260722000005-SeedZoneAssignDevicePermission.ts`** ⇒ UC-101 lấy **`20260722000006`**. Nếu đã tồn tại `20260722000006*` → lấy số kế tiếp chưa dùng và **ghi rõ**.

- **AC**: dán xác nhận đủ **8 mục** kèm bằng chứng; mục 1 ghi con số baseline; mục 2 kết luận `ILike` dùng được/không (nếu không → DỪNG); mục 4 chốt file test DTO; mục 8 chốt timestamp.

## T1 — `ListVehicleRegistrationsQueryDto` mở rộng (code) — plan §2.1, QĐ-5/7, SEC-03
File **Modified**: [list-vehicle-registrations-query.dto.ts](../../../../src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts). Giữ nguyên 3 field cũ, **thêm 2 field**:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `plate?: string` | `plate` | `@IsOptional @IsString @MaxLength(20)` |
| `vehicleType?: string` | `vehicle_type` | `@Expose({name:'vehicle_type'}) @IsOptional @IsString @MaxLength(50)` — **KHÔNG** `@IsIn` (QĐ-5) |

- Thêm import: `IsString`, `MaxLength` (class-validator), `Expose` (class-transformer). **CẤM** thêm `user_id`/`owner`/`sort_by`/`include_deleted`.
- `@Expose({name})` chỉ hoạt động khi pipe `transform:true` — `REGISTER_PIPE` đã có.
- **AC**: đúng 5 field (3 cũ + 2 mới); `plate` `@MaxLength(20)`; `vehicle_type` `@Expose({name:'vehicle_type'})` + `@MaxLength(50)` + **KHÔNG** `@IsIn`; 0 field cấm; comment cũ SEC-01 giữ nguyên (đúng cho lớp này).

## T1b — Test `ListVehicleRegistrationsQueryDto` — plan §7.5
File test DTO user (vị trí chốt ở T0 mục 4). Case `plainToInstance` + `validate`; case whitelist qua `ValidationPipe.transform`:
- `plate` hợp lệ (≤20) → 0 lỗi; `plate` 21 ký tự → `maxLength`.
- `vehicle_type` chuỗi bất kỳ (vd `'ô tô'`, `'Car'`) → 0 lỗi (KHÔNG `@IsIn`); 51 ký tự → `maxLength`.
- `@Expose({name:'vehicle_type'})`: gửi `{vehicle_type:'car'}` → sau transform property `vehicleType==='car'`.
- **Whitelist SEC-01**: `new ValidationPipe({whitelist:true, transform:true}).transform({user_id, owner, plate:'29A'}, {type:'body', metatype: ListVehicleRegistrationsQueryDto})` → loại `user_id`/`owner`, **giữ** `plate` (chứng minh route user không nhận filter admin).
- **AC**: các case xanh; case `@Expose` map + case whitelist loại `user_id`/`owner` bắt buộc có mặt.

## T2 — `AdminListVehicleRegistrationsQueryDto` net-new, `extends` (code) — plan §2.2, OQ-4
File net-new: `src/modules/anpr/dto/admin-list-vehicle-registrations-query.dto.ts`.
```
export class AdminListVehicleRegistrationsQueryDto extends ListVehicleRegistrationsQueryDto {
  // @Expose({name:'user_id'}) @IsOptional @IsUUID('4')
  userId?: string;
  // @IsOptional @IsString @MaxLength(255)
  owner?: string;
}
```
- `extends` DTO user (kế thừa `page`/`limit`/`status`/`plate`/`vehicle_type`) + 2 field. Import `Expose`, `IsOptional`, `IsUUID`, `IsString`, `MaxLength`.
- **JSDoc lớp con BẮT BUỘC đính chính** (OQ-4): comment lớp cha ghi *"KHÔNG nhận user_id — server lọc theo current user (SEC-01)"* **chỉ đúng cho lớp cha / route user**. Lớp con **CÓ** `user_id`/`owner`, chỉ dùng cho route admin **đã qua `@RequirePermissions`**; route user vẫn fold cứng `userId` từ JWT.
- **CẤM** `sort`/`include_deleted`.
- **AC**: class `extends ListVehicleRegistrationsQueryDto`; đúng 2 field mới với decorator nêu trên; có JSDoc đính chính; 0 field cấm.

## T2b — Test `AdminListVehicleRegistrationsQueryDto` — plan §7.5
File net-new: `src/modules/anpr/dto/admin-list-vehicle-registrations-query.dto.spec.ts`:
- **`extends` hoạt động**: instance có đủ `page`/`limit`/`status`/`plate`/`vehicle_type` (kế thừa) + `user_id`/`owner`.
- `user_id` không phải UUID v4 → lỗi `isUuid`; `user_id` UUID hợp lệ → 0 lỗi.
- `owner` 256 ký tự → `maxLength`; ≤255 → 0 lỗi.
- kế thừa ràng buộc cha: `limit=101` → `max`, `page=0` → `min`.
- `@Expose({name:'user_id'})`: gửi `{user_id:'<uuid>'}` → property `userId` set đúng sau transform.
- **AC**: các case xanh; case `extends` (đủ field cha+con) + case `user_id` isUuid bắt buộc.

## T3 — Mapper admin `toAdminVehicleRegistrationResponse` net-new (code) — plan §4, OQ-3, SEC-01
File net-new: `src/modules/anpr/dto/admin-vehicle-registration-response.dto.ts`.
- `toAdminVehicleRegistrationResponse(vr: VehicleRegistrationEntity)` = toàn bộ field của `toVehicleRegistrationResponse(vr)` **cộng** khối owner:
  ```
  owner: vr.user ? { user_id: vr.user.id, full_name: vr.user.fullName, email: vr.user.email } : null
  ```
- Được phép **gọi lại** `toVehicleRegistrationResponse(vr)` rồi spread thêm `owner` — nhưng **CẤM sửa** hàm gốc.
- **CHỈ** `user_id`+`full_name`+`email`. **CẤM** `phone`/`department`/`username`/`employeeCode`/trạng thái tài khoản/bất kỳ field nhạy cảm nào khác của `UserEntity` (SEC-01).
- **AC**: hàm mới trả owner đúng 3 khoá; `vr.user` null → `owner: null` (không nổ); `toVehicleRegistrationResponse` **không** bị import-sửa; 0 field nhạy cảm.

## T3b — Test mapper admin — plan §7.3
Thêm file test (hoặc describe) cho mapper admin:
- `vr.user` set → output có `owner.user_id`+`owner.full_name`+`owner.email`, **KHÔNG** có `phone`/`department`/`username`/`status` tài khoản.
- `vr.user` null → `owner: null`.
- output giữ nguyên mọi field của mapper user (chứng minh không bỏ sót field xe).
- **AC**: 3 case xanh; case field nhạy cảm bị loại bắt buộc.

## T4 — Service: `list()` mở rộng + `listAll()` net-new (code) — plan §3
File **Modified**: [vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts). Import: **giữ** `IsNull`+`FindOptionsWhere`; **thêm** `ILike` (typeorm); `normalizePlate` đã có. **KHÔNG** đụng `register`/`loadOwned`/`getDetail`/`updateMetadata`/`setStatus`/`softDeleteOwned`/constructor.

### 4.1. `list(userId, query)` — GIỮ `findAndCount` + `ILike` (điều chỉnh §2)
```
const where: FindOptionsWhere<VehicleRegistrationEntity> = { userId, deletedAt: IsNull() };
if (query.status)      where.status      = query.status;
if (query.vehicleType) where.vehicleType = query.vehicleType;
if (query.plate)       where.plateNumber = ILike(`%${normalizePlate(query.plate)}%`);
const [items, total] = await this.repo.findAndCount({
  where, order: { createdAt: 'DESC' }, skip: (page-1)*limit, take: limit,
});
```
- **KHÔNG** đổi sang QueryBuilder. **KHÔNG** join `user`. Fold cứng `userId` + `deletedAt: IsNull()` + sort + shape `{items, meta}` **y hệt VPL-001**. Filter vắng mặt **không** lọt `where`.

### 4.2. `listAll(query)` — net-new, QueryBuilder, **LUÔN** `leftJoinAndSelect`
```
const qb = this.repo.createQueryBuilder('vr')
  .leftJoinAndSelect('vr.user', 'u')          // LUÔN — KHÔNG join có điều kiện
  .where('vr.deletedAt IS NULL');             // KHÔNG fold userId
if (query.status)      qb.andWhere('vr.status = :status', { status: query.status });
if (query.vehicleType) qb.andWhere('vr.vehicleType = :vt', { vt: query.vehicleType });
if (query.plate)       qb.andWhere('vr.plateNumber ILIKE :p', { p: `%${normalizePlate(query.plate)}%` });
if (query.userId)      qb.andWhere('vr.userId = :uid', { uid: query.userId });
if (query.owner)       qb.andWhere('(u.fullName ILIKE :o OR u.email ILIKE :o)', { o: `%${query.owner}%` });
qb.orderBy('vr.createdAt', 'DESC').skip((page-1)*limit).take(limit);
const [items, total] = await qb.getManyAndCount();
```
- `owner`: **cả** `fullName` LẪN `email`, **KHÔNG** normalize. `plate`: **CÓ** normalize. Mọi giá trị **bound param** (SEC-03).
- Return `{ items, meta: { page, limit, total, totalPages: Math.ceil(total/limit) } }` dùng `PaginationMeta` đã export (QĐ-9).
- **AC**: `list()` vẫn dùng `findAndCount` (KHÔNG `createQueryBuilder`), thêm đúng 2 filter; `listAll()` **luôn** `leftJoinAndSelect`, KHÔNG fold userId, `deletedAt IS NULL` tường minh, 5 filter guard `if`, sort + skip/take + `getManyAndCount`; 0 khai `PaginationMeta` mới.

## T4b — Test service — plan §7.1/§7.2/§7.4
**`describe('list')` — CHỈ THÊM case (KHÔNG đụng 6 test cũ)**. Mock `findAndCount` đã có; **KHÔNG** cần `createQueryBuilder` cho nhánh `list`.
- `plate` normalize: `list('u1', {plate:'29a-123'})` → `where.plateNumber` = `ILike('%29A123%')` (assert so shape `ILike('%29A123%')` hoặc `_value==='%29A123%'`).
- `vehicle_type` exact: `{vehicleType:'car'}` → `where.vehicleType==='car'`.
- filter kết hợp `status`+`vehicleType`+`plate` → `where` đủ 3 key + `userId` + `deletedAt`.
- filter vắng mặt không lọt: chỉ gửi `plate` → `'status' in where===false`, `'vehicleType' in where===false`.
- vẫn fold cứng `userId` + `deletedAt: IsNull()`; **KHÔNG** gọi `createQueryBuilder`.

**`describe('listAll')`** — mock `createQueryBuilder` chainable (`where`/`andWhere`/`leftJoinAndSelect`/`orderBy`/`skip`/`take` → `mockReturnThis()`, `getManyAndCount` → `[[],0]`):
- **KHÔNG** fold `userId`: `where` từ current user không xuất hiện (chỉ có khi gửi filter `user_id`).
- **LUÔN** join: `leftJoinAndSelect('vr.user','u')` được gọi **kể cả** không gửi `owner`.
- `user_id` exact: `{userId:'u9'}` → `andWhere('vr.userId = :uid', {uid:'u9'})`.
- `owner` cả 2 cột: `{owner:'nguyen'}` → `andWhere('(u.fullName ILIKE :o OR u.email ILIKE :o)', {o:'%nguyen%'})`; **KHÔNG** normalize.
- **search + filter KẾT HỢP** (bài học UC-93): `{plate:'29A', userId:'u9', status:'active'}` → assert QueryBuilder nhận **CẢ** `ILIKE` **LẪN** 2 `andWhere` filter — không chỉ một trong hai.
- `deletedAt IS NULL` tường minh; sort + skip/take đúng; list rỗng → `items:[]`, `meta.total=0`, không throw.

**Ràng buộc**: 6 test cũ `list()` [service.spec.ts:230-267](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts) **KHÔNG đổi assert**. Thêm `createQueryBuilder` vào mock repo dùng chung thuộc loại **dựng mock → ĐƯỢC PHÉP**; vẫn CẤM đổi assert test cũ. Test cũ fail → **DỪNG, báo cáo**.
- **AC**: case mới xanh; case `plate` normalize + `owner` 2-cột + search-kết-hợp-filter bắt buộc; **6 test cũ không hồi quy**; coverage `VehicleRegistrationService` ≥80%.

## T5 — Controller: route admin net-new (code) — plan §5, OQ-1, SEC-02
File **Modified**: [vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts). Thêm import `AdminListVehicleRegistrationsQueryDto`, `toAdminVehicleRegistrationResponse`.
- **Route admin** (khai **trong nhóm route admin**, **TRƯỚC** `@Get('vehicle-registrations/:id')`):
  `@Get('admin/vehicle-registrations')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('anpr.vehicle.admin_read')` · `@UsePipes(REGISTER_PIPE)` · `@Query() query: AdminListVehicleRegistrationsQueryDto`
  → `{ success:true, message:'Vehicle registrations retrieved successfully', data: items.map(toAdminVehicleRegistrationResponse), meta }`.
- **Route user** `@Get('vehicle-registrations')`: **0 DÒNG THAY ĐỔI** (§2.1). Controller đã khai `@Query() query: ListVehicleRegistrationsQueryDto`; T1 thêm field vào **chính class đó** ⇒ tên type không đổi, field mới tự có hiệu lực. Guard/permission/DTO type/mapper (`toVehicleRegistrationResponse`)/envelope giữ nguyên tuyệt đối — KHÔNG chạm dòng nào của handler này.
- **Comment thứ tự khai (OQ-1)** tại chỗ: tiêu chí xung đột đúng = **cùng literal prefix + `:param` ở vị trí khác biệt**, **KHÔNG phải** "cùng số segment". `admin/vehicle-registrations` vs `vehicle-registrations/:id` **không** xung đột (segment đầu literal khác); đặt trước chỉ cho nhất quán. Mirror [zones.controller.ts:108-111](../../../../src/modules/zones/controllers/zones.controller.ts).
- **KHÔNG** `@HttpCode`; route admin **KHÔNG** `@CurrentUser`; **KHÔNG** đụng route `POST`/`PATCH`/`DELETE`/history/unknown.
- ⚠ Quên `@RequirePermissions` = endpoint hở im lặng (`PermissionsGuard` `return true` khi thiếu metadata).
- **AC**: 1 route admin mới đúng guard + `anpr.vehicle.admin_read` + `REGISTER_PIPE` + DTO admin + mapper admin; khai trước `:id` + có comment tiêu chí đúng; route user chỉ đổi kiểu DTO; các route cũ không đổi.

## T5b — Test controller — plan §7.6
Thêm vào [vehicle-registration.controller.spec.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.spec.ts):
- Route admin gọi `service.listAll(query)` 1 lần; envelope `{success, message, data:[...], meta}`; `data` qua `toAdminVehicleRegistrationResponse` (assert có `owner`); `meta` ngang `data`.
- **Metadata**: `Reflect.getMetadata(PERMISSIONS_KEY, controller.<adminHandler>)` = `['anpr.vehicle.admin_read']`; guard chứa `JwtAuthGuard`+`PermissionsGuard`. Route user handler **KHÔNG** có `PERMISSIONS_KEY`.
- Route user vẫn gọi `service.list(currentUser.userId, query)` — không hồi quy.
- **⭐ SEC-01 chiều ngược (§2.2)**: gọi handler route user → `data[0]` **KHÔNG có khoá `owner`** (dùng `toVehicleRegistrationResponse`, không phải mapper admin); `service.list` gọi đúng 1 lần với `currentUser.userId`; `service.listAll` **KHÔNG** được gọi.
- **Không hồi quy**: test `POST`/`PATCH`/`DELETE`/`admin/vehicle-history`/`admin/unknown-vehicles` cũ vẫn xanh, **không** bị sửa. Cập nhật mock `service` thêm `listAll` (dựng mock → được phép).
- **AC**: case route admin + assert metadata permission + **case SEC-01 route user không có `owner`** + không hồi quy bắt buộc; 0 test cũ bị sửa assert.

## T6 — Migration seed permission (code) — plan §6, QĐ-11/12, SEC-02
- File: **`src/database/migrations/20260722000006-SeedAnprVehicleAdminReadPermission.ts`** (timestamp chốt ở T0 mục 8), class `SeedAnprVehicleAdminReadPermission20260722000006` + field `name` trùng tên class.
- **Đặt trong `migrations/`, TUYỆT ĐỐI KHÔNG trong `src/database/seeds/`** (folder `seeds/` không có runner — AGENTS.md §5.5 rule 4).
- Mirror [20260722000005-SeedZoneAssignDevicePermission.ts](../../../../src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts):
  - `permission = { code:'anpr.vehicle.admin_read', name:<ASCII không dấu>, module:'anpr', action:'admin_read', description:<ASCII không dấu> }`;
  - INSERT đúng **6 cột** `(permission_code, permission_name, module_code, action_code, description, is_active)`, `action_code='admin_read'` **tường minh** (KHÔNG derive);
  - ⚠ **`roles` đúng 2 phần tử**: `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (QĐ-11 — khớp 3 permission ANPR hiện có). **CẤM** thêm `MANAGER`/`EMPLOYEE` (khác UC-93 zone-read 4 role); **CẤM** `ADMIN`/`INTERNAL_USER` (mã lỗi thời → im lặng không insert);
  - `up()` idempotent: INSERT `ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id` → `return` nếu vẫn không có → vòng lặp `role_permissions` `ON CONFLICT (role_id, permission_id) DO NOTHING`;
  - `down()`: xoá `role_permissions` **trước**, rồi `permissions`.
- Chỉ tạo file, **KHÔNG chạy** `migration:run`.
- **AC**: đúng tên/vị trí; `permission_code='anpr.vehicle.admin_read'`, `module_code='anpr'`, `action_code='admin_read'`; **đúng 2 role**; `up()` chạy lại không lỗi/không nhân bản; `down()` đúng thứ tự.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- `npm run build` = **0 error**.
- eslint trên **file touched** = **0 rule mới** (**chỉ lint file đã chạm, KHÔNG `npm run lint` trần** — script đó `--fix` toàn repo). File có lỗi nền → chứng minh pre-existing bằng `git show HEAD:<file>`.
- `npx jest src/modules/anpr` **xanh** — **gồm toàn bộ test cũ không hồi quy**, đối chiếu baseline T0 mục 1 (**8 suite / 100 test**). Test cũ fail → **DỪNG, báo cáo, KHÔNG sửa test cho qua**.
- Coverage `VehicleRegistrationService` **≥80%** (cả `list` mở rộng + `listAll`).
- **DI-proof**: `AppModule` compile **preview mode** — 0 `UnknownDependenciesException`, 0 circular. Throwaway xoá sạch.
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS chung · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file + kết quả jest (**tách rõ test cũ vs mới**) + coverage + DI-proof.
- **Bàn giao**: gọi thử `GET /api/v1/anpr/admin/vehicle-registrations` trên local cần chạy seed **`20260722000006`** trước; thiếu → **403 `FORBIDDEN`**, **không phải lỗi code**.
- **Owed (ghi, KHÔNG làm)**: index cho `plate`/`owner`/`vehicle_type`/`status` khi dữ liệu lớn (`pg_trgm`/btree) · **`owner` không normalize ⇒ `%`/`_` thành wildcard LIKE** (không phải lỗ hổng) · `vehicle_type` chưa có chuẩn giá trị · `PaginationMeta` trùng 2 bản trong module · ánh xạ số hiệu UC mới↔cũ · Project Overview FE-18 còn ghi "phê duyệt" xe (đã chốt bỏ duyệt) · global exception filter · Swagger · 5 file `spec/global/` rỗng · ranh giới `anpr`↔`accounts` khi lộ owner.
- **AC**: bảng gate + báo cáo tick: `list()` giữ `findAndCount` + `ILike`, 6 test cũ không đụng ✓ · `plate` normalize trước match ✓ · `listAll` **luôn** `leftJoinAndSelect`, KHÔNG fold userId ✓ · `owner` cả `fullName`+`email`, không normalize ✓ · search+filter kết hợp có test ✓ · `deletedAt IS NULL` cả 2 method ✓ · route admin gate `anpr.vehicle.admin_read`, route user chỉ `JwtAuthGuard` ✓ · mapper admin chỉ full_name+email ✓ · migration **2 role** + `action_code` tường minh ✓ · 0 migration schema ✓ · 0 `PaginationMeta` mới ✓ · `anpr.module.ts` không đổi ✓ · 100 test cũ không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-101
- **T0** → baseline 8 suite/100 test · `ILike` dùng được (điều kiện sống còn) · vị trí 6 test cũ (không đụng) · file test DTO · UserEntity fields + ManyToOne · mapper user · controller imports · timestamp `...0006`
- **T1/T1b** → DTO user +`plate`/`vehicle_type` (không `@IsIn`) + test `@Expose`/whitelist SEC-01
- **T2/T2b** → DTO admin `extends` +`user_id`/`owner` + JSDoc đính chính + test extends/isUuid
- **T3/T3b** → mapper admin `toAdminVehicleRegistrationResponse` (owner: full_name+email) + test field nhạy cảm bị loại
- **T4/T4b** → `list()` GIỮ `findAndCount`+`ILike` (chỉ thêm case) · `listAll()` QueryBuilder luôn join · test search+filter kết hợp + 6 test cũ không hồi quy
- **T5/T5b** → route admin `GET admin/vehicle-registrations`, static trước `:id` (comment tiêu chí đúng), permission gate · test metadata + không hồi quy
- **T6** → migration seed `anpr.vehicle.admin_read` → **2 role** (khác 4 role zone-read), `action_code` tường minh
- **T-GATE** → gate + không hồi quy 100 test + DI-proof + STOP + bàn giao + Owed
