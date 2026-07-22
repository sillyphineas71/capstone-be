# ZNC-001 — UC-90 (Zones): Tạo khu vực

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo spec ZNC-001 (UC-90): tạo zone (zone_code / zone_name / zone_type / building / floor) trên bảng `zones` đã có sẵn. RECON code thật (migration 20260721000001, ZoneEntity, ZonesModule schema-only, mẫu CRUD ANPR + iot-devices, mẫu seed permission, role codes thật). Crux = trùng `zone_code` đang sống + chuỗi permission chưa chốt. 9 OPEN QUESTIONS chờ Thiếu Chủ. | Toàn bộ |
| 2026-07-22 | Thiếu Chủ CHỐT OQ-1→OQ-9. OQ-1=`zones.zone.create` (module_code `zones`, format 3 tầng) · OQ-2=`SYSTEM_ADMIN`+`BUSINESS_ADMIN` · OQ-3=CHO PHÉP tái dùng `zone_code` sau soft-delete (lịch sử phải khoá theo `zone_id`) · **OQ-4=`zone_type` BẮT BUỘC (khác đề xuất agent là optional-default `'room'`)** — tránh zone cổng âm thầm thành `room` làm FT-20 không kích hoạt · OQ-5=normalize trim+toUpperCase, tách `utils/normalize-zone-code.ts` · OQ-6=`building`/`floor` nullable mọi zone_type · OQ-7.1=bám 4 role code thật · OQ-7.2=giữ error shape hiện trạng, không dựng global filter · OQ-7.3=natural idempotency qua `UQ_zones_code_active` ĐẠT ARCH-03 (`constitution.md:45-46`) · OQ-7.4/7.5=ghi nợ · **OQ-8=KHÔNG audit ở UC-90 (khác đề xuất agent là có audit)** — dời sang UC-92 · OQ-9=`POST /api/v1/zones`, mã `ZNC-001`. | §7 (đổi tiêu đề + kết luận từng OQ); sửa tối thiểu §1, §2, §3, §4, §5 (R2/R5/R9), §6 (ARCH-03), §8 cho khớp quyết định |

> **SPEC-ONLY.** Chưa plan/tasks/code. Nền schema đã commit (migration `20260721000001` + `ZoneEntity` + `ZonesModule` schema-only). UC-90 chỉ thêm DTO + service + controller + **1 migration seed permission**. **KHÔNG** migration schema (bảng/cột/index đã có). **KHÔNG** đụng `iot_devices.zone_id`, `gate_access_logs`, `zone_presence_events`. UC-90 là UC nền: FT-20 (điểm danh cổng) và FT-21 (hiện diện khu vực) phụ thuộc dữ liệu zone do UC này tạo ra.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Bảng `zones` thật ([20260721000001-CreateZonesTable.ts:14-45](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts))
- Cột: `id` uuid (`uuid_generate_v4()`, PK `PK_zones_id`), `zone_code` varchar(80) NOT NULL, `zone_name` varchar(150) NOT NULL, `zone_type` varchar(30) NOT NULL **DEFAULT `'room'`**, `building` varchar(100) NULL, `floor` varchar(30) NULL, `description` varchar(255) NULL, `metadata_json` jsonb NULL, `status` varchar(30) NOT NULL **DEFAULT `'active'`**, `created_at`/`updated_at` timestamptz NOT NULL DEFAULT now(), `deleted_at` timestamptz NULL.
- 3 index, đều **partial** `WHERE deleted_at IS NULL`: `UQ_zones_code_active` (UNIQUE trên `zone_code`), `IDX_zones_type`, `IDX_zones_building_floor` (`building`,`floor`).
- **KHÔNG có CHECK constraint, KHÔNG có PG enum** cho `zone_type`/`status` → mọi ràng buộc giá trị phải làm ở tầng application (DTO) → OQ-4.
- **KHÔNG có cột `created_by`/`updated_by`** → không lưu được người tạo ngay trên bảng; muốn truy vết phải qua `audit_logs` → OQ-8.
- Hệ quả trực tiếp của partial unique: **`zone_code` của zone đã soft-delete có thể được dùng lại** (comment ngay tại [:31](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts) ghi rõ chủ đích này) → OQ-3.

### 0.2. `ZoneEntity` đã tồn tại — KHÔNG tạo mới ([zone.entity.ts:21-58](../../../../src/modules/zones/entities/zone.entity.ts))
- `@Entity('zones')`, mapping camelCase ↔ snake_case đầy đủ: `zoneCode`, `zoneName`, `zoneType`, `building`, `floor`, `description`, `metadataJson`, `status`, `createdAt`, `updatedAt`, `deletedAt`.
- `@DeleteDateColumn({ name: 'deleted_at' })` → TypeORM tự lọc bản ghi soft-deleted ở `find*` mặc định, và `repo.softDelete()` dùng được (UC-92, ngoài scope).
- `metadataJson: Record<string, unknown> | null`; `building`/`floor`/`description` khai `string | null` (nullable ở DB).
- Entity **không khai relation** nào (không `@ManyToOne` sang rooms/iot_devices) — giữ nguyên ở UC-90.

### 0.3. `ZonesModule` hiện SCHEMA-ONLY ([zones.module.ts:18-28](../../../../src/modules/zones/zones.module.ts))
- Chỉ `TypeOrmModule.forFeature([ZoneEntity, GateAccessLogEntity, ZonePresenceEventEntity])` + `exports: [TypeOrmModule]`. **KHÔNG có** `controllers`/`providers`. Comment [:11-15](../../../../src/modules/zones/zones.module.ts) nói rõ nghiệp vụ để UC sau.
- Đã đăng ký trong [app.module.ts:41,112](../../../../src/app.module.ts) (`ZonesModule, // schema-only: đăng ký entity scope Zone (SAVP)`).
- ⇒ UC-90 **thêm** `controllers` + `providers` vào chính module này (giữ nguyên `forFeature`), **không** tạo module mới.

### 0.4. Mẫu controller CRUD gần nhất ([vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts))
- Pipe dùng lại 1 instance module-level: `const REGISTER_PIPE = new ValidationPipe({ whitelist: true, transform: true });` ([:33](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
- Route admin-gated: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.admin_register')` + `@HttpCode(HttpStatus.CREATED)` ([:165-180](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
- Envelope dựng **inline** trong controller: `{ success: true, message: '...', data: mapper(entity) }`; list thêm `meta`.
- `:id` luôn qua `ParseUUIDPipe`. Route static khai **trước** route động (`vehicle-history` trước `:id`) — lưu ý cho UC-93 sau.

### 0.5. Mẫu service create ([vehicle-registration.service.ts:49-90](../../../../src/modules/anpr/services/vehicle-registration.service.ts))
- Trình tự chuẩn: **normalize input → validate giá trị đã normalize → pre-check trùng (`findOne({ where: { ..., deletedAt: IsNull() } })`) → `repo.create` → `repo.save` trong `try/catch`**.
- Lỗi nghiệp vụ ném kèm payload `{ code, message }`: `BadRequestException({ code: 'INVALID_PLATE', ... })`, `ConflictException({ code: 'PLATE_ALREADY_REGISTERED', ... })` (helper `plateConflict()` [:30-34](../../../../src/modules/anpr/services/vehicle-registration.service.ts)).
- **Safety-net race condition**: bắt `23505` (`isUniqueViolation` [:212-218](../../../../src/modules/anpr/services/vehicle-registration.service.ts)) → ném lại đúng 409 sạch thay vì để lỗi DB phọt ra client. Mẫu này áp thẳng được cho `UQ_zones_code_active`.
- Service inject `@InjectRepository(Entity) repo` (không `DataSource`) khi chỉ đụng 1 bảng.

### 0.6. Mẫu DTO ([create-vehicle-registration.dto.ts](../../../../src/modules/anpr/dto/create-vehicle-registration.dto.ts), [create-iot-device.dto.ts](../../../../src/modules/iot/dto/create-iot-device.dto.ts))
- Field API dạng snake_case map sang property camelCase bằng `@Expose({ name: 'plate_raw' })` / `@Expose({ name: 'device_code' })`; validator `class-validator` (`@IsString`, `@IsNotEmpty`, `@MaxLength`, `@IsOptional`, `@IsEnum`, `@IsObject`).
- Chuẩn hoá nhẹ ngay trong DTO có tiền lệ: `@Transform(({ value }) => value.trim())` trên `device_code` ([create-iot-device.dto.ts:25](../../../../src/modules/iot/dto/create-iot-device.dto.ts)) → liên quan OQ-5.
- Field lấy từ JWT **không** khai trong DTO (SEC-01, `whitelist` loại field thừa).

### 0.7. Mẫu create có transaction + audit ([iot-devices.service.ts:96-176](../../../../src/modules/iot/services/iot-devices.service.ts))
- `queryRunner` + `startTransaction` → pre-check trùng `device_code` → `ConflictException({ code: 'DEVICE_CODE_EXISTS' })` → save → **ghi audit trong cùng transaction** (`iotAuditRepository.logDeviceCreation` [:158-162](../../../../src/modules/iot/services/iot-devices.service.ts)) → commit; catch → rollback.
- ⇒ Repo có **2 mẫu create song song**: ANPR (1 bảng, không transaction, không audit) và IoT (transaction + audit). Zone create chọn mẫu nào → OQ-8.

### 0.8. Chuỗi permission trong repo KHÔNG nhất quán
- Format 3 tầng `module.entity.action`: `iot.device.read` ([iot-devices.controller.ts:38](../../../../src/modules/iot/controllers/iot-devices.controller.ts)), `anpr.vehicle.admin_register`, `account.role.read`.
- Nhưng ngay cùng controller đó, route `POST /iot-devices` lại gate bằng format 2 tầng kiểu cũ `iot_devices:create` ([iot-devices.controller.ts:82](../../../../src/modules/iot/controllers/iot-devices.controller.ts)).
- ⇒ Không có "1 chuẩn duy nhất" để suy ra; phải chốt tay → OQ-1.

### 0.9. Mẫu seed permission ([20260718000008-SeedRoleReadPermission.ts:19-53](../../../../src/database/migrations/20260718000008-SeedRoleReadPermission.ts))
- `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES (..., true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;` → nếu rỗng thì `SELECT id ... WHERE permission_code = $1` (idempotent).
- Gán role: `INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;`
- `down()` xoá `role_permissions` trước rồi `permissions`.
- Tiền lệ `module_code`: `'anpr'` cho `anpr.vehicle.*` ([20260720000005-BackfillRolePermissions.ts:179-194](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts)), `'iot'` cho permission camera ([20260630000002-SeedCheckAvailabilityPermission.ts:38](../../../../src/database/migrations/20260630000002-SeedCheckAvailabilityPermission.ts)), `'accounts'` cho `account.role.*`.
- **Vị trí file**: seed permission phải nằm trong `src/database/migrations/` — folder `src/database/seeds/` vẫn còn nhiều file cũ nhưng **không có runner** (AGENTS.md §5.5 rule 4). Nếu đặt sai chỗ → permission không vào DB → 403.

### 0.10. Role code THẬT ([20260720000002-SeedCoreRoles.ts:32-56](../../../../src/database/migrations/20260720000002-SeedCoreRoles.ts))
- Chỉ **4 role** được seed/dùng: `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE`.
- Comment [:8-12](../../../../src/database/migrations/20260720000002-SeedCoreRoles.ts) ghi rõ: `ADMIN`, `INTERNAL_USER`, `ROOM_ADMIN` là **mã cũ/lỗi thời**, chỉ xuất hiện ở vài migration rất sớm, **không còn được tạo hay dùng**.
- ⇒ **Lệch với prompt UC-90** (prompt liệt kê "role codes có thật: ADMIN, BUSINESS_ADMIN, EMPLOYEE, INTERNAL_USER, MANAGER, SYSTEM_ADMIN"). Ghi nhận ở OQ-2/OQ-7.

### 0.11. Không có global ValidationPipe / global exception filter
- [main.ts:6-25](../../../../src/main.ts): chỉ `setGlobalPrefix('api/v1')`, `enableCors`, `useContainer`. **KHÔNG** `useGlobalPipes`, **KHÔNG** `useGlobalFilters`.
- [app.module.ts:128-131](../../../../src/app.module.ts): provider global duy nhất là `APP_GUARD: MustChangePasswordGuard`. Filter duy nhất trong `src/common/filters/` là `query-failed.filter.ts` (không đăng ký global).
- ⇒ UC-90 **bắt buộc** khai `@UsePipes(ValidationPipe({ whitelist, transform }))` ở controller (không dựa vào global), và error body sẽ là shape mặc định của Nest bọc payload `{ code, message }` — **chưa** có `timestamp`/`path` như CLAUDE.md §8.2 mô tả. Ghi nhận ở §8, KHÔNG tự sửa trong UC-90.

### 0.12. Tiền lệ chuẩn hoá mã ([normalize-plate.ts:13-18](../../../../src/modules/anpr/utils/normalize-plate.ts))
- `normalizePlate`: `trim → toUpperCase → strip [^A-Z0-9]`, pure function, tách file `utils/`, có cảnh báo không map nhầm O/0, I/1. Đây là mẫu tham chiếu nếu `zone_code` cần normalize → OQ-5.

---

## 1. Scope (UC-90)

### TRONG scope
1. **1 endpoint tạo zone**: `POST /api/v1/zones` (CHỐT OQ-9) — nhận `zone_code`, `zone_name`, `zone_type`, `building`, `floor`, `description`, `metadata_json`.
2. **DTO `CreateZoneDto`** — validate độ dài đúng theo DB (§0.1), `zone_type` **bắt buộc** theo danh sách cứng 5 giá trị (CHỐT OQ-4), snake_case ↔ camelCase qua `@Expose`.
3. **`ZonesService.create()`** — normalize `zone_code` (trim + toUpperCase, CHỐT OQ-5) → pre-check trùng `zone_code` **đang sống** → `repo.create/save` → safety-net `23505`.
4. **Controller + guard** — `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('zones.zone.create')` (CHỐT OQ-1), `@HttpCode(201)`, envelope `{success, message, data}`.
5. **Response mapper** `toZoneResponse(entity)` — trả field snake_case, không lộ field nội bộ ngoài schema.
6. **1 migration seed permission** trong `src/database/migrations/` (mẫu §0.9), gán cho `SYSTEM_ADMIN` + `BUSINESS_ADMIN` (CHỐT OQ-2), **cùng commit** với controller.
7. **Wiring**: thêm `controllers`/`providers` vào `ZonesModule` (giữ nguyên `forFeature`).
8. **Unit test** cho service (happy path + trùng code + race 23505) và DTO validate.

### NGOÀI scope (UC sau — KHÔNG làm)
- **UC-91 (sửa zone)**: `PATCH /zones/:id`, đổi `status`, đổi `zone_code`.
- **UC-92 (xoá zone)**: soft-delete `repo.softDelete`, ràng buộc "zone còn device/log thì có xoá được không".
- **UC-93 (xem/tra cứu)**: `GET /zones`, `GET /zones/:id`, filter theo `zone_type`/`building`/`floor`, phân trang.
- **UC-94 (gán camera vào zone)**: ghi `iot_devices.zone_id`, `iot_device_events.zone_id`.
- **FT-20 / FT-21**: ingestion `gate_access_logs`, `zone_presence_events`, ghép cặp in/out, occupancy.
- **KHÔNG** migration schema (bảng + 3 index đã có — §0.1); **KHÔNG** thêm cột (kể cả `created_by`).
- **KHÔNG** liên kết `zones` ↔ `rooms` (không FK, không đồng bộ 2 chiều). Zone song song `rooms`, không thay thế (AGENTS.md §5.5).
- **KHÔNG** WebSocket/notification/bulk-import/CSV.
- **KHÔNG** đụng `vehicle_control_list` hay bất kỳ bảng ANPR nào.

## 2. DTO (đề xuất — mô tả, KHÔNG code)

**`CreateZoneDto`** (`src/modules/zones/dto/create-zone.dto.ts`), style mirror §0.6:

| Field API | Property | Ràng buộc đề xuất | Ghi chú |
| :--- | :--- | :--- | :--- |
| `zone_code` | `zoneCode` | `@Expose({name:'zone_code'})` `@IsString` `@IsNotEmpty` `@MaxLength(80)` | Bắt buộc. Khớp varchar(80). Chuẩn hoá trim+uppercase ở service (CHỐT OQ-5). |
| `zone_name` | `zoneName` | `@Expose` `@IsString` `@IsNotEmpty` `@MaxLength(150)` | Bắt buộc. |
| `zone_type` | `zoneType` | `@Expose` **required** + danh sách cứng `['room','gate','corridor','lobby','parking']` (CHỐT OQ-4) | DB có DEFAULT `'room'` nhưng KHÔNG có CHECK → **không** dựa vào default, bắt khai tường minh. |
| `building` | `building` | `@IsOptional` `@IsString` `@MaxLength(100)` | Nullable cho **mọi** `zone_type` (CHỐT OQ-6). |
| `floor` | `floor` | `@IsOptional` `@IsString` `@MaxLength(30)` | Nullable cho mọi `zone_type` (CHỐT OQ-6). `floor` là **varchar**, chấp nhận `'G'`, `'B1'` — KHÔNG ép số. |
| `description` | `description` | `@IsOptional` `@IsString` `@MaxLength(255)` | |
| `metadata_json` | `metadataJson` | `@IsOptional` `@IsObject` | Mirror `create-iot-device.dto.ts`. |

- **KHÔNG** khai `status` trong DTO tạo mới: zone mới luôn `'active'` (DB default). Đổi trạng thái là UC-91.
- **KHÔNG** khai `id`/`created_at`/`updated_at`/`deleted_at`; `whitelist: true` loại mọi field thừa.

**`ZoneResponse` mapper** (`dto/zone-response.dto.ts`, mirror `toVehicleRegistrationResponse`): trả `id`, `zone_code`, `zone_name`, `zone_type`, `building`, `floor`, `description`, `metadata_json`, `status`, `created_at`, `updated_at`. **KHÔNG** trả `deleted_at`.

## 3. Service (đề xuất)

**`ZonesService`** (`src/modules/zones/services/zones.service.ts`), inject `@InjectRepository(ZoneEntity) repo` — **chỉ repository, KHÔNG `DataSource`/`queryRunner`** (CHỐT OQ-8: không audit ở UC-90).

`create(dto: CreateZoneDto): Promise<ZoneEntity>`
1. `zoneCode = normalizeZoneCode(dto.zoneCode)` — trim + toUpperCase, hàm pure tách `utils/normalize-zone-code.ts` (CHỐT OQ-5), mirror §0.12.
2. **Pre-check trùng (crux)**: `repo.findOne({ where: { zoneCode, deletedAt: IsNull() } })` → có → `ConflictException({ code: 'ZONE_CODE_EXISTS', message: 'Mã khu vực đã tồn tại' })`.
   - Lọc `deletedAt: IsNull()` **bắt buộc**, đúng ngữ nghĩa `UQ_zones_code_active` (§0.1) và AGENTS.md §5.5 rule 1.
3. `repo.create({ zoneCode, zoneName, zoneType, building: dto.building ?? null, floor: dto.floor ?? null, description: dto.description ?? null, metadataJson: dto.metadataJson ?? null })` — **không** set `status` (để DB default `'active'`).
4. `repo.save(...)` trong `try/catch`; catch `23505` → ném lại **cùng** `ZONE_CODE_EXISTS` (409) — safety-net race, mirror §0.5.
5. **KHÔNG** transaction, **KHÔNG** ghi `audit_logs` (CHỐT OQ-8 — dời sang UC-92 làm 1 lần cho cả cụm zone).

- SEC-03: chỉ dùng repository API (tham số được bind), KHÔNG string-concat SQL.
- Service **không nhận** `actorUserId`: bảng `zones` không có `created_by` (§0.1) và UC-90 không audit → không có nơi tiêu thụ. Định danh người gọi vẫn được `JwtAuthGuard` + `PermissionsGuard` kiểm ở tầng controller.

## 4. Controller (đề xuất — route)

`ZonesController` (`src/modules/zones/controllers/zones.controller.ts`), `@Controller('zones')` (CHỐT OQ-9 — không prefix `/savp/`, không đặt dưới `/iot/`).

```text
POST /api/v1/zones
```
- `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('zones.zone.create')` (CHỐT OQ-1).
- `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))` — khai tường minh vì không có global pipe (§0.11).
- `@HttpCode(HttpStatus.CREATED)`.
- Trả: `{ success: true, message: 'Zone created successfully', data: toZoneResponse(entity) }`.

**HTTP status dự kiến**

| Tình huống | Status | `error.code` |
| :--- | ---: | :--- |
| Tạo thành công | `201` | — |
| DTO sai (thiếu `zone_code`/`zone_name`/**`zone_type`**, quá `MaxLength`, `zone_type` ngoài danh sách) | `400` | (Nest validation) |
| Chưa đăng nhập / token sai | `401` | — |
| Thiếu permission | `403` | — |
| Trùng `zone_code` đang sống (pre-check hoặc race 23505) | `409` | `ZONE_CODE_EXISTS` |

## 5. Requirements (EARS)

- **R1**: **WHEN** người dùng đã xác thực và có permission gửi `POST /api/v1/zones` với `zone_code` + `zone_name` hợp lệ **→** hệ thống tạo 1 bản ghi `zones` mới với `status = 'active'`, `deleted_at = NULL`, trả `201` + envelope `{success, message, data}` chứa zone vừa tạo (qua mapper).
- **R2** (CHỐT OQ-4): **IF** request **không truyền** `zone_type` **→** hệ thống trả `400` và **KHÔNG** tạo bản ghi. **KHÔNG** rơi về DB DEFAULT `'room'` — zone cổng bị đặt nhầm thành `room` sẽ khiến logic FT-20 (điểm danh cổng) im lặng không kích hoạt.
- **R3 (crux)**: **IF** đã tồn tại 1 zone **chưa soft-delete** có cùng `zone_code` (sau chuẩn hoá, nếu có) **→** hệ thống trả `409 ZONE_CODE_EXISTS` và **KHÔNG** tạo bản ghi.
- **R4**: **IF** 2 request tạo cùng `zone_code` chạy đồng thời và cùng qua được pre-check **→** `UQ_zones_code_active` chặn ở DB (`23505`); hệ thống PHẢI dịch lỗi này thành `409 ZONE_CODE_EXISTS`, **KHÔNG** để lỗi driver/stack trace lọt ra client (ENG-03).
- **R5** (CHỐT OQ-4): **IF** `zone_type` nằm ngoài danh sách cứng `{room, gate, corridor, lobby, parking}` **→** trả `400`, **KHÔNG** tạo bản ghi.
- **R6**: **IF** bất kỳ field nào vượt giới hạn độ dài DB (`zone_code`>80, `zone_name`>150, `zone_type`>30, `building`>100, `floor`>30, `description`>255) **→** trả `400` từ DTO, **KHÔNG** để DB ném lỗi truncate.
- **R7 (SEC-02)**: **WHILE** xử lý `POST /zones`, request PHẢI qua `JwtAuthGuard` + `PermissionsGuard`; thiếu token → `401`, thiếu permission → `403`, và **KHÔNG** ghi gì vào DB.
- **R8**: **IF** body chứa field ngoài DTO (`id`, `status`, `deleted_at`, `created_at`…) **→** `ValidationPipe({whitelist:true})` loại bỏ; **KHÔNG** cho client tự đặt `status`/`id`/timestamp.
- **R9** (CHỐT OQ-3): **WHERE** tồn tại zone đã soft-delete mang cùng `zone_code`, **THE system SHALL** cho phép tạo zone mới với `zone_code` đó (partial unique bỏ qua bản ghi `deleted_at IS NOT NULL`), trả `201` với `id` **mới**. Hệ quả bắt buộc: mọi báo cáo/truy vết lịch sử (`gate_access_logs`, `zone_presence_events`) PHẢI khoá theo `zone_id`, **KHÔNG** được dùng `zone_code` làm khoá lịch sử.
- **R10**: **WHILE** thực hiện mọi truy vấn liên quan zone, điều kiện `deleted_at IS NULL` PHẢI có mặt (AGENTS.md §5.5 rule 1) — áp dụng cho pre-check trùng ở R3.

## 6. Constitution

| Rule | Áp dụng trong UC-90 |
| :--- | :--- |
| **SEC-01** (không secret plaintext) | UC-90 không đụng secret/credential. `metadata_json` KHÔNG được dùng để chứa mật khẩu/token camera — ghi rõ trong mô tả field. |
| **SEC-02** (auth bắt buộc cho mutating endpoint) | `POST /zones` gate bằng `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions` (R7). Không có endpoint public. |
| **SEC-03** (validate + parameterize) | DTO `class-validator` + `ValidationPipe({whitelist, transform})` khai tường minh (§0.11); chỉ dùng repository API, không raw SQL nối chuỗi. |
| **DATA-01** (không hard-delete) | UC-90 không xoá gì. Nhưng mọi lookup PHẢI lọc `deleted_at IS NULL` để tôn trọng ngữ nghĩa soft-delete (R10). Hard-delete zone bị cấm (UC-92 dùng `softDelete`). |
| **ARCH-01** (service boundary) | `zones` không truy cập DB của module khác; không đụng `iot_devices`/`rooms`. Controller → service → repository. |
| **ARCH-03** (idempotency) | **ĐẠT** — `constitution.md:45-46` cho phép *"idempotency-key header **hoặc** natural idempotency design"*. Idempotency tự nhiên qua `zone_code` + `UQ_zones_code_active`: gửi lại cùng `zone_code` → `409`, không tạo bản ghi trùng. KHÔNG cần `Idempotency-Key` header (CHỐT OQ-7.3 — không còn là open question). |
| **ENG-01** (coverage ≥80% business logic) | Unit test `ZonesService.create`: happy path, trùng code đang sống → 409, race `23505` → 409, tái dùng code đã soft-delete → 201. Test DTO validate (thiếu `zone_type`, sai giá trị, vượt `MaxLength`). |
| **ENG-02** (OpenAPI + EARS tag) | Repo hiện chưa có Swagger setup → ghi nhận residual ở §8. EARS tag (R1…R10) đặt trong JSDoc của service/controller. |
| **ENG-03** (không lộ chi tiết lỗi) | Lỗi nghiệp vụ ném `{code, message}` tiếng Việt; lỗi `23505` được dịch thành 409 sạch (R4); không trả stack trace. |
| **ENG-04** (pin dependency) | UC-90 KHÔNG thêm dependency mới. |

## 7. OPEN QUESTIONS — ĐÃ CHỐT

> Thiếu Chủ đã chốt toàn bộ OQ-1 → OQ-9 ngày 2026-07-22. Phần *Đề xuất/Lý do* giữ nguyên để lưu vết phân tích; dòng **KẾT LUẬN** là quyết định cuối cùng. **Plan/tasks/code KHÔNG được mở lại các OQ này.** Hai điểm quyết định **khác** đề xuất ban đầu của agent: **OQ-4** (`zone_type` thành bắt buộc) và **OQ-8** (bỏ audit).

- **OQ-1 (crux) — Chuỗi permission.** *Đề xuất*: `zones.zone.create`, `module_code = 'zones'`.
  *Lý do*: đúng format 3 tầng đang chiếm đa số (`iot.device.read`, `anpr.vehicle.admin_register`, `account.role.read` — §0.8) và có tiền lệ `module_code` = tên module (§0.9). `zones` là module riêng đã tồn tại trong `src/modules/` và trong bảng module ở AGENTS.md §4.1, nên gộp vào `iot` sẽ sai boundary (zone là khu vực vật lý, không phải thiết bị).
  *Rủi ro*: repo vẫn còn format cũ 2 tầng `iot_devices:create` ([iot-devices.controller.ts:82](../../../../src/modules/iot/controllers/iot-devices.controller.ts)) — nếu team đang có ý định thống nhất về format khác thì phải chốt trước khi seed, vì đổi `permission_code` sau khi seed lên RDS chung rất phiền.
  **KẾT LUẬN — CHỐT: `zones.zone.create`, `module_code = 'zones'`.** Format 3 tầng `module.entity.action` là chuẩn cho code mới; `iot_devices:create` là di sản cũ, **KHÔNG** dùng lại.

- **OQ-2 — Role nào được tạo zone.** *Đề xuất*: `SYSTEM_ADMIN` + `BUSINESS_ADMIN`.
  *Lý do*: khớp tiền lệ permission quản trị hạ tầng SAVP (`anpr.vehicle.admin_register` gán đúng 2 role này — §0.9). Zone là dữ liệu nền dùng chung toàn khuôn viên; `MANAGER`/`EMPLOYEE` không có nhu cầu tạo.
  *Cảnh báo*: chỉ 4 role tồn tại thật (`SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` — §0.10); `ADMIN`/`INTERNAL_USER` trong prompt là mã lỗi thời, **seed vào sẽ không gán được** (query lọc `role_code` + `is_active = true` → im lặng không insert).
  **KẾT LUẬN — CHỐT: `SYSTEM_ADMIN` + `BUSINESS_ADMIN`.** Bám 4 role code thật; **KHÔNG** seed `ADMIN`/`INTERNAL_USER`.

- **OQ-3 — `zone_code` trùng với zone đã soft-delete.** *Đề xuất*: **CHO PHÉP** tái sử dụng (giữ nguyên hành vi partial unique hiện tại).
  *Lý do*: đây là chủ đích đã ghi trong migration ([:31](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts)) và trùng pattern `vehicle_registrations`. Chặn thêm ở tầng app sẽ mâu thuẫn với thiết kế DB.
  *Rủi ro cần Thiếu Chủ cân*: `gate_access_logs` / `zone_presence_events` là append-only và tham chiếu `zone_id` cũ; tái dùng `zone_code` khiến báo cáo lịch sử theo **mã** khu vực bị lẫn 2 thực thể khác nhau (theo `zone_id` thì vẫn phân biệt được). Nếu ưu tiên sạch lịch sử → chặn và trả `409 ZONE_CODE_ARCHIVED`.
  **KẾT LUẬN — CHỐT: CHO PHÉP tái sử dụng.** Giữ nguyên hành vi partial unique. **Ràng buộc kèm theo (bắt buộc cho FT-20/FT-21)**: mọi báo cáo/truy vết lịch sử phải tham chiếu `zone_id`, **KHÔNG** dùng `zone_code` làm khoá lịch sử.

- **OQ-4 — Ràng buộc `zone_type`.** *Đề xuất*: `@IsIn(['room','gate','corridor','lobby','parking'])` — danh sách cứng, khai trong `constants/zone-type.constant.ts`; field **optional**, thiếu thì để DB default `'room'`.
  *Lý do*: DB không có CHECK/enum (§0.1) nên app là chốt chặn duy nhất; danh sách này đúng như mô tả UC-90 và là input cho FT-20/FT-21 (logic cổng khác logic hành lang). Mở tự do sẽ khiến hai phân hệ sau phải đoán ngữ nghĩa.
  *Phương án thay thế*: dùng TS `enum` + `@IsEnum` (mirror `IoTDeviceType`) nếu team muốn type-safe hơn `@IsIn`.
  **KẾT LUẬN — CHỐT (KHÁC đề xuất agent): `zone_type` BẮT BUỘC (required), KHÔNG optional-default.** Lý do Thiếu Chủ: để optional thì tạo zone cổng mà quên truyền `zone_type` sẽ **âm thầm** thành `'room'`, khiến logic FT-20 (điểm danh cổng) không bao giờ kích hoạt mà **không có lỗi nào báo**; bắt khai tường minh → sai thì `400` ngay. Danh sách cứng `['room','gate','corridor','lobby','parking']` khai trong `constants/zone-type.constant.ts`. `@IsIn` hay TS enum + `@IsEnum` đều được, miễn **nhất quán** trong toàn module.

- **OQ-5 — Chuẩn hoá `zone_code`.** *Đề xuất*: chỉ **trim + toUpperCase**; **KHÔNG** strip ký tự, **KHÔNG** bỏ dấu.
  *Lý do*: `zone_code` là mã do người quản trị đặt, thường có `-`/`_` (`GATE-01`, `B1_LOBBY`) — strip như `normalizePlate` sẽ làm `GATE-01` và `GATE01` đụng nhau ngoài ý muốn. Trim + uppercase đủ chặn trùng do gõ hoa/thường và khoảng trắng thừa.
  *Lưu ý*: nếu chốt có normalize thì phải áp **cùng một hàm** cho mọi UC sau (UC-91 đổi code, UC-93 tra cứu), tách file `utils/normalize-zone-code.ts` như tiền lệ §0.12. Nếu chốt "không normalize gì cả" thì `Gate-01` và `GATE-01` sẽ là 2 zone hợp lệ khác nhau.
  **KẾT LUẬN — CHỐT: trim + toUpperCase. KHÔNG strip ký tự, KHÔNG bỏ dấu.** Tách hàm pure `src/modules/zones/utils/normalize-zone-code.ts` (mirror `normalize-plate.ts`) để UC-91/UC-93 dùng lại **cùng một hàm**.

- **OQ-6 — `building` / `floor` bắt buộc hay nullable.** *Đề xuất*: giữ **nullable cho mọi `zone_type`** ở UC-90.
  *Lý do*: DB cho nullable (§0.1); ràng buộc theo loại (`room` phải có `floor`, `parking` thì không) là conditional validation, dễ sai và khó nới sau. Có thể siết ở UC-91/UC-93 khi đã rõ dữ liệu thực tế.
  *Phương án thay thế*: bắt buộc `building` cho mọi zone (báo cáo theo toà nhà sẽ sạch hơn), `floor` vẫn optional.
  **KẾT LUẬN — CHỐT: nullable cho mọi `zone_type` ở UC-90. KHÔNG conditional validation.**

- **OQ-7 — Mâu thuẫn giữa prompt và file luật/code thật.** Cả 5 điểm đã được xác minh độc lập trên code thật và **đều đúng**:
  1. **Role codes**: prompt liệt kê `ADMIN` và `INTERNAL_USER` là "role codes có thật"; code thật (§0.10) nói 2 mã này lỗi thời, không còn được tạo.
     **KẾT LUẬN — CHỐT: bám code thật (4 role).** Prompt trước liệt kê `ADMIN`/`INTERNAL_USER` là **sai**; phát hiện của agent được ghi nhận là đúng.
  2. **Error envelope**: CLAUDE.md §8.2 quy định `{success, message, error:{code,details}, timestamp, path}`, nhưng repo **không có global exception filter** (§0.11) nên lỗi thực tế là shape mặc định của Nest bọc `{code, message}`.
     **KẾT LUẬN — CHỐT: bám hiện trạng repo.** **KHÔNG** dựng global exception filter trong UC-90 (việc toàn hệ thống → task riêng). Ghi nợ ở §8.
  3. **ARCH-03 idempotency**: constitution yêu cầu "mọi mutating endpoint SHALL có idempotency mechanism"; UC-90 chỉ có idempotency tự nhiên qua unique `zone_code`, không có `Idempotency-Key`.
     **KẾT LUẬN — KHÔNG phải open question.** [`constitution.md:45-46`](../../../global/constitution.md) ghi rõ *"idempotency-key header **hoặc natural idempotency design**"* → natural idempotency qua `UQ_zones_code_active` là **ĐẠT**. Không hỏi lại.
  4. **ENG-02 OpenAPI**: constitution yêu cầu mọi public endpoint có OpenAPI doc; repo chưa setup Swagger.
     **KẾT LUẬN — CHỐT: UC-90 được miễn**, ghi nợ ở §8.
  5. Các file `spec/global/coding-standards.md`, `data-governance.md`, `security.md`, `system-arch.md`, `glossary.md` **rỗng hoàn toàn** (chỉ `constitution.md` có nội dung).
     **KẾT LUẬN — CHỐT: ghi nhận là nợ cấp nhóm, KHÔNG xử trong UC-90.** Căn cứ hiệu lực hiện tại = `constitution.md` + `CLAUDE.md` + `AGENTS.md`. **KHÔNG** tự tạo/điền nội dung cho các file rỗng.

- **OQ-8 — Có ghi `audit_logs` khi tạo zone không?** *Đề xuất*: **CÓ**, ghi trong cùng transaction, mirror `logDeviceCreation` (§0.7).
  *Lý do*: bảng `zones` **không có `created_by`** (§0.1) → không audit thì mất hoàn toàn dấu vết ai tạo khu vực, trong khi zone là dữ liệu nền cho điểm danh cổng/an ninh. CLAUDE.md §17 liệt kê thay đổi cấu hình hệ thống thuộc nhóm cần audit.
  *Chi phí*: phải chuyển service sang dùng `DataSource`/`queryRunner` + tái dùng repository audit → tăng phạm vi UC-90. Nếu ưu tiên gọn, chốt "không audit" và ghi nợ.
  **KẾT LUẬN — CHỐT (KHÁC đề xuất agent): KHÔNG audit ở UC-90.** Lý do Thiếu Chủ: audit kéo UC-90 từ CRUD 1 bảng thành transaction + inject `DataSource` + repository audit, phình phạm vi cho UC đơn giản nhất. Thao tác thực sự cần audit là **UC-92 (xoá zone)**; làm audit 1 lần cho cả cụm zone lúc đó sạch hơn. Service dùng `@InjectRepository` thuần, **KHÔNG** `DataSource`/`queryRunner`. Ghi nợ ở §8.

- **OQ-9 — Base path + mã feature.** *Đề xuất*: route `POST /api/v1/zones` (plural noun, top-level — CLAUDE.md §7.3); mã feature **`ZNC-001`** (Zone Create), thư mục `spec/features/zones/uc90-create-zone/`.
  *Lý do*: ANPR đặt tiền tố theo nghiệp vụ + số thứ tự (`VPR-001` đăng ký, `VPM-001` quản lý, `VPL-001` list, `VUN-001` unknown, `VHI-001` history) → `ZNC-001` cho tạo zone, dành `ZNU/ZNL…` cho UC-91/93. Zone không nằm dưới `iot` nên **không** dùng `/api/v1/iot/zones`.
  *Cân nhắc*: nếu team muốn gom SAVP dưới 1 prefix (vd `/api/v1/savp/zones`) thì phải quyết ngay ở UC-90 vì UC-91→94 sẽ nối theo.
  **KẾT LUẬN — CHỐT: `POST /api/v1/zones`**, mã feature `ZNC-001`, thư mục `spec/features/zones/uc90-create-zone/`. **KHÔNG** prefix `/savp/`, **KHÔNG** đặt dưới `/iot/`.

## 8. Residuals / known-gaps

- **Trạng thái bảng `zones` giữa các môi trường**: theo thông tin từ Thiếu Chủ, bảng đã được tạo trên **RDS chung bằng SQL tay** và đã chèn bản ghi log vào `typeorm_migrations`; DB **local có thể chưa có bảng**. UC-90 **không** chạy migration (ràng buộc §2 của prompt) → trước khi code/test tích hợp phải xác nhận local đã có `zones` + 3 index, nếu chưa thì chạy `20260721000001` ở local (**không** chạy trên RDS).
- **Không có `created_by`/`updated_by` trên `zones`** + **UC-90 KHÔNG ghi `audit_logs`** (CHỐT OQ-8) ⇒ **thao tác tạo zone hiện không để lại dấu vết người thực hiện ở bất kỳ đâu**. Nợ này được chốt xử ở **UC-92 (xoá zone)**: làm audit 1 lần cho cả cụm zone. Thêm cột `created_by` sau = migration ALTER trên bảng đã áp production → nếu chọn hướng cột thay vì audit thì phải quyết trước UC-92.
- **Không có global exception filter**: error body chưa khớp CLAUDE.md §8.2 (thiếu `timestamp`/`path`) — nợ toàn hệ thống, không sửa trong UC-90 (CHỐT OQ-7.2).
- **Chưa có Swagger/OpenAPI**: nợ ENG-02 cho toàn bộ endpoint hiện có, gồm cả UC-90 (CHỐT OQ-7.4).
- **5 file `spec/global/` rỗng 0 byte** (`coding-standards`, `data-governance`, `security`, `system-arch`, `glossary`): nợ cấp nhóm, không xử trong UC-90 (CHỐT OQ-7.5).
- **`status` của zone chưa có UC quản lý**: DB default `'active'`, nhưng không endpoint nào đổi được cho tới UC-91. Giá trị hợp lệ của `status` (`active`/`inactive`/…?) **chưa được định nghĩa ở đâu** — cần chốt khi làm UC-91.
- **Chưa có UC xem zone (UC-93)**: sau UC-90, client **không có cách nào** lấy `id`/danh sách zone ngoài response lúc tạo. Nếu FE cần dropdown chọn zone thì UC-93 là phụ thuộc chặn, nên xếp ngay sau UC-90.
- **Quan hệ `zones` ↔ `rooms` chưa định nghĩa**: một phòng họp vừa là `rooms.id` vừa có thể là zone `zone_type='room'` — hiện **không** có FK/mapping nào nối 2 bảng. Nguy cơ dữ liệu song song lệch nhau khi FT-21 tính hiện diện. Cần 1 quyết định kiến trúc riêng (ngoài UC-90).
- **`metadata_json` chưa có schema**: là túi tự do; nếu FT-20/FT-21 định dùng để chứa cấu hình (ngưỡng đếm người, toạ độ cổng…) thì nên định nghĩa khoá chuẩn trước khi dữ liệu thật đổ vào.
- **Kiểm thử race `23505`**: khó tái hiện bằng unit test thuần → đề xuất mock repository ném lỗi có `driverError.code = '23505'` (mirror `isUniqueViolation` §0.5), không chạy test song song thật.

---

> **Spec ĐÃ DUYỆT**, OQ-1 → OQ-9 đã chốt (2026-07-22). Bước kế tiếp: [plan.md](./plan.md) (plan-only, chưa code, chưa `tasks.md`).
