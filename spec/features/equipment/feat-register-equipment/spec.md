# SPEC — UC-61: Đăng ký thiết bị họp mới (Register new meeting equipment)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec.md cho UC-61 (đăng ký thiết bị họp). Trạng thái [Missing]. | Toàn bộ file |

> Phạm vi: **CHỈ UC-61** — đăng ký (create) một thiết bị họp mới vào kho.
> KHÔNG bao gồm cập nhật lỗi (UC-62), xóa (UC-63), tìm kiếm (UC-64), phân bổ phòng (UC-65).
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code, plan, tasks.

---

## 0. Trạng thái khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. Module `equipment` hiện tại = STUB
Kết quả khảo sát `src/modules/equipment/`:

| Thành phần | Hiện trạng |
| :--- | :--- |
| `entities/equipment.entity.ts` | ✅ ĐÃ có `EquipmentEntity` (bảng `equipments`) đầy đủ field + 3 enum |
| `equipment.module.ts` | ⚠️ STUB — chỉ `TypeOrmModule.forFeature([EquipmentEntity])` + import `AccountsModule`, `RoomsModule`. KHÔNG có controller/service. |
| `controllers/` | ❌ KHÔNG tồn tại |
| `services/` | ❌ KHÔNG tồn tại |
| `dto/` | ❌ KHÔNG tồn tại |
| `repositories/` | ❌ KHÔNG tồn tại |

→ **UC-61 là [Missing]** và là **UC ĐẦU TIÊN của module** ⇒ phải thiết lập nền: `EquipmentController` + `EquipmentService` + DTO input/response + endpoint + RBAC permission + seed.

### 0.2. Pattern sẽ mirror: module `rooms`
UC-61 (tạo một resource tài sản) đồng dạng gần nhất với **`rooms` create room**. Sẽ **bám theo** (không phát minh pattern lạ):

- `RoomsController.create` (`src/modules/rooms/controllers/rooms.controller.ts`):
  - `@Post()` + `@HttpCode(201)` + `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('room.create')`.
  - `@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`.
  - Lấy `userId` qua `@CurrentUser()`, `@Ip()` cho audit, trả `{ success, message, data }`.
- `RoomsService.create` (`src/modules/rooms/services/rooms.service.ts`):
  - Normalize input (uppercase/trim code).
  - Check trùng bằng `ConflictException` (payload chuẩn `{ success, message, error: { code, details }, timestamp, path }`).
  - Tạo entity **trong transaction**; ghi `audit_logs` **NGOÀI transaction** (fail-separate: audit fail KHÔNG rollback bản ghi chính).
  - Trả về `CreateRoomResponseDto`.
- Seed permission bám `SeedIotDeviceReadPermission` / mục `room.create` trong `20260704000002-SeedCameraDomainRbacPermissions.ts`:
  - `INSERT INTO permissions (...) ON CONFLICT (permission_code) DO NOTHING RETURNING id`, rồi gán `role_permissions` theo `role_code`.

### 0.3. Cảnh báo phát hiện khi khảo sát (cần chốt — xem §11)
1. **KHÔNG tìm thấy migration tạo bảng `equipments`** trong `src/database/migrations/` (grep `equipments` → rỗng). Chỉ có `EquipmentEntity`. ⇒ Trước khi implement phải xác nhận bảng đã tồn tại trong DB thật (init migration ngoài phạm vi tìm kiếm, hoặc dev dùng `synchronize`). Theo luật CLAUDE.md, **UC-61 KHÔNG tạo/sửa migration**; nếu bảng chưa tồn tại thì đó là việc nền phải chốt riêng, ngoài scope UC-61.
2. **Entity KHÔNG khai `@Unique`** cho `serial_number` hay `equipment_code`. ⇒ Uniqueness (pre-condition UC-61) sẽ được đảm bảo ở **tầng application** (mirror cách `rooms` check trùng), chưa có unique index DB. DB partial unique index là follow-up cần migration → ngoài scope UC-61.
3. **`equipment_code` là NOT NULL, không default** trong entity, nhưng UC list ghi `equipmentCode` là "tùy chọn". Đây là mâu thuẫn phải chốt (xem §5.2 và §11).

---

## 1. Tổng quan Use Case

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Use Case ID** | UC-61 |
| **Use Case Name** | Đăng ký thiết bị họp mới (Register new meeting equipment) |
| **Module** | Equipment Management (`src/modules/equipment`) |
| **Primary Actor** | Business Admin (xác nhận RBAC: **Business Admin + System Admin** — xem §8) |
| **Trigger** | Admin thêm một thiết bị vật lý (màn hình / máy chiếu / loa / camera / mic...) vào kho hệ thống. |
| **Expected Output** | Thiết bị được lưu vào bảng `equipments` với `asset_status = available` (đã vào kho, chưa gán phòng); trả về bản ghi thiết bị vừa tạo. |
| **Pre-condition** | Người dùng đã đăng nhập, có quyền `equipment.create`; `serial_number` (nếu nhập) là duy nhất trong hệ thống. |
| **Related** | UC-58, UC-59 (cùng nhóm Equipment Management); UC-62 (cập nhật lỗi), UC-63 (xóa), UC-64 (tìm kiếm), UC-65 (phân bổ phòng) — KHÔNG thuộc UC-61. |

---

## 2. Actor & Điều kiện tiên quyết

### 2.1. Actor
- **Business Admin** — actor chính (theo UC list).
- **System Admin** — đề xuất bổ sung (mirror `room.create` role-set `['SYSTEM_ADMIN','BUSINESS_ADMIN']`; System Admin luôn là superset quản trị tài sản). Xem §8.

### 2.2. Pre-condition
- PRE-01: Actor đã xác thực (JWT hợp lệ) — `JwtAuthGuard`.
- PRE-02: Actor có permission `equipment.create` — `PermissionsGuard`.
- PRE-03: `serial_number` (nếu cung cấp) chưa tồn tại ở bất kỳ thiết bị nào (kể cả soft-deleted — mirror cách `rooms` check `withDeleted`).
- PRE-04: `equipment_code` (định danh nội bộ) không trùng thiết bị đang tồn tại.
- PRE-05 (nếu cho nhập `currentRoomId` — xem §10): room tồn tại và đang active.

---

## 3. Endpoint

```
POST /api/v1/equipments
```

| Thuộc tính | Giá trị |
| :--- | :--- |
| Method | `POST` |
| Path | `/api/v1/equipments` |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `equipment.create` |
| Success status | `201 Created` |
| Controller | `EquipmentController.create` (MỚI) |
| Service | `EquipmentService.create` (MỚI) |

Route dạng resource plural noun đúng convention CLAUDE.md §7.3 và trùng gợi ý §22.7 (`POST /api/v1/equipments`).

---

## 4. Main Flow (luồng chính)

1. Actor gửi `POST /api/v1/equipments` kèm body (`CreateEquipmentDto`).
2. `JwtAuthGuard` xác thực → lấy `currentUserId`. `PermissionsGuard` kiểm `equipment.create` (thiếu → 403).
3. `ValidationPipe` validate DTO (whitelist, forbidNonWhitelisted, transform). Sai → 400/422.
4. `EquipmentService.create`:
   1. Normalize input (trim; `equipmentCode` uppercase/trim nếu áp dụng — xem §5.2).
   2. Kiểm trùng `serial_number` (nếu có) → trùng ⇒ `409 EQUIPMENT_SERIAL_ALREADY_EXISTS`.
   3. Kiểm trùng `equipment_code` → trùng ⇒ `409 EQUIPMENT_CODE_ALREADY_EXISTS`.
   4. (Nếu áp dụng §10) validate `currentRoomId` tồn tại + active → sai ⇒ `422 ROOM_NOT_FOUND` / `ROOM_INACTIVE`.
   5. Tạo `EquipmentEntity` **trong transaction** với trạng thái khởi tạo (§6).
   6. Ghi `audit_logs` **NGOÀI transaction** (fail-separate) với `actionType`, `entityType='equipment'`, `entityId`, `newValueJson` (§9).
5. Trả `201` + `{ success: true, message, data: EquipmentResponseDto }`.

---

## 5. Input — `CreateEquipmentDto`

Bám **entity thật** `EquipmentEntity`. KHÔNG bịa field.

### 5.1. Bảng field

| Field (DTO) | Cột DB | Kiểu | Bắt buộc? | Ràng buộc validate |
| :--- | :--- | :--- | :--- | :--- |
| `equipmentName` | `equipment_name` | string(≤150) | **Bắt buộc** | `@IsString`, `@IsNotEmpty`, `@MaxLength(150)` |
| `equipmentType` | `equipment_type` | enum `EquipmentType` | **Bắt buộc** | `@IsEnum(EquipmentType)` — giá trị: `camera, microphone, display, speaker, capture_agent, sensor, other` |
| `equipmentCode` | `equipment_code` | string(≤80) | **Cần chốt** (§5.2) | `@IsString`, `@Length/@Matches` nếu bắt buộc; định dạng đề xuất `^[A-Z0-9]+(?:-[A-Z0-9]+)*$` (mirror `roomCode`) |
| `serialNumber` | `serial_number` | string(≤120) | Tùy chọn | `@IsOptional`, `@IsString`, `@MaxLength(120)` |
| `brand` | `brand` | string(≤100) | Tùy chọn | `@IsOptional`, `@IsString`, `@MaxLength(100)` |
| `model` | `model` | string(≤100) | Tùy chọn | `@IsOptional`, `@IsString`, `@MaxLength(100)` |
| `purchaseDate` | `purchase_date` | date (ISO `YYYY-MM-DD`) | Tùy chọn | `@IsOptional`, `@IsDateString` (không cho ngày tương lai — đề xuất) |
| `specification` | `specification_json` | object (jsonb) | Tùy chọn | `@IsOptional`, `@IsObject` |
| `healthStatus` | `health_status` | enum `HealthStatus` | Tùy chọn — cần chốt (§6.2) | `@IsOptional`, `@IsEnum(HealthStatus)` |
| `currentRoomId` | `current_room_id` | uuid | **Cần chốt** (§10) | `@IsOptional`, `@IsUUID` — chỉ nếu cho set lúc tạo |
| `iotDeviceId` | `iot_device_id` | uuid | Tùy chọn — cần chốt (§10) | `@IsOptional`, `@IsUUID` |

### 5.2. Chốt `equipmentCode` (mâu thuẫn entity vs UC list)
- Entity: `equipment_code` **NOT NULL, không default** ⇒ luôn phải có giá trị khi lưu.
- UC list: `equipmentCode` = "tùy chọn".
- **Đề xuất (khuyến nghị)**: `equipmentCode` **bắt buộc** trong DTO (mirror `roomCode` mandatory của `rooms`), format `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`, normalize uppercase+trim. Lý do: đơn giản, nhất quán với `rooms`, tránh sinh mã ngầm khó kiểm soát.
- **Phương án thay thế**: cho `equipmentCode` tùy chọn, service **auto-generate** nếu trống (vd `EQP-<random/sequence>`), đảm bảo unique. Phức tạp hơn, cần chốt format sinh mã.
- ⇒ Điểm cần chốt (§11).

### 5.3. Field KHÔNG nhận từ input (server tự set / thuộc UC khác)
KHÔNG cho client set các field sau ở UC-61 (whitelist DTO sẽ loại):
`assetStatus` (server set §6), `assignedBy`, `assignedAt`, `installedAt`, `assignmentNote` (UC-65 phân bổ phòng), `lastMaintenanceAt`, `lastIssueReportedAt`, `lastIssueNote` (UC-62 báo lỗi), `id`, `createdAt`, `updatedAt`, `deletedAt`.

---

## 6. Trạng thái khởi tạo

### 6.1. `asset_status`
- **`available`** (default entity). "Thêm vào kho" nghĩa là thiết bị sẵn sàng nhưng **chưa gán phòng** ⇒ `available`. Server luôn set cứng, không nhận từ input.

### 6.2. `health_status` — phân tích "trạng thái hoạt động tốt"
Expected Output UC ghi "trạng thái hoạt động tốt". Có 2 cách hiểu:

| Phương án | `health_status` | Lập luận |
| :--- | :--- | :--- |
| **A (khuyến nghị)** | `unknown` (default entity) | Thiết bị vừa đăng ký **chưa có tín hiệu telemetry/heartbeat** từ IoT để xác nhận sức khỏe thật. `unknown` là trung thực. "Hoạt động tốt" trong UC nên hiểu là `asset_status=available` (sẵn sàng dùng), không phải khẳng định health đã kiểm chứng. |
| **B** | `healthy` | Hiểu sát chữ "trạng thái hoạt động tốt" = admin xác nhận thiết bị mới còn tốt lúc nhập kho. |

- **Đề xuất**: mặc định **A (`unknown`)**, nhưng cho DTO **tùy chọn `healthStatus`** để admin chủ động set `healthy` nếu đã kiểm tra vật lý. Nếu team muốn mặc định `healthy`, chuyển sang B. ⇒ Điểm cần chốt (§11).

### 6.3. Các field còn lại lúc tạo
`currentRoomId = null` (nếu theo §10 phương án không cho set lúc tạo), `assignedBy/assignedAt/installedAt/assignmentNote = null`, `lastMaintenance*/lastIssue* = null`, `iotDeviceId = null` trừ khi cho nhập.

---

## 7. Uniqueness (pre-condition "serial number duy nhất")

| Field | Quy tắc | Xử lý trùng |
| :--- | :--- | :--- |
| `serial_number` | Duy nhất **nếu có giá trị** (nullable — nhiều thiết bị có thể `null` serial). Check tầng app, `withDeleted: true` (mirror `rooms`). | `409 EQUIPMENT_SERIAL_ALREADY_EXISTS` |
| `equipment_code` | Duy nhất (định danh nội bộ). Check tầng app, `withDeleted: true`. | `409 EQUIPMENT_CODE_ALREADY_EXISTS` |

- Không tự tạo unique index DB trong UC-61 (cần migration — ngoài scope). Đề xuất follow-up: **partial unique index** `UNIQUE (serial_number) WHERE serial_number IS NOT NULL` và `UNIQUE (equipment_code)` để chống race-condition ở tầng DB (ghi rõ là việc nền sau, cần migration).
- Lưu ý race-condition: check-then-insert ở tầng app có khe hở đồng thời; chấp nhận ở UC-61 (mirror `rooms` hiện cũng chỉ check app-level), khắc phục triệt để khi có unique index DB.

---

## 8. Permission / RBAC

### 8.1. Permission mới
Mirror `room.create` (mục trong `SeedCameraDomainRbacPermissions.ts`):

| Thuộc tính | Giá trị đề xuất |
| :--- | :--- |
| `permission_code` | `equipment.create` |
| `permission_name` | `Đăng ký thiết bị họp mới` |
| `module_code` | `equipment` *(cần chốt: `equipment` vs `equipments` — `rooms` dùng plural `rooms`; xem §11)* |
| `action_code` | `create` |
| `description` | `Cho phép đăng ký (tạo mới) thiết bị họp vào kho.` |
| `is_active` | `true` |

### 8.2. Gán role
- **Đề xuất `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']`** — **y hệt role-set `room.create`** (sibling resource tài sản).
- Actor chính UC là Business Admin; bổ sung System Admin theo chuẩn superset quản trị tài sản của dự án.
- Seed bám pattern `SeedIotDeviceReadPermission` (queryRunner + `ON CONFLICT DO NOTHING`, idempotent). **KHÔNG execute seed** trong UC-61 (dự án chưa wire seed-runner — ghi chú giống các seed hiện có).

---

## 9. Audit logging

Theo CLAUDE.md §17 (create tài sản là hành động quan trọng) và mirror `RoomsService.create`:

| Trường audit | Giá trị |
| :--- | :--- |
| `userId` | `currentUserId` |
| `actionType` | `create` *(theo convention `rooms`; UC gợi ý `EQUIPMENT_CREATE` — chốt §11)* |
| `entityType` | `equipment` |
| `entityId` | id thiết bị vừa tạo |
| `newValueJson` | `{ equipmentCode, equipmentName, equipmentType, serialNumber, assetStatus, healthStatus }` (KHÔNG log secret) |
| `ipAddress` | `@Ip()` (nullable) |
| `severity` | `INFO` |

- Ghi audit **NGOÀI transaction tạo thiết bị** (fail-separate) — audit lỗi KHÔNG rollback việc tạo thiết bị (mirror FR-019 của `rooms`).
- **Chốt `actionType`**: đề xuất theo convention hiện hành của `rooms` là `actionType='create'` + `entityType='equipment'` (thay vì `EQUIPMENT_CREATE` gộp) để đồng nhất toàn hệ thống. ⇒ §11.

---

## 10. Ranh giới UC-61 vs UC lân cận

| Việc | Thuộc UC | UC-61 làm? |
| :--- | :--- | :--- |
| Tạo bản ghi thiết bị (create) | **UC-61** | ✅ |
| Cập nhật lỗi / báo hỏng (`lastIssue*`, `health_status=faulty`) | UC-62 | ❌ |
| Xóa thiết bị (soft delete) | UC-63 | ❌ |
| Tìm kiếm / list / filter thiết bị | UC-64 | ❌ |
| Phân bổ thiết bị vào phòng (đổi `asset_status=assigned`, ghi `assigned_by/assigned_at/installed_at`) | UC-65 | ❌ |

### 10.1. Chốt: có cho set `currentRoomId` lúc tạo không?
- **Đề xuất (khuyến nghị) — Phương án A**: **KHÔNG** cho set `currentRoomId`/`iotDeviceId` ở UC-61. Thiết bị chỉ "nhập kho" (`available`, `current_room_id = null`). Toàn bộ logic gán phòng thuộc **UC-65**. Ranh giới sạch nhất, tránh trạng thái nửa vời.
- **Phương án B** (theo hướng gợi ý ban đầu): cho `currentRoomId` **tùy chọn** lúc tạo, chỉ lưu giá trị + validate room tồn tại/active, **nhưng KHÔNG** đổi `asset_status=assigned` và **KHÔNG** ghi `assigned_by/assigned_at` (đó là UC-65). Nhược điểm: sinh trạng thái mâu thuẫn (`current_room_id` có nhưng `asset_status=available`), UI/logic phân bổ phải xử lý ngoại lệ.
- ⇒ Điểm cần chốt (§11). Spec này mặc định trình bày theo **A**; nếu chọn B thì bổ sung validate `ROOM_NOT_FOUND`/`ROOM_INACTIVE` như §4.4.4.

---

## 11. Điểm cần chốt trước khi implement

| # | Vấn đề | Đề xuất |
| :--- | :--- | :--- |
| C1 | `equipmentCode` bắt buộc hay auto-generate? (entity NOT NULL vs UC "tùy chọn") | **Bắt buộc** trong DTO (mirror `roomCode`), format `^[A-Z0-9]+(?:-[A-Z0-9]+)*$` |
| C2 | `health_status` khởi tạo: `unknown` hay `healthy`? | **`unknown`** (default entity) + cho DTO tùy chọn set `healthy`; "hoạt động tốt" = `asset_status=available` |
| C3 | Có cho set `currentRoomId`/`iotDeviceId` lúc tạo? | **KHÔNG** (Phương án A) — để UC-65 |
| C4 | `module_code` permission: `equipment` hay `equipments`? | Theo `rooms` dùng plural ⇒ có thể `equipment`; cần khớp convention team |
| C5 | Role-set `equipment.create` | `['SYSTEM_ADMIN','BUSINESS_ADMIN']` (mirror `room.create`) |
| C6 | `audit_logs.actionType`: `create` hay `EQUIPMENT_CREATE`? | **`create`** + `entityType='equipment'` (đồng nhất convention `rooms`) |
| C7 | Bảng `equipments` đã tồn tại trong DB thật chưa? (không thấy migration tạo bảng) | Xác nhận trước khi implement; UC-61 KHÔNG tạo migration |
| C8 | Unique index DB cho `serial_number`/`equipment_code` | Follow-up (cần migration) — ngoài scope UC-61; UC-61 dùng check app-level |

---

## 12. Functional Requirements

- **FR-01**: Hệ thống cung cấp `POST /api/v1/equipments` để đăng ký thiết bị mới.
- **FR-02**: Chỉ user có permission `equipment.create` được gọi (nếu không → 403).
- **FR-03**: `equipmentName` và `equipmentType` là bắt buộc; `equipmentType` phải thuộc enum `EquipmentType`.
- **FR-04**: `serial_number` (nếu có) phải duy nhất toàn hệ thống (kể cả soft-deleted); trùng → 409.
- **FR-05**: `equipment_code` phải duy nhất; trùng → 409.
- **FR-06**: Thiết bị tạo mới có `asset_status = available`.
- **FR-07**: `health_status` khởi tạo theo §6.2 (chốt C2); nếu DTO có `healthStatus` hợp lệ thì dùng giá trị đó.
- **FR-08**: Ghi `audit_logs` cho hành động tạo (fail-separate, không rollback bản ghi chính).
- **FR-09**: Response trả bản ghi thiết bị vừa tạo theo format `{ success, message, data }`.
- **FR-10**: UC-61 KHÔNG thực hiện assign phòng, báo lỗi, xóa, hay tìm kiếm.

## 13. Non-Functional Requirements

- **NFR-01**: Tuân thủ TypeORM (không Prisma), UUID PK, `timestamptz`.
- **NFR-02**: DTO validate ở boundary (`whitelist`, `forbidNonWhitelisted`, `transform`).
- **NFR-03**: Không log secret/serial nhạy cảm ra log/audit vượt mức cần thiết.
- **NFR-04**: Không hard-code magic string — dùng enum `EquipmentType`/`AssetStatus`/`HealthStatus` sẵn có.
- **NFR-05**: Response error theo exception filter chuẩn (`{ success:false, message, error:{code,details}, timestamp, path }`).

## 14. Acceptance Criteria

- **AC-01**: `POST /api/v1/equipments` với `equipmentName` + `equipmentType` hợp lệ (+ `equipmentCode` theo C1) → `201`, `data.assetStatus='available'`, `data.id` là UUID.
- **AC-02**: Thiếu `equipmentName` hoặc `equipmentType` → `400/422`.
- **AC-03**: `equipmentType` ngoài enum → `422`.
- **AC-04**: `serial_number` trùng thiết bị đã có → `409 EQUIPMENT_SERIAL_ALREADY_EXISTS`.
- **AC-05**: `equipment_code` trùng → `409 EQUIPMENT_CODE_ALREADY_EXISTS`.
- **AC-06**: Không có permission `equipment.create` → `403`.
- **AC-07**: Chưa đăng nhập → `401`.
- **AC-08**: Tạo thành công ghi 1 dòng `audit_logs` (`entityType='equipment'`, `entityId` = id mới).
- **AC-09**: Field thuộc UC khác (`assignedBy`, `assetStatus`, ...) gửi trong body bị whitelist loại/hoặc reject `forbidNonWhitelisted`.

## 15. Exception / Alternative Flows

- **EC-01**: Serial trùng → 409, không tạo bản ghi.
- **EC-02**: equipment_code trùng → 409.
- **EC-03**: Validate DTO fail → 400/422.
- **EC-04**: (Nếu chọn Phương án B §10) `currentRoomId` không tồn tại/không active → 422 `ROOM_NOT_FOUND`/`ROOM_INACTIVE`.
- **EC-05**: Ghi `audit_logs` lỗi → log warning, KHÔNG rollback thiết bị (fail-separate).
- **EC-06**: (Chốt C7) Bảng `equipments` chưa tồn tại trong DB → lỗi hạ tầng, phải xử lý ở bước nền, không phải luồng nghiệp vụ UC-61.

---

## 16. [Missing] — Tóm tắt cần làm (KHÔNG thuộc spec này, để phục vụ plan/tasks sau)

**Trạng thái: [Missing]** — module `equipment` chưa có controller/service/dto; UC-61 phải tạo nền.

Danh mục sẽ triển khai (ở plan/tasks, KHÔNG làm trong spec này):
1. `EquipmentController` (mới) — `@Post()` create, guard + `@RequirePermissions('equipment.create')`.
2. `EquipmentService` (mới) — check trùng serial/code, tạo trong transaction, audit fail-separate.
3. `CreateEquipmentDto` + `EquipmentResponseDto` (mới).
4. Wire `EquipmentModule` — thêm `controllers`/`providers` (hiện chỉ có `TypeOrmModule.forFeature`).
5. Seed `equipment.create` (mới, KHÔNG execute) — mirror `SeedIotDeviceReadPermission`.
6. Test service (uniqueness, trạng thái khởi tạo, audit) + controller (RBAC, response shape).

**Điểm cần chốt trước khi code**: C1–C8 (§11) — đặc biệt: field bắt buộc `equipmentCode`, `healthStatus` khởi tạo, có set room lúc tạo không, `module_code`/role-set/`actionType` permission, và xác nhận bảng `equipments` tồn tại.

**Ranh giới**: UC-61 CHỈ create. KHÔNG UC-62 (báo lỗi) / UC-63 (xóa) / UC-64 (tìm kiếm) / UC-65 (phân bổ phòng). KHÔNG migration, KHÔNG execute seed, KHÔNG mutation ngoài create.
