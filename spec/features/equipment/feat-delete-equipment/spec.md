# SPEC — UC-63: Xóa thiết bị (Delete equipment — soft delete)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec.md cho UC-63 (xóa mềm thiết bị + gỡ tham chiếu phòng). Trạng thái [Missing]. | Toàn bộ file |

> Phạm vi: **CHỈ UC-63** — xóa **mềm** (soft-delete) một thiết bị và gỡ tham chiếu phòng.
> KHÔNG bao gồm create (UC-61), báo lỗi (UC-62), tìm kiếm (UC-64), phân bổ phòng (UC-65).
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code, plan, tasks.

---

## 0. Khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. Luật soft-delete — DATA-01
`spec/global/constitution.md:28-29` (**DATA-01 — Không xóa dữ liệu vĩnh viễn**): "THE system SHALL dùng soft-delete (`deleted_at`) thay vì hard-delete cho mọi entity business-critical."
⇒ UC-63 **BẮT BUỘC soft-delete**, **CẤM hard-delete** thiết bị.

### 0.2. Nền module `equipment` (sau UC-61 + UC-62)
| Thành phần | Hiện trạng |
| :--- | :--- |
| `entities/equipment.entity.ts` | ✅ Có `@DeleteDateColumn deletedAt` (soft-delete được); field `currentRoomId`, `assetStatus`, `assignedBy`, `assignedAt`, `installedAt`, `assignmentNote`, `iotDeviceId`. |
| `services/equipment.service.ts` | ✅ `EquipmentService` với `create` (UC-61) + `reportFault` (UC-62). **Chưa có** delete. |
| `controllers/equipment.controller.ts` | ✅ `POST /equipments` + `PATCH :equipmentId/fault`. **Chưa có** DELETE. |
| `equipment.module.ts` | ✅ Wiring đủ (`AuthModule`, `JwtModule`, controllers, providers). |
| Permission | `equipment.create`, `equipment.report_fault`. |

→ **UC-63 = [Missing]**. Sẽ **THÊM method + endpoint** vào `EquipmentService`/`EquipmentController` sẵn có. **KHÔNG tạo service/controller mới**, **KHÔNG migration** (entity đã có `deletedAt`).

### 0.3. Khảo sát ràng buộc tham chiếu (schema thật)
- **`iot_devices.equipment_id`** (`iot/entities/iot-device.entity.ts:55-56,122-124`): FK `@ManyToOne(() => EquipmentEntity, { onDelete: 'SET NULL' })`, **nullable** — một iot_device có thể trỏ tới equipment này (chiều ngược).
  - `onDelete: SET NULL` chỉ kích hoạt khi **hard-delete** ở DB; với **soft-delete** (chỉ set `deleted_at`), FK này **không** tự null. ⇒ Sau soft-delete equipment, `iot_devices.equipment_id` vẫn trỏ tới bản ghi (đã ẩn). Cách xử lý → §7.3 (đề xuất KHÔNG đụng — ngoài scope).
- **KHÔNG** có FK trực tiếp từ `meetings`/`room_bookings`/`recording_*`/`capture_*` tới `equipments` (grep toàn `*.entity.ts`). ⇒ Không có ràng buộc "đang dùng trong cuộc họp" cấp schema để chặn xóa.

### 0.4. Mirror pattern
- **UC-10 `deleteUser`** (`accounts/services/users.service.ts:576-779`): **soft-delete pattern** — Phase A validate (READ ngoài transaction: load `deletedAt: IsNull()` → 404; gom dependencies → 409 `*_HAS_DEPENDENCIES`) → Phase B transaction (`tem.softDelete(...)` + update liên quan + audit).
- **UC-61 `create`** (`equipment/services/equipment.service.ts:85-186`): audit **fail-separate** (transaction riêng, try/catch, không rollback).
  - ⚠️ **Khác biệt cần chốt (§9)**: `deleteUser` để audit **atomic trong cùng transaction** (`:744-762`); UC-61/62 để audit **fail-separate**. UC-63 chọn 1 kiểu — đề xuất §9.

---

## 1. Tổng quan Use Case

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Use Case ID** | UC-63 |
| **Use Case Name** | Xóa thiết bị (soft delete) |
| **Module** | Equipment Management (`src/modules/equipment`) |
| **Primary Actor** | Business Admin (xác nhận RBAC — §8) |
| **Trigger** | Admin gỡ thiết bị hỏng khỏi hệ thống. |
| **Expected Output** | Thiết bị bị **loại khỏi danh mục** (soft-delete, `deleted_at` được set) và **gỡ tham chiếu phòng** (`current_room_id=null`, clear `assigned_*`). |
| **Pre-condition** | Thiết bị tồn tại (chưa soft-delete). |
| **Related** | UC-57 (cùng nhóm Equipment Management); UC-61/62/64/65 — KHÔNG thuộc UC-63. |

---

## 2. Actor & Pre-condition

### 2.1. Actor
- **Business Admin** — actor chính (theo UC list).
- **System Admin** — đề xuất bổ sung (mirror `equipment.create` role-set `[SYSTEM_ADMIN, BUSINESS_ADMIN]`; System Admin là superset quản trị tài sản). Xóa là hành động admin-level ⇒ **KHÔNG** cấp cho Internal User/Manager. §8.

### 2.2. Pre-condition
- PRE-01: Actor đã xác thực (JWT) — `JwtAuthGuard`.
- PRE-02: Actor có permission `equipment.delete` — `PermissionsGuard`.
- PRE-03: Thiết bị tồn tại và **chưa** soft-delete (`deletedAt IS NULL`) → không có ⇒ 404.

---

## 3. Endpoint

```
DELETE /api/v1/equipments/:equipmentId
```

| Thuộc tính | Giá trị |
| :--- | :--- |
| Method | `DELETE` |
| Path | `/api/v1/equipments/:equipmentId` (`ParseUUIDPipe`) |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `equipment.delete` |
| Success status | **200** (đề xuất — §3.1) |
| Handler | `EquipmentController.deleteEquipment` (THÊM) |
| Service | `EquipmentService.deleteEquipment` (THÊM) |

### 3.1. Response 200 vs 204 (cần chốt §11)
- **Đề xuất 200** `{ success:true, message:'Xoa thiet bi thanh cong' }` (data có thể bỏ hoặc trả snapshot tối thiểu) — nhất quán với envelope `{success,message,data}` của module (CLAUDE.md §8) và với `deleteUser`/`deleteRoom` (trả message).
- **204 No Content**: gọn nhưng mất envelope thống nhất; không khuyến nghị cho dự án này (§8.3 CLAUDE.md map 200 cho "xóa mềm thành công").
- ⇒ Đề xuất **200 + `{success,message}`** (không cần `data`); nếu team muốn `data`, trả snapshot đã cập nhật.

---

## 4. Main Flow

1. Actor gửi `DELETE /api/v1/equipments/:equipmentId`.
2. `JwtAuthGuard` → `currentUserId`; `PermissionsGuard` kiểm `equipment.delete` (thiếu → 403).
3. `EquipmentService.deleteEquipment(equipmentId, userId, ipAddress)`:
   - **Phase A — validate (READ)**:
     1. Load `findOne({ where:{ id, deletedAt: IsNull() } })` → không có ⇒ 404 `EQUIPMENT_NOT_FOUND` (bao gồm trường hợp đã soft-delete → idempotent §6).
     2. (Nếu chốt chặn — §7.2) kiểm ràng buộc nghiệp vụ → 409 nếu vi phạm. *(Đề xuất: KHÔNG chặn — cho xóa + gỡ tham chiếu.)*
     3. Snapshot `oldValue` (thông tin thiết bị) cho audit.
   - **Phase B — transaction (atomic)**:
     1. **Gỡ tham chiếu phòng**: `UPDATE` set `currentRoomId=null`, `assignedBy=null`, `assignedAt=null`, `installedAt=null`, `assignmentNote=null`; `assetStatus` → §5.2 (đề xuất `retired`).
     2. **Soft-delete**: `softDelete(EquipmentEntity, equipmentId)` (set `deleted_at`).
     3. Audit (§9).
4. Trả **200** `{ success, message }`.

---

## 5. Cơ chế xóa & "gỡ tham chiếu phòng"

### 5.1. Soft-delete (DATA-01)
- Dùng `softDelete` / set `deleted_at = now`. **KHÔNG** `delete`/`remove` cứng.
- Sau soft-delete, thiết bị **không** xuất hiện ở query mặc định (`@DeleteDateColumn` tự lọc).

### 5.2. "Gỡ tham chiếu phòng" (Expected Output) + `asset_status` sau xóa (cần chốt §11)
Expected Output yêu cầu "gỡ tham chiếu phòng" ⇒ **phải** set `current_room_id = null` và clear `assigned_by/assigned_at/installed_at/assignment_note` trong cùng transaction trước/cùng lúc soft-delete.

`asset_status` sau xóa — 3 phương án:

| Phương án | `asset_status` | Phân tích |
| :--- | :--- | :--- |
| **A (khuyến nghị)** | `retired` | "Admin gỡ **thiết bị hỏng**" + "loại khỏi danh mục" ⇒ ngừng sử dụng vĩnh viễn = `retired`. Nhất quán ngữ nghĩa; nếu sau này query `withDeleted` vẫn thấy trạng thái đúng. |
| B | Giữ nguyên | Chỉ soft-delete, không đổi status. Đơn giản nhưng bản ghi ẩn có thể còn `assigned` mâu thuẫn với `current_room_id=null`. |
| C | `available` | Sai ngữ nghĩa (thiết bị đã xóa không "sẵn sàng"). Loại. |

→ Đề xuất **A (`retired`)** + clear room refs, rồi `softDelete`. ⇒ Điểm cần chốt §11.

---

## 6. Idempotent
- Thiết bị **đã** soft-delete → `findOne({deletedAt: IsNull()})` trả null → **404 `EQUIPMENT_NOT_FOUND`** (không "xóa lại"). Mirror `deleteUser` (`where:{id, deletedAt: IsNull()}`).

---

## 7. Ràng buộc xóa

### 7.1. Không có FK cứng chặn (khảo sát §0.3)
Không entity nào (meetings/recording/capture) tham chiếu FK trực tiếp tới `equipments`. ⇒ Không có ràng buộc schema bắt buộc chặn.

### 7.2. Có chặn xóa thiết bị đang `assigned`/đang dùng không? (cần chốt §11)
| Phương án | Hành vi |
| :--- | :--- |
| **A (khuyến nghị)** | **KHÔNG chặn** — cho xóa mọi thiết bị (kể cả `assigned`), đồng thời gỡ tham chiếu phòng. Đúng Expected Output "gỡ tham chiếu phòng". Admin gỡ thiết bị hỏng không nên bị chặn bởi việc nó đang lắp ở phòng. |
| B | Chặn nếu `assetStatus=assigned` → 409 `EQUIPMENT_IN_USE`, yêu cầu gỡ khỏi phòng (UC-65) trước. An toàn hơn nhưng mâu thuẫn Expected Output; thêm bước thủ công. |

→ Đề xuất **A** (không chặn, gỡ tham chiếu). Không có tín hiệu "đang dùng trong meeting đang diễn ra" ở schema để chặn (không FK equipment→meeting). ⇒ Điểm cần chốt §11.

### 7.3. Tham chiếu ngược `iot_devices.equipment_id` (cần chốt §11)
- Sau soft-delete, `iot_devices.equipment_id` có thể vẫn trỏ tới thiết bị đã ẩn (`onDelete: SET NULL` không kích hoạt với soft-delete).
- **Đề xuất KHÔNG đụng** trong UC-63 (ngoài scope; cột nullable, dangling ref tới bản ghi soft-deleted chấp nhận được; việc dọn map iot_device↔equipment thuộc module `iot`). Ghi nhận để UC iot xử lý nếu cần.

---

## 8. Permission / RBAC

| Thuộc tính | Giá trị đề xuất |
| :--- | :--- |
| `permission_code` | `equipment.delete` |
| `permission_name` | `Xóa thiết bị` |
| `module_code` | `equipment` |
| `action_code` | `delete` |
| roles | `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (mirror `equipment.create`; **KHÔNG** cấp Internal User/Manager — xóa là hành động phá hủy) |

Seed mirror `SeedEquipmentCreatePermission` (queryRunner + `ON CONFLICT DO NOTHING`). **KHÔNG execute**.

---

## 9. Audit logging (điểm cần chốt kiểu ghi)

Xóa tài sản là hành động quan trọng (CLAUDE.md §17, DATA-01) → **PHẢI** ghi `audit_logs`:

| Trường | Giá trị |
| :--- | :--- |
| `userId` | `currentUserId` |
| `actionType` | `delete` *(hoặc `EQUIPMENT_DELETE` như style `deleteUser` dùng `ACCOUNT_DELETE`; đề xuất `delete` đồng nhất UC-61/62)* |
| `entityType` | `equipment` |
| `entityId` | `equipmentId` |
| `oldValueJson` | snapshot `{ equipmentCode, equipmentName, equipmentType, serialNumber, assetStatus, healthStatus, currentRoomId }` (trước xóa) |
| `ipAddress` | `@Ip()` |
| `severity` | `WARNING` |

**Kiểu ghi (cần chốt §11)**:
- **Đề xuất — atomic trong transaction** (mirror `deleteUser:744-762`): xóa + audit cùng transaction, đảm bảo mọi thao tác xóa đều có vết. Phù hợp hành động phá hủy.
- Thay thế — fail-separate (mirror UC-61/62): audit lỗi không rollback xóa. Nhất quán trong module equipment nhưng có nguy cơ xóa mà thiếu vết audit.
- → Với **hành động xóa**, đề xuất **atomic** (an toàn về audit trail). Ghi rõ đây là khác biệt có chủ đích so với UC-61/62.

---

## 10. Ranh giới UC-63 vs UC lân cận

| Việc | Thuộc UC | UC-63 làm? |
| :--- | :--- | :--- |
| Soft-delete thiết bị + gỡ tham chiếu phòng (vì xóa) | **UC-63** | ✅ |
| Tạo thiết bị | UC-61 | ❌ |
| Báo lỗi / bảo trì | UC-62 | ❌ |
| Tìm kiếm / list | UC-64 | ❌ |
| **Gỡ khỏi phòng để tái phân bổ** (`current_room_id=null` nhưng thiết bị **vẫn active**) | **UC-65** | ❌ |
| Dọn map `iot_devices.equipment_id` | Module `iot` (future) | ❌ |
| Khôi phục thiết bị đã xóa (restore) | UC khác/future | ❌ |

**Làm rõ "gỡ tham chiếu phòng" (UC-63) vs "gỡ khỏi phòng" (UC-65)**:
- **UC-63**: gỡ `current_room_id` **vì thiết bị bị xóa** (terminal) — thiết bị rời khỏi vòng vận hành, `deleted_at` set.
- **UC-65**: gỡ `current_room_id` **vì tái phân bổ** — thiết bị **vẫn active**, chỉ đổi vị trí/không còn ở phòng cũ.
- Hai hành động khác mục đích và kết quả cuối; UC-63 KHÔNG thay thế UC-65.

---

## 11. Điểm cần chốt

| # | Vấn đề | Đề xuất |
| :--- | :--- | :--- |
| C1 | Response 200 vs 204 | **200 `{success,message}`** (đồng nhất envelope) |
| C2 | `asset_status` sau xóa | **`retired`** + clear room refs |
| C3 | Có chặn xóa thiết bị `assigned`/đang dùng? | **KHÔNG chặn** — cho xóa + gỡ tham chiếu (đúng Expected Output) |
| C4 | Tham chiếu ngược `iot_devices.equipment_id` | **KHÔNG đụng** (ngoài scope, module iot xử lý sau) |
| C5 | Permission role-set | `['SYSTEM_ADMIN','BUSINESS_ADMIN']` (không Internal User) |
| C6 | Audit atomic vs fail-separate | **Atomic trong transaction** (an toàn audit trail cho hành động xóa) — khác chủ đích UC-61/62 |
| C7 | `actionType` | `delete` (đồng nhất) |
| C8 | Trả `data` trong response? | Không cần; nếu cần thì snapshot đã cập nhật |

---

## 12. Functional Requirements

- **FR-01**: Cung cấp `DELETE /api/v1/equipments/:equipmentId` để xóa **mềm** thiết bị.
- **FR-02**: Chỉ user có permission `equipment.delete` được gọi (thiếu → 403).
- **FR-03**: Thiết bị không tồn tại / đã soft-delete → 404 `EQUIPMENT_NOT_FOUND` (idempotent).
- **FR-04**: Xóa dùng **soft-delete** (`deleted_at`), tuân DATA-01. CẤM hard-delete.
- **FR-05**: Khi xóa, set `current_room_id=null` và clear `assigned_by/assigned_at/installed_at/assignment_note`.
- **FR-06**: `asset_status` sau xóa theo §5.2 (chốt C2 — đề xuất `retired`).
- **FR-07**: Ghi `audit_logs` (`actionType='delete'`, `entityType='equipment'`, `oldValueJson`, WARNING) — kiểu ghi theo C6.
- **FR-08**: Toàn bộ (gỡ tham chiếu + soft-delete + audit) trong **1 transaction** atomic.
- **FR-09**: Response 200 `{success,message}` (C1).
- **FR-10**: KHÔNG chặn theo trạng thái `assigned` (C3) — trừ khi team chốt khác.

## 13. Non-Functional Requirements

- **NFR-01**: TypeORM, không Prisma; soft-delete qua `@DeleteDateColumn`; transaction cho use case nhiều thao tác.
- **NFR-02**: Dùng enum `AssetStatus` sẵn có (không magic string).
- **NFR-03**: Không log secret; error theo exception filter chuẩn.
- **NFR-04**: Chỉ THÊM vào `EquipmentService`/`EquipmentController` (không tạo mới, không sửa `create`/`reportFault`).
- **NFR-05**: Tuân DATA-01 tuyệt đối — không hard-delete.

## 14. Acceptance Criteria

- **AC-01**: DELETE thiết bị tồn tại → 200 `{success:true,message}`; `deleted_at` được set; `current_room_id=null`.
- **AC-02**: Thiết bị đang `assigned` (có `current_room_id`) → xóa OK, tham chiếu phòng được gỡ, `assigned_*` clear.
- **AC-03**: Thiết bị không tồn tại → 404 `EQUIPMENT_NOT_FOUND`.
- **AC-04**: Thiết bị đã soft-delete → 404 (idempotent, không xóa lại).
- **AC-05**: Thiếu permission → 403; chưa đăng nhập → 401.
- **AC-06**: Ghi 1 dòng `audit_logs` (`actionType='delete'`, `entityType='equipment'`, có `oldValueJson`).
- **AC-07**: Query mặc định sau xóa KHÔNG trả thiết bị; `withDeleted` vẫn thấy (soft-delete, không mất dữ liệu — DATA-01).
- **AC-08**: `asset_status` sau xóa = `retired` (theo C2).

## 15. Exception / Alternative Flows

- **EC-01**: 404 thiết bị không tồn tại / đã xóa → không thao tác.
- **EC-02**: (Nếu chốt chặn C3=B) 409 `EQUIPMENT_IN_USE` khi `assigned`.
- **EC-03**: Lỗi transaction → rollback toàn bộ (nếu audit atomic, audit fail cũng rollback xóa — theo C6).

---

## 16. [Missing] — Tóm tắt cần làm

**Trạng thái: [Missing]** — module `equipment` có `create`/`reportFault`; chưa có delete.

Danh mục triển khai (ở plan/tasks sau, KHÔNG làm trong spec này):
1. THÊM `EquipmentService.deleteEquipment(equipmentId, userId, ip)` — Phase A load `deletedAt:IsNull()`/404 → Phase B transaction (gỡ tham chiếu phòng + `asset_status=retired` + `softDelete` + audit). KHÔNG sửa `create`/`reportFault`.
2. THÊM `EquipmentController.deleteEquipment` — `DELETE :equipmentId` (`ParseUUIDPipe`), guard + `@RequirePermissions('equipment.delete')`.
3. TẠO seed `equipment.delete` (KHÔNG execute) — role `[SYSTEM_ADMIN,BUSINESS_ADMIN]`.
4. Test service (xóa OK + gỡ tham chiếu, assigned→xóa+un-ref, 404 không tồn tại, 404 idempotent đã xóa, soft-delete không hard-delete, audit) + controller (RBAC, response 200).

**Điểm cần chốt trước khi code**: C1–C8 (§11) — đặc biệt: response 200/204 (C1), `asset_status` sau xóa (C2), có chặn `assigned` không (C3), audit atomic vs fail-separate (C6), tham chiếu ngược iot (C4).

**Ranh giới**: UC-63 CHỈ soft-delete + gỡ tham chiếu phòng (vì xóa). KHÔNG create/báo lỗi/tìm kiếm/tái phân bổ (UC-65). KHÔNG hard-delete (DATA-01). KHÔNG migration, KHÔNG execute seed, KHÔNG sửa `create`/`reportFault`/module khác.
