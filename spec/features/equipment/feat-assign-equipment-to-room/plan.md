# PLAN — UC-65: Phân bổ thiết bị vào phòng họp (Assign equipment to room)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-65 (gán thiết bị vào phòng, validate cross-module). | Toàn bộ file |

> Dựa trên `spec.md` (UC-65) đã duyệt. **CHỈ kế hoạch** — KHÔNG code, KHÔNG task breakdown.
> Phạm vi: chỉ gán thiết bị vào phòng. KHÔNG un-assign/create/báo lỗi/xóa/tìm kiếm.
> KHÔNG migration, KHÔNG execute seed. Mirror `reportFault` UC-62 (validate + update + audit fail-separate).

---

## 0. Ràng buộc & quyết định đã chốt (C1–C11, không mở lại)

### 0.1. Bối cảnh
- Module `equipment` có nền UC-61/62/63/64: `EquipmentService` (constructor: `equipmentRepo` + `dataSource`), `EquipmentController`, `EquipmentResponseDto`, wiring đủ (**import `RoomsModule`** dòng 14).
- `RoomEntity`: `isActive`, `currentStatus` (`available/occupied/reserved/maintenance/inactive`), `@DeleteDateColumn deletedAt`.
- UC-65 = [Missing] → **THÊM** `assignToRoom` + handler. Mirror `reportFault:205-322`.

### 0.2. 11 ràng buộc chốt
| # | Chốt |
| :--- | :--- |
| C1 | `PATCH /api/v1/equipments/:equipmentId/assignment` (`ParseUUIDPipe`), 200, response `{success,message,data:EquipmentResponseDto}`, guard + `@RequirePermissions('equipment.assign')`, `ValidationPipe(whitelist+forbidNonWhitelisted+transform)`. |
| C2 | Đọc RoomEntity qua `this.dataSource.getRepository(RoomEntity)` (**KHÔNG đổi constructor**). |
| C3 | `installedAt = dto.installedAt ?? now`. |
| C4 | Phòng assignable = `isActive===true` **AND** `currentStatus !== 'inactive'`. Vi phạm → 409 `ROOM_NOT_ASSIGNABLE`. |
| C5 | Thiết bị gán được khi `assetStatus ∈ {available, assigned}`. `retired/lost/maintenance` → 409 `EQUIPMENT_NOT_ASSIGNABLE`. |
| C6 | Re-assign sang phòng khác: **cho phép** (ghi đè `currentRoomId` + `assignedAt`/`assignedBy` mới). |
| C7 | Gán đúng phòng đang ở (`roomId==currentRoomId`): **cập nhật lại** (refresh, không nhánh no-op). |
| C8 | Audit **fail-separate** (audit lỗi KHÔNG rollback gán). |
| C9 | `actionType='update'`, `entityType='equipment'`, `oldValueJson={currentRoomId,assetStatus}`, `newValueJson={currentRoomId,assetStatus,assignedBy,assignedAt}`, `severity=INFO`. |
| C10 | Permission `equipment.assign` (`module_code='equipment'`, `action_code='assign'`) → `[SYSTEM_ADMIN,BUSINESS_ADMIN]`; seed KHÔNG execute. |
| C11 | KHÔNG un-assign (UC riêng tương lai). UC-65 CHỈ gán. |

### 0.3. Xác nhận KHÔNG cần sửa
`equipment.module.ts` (đã import `RoomsModule`, đủ để `getRepository(RoomEntity)`), `equipment.entity.ts`, `EquipmentResponseDto` (chỉ tái dùng), **constructor `EquipmentService`** (giữ nguyên `equipmentRepo` + `dataSource`). ⇒ KHÔNG sửa.

---

## 1. Kiến trúc & luồng

```
PATCH /api/v1/equipments/:equipmentId/assignment
  → EquipmentController.assignToRoom (THÊM)
      JwtAuthGuard(class) → PermissionsGuard('equipment.assign') → ValidationPipe(AssignEquipmentDto)
      @Param('equipmentId', ParseUUIDPipe) @Body() dto @CurrentUser() @Ip()
  → EquipmentService.assignToRoom(equipmentId, dto, userId, ipAddress) (THÊM)
      Phase A — validate (READ, ngoài transaction):
        1. load equipment findOne({id, deletedAt:IsNull()}) → null → 404 EQUIPMENT_NOT_FOUND
        2. assetStatus ∈ {available,assigned}? không (retired/lost/maintenance) → 409 EQUIPMENT_NOT_ASSIGNABLE
        3. load room: this.dataSource.getRepository(RoomEntity).findOne({id:dto.roomId, deletedAt:IsNull()}) → null → 404 ROOM_NOT_FOUND
        4. room.isActive===true && room.currentStatus!=='inactive'? không → 409 ROOM_NOT_ASSIGNABLE
        5. snapshot oldValue = { currentRoomId, assetStatus }
      Phase B — transaction (update 6 field):
        currentRoomId=dto.roomId, assetStatus=ASSIGNED, assignedBy=userId, assignedAt=now,
        installedAt=dto.installedAt ?? now, assignmentNote=dto.assignmentNote ?? null
      Phase C — audit fail-separate (transaction riêng, try/catch, INFO, không rollback)
      → new EquipmentResponseDto(saved)
  → 200 { success, message, data }
```

### 1.1. Mirror `reportFault` UC-62 (trỏ dòng thật)
| Thành phần UC-65 | Mirror từ `reportFault` (`services/equipment.service.ts`) |
| :--- | :--- |
| `assignToRoom` khung Phase A/B/C | `:205-322`. |
| Phase A load `findOne({id, deletedAt:IsNull()})` + 404 payload | (mirror `deleteEquipment:333-...` load `deletedAt:IsNull()`) + `reportFault` NotFound payload. |
| Kiểm trạng thái → `ConflictException` (409) | `reportFault` `EQUIPMENT_NOT_REPORTABLE` (retired/lost 409) — cùng dạng. |
| Phase B `dataSource.transaction` update | `reportFault:263-276`. |
| Phase C audit **fail-separate** (`try/catch`, `em.create(AuditLogEntity)`, `logger.error`) | `reportFault:277-305`. |
| Map response | `reportFault:306-321` (`new EquipmentResponseDto({...saved})`). |
| Controller handler (guard + `@RequirePermissions` + `@Param ParseUUIDPipe` + `@Body` + `@CurrentUser` + `@Ip`) | `EquipmentController.reportFault` (UC-62). |
| Seed permission | `src/database/seeds/20260713000003-SeedEquipmentCreatePermission.ts`. |

> **Khác `reportFault`**: UC-65 có thêm bước **load + validate RoomEntity** (cross-module, chỉ ĐỌC) và set 6 field assign. Audit vẫn fail-separate (C8) — giống UC-62, **khác** UC-63 (atomic).

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/modules/equipment/dto/assign-equipment.dto.ts` | `AssignEquipmentDto` — input. |
| `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentAssignPermission.ts` | Seed `equipment.assign` (KHÔNG execute). |
| `src/modules/equipment/tests/equipment-assign.service.spec.ts` | Unit test service `assignToRoom`. |
| `src/modules/equipment/tests/equipment-assign.controller.spec.ts` | Unit test controller (RBAC + response). |

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/equipment/services/equipment.service.ts` | THÊM `assignToRoom` (+ import `RoomEntity` từ `../../rooms/entities/room.entity.js`; `IsNull`/`AssetStatus`/`ConflictException`/`NotFoundException` đã có). **KHÔNG đổi constructor**; **KHÔNG đụng** method cũ. |
| `src/modules/equipment/controllers/equipment.controller.ts` | THÊM handler `assignToRoom` (+ import `AssignEquipmentDto`; `Patch`/`Param`/`ParseUUIDPipe`/`Body` đã có). KHÔNG đụng handler cũ. |

> KHÔNG tạo response DTO (tái dùng `EquipmentResponseDto`). KHÔNG sửa module/entity/rooms.

---

## 3. Thiết kế `EquipmentService.assignToRoom()`

### 3.1. Chữ ký
```
assignToRoom(equipmentId: string, dto: AssignEquipmentDto, userId: string, ipAddress?: string): Promise<EquipmentResponseDto>
```
Dùng lại constructor sẵn có (`equipmentRepo`, `dataSource`, `logger`).

### 3.2. Phase A — validate (READ)
1. `const equipment = await this.equipmentRepo.findOne({ where:{ id: equipmentId, deletedAt: IsNull() } });` → `!equipment` → `NotFoundException` code `EQUIPMENT_NOT_FOUND` (404).
2. **Thiết bị assignable** (C5): nếu `equipment.assetStatus` KHÔNG thuộc `{AssetStatus.AVAILABLE, AssetStatus.ASSIGNED}` → `ConflictException` code `EQUIPMENT_NOT_ASSIGNABLE` (409), details `{assetStatus}`.
3. **Load room** (C2): `const room = await this.dataSource.getRepository(RoomEntity).findOne({ where:{ id: dto.roomId, deletedAt: IsNull() } });` → `!room` → `NotFoundException` code `ROOM_NOT_FOUND` (404).
4. **Phòng assignable** (C4): nếu `!(room.isActive === true && room.currentStatus !== RoomStatus.INACTIVE)` → `ConflictException` code `ROOM_NOT_ASSIGNABLE` (409), details `{roomId, isActive, currentStatus}`.
5. `const oldValue = { currentRoomId: equipment.currentRoomId, assetStatus: equipment.assetStatus };`

> Thứ tự chốt: equipment 404 → equipment 409 → room 404 → room 409 (validate thiết bị trước, phòng sau).

### 3.3. Phase B — transaction (update)
```
const saved = await this.dataSource.transaction(async (em) => {
  equipment.currentRoomId  = dto.roomId;
  equipment.assetStatus    = AssetStatus.ASSIGNED;
  equipment.assignedBy     = userId;
  equipment.assignedAt     = new Date();
  equipment.installedAt    = dto.installedAt ? new Date(dto.installedAt) : new Date();  // C3
  equipment.assignmentNote = dto.assignmentNote ?? null;
  return em.save(EquipmentEntity, equipment);
});
```
> C6 (re-assign phòng khác) và C7 (gán đúng phòng đang ở) đều đi qua đúng nhánh này — ghi đè `currentRoomId` + `assignedAt` mới, không cần nhánh riêng.

### 3.4. Phase C — audit fail-separate (C8/C9)
Transaction riêng, `try/catch`, `logger.error` khi fail (mirror `reportFault:277-305`):
`em.save(AuditLogEntity, { userId, actionType:'update', entityType:'equipment', entityId:saved.id, oldValueJson:oldValue, newValueJson:{ currentRoomId:saved.currentRoomId, assetStatus:saved.assetStatus, assignedBy:saved.assignedBy, assignedAt:saved.assignedAt }, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.INFO })`.

### 3.5. Map
`return new EquipmentResponseDto({ ...12 field... })` (shape UC-61).

---

## 4. DTO — `AssignEquipmentDto`

| Field | Decorators |
| :--- | :--- |
| `roomId` | `@IsUUID('4')` (**bắt buộc** — không `@IsOptional`) |
| `installedAt?` | `@IsOptional`, `@IsISO8601()` |
| `assignmentNote?` | `@IsOptional`, `@IsString`, `@MaxLength(2000)` |

- `forbidNonWhitelisted` reject field lạ (`currentRoomId/assetStatus/assignedBy/...`).

---

## 5. Error handling map

| Tình huống | Exception | HTTP | `error.code` |
| :--- | :--- | :--- | :--- |
| `equipmentId`/`roomId` không UUID | `ParseUUIDPipe` / `ValidationPipe` | 400 | — |
| DTO sai (roomId thiếu, installedAt, note) | `ValidationPipe` | 400 | (validation) |
| Thiết bị không tồn tại | `NotFoundException` | 404 | `EQUIPMENT_NOT_FOUND` |
| Thiết bị retired/lost/maintenance | `ConflictException` | 409 | `EQUIPMENT_NOT_ASSIGNABLE` |
| Phòng không tồn tại | `NotFoundException` | 404 | `ROOM_NOT_FOUND` |
| Phòng không active | `ConflictException` | 409 | `ROOM_NOT_ASSIGNABLE` |
| Chưa đăng nhập | `JwtAuthGuard` | 401 | — |
| Thiếu quyền | `PermissionsGuard` | 403 | — |

Payload chuẩn: `{success:false,message,error:{code,details},timestamp,path:'/api/v1/equipments/:equipmentId/assignment'}`.

---

## 6. Audit plan
- 1 dòng `audit_logs` mỗi lần gán thành công.
- `actionType='update'`, `entityType='equipment'`, `severity=INFO` (gán không phá hủy), old/new (C9).
- **fail-separate** (C8) — ngoài transaction update, `try/catch`, `logger.error`, KHÔNG rollback. **Khác** UC-63 (atomic) — có chủ đích vì gán không phá hủy dữ liệu.
- KHÔNG log secret.

---

## 7. RBAC + Seed

### 7.1. Permission
| Thuộc tính | Giá trị |
| :--- | :--- |
| `permission_code` | `equipment.assign` |
| `permission_name` | `Phân bổ thiết bị vào phòng` |
| `module_code` | `equipment` |
| `action_code` | `assign` |
| roles | `['SYSTEM_ADMIN','BUSINESS_ADMIN']` (C10 — KHÔNG Manager/Internal) |

### 7.2. Seed
- Mirror `SeedEquipmentCreatePermission` (queryRunner + `ON CONFLICT DO NOTHING`, loop 2 role → `role_permissions`).
- Idempotent; **KHÔNG execute/wire runner**.

---

## 8. Route order (ghi chú)
- `PATCH :equipmentId/assignment` vs `PATCH :equipmentId/fault` (UC-62): cùng cấp sub-resource dưới `:equipmentId` nhưng **khác segment cuối tĩnh** (`assignment` vs `fault`) ⇒ **không collision** (NestJS/Express match theo path đầy đủ).
- Không có `PATCH :equipmentId` trần ⇒ param không nuốt. An toàn.

---

## 9. Business rules mapping (FR)

| FR | Xử lý |
| :--- | :--- |
| FR-01 endpoint PATCH assignment | Controller `assignToRoom` (§1). |
| FR-02 permission | `@RequirePermissions('equipment.assign')`. |
| FR-03 roomId bắt buộc uuid | DTO `@IsUUID`. |
| FR-04 equipment 404 | Phase A.1. |
| FR-05 room 404 | Phase A.3. |
| FR-06 room not assignable 409 | Phase A.4 (C4). |
| FR-07 equipment not assignable 409 | Phase A.2 (C5). |
| FR-08 set 6 field | Phase B. |
| FR-09 re-assign phòng khác | Phase B (ghi đè). |
| FR-10 audit fail-separate | Phase C (C8/C9). |
| FR-11 response EquipmentResponseDto | Map §3.5. |
| FR-12 chỉ gán, không un-assign | Không nhánh set currentRoomId=null. |

---

## 10. Test plan (liệt kê — implement ở bước sau; FILE RIÊNG)

### 10.1. Service (`equipment-assign.service.spec.ts`)
- **S1**: gán `available` → phòng active OK → `currentRoomId=roomId`, `assetStatus=ASSIGNED`, `assignedBy=userId`, `assignedAt` set, `installedAt` set, `assignmentNote`.
- **S2**: thiết bị không tồn tại → 404 `EQUIPMENT_NOT_FOUND`; KHÔNG load room.
- **S3**: thiết bị `retired`/`lost`/`maintenance` → 409 `EQUIPMENT_NOT_ASSIGNABLE`.
- **S4**: phòng không tồn tại → 404 `ROOM_NOT_FOUND`.
- **S5**: phòng `isActive=false` → 409 `ROOM_NOT_ASSIGNABLE`; phòng `currentStatus='inactive'` → 409.
- **S6**: re-assign — thiết bị đang `assigned` phòng A → gán phòng B → `currentRoomId=B`, `assignedAt` mới.
- **S7**: gán đúng phòng đang ở (`roomId==currentRoomId`) → cập nhật lại (assignedAt refresh), không lỗi.
- **S8**: `installedAt` mặc định — không truyền `dto.installedAt` → `installedAt` = now (Date).
- **S9**: audit fail-separate — mock audit transaction reject → `assignToRoom` vẫn resolve; audit `actionType='update'`, `severity=INFO`, old/new.
- **S10**: đọc RoomEntity qua `dataSource.getRepository(RoomEntity)` — assert `getRepository` được gọi với `RoomEntity`.

> Mock: `equipmentRepo.findOne`; `dataSource.getRepository` → trả `{ findOne }` room repo giả; `dataSource.transaction(cb)` → `cb(fakeEm)` (Phase B save + Phase C audit — dùng call-count để reject audit).

### 10.2. Controller (`equipment-assign.controller.spec.ts`)
- **C1**: gọi service đúng `(equipmentId, dto, userId, ip)`, trả `{success,message,data}`.
- **C2**: handler guard metadata = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.assign']`.
- **C4**: thiếu `userId` → throw (check JwtAuthGuard).

---

## 11. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| **Đổi constructor phá test UC-61/62/63/64** | Dùng `dataSource.getRepository(RoomEntity)` — **KHÔNG** thêm `@InjectRepository` param (C2). Test cũ `new EquipmentService(repo, dataSource)` không đổi. |
| Sửa nhầm method cũ | Chỉ THÊM `assignToRoom`; diff insertions thuần. |
| `RoomEntity`/`RoomStatus` import path sai | Import từ `../../rooms/entities/room.entity.js` (chỉ ĐỌC). |
| Thứ tự validate sai | Cố định equipment 404 → equipment 409 → room 404 → room 409 (§3.2); test S2–S5. |
| Audit atomic nhầm (sai C8) | Audit trong transaction RIÊNG + try/catch (fail-separate); test S9 assert resolve khi audit fail. |
| N+1 | 1 findOne equipment + 1 findOne room; không loop. |
| Test đụng UC-61/62/63/64 | File test riêng (§2.1). |
| `getRepository` khả dụng | `RoomsModule` export `TypeOrmModule` (RoomEntity forFeature) + equipment import RoomsModule ⇒ `dataSource.getRepository(RoomEntity)` chạy (DataSource toàn cục có metadata RoomEntity). |

---

## 12. Tác động code người khác

- **KHÔNG đổi constructor** `EquipmentService`; **KHÔNG sửa** `create`/`reportFault`/`deleteEquipment`/`listEquipments`/`checkDuplicate*`/endpoint cũ.
- **CHỈ ĐỌC** `RoomEntity` (qua `dataSource.getRepository`); **KHÔNG sửa** module `rooms`.
- **KHÔNG sửa** `equipment.module.ts`, `equipment.entity.ts`, `EquipmentResponseDto` (chỉ tái dùng), `accounts/iot/auth/administration` (chỉ ĐỌC).
- **SỬA additive**: `equipment.service.ts` (+`assignToRoom`, +import `RoomEntity`), `equipment.controller.ts` (+handler, +import DTO) — chỉ THÊM.
- Còn lại là file mới: 1 DTO, 1 seed, 2 test.
- KHÔNG migration, KHÔNG execute seed, KHÔNG un-assign.

---

## 13. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/modules/equipment/dto/assign-equipment.dto.ts`
- [ ] `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentAssignPermission.ts` (KHÔNG execute)
- [ ] `src/modules/equipment/tests/equipment-assign.service.spec.ts`
- [ ] `src/modules/equipment/tests/equipment-assign.controller.spec.ts`

**SỬA (additive)**
- [ ] `src/modules/equipment/services/equipment.service.ts` (+`assignToRoom`, +import `RoomEntity`; **không đổi constructor**, không đụng method cũ)
- [ ] `src/modules/equipment/controllers/equipment.controller.ts` (+handler `assignToRoom`, +import DTO)

**KHÔNG làm**: migration; execute/wire seed-runner; đổi constructor; sửa method/route cũ/`equipment.module.ts`/`equipment.entity.ts`/`EquipmentResponseDto`/module `rooms`/module khác; tạo response DTO; un-assign; đụng test UC-61/62/63/64; UC-61/62/63/64.
