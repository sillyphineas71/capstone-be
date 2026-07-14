# SPEC — UC-65: Phân bổ thiết bị vào phòng họp (Assign equipment to room)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec.md cho UC-65 (gán thiết bị vào phòng). Trạng thái [Missing]. | Toàn bộ file |

> Phạm vi: **CHỈ UC-65** — gán một thiết bị vào một phòng họp (ghi nhận `current_room_id`).
> KHÔNG bao gồm create (UC-61), báo lỗi (UC-62), xóa (UC-63), tìm kiếm (UC-64).
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code, plan, tasks.

---

## 0. Khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. Nền module `equipment` (sau UC-61/62/63/64)
| Thành phần | Hiện trạng |
| :--- | :--- |
| `entities/equipment.entity.ts` | ✅ `assetStatus` (enum `available/assigned/retired/lost/maintenance`), `currentRoomId` (uuid), `assignedBy` (uuid), `assignedAt` (timestamptz), `installedAt` (timestamptz), `assignmentNote` (text), `@DeleteDateColumn deletedAt`. |
| `services/equipment.service.ts` | ✅ `create` (UC-61), `reportFault` (UC-62), `deleteEquipment` (UC-63), `listEquipments` (UC-64). **Chưa có** assign. |
| `controllers/equipment.controller.ts` | ✅ `POST /`, `PATCH :id/fault`, `DELETE :id`, `GET /`. **Chưa có** assign. |
| `equipment.module.ts` | ✅ Wiring đủ; **import `RoomsModule`** (dòng 14). |
| Permission | `equipment.create`, `equipment.report_fault`, `equipment.delete`, `equipment.read`. |

→ **UC-65 = [Missing]**. Sẽ **THÊM method + endpoint** vào `EquipmentService`/`EquipmentController` sẵn có. **KHÔNG tạo service/controller mới**, **KHÔNG migration**.

### 0.2. RoomEntity thật (`rooms/entities/room.entity.ts`)
- `isActive` (boolean, default true).
- `currentStatus` (enum `RoomStatus`: `available/occupied/reserved/maintenance/inactive`).
- `@DeleteDateColumn deletedAt` (room có soft-delete).

### 0.3. Cross-module: đọc RoomEntity để validate (chỉ ĐỌC)
- `equipment.module` **đã import `RoomsModule`**; `RoomsModule.forFeature([RoomEntity, ...])` + `exports: [TypeOrmModule]` ⇒ `EquipmentService` **đọc được** RoomEntity qua:
  - **(khuyến nghị) `this.dataSource.getRepository(RoomEntity)`** — KHÔNG đổi constructor `EquipmentService`, an toàn nhất với test UC-61/62/63/64 hiện có; hoặc
  - `@InjectRepository(RoomEntity)` — thêm 1 tham số constructor (test cũ `new EquipmentService(repo, dataSource)` sẽ truyền `undefined` cho tham số 3, không dùng ⇒ vẫn chạy, nhưng đổi chữ ký).
- ⇒ Điểm cần chốt §11 (đề xuất `dataSource.getRepository`). **CHỈ ĐỌC** RoomEntity, **KHÔNG** sửa module rooms.

### 0.4. Mirror pattern
- **UC-62 `reportFault`**: Phase A validate (load/404/kiểm trạng thái) → Phase B transaction (update state) → Phase C audit **fail-separate**. UC-65 mirror cấu trúc này.
- **UC-61 `create`**: audit fail-separate + payload exception chuẩn.

---

## 1. Tổng quan Use Case

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Use Case ID** | UC-65 |
| **Use Case Name** | Phân bổ thiết bị vào phòng họp (Assign equipment to room) |
| **Module** | Equipment Management (`src/modules/equipment`) |
| **Primary Actor** | Business Admin (xác nhận RBAC — §8) |
| **Trigger** | Admin gán một thiết bị vào một phòng họp. |
| **Expected Output** | Vị trí thiết bị được ghi nhận tại phòng: `current_room_id = roomId`, `asset_status = assigned`, kèm `assigned_by/assigned_at`. |
| **Pre-condition** | Thiết bị và phòng tồn tại; actor có quyền. |
| **Related** | UC-57 (cùng nhóm Equipment Management); UC-61/62/63/64 — KHÔNG thuộc UC-65. |

---

## 2. Actor & Pre-condition

### 2.1. Actor
- **Business Admin** — actor chính.
- **System Admin** — đề xuất bổ sung (mirror `equipment.create`/`delete` role-set). Gán tài sản là **admin-level** ⇒ **KHÔNG** cấp Manager/Internal User. §8.

### 2.2. Pre-condition
- PRE-01: Actor đã xác thực (JWT) — `JwtAuthGuard`.
- PRE-02: Actor có permission `equipment.assign` — `PermissionsGuard`.
- PRE-03: Thiết bị tồn tại (`deletedAt IS NULL`) → 404 nếu không.
- PRE-04: Phòng tồn tại (`deletedAt IS NULL`) → 404 nếu không.
- PRE-05: Phòng ở trạng thái nhận được thiết bị (§7.2).
- PRE-06: Thiết bị ở trạng thái cho phép gán (§7.3).

---

## 3. Endpoint

```
PATCH /api/v1/equipments/:equipmentId/assignment
```

| Thuộc tính | Giá trị |
| :--- | :--- |
| Method | `PATCH` (cập nhật assignment của thiết bị) |
| Path | `/api/v1/equipments/:equipmentId/assignment` (`ParseUUIDPipe`) |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `equipment.assign` |
| Success status | `200` |
| Handler | `EquipmentController.assignToRoom` (THÊM) |
| Service | `EquipmentService.assignToRoom` (THÊM) |

### 3.1. Tên endpoint (cần chốt §11)
- **`/assignment`** (khuyến nghị): noun rõ nghĩa "gán/assignment của thiết bị"; đối xứng cho un-assign tương lai (DELETE `:id/assignment`).
- Thay thế: `/assign-room`, `/room`. `/assign-room` là verb (kém REST); `/room` mơ hồ.
- Route tĩnh `:equipmentId/assignment` phân biệt với `:equipmentId/fault` (UC-62) ⇒ không collision.

---

## 4. Input — `AssignEquipmentDto`

| Field (DTO) | Cột DB | Kiểu | Bắt buộc? | Validate |
| :--- | :--- | :--- | :--- | :--- |
| `roomId` | `current_room_id` | uuid | **Bắt buộc** | `@IsUUID('4')` |
| `installedAt?` | `installed_at` | date/timestamp | Tùy chọn | `@IsOptional`, `@IsISO8601` (hoặc `@IsDateString`) |
| `assignmentNote?` | `assignment_note` | text | Tùy chọn | `@IsOptional`, `@IsString`, `@MaxLength(2000)` |

- DTO KHÔNG nhận field khác (`currentRoomId/assetStatus/assignedBy/...`) → `forbidNonWhitelisted` reject.

---

## 5. Main Flow

1. Actor gửi `PATCH /api/v1/equipments/:equipmentId/assignment` + `AssignEquipmentDto`.
2. `JwtAuthGuard` → `currentUserId`; `PermissionsGuard` kiểm `equipment.assign` (thiếu → 403).
3. `ValidationPipe` validate DTO (roomId uuid, installedAt, note).
4. `EquipmentService.assignToRoom(equipmentId, dto, userId, ipAddress)`:
   1. **Phase A — validate (READ)**:
      - Load equipment (`findOne({ id, deletedAt: IsNull() })`) → 404 `EQUIPMENT_NOT_FOUND`.
      - Kiểm thiết bị cho phép gán (§7.3) → 409 `EQUIPMENT_NOT_ASSIGNABLE`.
      - Load room (`getRepository(RoomEntity).findOne({ id: dto.roomId, deletedAt: IsNull() })`) → 404 `ROOM_NOT_FOUND`.
      - Kiểm phòng nhận được thiết bị (§7.2) → 409 `ROOM_NOT_ASSIGNABLE`.
      - Snapshot `oldValue = { currentRoomId, assetStatus }`.
   2. **Phase B — transaction (update)**:
      - `currentRoomId = dto.roomId`, `assetStatus = ASSIGNED`, `assignedBy = userId`, `assignedAt = now`, `installedAt = §6`, `assignmentNote = dto.assignmentNote ?? null`.
   3. **Phase C — audit fail-separate** (§9).
5. Trả `200` + `{ success, message, data: EquipmentResponseDto }`.

---

## 6. Cơ chế gán & giá trị field

| Field | Giá trị khi gán |
| :--- | :--- |
| `currentRoomId` | `dto.roomId` |
| `assetStatus` | `AssetStatus.ASSIGNED` (server set cứng) |
| `assignedBy` | `currentUserId` |
| `assignedAt` | `now` (server) |
| `installedAt` | **§6.1 (cần chốt)** |
| `assignmentNote` | `dto.assignmentNote ?? null` |

### 6.1. `installedAt` mặc định (cần chốt §11)
- Ngữ nghĩa: thời điểm thiết bị **được lắp đặt vật lý** tại phòng.
- **Đề xuất**: `installedAt = dto.installedAt ?? now` — coi "gán = đã/đang lắp" nếu admin không nhập cụ thể.
- Thay thế: `installedAt = dto.installedAt ?? null` (giữ null nếu chưa lắp thực tế — tách "gán logic" khỏi "lắp vật lý").
- ⇒ Đề xuất mặc định `now`; nếu team phân biệt gán vs lắp thì để `null`. Điểm cần chốt.

---

## 7. Ràng buộc validate (UC nặng)

### 7.1. Tồn tại
- Thiết bị `deletedAt IS NULL` → 404 `EQUIPMENT_NOT_FOUND`.
- Phòng `deletedAt IS NULL` → 404 `ROOM_NOT_FOUND`.

### 7.2. Phòng nhận được thiết bị (cần chốt §11)
RoomEntity có `isActive` + `currentStatus`. Đề xuất điều kiện assignable:

| Phương án | Điều kiện | Phân tích |
| :--- | :--- | :--- |
| **A (khuyến nghị)** | `isActive = true` **AND** `currentStatus != inactive` | Chặn phòng đã ngừng hoạt động (`isActive=false`) hoặc `inactive`. **KHÔNG** chặn `occupied/reserved/maintenance` — các trạng thái này là realtime meeting/bảo trì phòng, không cản việc **lắp đặt tài sản vật lý**. |
| B | `isActive = true` AND `currentStatus IN (available)` | Chặt hơn — chỉ gán khi phòng rảnh. Nhược điểm: không lắp được thiết bị khi phòng đang có lịch/bảo trì (bất tiện thực tế). |

- Vi phạm → 409 `ROOM_NOT_ASSIGNABLE`.
- Đề xuất **A**. ⇒ Điểm cần chốt.

### 7.3. Trạng thái thiết bị cho phép gán (cần chốt §11)
| `assetStatus` | Gán được? | Lý do |
| :--- | :--- | :--- |
| `available` | ✅ | Sẵn sàng gán. |
| `assigned` | ✅ | Cho **re-assign** (đổi phòng — §7.4). |
| `maintenance` | ❌ (đề xuất chặn) | Thiết bị đang bảo trì/hỏng, không nên đưa vào sử dụng. Phải phục hồi (`available`) trước. |
| `retired` | ❌ | Đã thanh lý. |
| `lost` | ❌ | Đã mất. |

- Thiết bị `retired/lost/maintenance` → 409 `EQUIPMENT_NOT_ASSIGNABLE`.
- (Nếu team muốn cho gán `maintenance` — vd lắp sẵn chờ sửa tại chỗ — chuyển sang cho phép. Đề xuất **chặn** `maintenance`.) ⇒ Điểm cần chốt.

### 7.4. Re-assign sang phòng khác (thiết bị đang `assigned` phòng A → gán phòng B) (cần chốt §11)
- **Đề xuất — cho phép re-assign**: ghi đè `currentRoomId = B`, `assignedAt = now`, `assignedBy` mới. Không cần "gỡ phòng A" thủ công (gán mới thay thế). Đơn giản, đúng thực tế di dời thiết bị.
- Thay thế: chặn (yêu cầu un-assign phòng A trước) → cần UC un-assign (chưa có). Không khuyến nghị.
- ⇒ Đề xuất **cho phép**. Điểm cần chốt.

### 7.5. Gán vào đúng phòng đang ở (`roomId == currentRoomId` hiện tại) (cần chốt §11)
- **Đề xuất — cập nhật lại** (refresh `assignedAt`, `assignedBy`, `assignmentNote`, `installedAt`): coi như thao tác xác nhận/cập nhật ghi chú. Idempotent về kết quả `currentRoomId`.
- Thay thế: no-op (trả nguyên trạng). 
- ⇒ Đề xuất **cập nhật lại** (đơn giản, không cần nhánh đặc biệt). Điểm cần chốt.

---

## 8. Permission / RBAC

| Thuộc tính | Giá trị đề xuất |
| :--- | :--- |
| `permission_code` | `equipment.assign` |
| `permission_name` | `Phân bổ thiết bị vào phòng` |
| `module_code` | `equipment` |
| `action_code` | `assign` |
| roles | `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (mirror `equipment.create`/`delete`; **KHÔNG** Manager/Internal — gán tài sản là admin-level) |

Seed mirror `SeedEquipmentCreatePermission`. **KHÔNG execute**.

---

## 9. Audit logging (kiểu ghi — cần chốt §11)

Gán tài sản là hành động quan trọng (CLAUDE.md §17) → **PHẢI** ghi `audit_logs`:

| Trường | Giá trị |
| :--- | :--- |
| `userId` | `currentUserId` |
| `actionType` | `update` *(hoặc `assign`; đề xuất `update` đồng nhất UC-62/63)* |
| `entityType` | `equipment` |
| `entityId` | `equipmentId` |
| `oldValueJson` | `{ currentRoomId, assetStatus }` (trước) |
| `newValueJson` | `{ currentRoomId, assetStatus, assignedBy, assignedAt }` (sau) |
| `ipAddress` | `@Ip()` |
| `severity` | `INFO` (gán không phá hủy — khác `delete` WARNING) |

**Kiểu ghi**: đề xuất **fail-separate** (mirror UC-61/62 — audit lỗi KHÔNG rollback gán). Lý do: gán **không phá hủy** dữ liệu (khác `delete` dùng atomic). ⇒ Điểm cần chốt §11.

---

## 10. Ranh giới UC-65 vs UC lân cận

| Việc | Thuộc UC | UC-65 làm? |
| :--- | :--- | :--- |
| Gán thiết bị vào phòng (`current_room_id`, `assigned`, `assigned_*`) — thiết bị **vẫn active** | **UC-65** | ✅ |
| Tạo/báo lỗi/xóa/tìm kiếm | UC-61/62/63/64 | ❌ |
| **Gỡ khỏi phòng (un-assign)**: set `current_room_id=null`, `assetStatus=available`, giữ thiết bị active | **UC khác/future** (KHÔNG phải UC-65) | ❌ |
| Gỡ tham chiếu phòng **vì XÓA** (`delete` + un-reference) | UC-63 | ❌ |

**Làm rõ**:
- **UC-65** gán vào phòng — thiết bị **vẫn active**, `assetStatus=assigned`.
- **UC-63** gỡ `current_room_id` **vì xóa** (terminal, `deleted_at` set, `retired`).
- **Un-assign chủ động** (gỡ khỏi phòng nhưng giữ thiết bị active, về `available`) — UC list UC-65 chỉ nói "gán" ⇒ **KHÔNG** thuộc UC-65; là UC riêng tương lai (`DELETE :id/assignment`). Nêu rõ để không gộp.

---

## 11. Điểm cần chốt

| # | Vấn đề | Đề xuất |
| :--- | :--- | :--- |
| C1 | Tên endpoint | `PATCH :equipmentId/assignment` |
| C2 | Cách đọc RoomEntity | `dataSource.getRepository(RoomEntity)` (không đổi constructor) |
| C3 | `installedAt` mặc định | `dto.installedAt ?? now` |
| C4 | Điều kiện phòng assignable | `isActive=true` AND `currentStatus != inactive` (Phương án A) |
| C5 | Trạng thái thiết bị cho gán | `available`/`assigned` OK; chặn `retired/lost/maintenance` |
| C6 | Re-assign sang phòng khác | **Cho phép** (ghi đè + assignedAt mới) |
| C7 | Gán đúng phòng đang ở | **Cập nhật lại** (refresh assignedAt/note) |
| C8 | Audit kiểu ghi | **fail-separate** (gán không phá hủy) |
| C9 | `actionType` | `update` (đồng nhất) |
| C10 | Role-set | `[SYSTEM_ADMIN, BUSINESS_ADMIN]` |
| C11 | Un-assign trong UC-65? | **KHÔNG** (UC riêng future) |

---

## 12. Functional Requirements

- **FR-01**: Cung cấp `PATCH /api/v1/equipments/:equipmentId/assignment` để gán thiết bị vào phòng.
- **FR-02**: Chỉ user có permission `equipment.assign` được gọi (thiếu → 403).
- **FR-03**: `roomId` bắt buộc, uuid hợp lệ.
- **FR-04**: Thiết bị không tồn tại → 404 `EQUIPMENT_NOT_FOUND`.
- **FR-05**: Phòng không tồn tại → 404 `ROOM_NOT_FOUND`.
- **FR-06**: Phòng không nhận được thiết bị (§7.2) → 409 `ROOM_NOT_ASSIGNABLE`.
- **FR-07**: Thiết bị `retired/lost/maintenance` → 409 `EQUIPMENT_NOT_ASSIGNABLE`.
- **FR-08**: Gán set `currentRoomId=roomId`, `assetStatus=assigned`, `assignedBy=currentUser`, `assignedAt=now`, `installedAt` (§6.1), `assignmentNote`.
- **FR-09**: Cho re-assign sang phòng khác (ghi đè).
- **FR-10**: Ghi `audit_logs` (fail-separate) với old/new.
- **FR-11**: Trả bản ghi thiết bị sau gán (`EquipmentResponseDto`).
- **FR-12**: UC-65 CHỈ gán — KHÔNG un-assign, KHÔNG create/báo lỗi/xóa/tìm kiếm.

## 13. Non-Functional Requirements

- **NFR-01**: TypeORM; transaction cho update; audit fail-separate.
- **NFR-02**: DTO validate ở boundary (whitelist/forbidNonWhitelisted/transform).
- **NFR-03**: Dùng enum `AssetStatus`/`RoomStatus` sẵn có, không magic string.
- **NFR-04**: Cross-module RoomEntity **chỉ ĐỌC** — KHÔNG sửa module rooms.
- **NFR-05**: Chỉ THÊM vào service/controller (không sửa `create`/`reportFault`/`deleteEquipment`/`listEquipments`).

## 14. Acceptance Criteria

- **AC-01**: PATCH gán thiết bị `available` vào phòng active → 200, `data.currentRoomId=roomId`, `data.assetStatus='assigned'`; `assignedBy/assignedAt` được set.
- **AC-02**: Thiết bị không tồn tại → 404 `EQUIPMENT_NOT_FOUND`.
- **AC-03**: Phòng không tồn tại → 404 `ROOM_NOT_FOUND`.
- **AC-04**: Phòng `isActive=false` / `currentStatus=inactive` → 409 `ROOM_NOT_ASSIGNABLE`.
- **AC-05**: Thiết bị `retired`/`lost`/`maintenance` → 409 `EQUIPMENT_NOT_ASSIGNABLE`.
- **AC-06**: Thiết bị đang `assigned` phòng A → gán phòng B → 200, `currentRoomId=B`, `assignedAt` mới.
- **AC-07**: `roomId` không uuid / thiếu → 400.
- **AC-08**: Thiếu permission → 403; chưa đăng nhập → 401.
- **AC-09**: Ghi 1 dòng `audit_logs` (`entityType='equipment'`, old/new có `currentRoomId`,`assetStatus`).

## 15. Exception / Alternative Flows

- **EC-01**: 404 thiết bị/phòng không tồn tại.
- **EC-02**: 409 `ROOM_NOT_ASSIGNABLE` (phòng không active).
- **EC-03**: 409 `EQUIPMENT_NOT_ASSIGNABLE` (thiết bị retired/lost/maintenance).
- **EC-04**: 400 DTO sai (roomId/installedAt/note).
- **EC-05**: Audit ghi lỗi → log warning, KHÔNG rollback gán (fail-separate).

---

## 16. [Missing] — Tóm tắt cần làm

**Trạng thái: [Missing]** — module `equipment` có create/reportFault/delete/list; chưa có assign.

Danh mục triển khai (ở plan/tasks sau, KHÔNG làm trong spec này):
1. TẠO `AssignEquipmentDto` (`roomId` bắt buộc + `installedAt?` + `assignmentNote?`).
2. THÊM `EquipmentService.assignToRoom(equipmentId, dto, userId, ip)` — Phase A validate (equipment 404 → equipment-assignable 409 → room 404 via `dataSource.getRepository(RoomEntity)` → room-assignable 409 → snapshot) → Phase B transaction (set 6 field) → Phase C audit fail-separate. KHÔNG sửa method cũ.
3. THÊM `EquipmentController.assignToRoom` — `PATCH :equipmentId/assignment`, guard + `@RequirePermissions('equipment.assign')` + ValidationPipe.
4. TẠO seed `equipment.assign` (KHÔNG execute) — role `[SYSTEM_ADMIN,BUSINESS_ADMIN]`.
5. Tái dùng `EquipmentResponseDto`.
6. Test service (gán OK + set field, 404 equipment/room, room không active 409, equipment retired/lost/maintenance 409, re-assign phòng khác, audit fail-separate, đọc RoomEntity qua getRepository) + controller (RBAC, response).

**Điểm cần chốt trước khi code**: C1–C11 (§11) — đặc biệt: điều kiện phòng assignable (C4), trạng thái thiết bị cho gán (C5), re-assign phòng khác (C6), `installedAt` mặc định (C3), audit fail-separate (C8), cách đọc RoomEntity (C2), un-assign KHÔNG thuộc UC-65 (C11).

**Ranh giới**: UC-65 CHỈ gán (thiết bị vẫn active). KHÔNG un-assign, KHÔNG create/báo lỗi/xóa/tìm kiếm. Cross-module RoomEntity chỉ ĐỌC. KHÔNG migration, KHÔNG execute seed, KHÔNG sửa method cũ/module rooms.
