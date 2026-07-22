# VCL-001 — UC8 (ANPR/SAVP): CRUD danh sách kiểm soát phương tiện (blocklist/watchlist)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo spec VCL-001 (UC8): CRUD `vehicle_control_list` (thêm/sửa/gỡ/tra biển blocklist-watchlist). RECON code thật (entity đã có, `normalize-plate.ts`, pattern UC1-UC7). 4 câu hỏi nghiệp vụ đã hỏi + chốt trực tiếp với Thiếu Chủ trước khi viết spec (role mapping, list_type bất biến, xử lý trùng inactive, phạm vi "tra biển") — khác quy trình UC2 (OQ mở chờ duyệt sau), ở đây OQ chốt ngay nên spec+plan+tasks viết cùng lượt. | Toàn bộ |

> **SPEC + PLAN + TASKS viết cùng lượt** (khác nhịp UC1-UC7: OQ đã được Thiếu Chủ chốt qua trao đổi trực tiếp trước khi đặt bút, không cần vòng duyệt OQ riêng). Vẫn giữ nguyên kỷ luật STOP cuối file — **chưa code**, chờ Thiếu Chủ duyệt cả 3 file.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Entity đã tồn tại, schema-only ([vehicle-control-list.entity.ts](../../../../src/modules/anpr/entities/vehicle-control-list.entity.ts))
`VehicleControlListEntity`: `plateNumber` (normalized, varchar 16), `plateRaw` (nullable, varchar 20), `listType` (default `'blocklist'`), `reason` (nullable), `active` (boolean, default true, **tách khỏi** `deletedAt`), `createdBy` (uuid nullable, FK `users.id` SET NULL), `createdAt`/`updatedAt`/`deletedAt` (soft-delete chuẩn). Comment trong entity xác nhận rõ: "Schema-only: KHÔNG logic nghiệp vụ (CRUD... = UC sau)" → UC8 chính là UC đó.

### 0.2. Unique constraint thật (đã tạo ở migration `20260721000006-CreateVehicleControlListTable.ts`)
- `UQ_vehicle_control_plate_type_active` = `(plate_number, list_type) WHERE deleted_at IS NULL` — **một plate CÓ THỂ nằm đồng thời ở cả blocklist và watchlist** (2 dòng, khác `list_type`), chỉ chặn trùng cùng `(plate, list_type)` khi còn sống.
- `IDX_vehicle_control_lookup` = `(plate_number) WHERE deleted_at IS NULL AND active = true` — index cho hot-path tra biển khi xe qua cổng (**gate-check dùng ở UC sau, KHÔNG phải UC8**).
- `active` KHÔNG nằm trong điều kiện của `UQ_vehicle_control_plate_type_active` → thêm bản ghi trùng `(plate, list_type)` mà bản ghi cũ `active=false` **vẫn bị chặn unique** (409), không tự động bỏ qua.

### 0.3. `normalize-plate.ts` ([normalize-plate.ts](../../../../src/modules/anpr/utils/normalize-plate.ts))
`normalizePlate(raw)`: trim → uppercase → strip ngoài `[A-Z0-9]`. Pure function, dùng chung UC1/UC4. UC8 bắt buộc gọi đúng hàm này trước khi lưu/tra `plate_number`, lưu song song `plate_raw` — đúng yêu cầu CLAUDE.md §5.5 quy tắc 5.

### 0.4. Pattern CRUD gần nhất — UC1+UC2 ([vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts), [vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts))
- Pre-check trùng (`repo.findOne` trước khi insert) **+ safety-net** bắt `23505` (`isUniqueViolation`) → `ConflictException({code, message})` — race condition giữa pre-check và insert vẫn trả 409 sạch, không để lỗi DB phọt ra client. UC8 tái dùng đúng 2 lớp phòng thủ này.
- Envelope response inline `{success, message, data}` (mirror toàn bộ module).
- Response DTO có mapper thuần (`toVehicleRegistrationResponse`) — UC8 làm tương tự `toVehicleControlListResponse`.

### 0.5. Pattern route admin-gated đã có — UC6+UC7 ([vehicle-registration.controller.ts:74-102](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts))
`@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.xxx')` — route `admin/...` không có khái niệm ownership (khác UC2 user tự quản biển của mình). UC8 mirror đúng shape này cho **cả 5 route** vì `vehicle_control_list` không gắn `user_id`, không phải dữ liệu do user sở hữu — đây là dữ liệu an ninh do admin quản trị.

### 0.6. Guard/decorator xác nhận tồn tại
`JwtAuthGuard` ([../../auth/guards/jwt-auth.guard.ts](../../../../src/modules/auth/guards/jwt-auth.guard.ts)), `PermissionsGuard` ([../../auth/guards/permissions.guard.ts](../../../../src/modules/auth/guards/permissions.guard.ts)), `@RequirePermissions()` ([../../auth/decorators/require-permissions.decorator.ts](../../../../src/modules/auth/decorators/require-permissions.decorator.ts)), `@CurrentUser()` trả `{userId}`.

### 0.7. Permission seed pattern thật ([20260720000005-BackfillRolePermissions.ts](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts))
Migration insert `permissions` (idempotent `WHERE NOT EXISTS`) rồi insert `role_permissions` theo `role_code` (idempotent tương tự). 4 role lõi đã seed: `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` (migration `20260720000002-SeedCoreRoles.ts`). CLAUDE.md §5.5 quy tắc 4: seed permission migration phải **cùng commit** với controller, KHÔNG dùng `seeds/` (không có runner).

---

## 1. Câu hỏi nghiệp vụ đã chốt (trước khi viết spec này)

Đã trao đổi trực tiếp và Thiếu Chủ chốt 4 điểm mơ hồ sau (không tự suy đoán từ code):

1. **Role mapping**: `create`/`update`/`delete` → `SYSTEM_ADMIN` + `BUSINESS_ADMIN`; `read` → thêm `MANAGER` (mirror pattern `anpr.vehicle.*` hiện có + `iot.device.read`).
2. **`list_type` bất biến**: KHÔNG cho sửa `list_type` qua PATCH. Muốn đổi loại (blocklist ⇄ watchlist) → xóa-mềm bản ghi cũ + tạo bản ghi mới (mirror UC2: đổi `plate_number` = xóa + đăng ký lại).
3. **Trùng `(plate, list_type)` nhưng bản ghi cũ `active=false`**: vẫn trả **409** (đúng theo unique index, không phân biệt active) — admin tự `PATCH active=true` bản ghi cũ thay vì tạo bản ghi mới.
4. **"Tra biển" trong scope UC8**: CHỈ là `GET` list/detail có filter theo `plate`/`list_type`/`active`, phân trang chuẩn §8.4. Endpoint "check nhanh" phục vụ gate/camera hot-path (dùng `IDX_vehicle_control_lookup`) là **việc SAU** (gate-pairing, ngoài scope UC8).

---

## 2. Scope (UC8)

### TRONG scope
1. **POST** `/api/v1/anpr/admin/control-list` — thêm biển vào blocklist/watchlist.
2. **GET** `/api/v1/anpr/admin/control-list` — danh sách, filter `plate` (normalize trước khi query)/`listType`/`active`, phân trang.
3. **GET** `/api/v1/anpr/admin/control-list/:id` — chi tiết 1 bản ghi.
4. **PATCH** `/api/v1/anpr/admin/control-list/:id` — sửa `reason` và/hoặc `active` (KHÔNG `list_type`/`plate_number`/`plate_raw`).
5. **DELETE** `/api/v1/anpr/admin/control-list/:id` — xóa-mềm (`repo.softDelete`).
6. Chuẩn hóa `plate_raw` → `plate_number` qua `normalizePlate()` trước khi lưu/tra (bắt buộc, CLAUDE.md §5.5-5).
7. Migration seed 4 permission `vehicle_control.create/read/update/delete` + gán role — cùng commit với controller (CLAUDE.md §5.5-4).
8. Bắt lỗi trùng `(plate_number, list_type)` còn sống → **409** sạch (pre-check + safety-net `23505`, mirror UC1).

### NGOÀI scope (UC sau — KHÔNG làm ở đây)
- Endpoint "check nhanh" cho gate/camera hot-path (dùng `IDX_vehicle_control_lookup`, có thể auth khác — internal token như `AnprInternalTokenGuard`) — **gate-pairing UC sau**.
- Đối chiếu control-list khi có `gate_access_logs` mới (real-time alert khi xe blocklist qua cổng) — **alert center UC sau**, thuộc phần việc lớn hơn của Tài nhưng KHÔNG phải UC8.
- Restore/un-delete bản ghi đã xóa mềm.
- Sửa `list_type`/`plate_number`/`plate_raw` sau khi tạo (đổi = xóa + tạo mới, mục 1 đã chốt).
- Bulk import (Excel) danh sách blocklist.
- Migration schema mới (bảng + index + entity đã có sẵn, ADD-ONLY nguyên tắc CLAUDE.md §5.5 không áp dụng thêm ở UC8 vì không đổi schema).
- `zones`/`gate_access_logs`/`zone_presence_events` — module `zones` khác, không đụng.

## 3. DTO (đề xuất — mô tả, KHÔNG code)
- **`CreateVehicleControlListDto`**: `plate_raw` (`@Expose('plate_raw') @IsString @IsNotEmpty @MaxLength(20)`), `list_type` (`@Expose('list_type') @IsIn(['blocklist','watchlist'])`), `reason?` (`@IsOptional @IsString @MaxLength(255)`). KHÔNG `active`/`created_by` (mặc định `active=true`; `created_by` lấy từ `@CurrentUser()`, KHÔNG từ body — mirror SEC-01 UC1).
- **`UpdateVehicleControlListDto`**: `reason?` (`@IsOptional @IsString @MaxLength(255)`, gửi `null` = xóa lý do), `active?` (`@IsOptional @IsBoolean`). KHÔNG `list_type`/`plate_number`/`plate_raw` (mục 1.2 đã chốt — `whitelist:true` loại field thừa nếu client lén gửi). Cả 2 field absent → no-op, trả nguyên trạng 200 (mirror OQ-5 UC2).
- **`ListVehicleControlListQueryDto`**: `page`/`limit` (mirror UC3, limit max 100), `plate?` (string, service tự `normalizePlate()` trước khi where — so khớp CHÍNH XÁC trên `plate_number` đã chuẩn hóa, KHÔNG phải tìm gần đúng), `list_type?` (`@IsIn(['blocklist','watchlist'])`), `active?` (boolean qua query string `'true'|'false'`, cần `@Transform` tay vì `@Type(()=>Boolean)` của class-transformer coi mọi string non-empty là `true`).
- **`VehicleControlListResponseDto`** + mapper `toVehicleControlListResponse`: `id`, `plate_number`, `plate_raw`, `list_type`, `reason`, `active`, `created_by`, `created_at`, `updated_at`. KHÔNG lộ `deleted_at`.

## 4. Service (đề xuất — `VehicleControlListService` mới, file riêng theo yêu cầu)
- `create(currentUserId, dto)`: `normalizePlate(dto.plateRaw)` → pre-check `repo.findOne({where:{plateNumber, listType: dto.listType, deletedAt: IsNull()}})` → tồn tại → `ConflictException({code:'PLATE_ALREADY_IN_CONTROL_LIST', message:'Biển số này đã có trong danh sách kiểm soát'})`. Không trùng → `repo.create({plateNumber, plateRaw: dto.plateRaw, listType: dto.listType, reason: dto.reason ?? null, active: true, createdBy: currentUserId})` → `repo.save`, bắt `23505` an toàn (safety-net) → 409 tương tự.
- `list(query)`: build `where` (mirror UC3): `deletedAt: IsNull()`, thêm `plateNumber: normalizePlate(query.plate)` nếu có, `listType` nếu có, `active` nếu có (kể cả `false` — kiểm tra `!== undefined`, KHÔNG dùng truthy check để tránh bỏ sót filter `active=false`). `findAndCount`, sort `createdAt DESC`, phân trang chuẩn.
- `getDetail(id)`: `repo.findOne({where:{id, deletedAt: IsNull()}})` → không có → `NotFoundException({code:'CONTROL_LIST_ENTRY_NOT_FOUND', message:'Không tìm thấy bản ghi kiểm soát phương tiện'})`. **KHÔNG có khái niệm ownership** (khác UC2) — bất kỳ ai có quyền `read` đều xem được record bất kỳ.
- `update(id, dto)`: `getDetail(id)` (load + tồn tại) → set `reason`/`active` CHỈ field `!== undefined` → không field nào gửi → no-op trả nguyên trạng → có field → `repo.save`.
- `softDelete(id)`: `getDetail(id)` (đảm bảo tồn tại + chưa xóa) → `repo.softDelete(id)`.
- Tái dùng `isUniqueViolation(e)` helper (copy từ `VehicleRegistrationService` hoặc factor chung nếu team đồng ý — **mặc định copy riêng trong service mới, KHÔNG refactor chung ở UC8** để tránh động code UC1 đang chạy).

## 5. Controller (đề xuất — `VehicleControlListController` mới, file riêng theo yêu cầu)
- `@Controller('anpr/admin/control-list')`, toàn bộ route `@UseGuards(JwtAuthGuard, PermissionsGuard)` (không có route "self-service" như UC1/UC2 vì dữ liệu không thuộc user).
- `@Post()` `@RequirePermissions('vehicle_control.create')` → 201, `createdBy` từ `@CurrentUser()`.
- `@Get()` `@RequirePermissions('vehicle_control.read')` → list + meta phân trang.
- `@Get(':id')` `@RequirePermissions('vehicle_control.read')` → `ParseUUIDPipe`.
- `@Patch(':id')` `@RequirePermissions('vehicle_control.update')` → `ParseUUIDPipe`.
- `@Delete(':id')` `@RequirePermissions('vehicle_control.delete')` → `ParseUUIDPipe`, trả `data: null` (mirror OQ-4 UC2).
- Toàn bộ dùng `ValidationPipe({whitelist:true, transform:true})`, envelope inline `{success, message, data, meta?}`.

## 6. Requirements (EARS)
- **R1**: **WHEN** admin có quyền `vehicle_control.create` gửi `POST` với `plate_raw` + `list_type` hợp lệ **→** chuẩn hóa `plate_number` qua `normalizePlate()`, lưu cả `plate_raw`, `active=true` mặc định, `created_by` từ JWT, trả 201 + bản ghi.
- **R2 (crux)**: **IF** `(plate_number, list_type)` đã tồn tại bản ghi còn sống (`deleted_at IS NULL`, bất kể `active`) **→** `409 PLATE_ALREADY_IN_CONTROL_LIST`, KHÔNG tạo bản ghi mới (mục 1.3 đã chốt).
- **R3**: **WHEN** admin gửi `GET` list với filter `plate`/`list_type`/`active` bất kỳ tổ hợp **→** trả đúng tập lọc, phân trang chuẩn §8.4, `plate` filter phải qua `normalizePlate()` trước khi so khớp.
- **R4**: **WHEN** admin gửi `PATCH /:id` với `reason`/`active` **→** cập nhật đúng field gửi, KHÔNG đụng `plate_number`/`plate_raw`/`list_type`; cả 2 field absent → no-op 200.
- **R5**: **IF** body PATCH chứa `list_type`/`plate_number`/`plate_raw` **→** `ValidationPipe whitelist` loại bỏ, KHÔNG cho đổi qua UC8 (mục 1.2 đã chốt).
- **R6**: **WHEN** admin gửi `DELETE /:id` **→** soft-delete (`deleted_at` set), trả 200 `{data:null}`.
- **R7**: **IF** `:id` không tồn tại/đã xóa mềm (GET/PATCH/DELETE) **→** `404 CONTROL_LIST_ENTRY_NOT_FOUND`.
- **R8**: **IF** user không có permission tương ứng (`vehicle_control.create/read/update/delete`) **→** `403` (PermissionsGuard), KHÔNG thực thi business logic.
- **R9**: **WHILE** xử lý mọi route, `created_by` (khi tạo) PHẢI từ JWT (`@CurrentUser`), KHÔNG từ body.

## 7. Constitution
- **SEC-01**: Toàn bộ 5 route bắt buộc `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('vehicle_control.<action>')`. KHÔNG có route không cần quyền (khác UC1 có route self-service).
- **SEC-02**: `created_by` từ JWT, KHÔNG tin body.
- **ARCH-01**: Controller→Service→Repo, mirror UC1/UC2 (pre-check + safety-net conflict, `@InjectRepository`, envelope inline). File **mới hoàn toàn** (`vehicle-control-list.service.ts` + `.controller.ts`) — KHÔNG nhét vào `VehicleRegistrationService`/`Controller` (2 bảng khác mục đích, theo đúng ghi chú CLAUDE.md §5.5: `vehicle_control_list` khác `vehicle_registrations`).
- **DATA-01 (crux)**: `plate_number` LUÔN qua `normalizePlate()` trước khi lưu/tra — CLAUDE.md §5.5 quy tắc 5.
- **DATA-02**: `list_type` bất biến sau khi tạo (mục 1.2). Đổi loại = xóa-mềm + tạo mới.
- **DATA-03**: Trùng `(plate_number, list_type)` còn sống → LUÔN 409, bất kể `active` (mục 1.3).
- **DATA-04**: Xóa = soft-delete (`repo.softDelete`), KHÔNG hard-delete (mirror pattern toàn repo).
- **VAL-01**: DTO `class-validator` + `ValidationPipe({whitelist:true, transform:true})`; `:id` `ParseUUIDPipe`; `list_type` `@IsIn(['blocklist','watchlist'])`.
- **PERM-01**: 4 permission `vehicle_control.create/read/update/delete`, seed migration **cùng commit** với controller (`src/database/migrations/`, KHÔNG `seeds/`) — CLAUDE.md §5.5 quy tắc 4, nếu không sẽ 403 khi FE gọi.
- **NO-SCOPE-01**: KHÔNG tự làm gate-check hot-path endpoint, KHÔNG tự làm alert center — CLAUDE.md §5.5 quy tắc 7 (các bảng cảnh báo an ninh CHƯA có trong schema, phải thiết kế mới + review riêng nếu làm).

## 8. Residuals / known-gaps
- **Gate-check hot-path endpoint** (dùng `IDX_vehicle_control_lookup`, có thể cần auth kiểu `AnprInternalTokenGuard` thay vì JWT user) — owed, thuộc UC gate-pairing kế tiếp trong roadmap của Tài (memory dự án: control-list, gate pairing, dashboard, alert center, 3 báo cáo).
- **Alert khi xe blocklist thực sự qua cổng** (join với `gate_access_logs` mới của Hải) — owed, UC sau.
- **Restore/un-delete** bản ghi đã xóa mềm — chưa làm; partial-unique cho phép thêm lại cùng `(plate, list_type)` sau khi xóa mềm bản ghi cũ.
- **Bulk import** danh sách blocklist qua Excel — chưa yêu cầu, không tự làm.
- **`isUniqueViolation` trùng lặp code** giữa `VehicleRegistrationService` và `VehicleControlListService` — chấp nhận trùng nhỏ ở UC8 để tránh đụng code UC1 đang chạy; có thể factor ra `common/utils` sau nếu team muốn (không phải quyết định của UC8).

---

> **STOP.** Spec+Plan+Tasks (3 file) đã viết cùng lượt vì OQ đã chốt trước khi bắt đầu. Chờ Thiếu Chủ duyệt cả 3 file (`spec.md`, `plan.md`, `tasks.md`) trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
