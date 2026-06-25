# VPL-001 — UC3 (ANPR): xem danh sách / chi tiết biển đã đăng ký

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo spec VPL-001 (UC3): user xem list (phân trang + filter status) + detail biển CỦA MÌNH. Crux = lọc cứng userId=current (không lộ biển người khác) + tái dùng `loadOwned` cho detail. RECON pagination pattern repo. OQ chờ chốt. | Toàn bộ |
| 2026-06-24 | Thiếu Chủ CHỐT OQ-1…5: OQ-1=mirror pagination repo (page/limit, meta{page,limit,total,totalPages}) · OQ-2=filter status optional `@IsIn` (chỉ status v1) · OQ-3=detail 404 tái dùng `loadOwned` · OQ-4=list rỗng `[]`+200+meta.total=0 · OQ-5=sort `created_at DESC` mặc định. §7 ĐÃ CHỐT. | §7 |

> **SPEC-ONLY.** Chưa plan/tasks/code. Nền UC1/UC2 đã commit: entity + `VehicleRegistrationService` (có `loadOwned` private) + `VehicleRegistrationController` + `toVehicleRegistrationResponse`. UC3 thêm 2 GET route + method `list`/`getDetail` vào service+controller CÓ SẴN. KHÔNG migration, KHÔNG camera. **Chỉ user xem biển của mình** (admin list-all owed).

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Service/controller UC1+UC2 (chỗ thêm + tái dùng ownership)
- `VehicleRegistrationService` ([vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts)): inject `@InjectRepository(VehicleRegistrationEntity) repo`. **`private loadOwned(id, userId)`** = `findOne({where:{id, userId, deletedAt: IsNull()}})` → null → 404 `VEHICLE_NOT_FOUND` (UC2). ⇒ UC3 **detail tái dùng `loadOwned`** qua method public `getDetail(id, userId)` (single-source ownership, KHÔNG lặp logic).
- `VehicleRegistrationController` ([vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)): `@Controller('anpr')`, method-path nối `vehicle-registrations[...]`; envelope inline `{success,message,data}`; `@CurrentUser()`/`ParseUUIDPipe` đã dùng. `toVehicleRegistrationResponse` ([vehicle-registration-response.dto.ts](../../../../src/modules/anpr/dto/vehicle-registration-response.dto.ts)).

### 0.2. Pagination pattern repo — CÓ CHUẨN (mirror)
- Query DTO ([list-iot-devices-query.dto.ts](../../../../src/modules/iot/dto/list-iot-devices-query.dto.ts)): `page` (`@Type(()=>Number) @IsInt @Min(1)`, default 1), `limit` (`@Min(1) @Max(100)`, default 20), filter optional (`@IsOptional @IsEnum`, `@Expose` snake_case).
- Service `findAll(query)` ([iot-devices.service.ts:274-320](../../../../src/modules/iot/services/iot-devices.service.ts)): QueryBuilder `.skip((page-1)*limit).take(limit)` → `getManyAndCount()` → trả `{ items, meta: { page, limit, total, totalPages: Math.ceil(total/limit) } }`.
- Controller list ([iot-devices.controller.ts:46-55](../../../../src/modules/iot/controllers/iot-devices.controller.ts)): `{ success, message, data: items, meta }`, `@UsePipes(ValidationPipe{whitelist,transform})`.
- ⇒ Khớp CLAUDE.md §8.4 (page/limit, default 20 max 100, meta {page,limit,total,totalPages}). UC3 **mirror pattern này** (OQ-1) — KHÔNG tự dựng phân trang lệch.

### 0.3. @Query DTO validate
- List route nhận `@Query() dto: ListXxxQueryDto` + `@UsePipes(ValidationPipe{whitelist:true, transform:true})` (transform để ép `@Type(()=>Number)` page/limit từ string query). ⇒ UC3 `ListVehicleRegistrationsQueryDto` mirror.

---

## 1. Scope (UC3)

### TRONG scope
1. **GET `/api/v1/anpr/vehicle-registrations`** — list biển của current user. Lọc cứng `userId=current AND deletedAt IS NULL`. Phân trang (page/limit, mirror repo) + filter `status` optional. Trả mảng qua `toVehicleRegistrationResponse` + `meta`.
2. **GET `/api/v1/anpr/vehicle-registrations/:id`** — detail 1 biển của current user. Tái dùng `loadOwned` → không thuộc/đã xóa → 404. `ParseUUIDPipe`.
3. Cả 2 `JwtAuthGuard`, `userId` từ `@CurrentUser()`, envelope inline mirror UC1/UC2.

### NGOÀI scope (UC sau — KHÔNG làm)
- KHÔNG admin list-all (owed). KHÔNG xem biển đã xóa-mềm (chỉ `deletedAt IS NULL`). KHÔNG sửa/xóa (UC2). KHÔNG search phức tạp / filter `vehicle_type` (chỉ `status` v1). KHÔNG migration. KHÔNG camera.

## 2. DTO (đề xuất — mô tả, KHÔNG code)
`ListVehicleRegistrationsQueryDto` (mirror §0.2):
- `page` (`@Type(()=>Number) @IsOptional @IsInt @Min(1)`, default 1).
- `limit` (`@Type(()=>Number) @IsOptional @IsInt @Min(1) @Max(100)`, default 20).
- `status?` (`@IsOptional @IsIn(['active','disabled'])`) — filter optional (OQ-2).
- KHÔNG nhận `user_id` (server gắn current). `whitelist:true` loại field thừa.

## 3. Service (đề xuất — thêm vào `VehicleRegistrationService`)
- **`list(userId, query): Promise<{items: Entity[], meta}>`**: `where: { userId, deletedAt: IsNull(), ...(query.status ? {status} : {}) }`; `.skip((page-1)*limit).take(limit)`; sort `created_at DESC` (OQ-5); `findAndCount` (hoặc QueryBuilder `getManyAndCount`) → `meta: {page, limit, total, totalPages}`. List rỗng → `items: []`, total 0 (OQ-4).
- **`getDetail(id, userId): Promise<Entity>`**: `return this.loadOwned(id, userId)` (tái dùng — SEC ownership + 404 nếu không thuộc/đã xóa) (OQ-3).
- SEC-03 dùng repo (bind tham số). KHÔNG đụng `register`/UC2 method.

## 4. Controller (đề xuất — 2 GET route)
- `@Get('vehicle-registrations')` `@UseGuards(JwtAuthGuard)` `@UsePipes(ValidationPipe{whitelist:true,transform:true})` → `list(user.userId, query)` → `{ success:true, message:'Vehicle registrations retrieved', data: items.map(toVehicleRegistrationResponse), meta }` (200).
- `@Get('vehicle-registrations/:id')` `@UseGuards(JwtAuthGuard)` `@Param('id', ParseUUIDPipe)` → `getDetail(id, user.userId)` → `{ success:true, message:'Vehicle registration retrieved', data: toVehicleRegistrationResponse(entity) }` (200).
- (Lưu ý ordering route: `:id` đặt SAU path tĩnh để KHÔNG nuốt route khác — nhưng UC2 đã có `vehicle-registrations/:id` (PATCH/DELETE); GET thêm cùng path khác method, không xung đột.)

## 5. Requirements (EARS)
- **R1**: **WHEN** user đã xác thực gọi `GET /vehicle-registrations` **→** trả danh sách biển của CHÍNH user (`userId=current AND deletedAt IS NULL`), phân trang + `meta`, sort `created_at DESC`.
- **R2**: **IF** query có `status ∈ {active, disabled}` **→** lọc thêm theo status; KHÔNG truyền → trả cả 2 (trừ xóa-mềm).
- **R3**: **WHEN** user gọi `GET /vehicle-registrations/:id` trên biển của mình **→** trả detail (qua mapper).
- **R4 (SEC)**: **IF** `:id` không tồn tại / đã xóa-mềm / KHÔNG thuộc current user **→** `404 VEHICLE_NOT_FOUND` (tái dùng `loadOwned`), KHÔNG lộ biển người khác.
- **R5**: **WHILE** xử lý cả 2 route, `userId` PHẢI từ JWT (`@CurrentUser`); list KHÔNG BAO GIỜ trả biển user khác.
- **R6**: **IF** user không có biển nào (hoặc filter rỗng kết quả) **→** `data: []` + 200 (+ `meta.total=0`), KHÔNG 404.
- **R7**: **IF** `page`/`limit` sai kiểu / `limit > 100` / `status` ngoài enum **→** `400` validate fail.

## 6. Constitution
- **SEC-01 (crux ownership)**: list lọc cứng `userId=current`; detail qua `loadOwned` (`{id, userId, deletedAt:IsNull()}`). KHÔNG BAO GIỜ trả/để lộ biển người khác. `userId` từ JWT (KHÔNG query/body).
- **SEC-02 (giấu tồn tại)**: detail không thuộc → 404 (mirror UC2 OQ-1), KHÔNG 403.
- **ARCH-01**: controller→service→repo, mirror UC1/UC2; detail **tái dùng `loadOwned`** (single-source ownership, KHÔNG lặp).
- **DATA-01**: lọc cứng `userId=current AND deletedAt IS NULL`; filter `status` optional; read-only (KHÔNG mutate).
- **DATA-02**: no-migration.
- **VAL-01**: query DTO `class-validator` + `ValidationPipe({whitelist,transform})` (`page`/`limit` `@Type Number @IsInt @Min/@Max`, `status` `@IsIn`); `:id` `ParseUUIDPipe`.

## 7. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 (crux) pagination — CHỐT**: **mirror repo** — `page` (default 1), `limit` (default 20, max 100), `.skip((page-1)*limit).take(limit)` + count, `meta:{page,limit,total,totalPages}` (đúng shape iot-devices §0.2).
- **OQ-2 filter — CHỐT**: `status` optional `@IsIn(['active','disabled'])`; không truyền → cả 2 (trừ xóa-mềm). Chỉ `status` v1 (KHÔNG `vehicle_type`/search).
- **OQ-3 detail ownership-fail — CHỐT**: **404** — tái dùng `loadOwned(id, userId)` (KHÔNG viết lại ownership).
- **OQ-4 list rỗng — CHỐT**: `data: []` + 200 + `meta.total=0` (KHÔNG 404).
- **OQ-5 sort — CHỐT**: `created_at DESC` mặc định (mới nhất trước); KHÔNG cho client đổi sort v1.

## 8. Residuals / known-gaps
- **Admin list-all owed**: xem biển mọi user (cần PermissionsGuard + bỏ lọc userId) defer.
- **Search/sort-by-field owed**: chỉ filter `status` + sort cố định `created_at DESC` v1; search theo `plate_number`/`vehicle_type` + sort tùy chọn defer.
- **Xem biển đã xóa-mềm**: KHÔNG trong UC3 (chỉ `deletedAt IS NULL`); nếu cần history → owed.
- **Cursor pagination**: dùng offset (page/limit) mirror repo; cursor cho list lớn defer.
- **UC3 cung cấp `id`** cho UC2 (PATCH/DELETE cần `id`) — khép vòng client.

> **STOP.** Spec-only. Chờ Thiếu Chủ review §0 RECON + chốt OQ-1…OQ-5 trước khi plan/tasks. KHÔNG tự code.
