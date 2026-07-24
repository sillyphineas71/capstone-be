# VPL-002 — UC-101 (ANPR): Xem & tra cứu phương tiện (mở rộng)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec VPL-002 (UC-101): mở rộng VPL-001 (uc3-plate-list) — thêm search biển số + filter `vehicle_type` cho route user, và route admin `GET admin/vehicle-registrations` (list xe của mọi người + filter `user_id`/`owner`). RECON đã xác minh trước (§0). 12 quyết định đã chốt (§7). Đây là ĐÚNG phần VPL-001 tự ghi đã hoãn; KHÔNG xây lại phần đã có. | Toàn bộ |
| 2026-07-23 | Thiếu Chủ chốt OQ-1→OQ-5 (§8 → ĐÃ CHỐT). **(i)** Phân tích route của agent được chấp nhận **và** đính chính luật: tiêu chí xung đột KHÔNG phải "cùng số segment" mà là "cùng literal prefix + có `:param` ở vị trí khác biệt" (§8 OQ-1). **(ii)** OQ-4 chốt DTO admin **`extends`** DTO user — **khác đề xuất ban đầu của agent** (agent đề xuất độc lập, nhưng lý do bị hiểu ngược chiều thừa kế: `extends` = admin kế thừa user, DTO user không đổi). OQ-3 chốt route admin **luôn** `leftJoinAndSelect` + mapper riêng cho admin. Cập nhật §2/§3/§4 cho khớp. | §2, §3, §4, §8 |

> **SPEC-ONLY.** Chưa plan/tasks/code. **Mở rộng** [VPL-001 / uc3-plate-list](../uc3-plate-list/spec.md) — chỉ đặc tả **phần chênh lệch**. RECON đã được đối chiếu độc lập trên code thật (§0). 12 quyết định đã chốt ở §7 — **KHÔNG mở lại**. Kế thừa toàn bộ convention ANPR (normalize biển qua `normalizePlate`, ownership fold cứng `userId`, soft-delete `deletedAt IS NULL`, envelope `{success, message, data, meta}`, `ValidationPipe({whitelist,transform})`). KHÔNG migration schema.

---

## 0. RECON findings (đã đọc CODE THẬT — đã xác minh, không kiểm lại)

### 0.1. Chuẩn hoá biển số ⭐ ([normalize-plate.ts:13-18](../../../../src/modules/anpr/utils/normalize-plate.ts))
- `normalizePlate(raw) = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')` — **strip mọi ký tự không phải `[A-Z0-9]`**. Pure function, single source of truth.
- Lưu: `plateNumber = normalizePlate(dto.plateRaw)` (cột `plate_number` DB đã chuẩn hoá), `plateRaw` = gốc người dùng nhập ([vehicle-registration.service.ts:53,72-79](../../../../src/modules/anpr/services/vehicle-registration.service.ts)).
- ⇒ Search **KHÔNG** normalize input thì `29a-123.45` (còn `-`, `.`, chữ thường) **không bao giờ** là substring của `29A12345` ⇒ không khớp.
- **Tiền lệ normalize-trước-khi-so** ([vehicle-history.service.ts:93-96](../../../../src/modules/anpr/services/vehicle-history.service.ts)): `params.push(normalizePlate(query.plateNumber))` rồi so `= $n`. UC-101 dùng cùng cách nhưng đổi `=` → `ILIKE '%...%'` (QĐ-2b).

### 0.2. Quan hệ ORM tới user ⭐ ([vehicle-registration.entity.ts:55-57](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts))
- Entity **CÓ** `@ManyToOne(() => UserEntity, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: UserEntity;`.
- ⇒ Lọc theo chủ xe **join được qua relation `user`** trong QueryBuilder (`leftJoin('vr.user', 'u')`), **KHÔNG** cần gọi service module `accounts` ⇒ hợp ARCH-01 (đọc qua relation đã khai, không phát sinh phụ thuộc module mới; `UserEntity` vốn đã được import ở tầng entity).
- **`UserEntity` field cho `owner` search** ([user.entity.ts:44-56](../../../../src/modules/accounts/entities/user.entity.ts)): `email: varchar(255)` ([:44-45](../../../../src/modules/accounts/entities/user.entity.ts)), `fullName` map cột `full_name` varchar(255) ([:55-56](../../../../src/modules/accounts/entities/user.entity.ts)).

### 0.3. `list()` hiện tại ([vehicle-registration.service.ts:121-148](../../../../src/modules/anpr/services/vehicle-registration.service.ts))
- Dùng **`findAndCount`**; `where = { userId, deletedAt: IsNull() }`, chỉ thêm `status` khi có giá trị ([:133-135](../../../../src/modules/anpr/services/vehicle-registration.service.ts)); `order: { createdAt: 'DESC' }`.
- UC-101 đổi sang QueryBuilder (QĐ-4) vì cần `leftJoin` + `ILIKE` — **giữ nguyên hành vi nghiệp vụ** route user.

### 0.4. Route hiện có ([vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts))
- `@Controller('anpr')`; 9 route đăng ký. Thứ tự khai hiện tại: `admin/vehicle-history` → `admin/unknown-vehicles` → `vehicle-registrations` → `vehicle-registrations/:id` → `POST ...` → PATCH/DELETE.
- **Chưa có** `@Get('admin/vehicle-registrations')` (chỉ `@Post('admin/vehicle-registrations')` ở [:165](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
- Route user list/detail chỉ `@UseGuards(JwtAuthGuard)`, `userId` từ `@CurrentUser` ([:107-130](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
- Hằng pipe: `REGISTER_PIPE = new ValidationPipe({ whitelist: true, transform: true })`.

### 0.5. `ListVehicleRegistrationsQueryDto` ([list-vehicle-registrations-query.dto.ts:15-31](../../../../src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts))
- Đúng 3 field: `page`/`limit` (`@Type(() => Number)`, `@Min(1)`, `limit @Max(100)`), `status` `@IsIn(VEHICLE_STATUSES)`. Comment [:13](../../../../src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts): *"KHÔNG nhận `user_id` — server lọc theo current user (SEC-01)"*.

### 0.6. `vehicle_type` ([entity:36-37](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts), [create-vehicle-registration.dto.ts:17-21](../../../../src/modules/anpr/dto/create-vehicle-registration.dto.ts))
- `varchar(50)` nullable, **KHÔNG enum/CHECK**; validate chỉ `@IsOptional @IsString @MaxLength(50)`. **KHÔNG TÌM THẤY** constant/enum giá trị hợp lệ (grep toàn repo).
- Giá trị demo thật ([20260720000011-SeedDemoNotificationsJobsAuditVehicles.ts:19-45](../../../../src/database/migrations/20260720000011-SeedDemoNotificationsJobsAuditVehicles.ts)): chỉ `'car'`, `'motorbike'`.

### 0.7. Index ([20260624000000-CreateVehicleRegistrationsTable.ts:32-40](../../../../src/database/migrations/20260624000000-CreateVehicleRegistrationsTable.ts))
- `UQ_vehicle_plate_number_active (plate_number) WHERE deleted_at IS NULL` (unique partial) · `IDX_vehicle_registrations_user_id (user_id)`. **Không index nào khác**, không migration nào thêm sau (grep xác nhận).
- ⇒ **Filter dùng index**: `plate_number = $n` (exact), `user_id = $n`. **Full scan**: `plate_number ILIKE '%kw%'`, `vehicle_type`, `owner ILIKE`, `status`.

### 0.8. Permission ANPR ([20260720000005-BackfillRolePermissions.ts:178-195](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts))
- Đúng 3: `anpr.vehicle.admin_register`, `anpr.vehicle.history_view`, `anpr.vehicle.unknown_view` — đều `BUSINESS_ADMIN` + `SYSTEM_ADMIN`.
- ⚠ Seed bằng **migration backfill** cấu trúc mảng `{ code, module, name, roles }` — **KHÔNG** thấy `action_code` trong cấu trúc mảng. **Khác** cụm zone (mỗi UC 1 file seed, cột `(permission_code, permission_name, module_code, action_code)`). Cần đọc cấu trúc bảng `permissions` thật + hàm insert ở bước plan (QĐ-11) — KHÔNG đoán.

### 0.9. Tiền lệ route admin ([vehicle-history.service.ts:50-73](../../../../src/modules/anpr/services/vehicle-history.service.ts), [controller:75-87](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts))
- Khuôn **2 method**: `listForUser(userId, query)` fold cứng `userId`; `listAll(query)` không fold. Phân biệt admin bằng **permission** + method riêng, không kiểm gì thêm.
- ⚠ Nhưng `listAll` đọc **`iot_device_events`** (raw SQL, [:112-134](../../../../src/modules/anpr/services/vehicle-history.service.ts)) — **nguồn dữ liệu khác hẳn** `vehicle_registrations`. UC-101 admin đọc **`vehicle_registrations`** (bảng đăng ký), không tái dùng được truy vấn của `listAll`; chỉ tái dùng **khuôn** (2 method + permission gate).
- ⚠ `listAll` **không** hỗ trợ lọc `user_id` — admin hiện không tra được xe của một người cụ thể. UC-101 bổ sung việc này.

### 0.10. `PaginationMeta` trùng lặp
- Khai **2 bản** cùng shape `{page, limit, total, totalPages}`: [vehicle-registration.service.ts:17-22](../../../../src/modules/anpr/services/vehicle-registration.service.ts) (**có `export`**) và [vehicle-history.service.ts:19-24](../../../../src/modules/anpr/services/vehicle-history.service.ts). UC-101 **dùng lại bản đã export ở `vehicle-registration.service.ts`** (QĐ-9), cấm khai bản thứ ba.

### 0.11. Mốc
- Baseline test module `anpr`: **8 suite / 100 test** (`npx jest src/modules/anpr`).
- Migration cuối: `20260722000005-SeedZoneAssignDevicePermission.ts` ⇒ UC-101 seed permission dùng **`20260722000006`** (xác nhận lại ở plan/T0).

---

## 1. Scope (UC-101)

### ĐÃ CÓ từ VPL-001 (KHÔNG làm lại)
- `GET /api/v1/anpr/vehicle-registrations` — list xe **của chính user**, phân trang + filter `status`, sort `createdAt DESC` ([controller:107-124](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts), [service list():121-148](../../../../src/modules/anpr/services/vehicle-registration.service.ts)).
- `GET .../:id` — detail xe của chính user (fold ownership, 404 `VEHICLE_NOT_FOUND`).
- `ListVehicleRegistrationsQueryDto` với 3 field `page`/`limit`/`status`.
- `toVehicleRegistrationResponse` mapper, `PaginationMeta` đã export.
- Toàn bộ đăng ký/sửa/xoá (uc1/uc2), webhook/resolve/unknown/history (uc4-7).

### TRONG scope (phần mở rộng)
1. **Route user — thêm 2 filter**: `plate` (search biển, normalize + `ILIKE`) và `vehicle_type` (exact). Giữ nguyên fold cứng `userId`, sort `createdAt DESC`.
2. **Route admin mới**: `GET /api/v1/anpr/admin/vehicle-registrations` — list xe của **mọi người**, phân trang; filter `status`, `vehicle_type`, `plate` (search), `user_id` (exact UUID), `owner` (search tên/email chủ xe qua `leftJoin`).
3. **Đổi `list()` sang QueryBuilder** (QĐ-4) — hành vi nghiệp vụ route user không đổi; test cũ VPL-001 phải vẫn xanh.
4. **1 migration seed permission** `anpr.vehicle.admin_read` → `BUSINESS_ADMIN` + `SYSTEM_ADMIN`.
5. Unit test cho method mới + DTO (mock repo, không DB).

### NGOÀI scope
- **KHÔNG** migration schema: không thêm cột, **không thêm index dù có sequential scan** (QĐ-2b/QĐ-12).
- **KHÔNG** enum/constant cho `vehicle_type` (QĐ-5) — cột đang chuỗi tự do, thêm ràng buộc phá dữ liệu cũ.
- **KHÔNG** thêm khái niệm duyệt/`pending` — đăng ký xe không cần duyệt (đã chốt VPL-001).
- **KHÔNG** `include_deleted`, **KHÔNG** cho client chọn `sort` (QĐ-7/QĐ-8).
- **KHÔNG** thêm `user_id`/`owner` vào route **user** (SEC-01 — người dùng chỉ xem xe của mình).
- **KHÔNG** đụng uc1 (đăng ký), uc2 (sửa/huỷ), uc4 (webhook), uc5 (resolve), uc6 (xe lạ), uc7 (lịch sử).
- **KHÔNG** khai `PaginationMeta` lần thứ ba.
- **KHÔNG** đổi wiring `AnprModule` (nếu không phát sinh dependency mới).

## 2. DTO

### 2.1. `ListVehicleRegistrationsQueryDto` — MỞ RỘNG (route user)
Thêm **2 field optional** vào DTO hiện có (giữ 3 field cũ):

| Field API | Property | Ràng buộc đề xuất | Index? |
| :--- | :--- | :--- | :--- |
| `plate` | `plate` | `@IsOptional @IsString @MaxLength(20)` | ❌ full scan (leading wildcard) |
| `vehicle_type` | `vehicleType` | `@Expose({name:'vehicle_type'}) @IsOptional @IsString @MaxLength(50)` — **KHÔNG** `@IsIn` (QĐ-5) | ❌ không index |

- Giữ nguyên `page`/`limit`/`status`. **KHÔNG** thêm `user_id`/`owner`/`sort_by` (route user).

### 2.2. `AdminListVehicleRegistrationsQueryDto extends ListVehicleRegistrationsQueryDto` (net-new — route admin) — **ĐÃ CHỐT OQ-4: `extends`**
**Kế thừa lớp cha** (`page`/`limit`/`status`/`plate`/`vehicle_type` — sau khi §2.1 mở rộng) **cộng 2 field admin**:

| Field API | Property | Ràng buộc | Index? |
| :--- | :--- | :--- | :--- |
| *(kế thừa)* `page`/`limit`/`status`/`plate`/`vehicle_type` | | y hệt lớp cha `ListVehicleRegistrationsQueryDto` | — |
| `user_id` | `userId` | `@Expose({name:'user_id'}) @IsOptional @IsUUID('4')` | ✅ `IDX_vehicle_registrations_user_id` |
| `owner` | `owner` | `@IsOptional @IsString @MaxLength(255)` | ❌ full scan (join + ILIKE) |

- **CHỐT OQ-4: `extends`, KHÔNG khai độc lập.** `extends` = admin **kế thừa** user ⇒ DTO user **không đổi**, route user **không thể** nhận `user_id`/`owner` (SEC-01 vẫn nguyên). Chặn drift: sau này thêm filter cho user thì admin tự có (bộ filter admin là **tập cha** của user). Phương án độc lập ngược lại dễ để admin thiếu filter so với user.
- ⚠ **JSDoc lớp con BẮT BUỘC** đính chính: comment lớp cha *"KHÔNG nhận `user_id` — server lọc theo current user (SEC-01)"* **chỉ đúng cho lớp cha / route user**. Lớp con CÓ `user_id`/`owner`, chỉ dùng cho route admin **đã qua `@RequirePermissions`**; route user vẫn fold cứng `userId` từ JWT.
- **KHÔNG** cho `sort`/`include_deleted`.

## 3. Service

Thêm/sửa trong `VehicleRegistrationService`. **Dùng lại** `PaginationMeta` đã export (QĐ-9), `normalizePlate` (QĐ-2).

### 3.1. `list()` — đổi sang QueryBuilder (QĐ-4), giữ hành vi
- `qb = repo.createQueryBuilder('vr').where('vr.userId = :userId', { userId }).andWhere('vr.deletedAt IS NULL')`.
- Filter (chỉ thêm khi có giá trị — cấm `undefined` lọt vào where):
  - `status` → `andWhere('vr.status = :status')`;
  - `vehicleType` → `andWhere('vr.vehicleType = :vt')`;
  - `plate` → `andWhere('vr.plateNumber ILIKE :p', { p: '%' + normalizePlate(query.plate) + '%' })` (QĐ-2, bound param).
- `orderBy('vr.createdAt', 'DESC')` (hard-code, QĐ-7) → `skip/take` → `getManyAndCount()`.
- Trả `{ items, meta }` — **shape output không đổi** so với VPL-001 (test cũ phải xanh).

### 3.2. `listAll(query)` — net-new (route admin) — **ĐÃ CHỐT OQ-3: LUÔN join**
- `qb = repo.createQueryBuilder('vr').leftJoinAndSelect('vr.user', 'u')` — **LUÔN** join, KHÔNG có nhánh "có owner mới join" (CHỐT OQ-3: response đằng nào cũng cần owner ⇒ join luôn cho ít đường rẽ; filter `owner` chỉ là `andWhere` lên alias `u` đã có). `andWhere('vr.deletedAt IS NULL')` **tường minh** (QĐ-8).
  - ✅ **An toàn phân trang**: `vr.user` là **`ManyToOne`** (nhiều xe → một user) nên join **KHÔNG nhân dòng** ⇒ `getManyAndCount()` + `skip`/`take` vẫn đúng. (Nếu tương lai thêm quan hệ `OneToMany` — vd ảnh xe — join sẽ nhân dòng và phá phân trang: xem §9 / plan §9.)
- Filter: `status`, `vehicleType`, `plate` (như §3.1) **cộng**:
  - `userId` → `andWhere('vr.userId = :uid')` (exact, dùng index);
  - `owner` → `andWhere('(u.fullName ILIKE :o OR u.email ILIKE :o)', { o: '%' + owner + '%' })` — **cả `fullName` LẪN `email`** (CHỐT OQ-2), **KHÔNG** normalize `owner` (đây là tên người, không phải biển).
- **KHÔNG** fold `userId` theo current user (đây là admin xem tất cả).
- `orderBy('vr.createdAt', 'DESC')`, `skip/take`, `getManyAndCount()`.
- ⚠ **Search kết hợp filter** (bài học UC-93): QueryBuilder phải gắn **cả** filter **lẫn** `ILIKE` — test phải chứng minh, không chỉ một trong hai.
### 3.3. Response admin — **ĐÃ CHỐT OQ-3: CÓ owner, mapper riêng**
- Route admin trả kèm owner **chỉ** `full_name` + `email` (**CẤM** `phone`/`department`/trạng thái tài khoản/field nhạy cảm khác — SEC-01).
- Dùng **mapper riêng** `toAdminVehicleRegistrationResponse` (net-new) — **KHÔNG** sửa `toVehicleRegistrationResponse` hiện có (route user tuyệt đối không trả owner). Chi tiết mapper: xem plan §4.

## 4. Controller — route

Thêm vào `VehicleRegistrationController`.

```text
GET /api/v1/anpr/admin/vehicle-registrations   → listAll (admin)
GET /api/v1/anpr/vehicle-registrations         → list (user, MỞ RỘNG filter — route đã có)
```
- **Route admin mới**: `@Get('admin/vehicle-registrations')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('anpr.vehicle.admin_read')` (QĐ-10) · `@UsePipes(REGISTER_PIPE)` · `@Query() query: AdminListVehicleRegistrationsQueryDto` → `{ success, message, data: items.map(toAdminVehicleRegistrationResponse), meta }` (mapper riêng — CHỐT OQ-3).
- **Route user**: giữ nguyên guard (`JwtAuthGuard`, không permission — QĐ-10), chỉ nhận DTO mở rộng; response giữ `toVehicleRegistrationResponse` cũ (KHÔNG owner).
- **Thứ tự khai (ĐÃ CHỐT OQ-1)**: khai `@Get('admin/vehicle-registrations')` **trong nhóm route admin** (cạnh `admin/vehicle-history`, `admin/unknown-vehicles`), **trước** `@Get('vehicle-registrations/:id')` — cho nhất quán, **dù kỹ thuật KHÔNG bắt buộc** (segment đầu literal khác nhau, không xung đột). Tiêu chí xung đột đúng: xem OQ-1.

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| List thành công (user/admin) | `200` | — |
| Query sai (`limit>100`, `page<1`, `status` ngoài enum, `user_id` không UUID) | `400` | (Nest validation) |
| Chưa đăng nhập | `401` | — |
| Route admin — thiếu permission | `403` | `FORBIDDEN` (guard) |

## 5. Requirements (EARS)

- **R1**: **WHEN** người dùng đã xác thực gọi `GET /anpr/vehicle-registrations` với `plate`/`vehicle_type`/`status` **→** hệ thống trả **chỉ xe của current user** (`vr.userId = current`, `deleted_at IS NULL`), khớp tất cả filter được gửi, sort `createdAt DESC`, kèm `meta`.
- **R2 (crux search)**: **WHERE** client gửi `plate`, hệ thống PHẢI `normalizePlate(plate)` **trước** khi `ILIKE '%...%'` trên `plate_number` (bound param) — gõ `29a-123` khớp `29A12345`; **CẤM** nội suy chuỗi vào SQL (SEC-03).
- **R3**: **WHILE** dựng truy vấn, filter **không được gửi** KHÔNG được đưa vào `WHERE` (kể cả `undefined`).
- **R4**: **WHEN** admin có permission gọi `GET /anpr/admin/vehicle-registrations` **→** hệ thống trả xe của **mọi người** (không fold `userId`), áp filter `status`/`vehicle_type`/`plate`/`user_id`/`owner` được gửi.
- **R5 (crux owner)**: **WHERE** admin gửi `owner`, hệ thống `leftJoin` relation `user` và `ILIKE` trên `full_name` **OR** `email` (bound param, **không** normalize); **CẤM** query thẳng bảng `users` bằng raw SQL rời (dùng relation đã khai — ARCH-01).
- **R6 (SEC-01)**: route user **KHÔNG** nhận `user_id`/`owner`; kể cả client lén truyền, `whitelist` loại bỏ và query vẫn fold cứng `userId` từ JWT.
- **R7 (SEC-02)**: route admin PHẢI qua `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('anpr.vehicle.admin_read')`; thiếu permission → `403`, KHÔNG trả dữ liệu.
- **R8**: **WHILE** mọi truy vấn của UC-101, `deleted_at IS NULL` PHẢI có mặt tường minh — xe đã xoá mềm KHÔNG xuất hiện, kể cả admin (QĐ-8).
- **R9**: **WHERE** danh sách rỗng **→** `200` + `data: []`, `meta.total = 0` (KHÔNG 404).
- **R10**: **IF** `limit > 100` / `page < 1` / `status` ngoài `VEHICLE_STATUSES` / `user_id` không phải UUID **→** `400`, KHÔNG truy vấn DB.
- **R11**: **WHILE** đổi `list()` sang QueryBuilder, **output shape và hành vi nghiệp vụ KHÔNG đổi** so với VPL-001 (fold `userId`, sort `createdAt DESC`, `meta` đủ 4 field) — mọi test cũ phải xanh.

## 6. Constitution

| Rule | Áp dụng UC-101 |
| :--- | :--- |
| **SEC-01** | Route user fold cứng `userId`, không nhận `user_id`/`owner`; `whitelist` loại field thừa. |
| **SEC-02** | Route admin gate `@RequirePermissions('anpr.vehicle.admin_read')`; route user giữ `JwtAuthGuard`. |
| **SEC-03** | `plate`/`owner`/`user_id` qua **bound param**; `plate` normalize bằng `normalizePlate`; **CẤM** nối chuỗi SQL. |
| **DATA-01** | Read-only; mọi lookup `deleted_at IS NULL` tường minh. |
| **ARCH-01** | Lọc `owner` qua **relation `user`** (`leftJoin`), không gọi service `accounts`, không raw JOIN rời — dùng relation đã khai ở entity. |
| **ARCH-02** | `limit ≤ 100` chặn quét toàn bảng; chấp nhận seq scan cho `plate`/`vehicle_type`/`owner`/`status` (bảng nhỏ — §9). |
| **ARCH-03** | Read-only → idempotent tự nhiên. |
| **ENG-01** | Test ≥80%: filter đơn/kết hợp, search normalize, admin không fold, user fold, owner join, soft-delete không lọt, VPL-001 không hồi quy. |
| **ENG-03** | Lỗi `{code, message}`; không lộ SQL/stack. |
| **ENG-04** | Không thêm dependency. |

## 7. QUYẾT ĐỊNH ĐÃ CHỐT

> 12 quyết định dưới đây do Thiếu Chủ chốt trước khi viết spec. **Plan/tasks/code KHÔNG mở lại.**

1. **Route admin**: thêm `GET /api/v1/anpr/admin/vehicle-registrations`, khuôn 2 method (`list` user fold cứng — giữ nguyên; `listAll` admin không fold). KHÔNG thêm tham số "xem của người khác" vào route user.
2. **Search biển**: normalize input rồi `ILIKE '%...%'` trên `plate_number`; bắt buộc `normalizePlate()`, bound param.
3. **Đánh đổi index (2b)**: partial match ⇒ leading wildcard ⇒ **sequential scan, không dùng `UQ_vehicle_plate_number_active`**. Chấp nhận (bảng nhỏ), ghi §9.
4. **Lọc chủ xe (chỉ admin)**: `user_id` (exact, dùng index) **và** `owner` (`ILIKE` tên/email qua `leftJoin` relation `user`).
5. **`list()` → QueryBuilder**: cần `leftJoin` + `ILIKE`; route user giữ hành vi nghiệp vụ; test cũ phải xanh.
6. **`vehicle_type`**: filter exact `=`; KHÔNG thêm enum/constant.
7. **Filter route user**: thêm `plate` + `vehicle_type`; KHÔNG `user_id`/`owner`.
8. **Sắp xếp**: `createdAt DESC` hard-code; client không chọn `sort`.
9. **Xe xoá mềm**: KHÔNG hiển thị (kể cả admin), KHÔNG `include_deleted`; cả 2 nhánh có `deletedAt IS NULL` tường minh.
10. **`PaginationMeta`**: dùng lại bản export `vehicle-registration.service.ts:17-22`; cấm khai bản thứ ba.
11. **Permission**: thêm `anpr.vehicle.admin_read` → `BUSINESS_ADMIN` + `SYSTEM_ADMIN`; KHÔNG tái dùng `admin_register`. Route user giữ nguyên (chỉ `JwtAuthGuard`).
12. **Cách seed permission ⚠**: ANPR seed gộp trong migration backfill (`{code, module, name, roles}`), khác cụm zone. **Bước plan PHẢI đọc cấu trúc bảng `permissions` thật (migration tạo bảng) + hàm insert của backfill** rồi mới chốt file seed mới viết theo dạng nào — KHÔNG đoán.

## 8. OPEN QUESTIONS — ĐÃ CHỐT

- **OQ-1 — Thứ tự khai route `admin/vehicle-registrations` vs `vehicle-registrations/:id`.** *Phân tích*: `admin/vehicle-registrations` = 2 segment (`admin` + `vehicle-registrations`); `vehicle-registrations/:id` = 2 segment (`vehicle-registrations` + `:id`). **Segment ĐẦU là literal khác nhau** (`admin` ≠ `vehicle-registrations`) ⇒ **KHÔNG xung đột thật**: request `/admin/vehicle-registrations` không khớp pattern `vehicle-registrations/:id` vì segment đầu phải đúng literal `vehicle-registrations`. Xung đột "route động nuốt static" chỉ xảy ra khi hai pattern **cùng prefix** và một cái có `:param` ở vị trí segment sau (vd `vehicle-registrations/summary` vs `vehicle-registrations/:id` — cùng prefix `vehicle-registrations`, đó mới nuốt).
  → **CHỐT: không có xung đột thật — phân tích của agent đúng.** Đính chính luật: tiêu chí xung đột **KHÔNG phải "cùng số segment"** mà là **"cùng literal prefix + có `:param` ở vị trí khác biệt"**. Vẫn khai `@Get('admin/vehicle-registrations')` **trong nhóm admin, trước** `@Get('vehicle-registrations/:id')` cho nhất quán tiền lệ ([controller:52,104](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)), dù kỹ thuật không bắt buộc; kèm comment tại chỗ nêu rõ tiêu chí đúng.

- **OQ-2 — `owner` search áp lên field nào của `UserEntity`?** Đã đọc entity thật: có đủ cả hai ([user.entity.ts:44-45,55-56](../../../../src/modules/accounts/entities/user.entity.ts)).
  → **CHỐT: CẢ HAI** — `u.fullName` **OR** `u.email`, cùng một bound param (`ILIKE :o`). **KHÔNG** normalize `owner` (tên người, không phải biển số).

- **OQ-3 — Response route admin có trả kèm tên/email chủ xe không?** *Đánh đổi*: trả tên/email nghĩa là **lộ dữ liệu module `accounts` qua endpoint `anpr`** — nhưng chỉ cho admin đã có permission `admin_read`, và dữ liệu này admin vốn xem được qua module accounts.
  → **CHỐT: CÓ, và LUÔN join (không join có điều kiện).** Route admin **luôn** `leftJoinAndSelect('vr.user','u')` kể cả khi không gửi filter `owner` — bỏ hẳn nhánh rẽ, code gọn. An toàn phân trang vì `vr.user` là `ManyToOne` (không nhân dòng). **Chỉ trả `full_name` + `email`**, CẤM `phone`/`department`/trạng thái tài khoản. Dùng **mapper riêng** `toAdminVehicleRegistrationResponse`, **KHÔNG** sửa `toVehicleRegistrationResponse` (route user tuyệt đối không trả owner).

- **OQ-4 — DTO admin `extends` DTO user hay khai độc lập?**
  → **CHỐT: `AdminListVehicleRegistrationsQueryDto extends ListVehicleRegistrationsQueryDto`** (thêm `user_id`, `owner`). **Khác đề xuất ban đầu của agent** (agent đề xuất độc lập). Lý do agent nêu (*"tránh route user vô tình thừa kế field admin"*) **bị ngược chiều thừa kế**: `extends` = admin kế thừa user ⇒ DTO user không đổi, route user không thể nhận `user_id`/`owner`. Rủi ro thật nằm ở phương án độc lập (drift: thêm filter user mà quên admin). Kèm JSDoc lớp con đính chính comment SEC-01 của lớp cha (xem §2.2).

- **OQ-5 — Mâu thuẫn prompt vs file luật**: **XÁC NHẬN không có mâu thuẫn mới**. Các lệch đã biết (4 role thật, error envelope thiếu `timestamp`/`path`, chưa Swagger, 5 file `spec/global/` rỗng) giữ nguyên như các UC trước, không mở lại.

## 9. Residuals / known-gaps

- **Sequential scan cho search/filter**: `plate ILIKE '%kw%'` (leading wildcard), `vehicle_type`, `status`, `owner ILIKE` đều không dùng được index (§0.7). Chấp nhận vì bảng đăng ký xe của một khuôn viên là bảng nhỏ (vài trăm–vài nghìn bản ghi). Khi dữ liệu lớn cần index bổ sung (`pg_trgm` cho `plate`/`owner`, btree cho `vehicle_type`/`status`) — **task migration riêng**, ngoài UC-101 (QĐ-12 cấm migration schema ở UC này).
- **`vehicle_type` chưa có chuẩn giá trị**: filter exact nhưng cột là chuỗi tự do; dữ liệu thực tế mới có `'car'`/`'motorbike'`. Nếu người nhập gõ `'Car'`/`'ô tô'` thì filter `= 'car'` không khớp. Chuẩn hoá `vehicle_type` (enum + migration dữ liệu cũ) là việc lớn, để riêng.
- **`owner` join làm truy vấn admin nặng hơn**: mỗi filter `owner` kéo theo `leftJoin users` + `ILIKE` 2 cột không index. Chấp nhận ở quy mô hiện tại.
- **Lộ dữ liệu `accounts` qua `anpr`** (OQ-3 đã chốt trả tên/email): ranh giới module mờ đi; giới hạn bằng permission `admin_read` và chỉ trả field không nhạy cảm (tên/email, **không** phone/department/status tài khoản).
- **Join `user` luôn bật ở route admin an toàn CHỈ vì `vr.user` là `ManyToOne`**: nếu sau này thêm quan hệ `OneToMany` (vd ảnh xe) vào cùng QueryBuilder thì join sẽ nhân dòng và **phá `getManyAndCount` + phân trang**. Người sau phải tách count query nếu thêm collection-join.
- **`PaginationMeta` vẫn trùng 2 bản** trong module (§0.10) — UC-101 không sửa (ngoài scope), chỉ dùng lại bản export. Dọn trùng là refactor riêng.
- **Chưa có global exception filter / Swagger / 5 file `spec/global/` rỗng**: nợ toàn hệ thống, giữ nguyên.
- **Route admin đọc `vehicle_registrations`, khác `admin/vehicle-history` đọc `iot_device_events`** — hai "admin view" của ANPR nhìn hai nguồn dữ liệu khác nhau; FE cần hiểu rõ để không nhầm "xe đã đăng ký" với "lượt ra/vào".

---

> **STOP.** Spec-only. OQ-1→OQ-5 **ĐÃ CHỐT** (§8); 12 quyết định §7 KHÔNG mở lại. Đã sang bước **plan** ([plan.md](./plan.md)). Chưa viết code/`tasks.md`, chưa chạy migration/seed/test/build, chưa commit.
