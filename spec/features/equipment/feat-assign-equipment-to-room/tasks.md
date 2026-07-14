# TASKS — UC-65: Phân bổ thiết bị vào phòng họp (Assign equipment to room)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-65 (T001–T006). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (UC-65) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> Phạm vi: chỉ gán thiết bị vào phòng. KHÔNG un-assign/create/báo lỗi/xóa/tìm kiếm.
> KHÔNG migration, KHÔNG execute seed, KHÔNG commit. Mirror `reportFault` UC-62 (`:205-322`).

---

## 0. Ràng buộc thực thi (áp cho mọi task)

### 0.1. Bối cảnh
- Nền UC-61/62/63/64: `EquipmentService` (constructor `equipmentRepo` + `dataSource`), `EquipmentController`, `EquipmentResponseDto`, wiring đủ (**import `RoomsModule`**).
- `RoomEntity`: `isActive`, `currentStatus` (`RoomStatus`), `@DeleteDateColumn deletedAt`.
- UC-65 = THÊM `assignToRoom` + handler. Mirror `reportFault` (Phase A/B/C `:205-322`, audit fail-separate `:277-305`).

### 0.2. 11 ràng buộc chốt (C1–C11)
| # | Chốt |
| :--- | :--- |
| C1 | `PATCH /api/v1/equipments/:equipmentId/assignment` (`ParseUUIDPipe`), 200, response `{success,message,data:EquipmentResponseDto}`, guard + `@RequirePermissions('equipment.assign')`, `ValidationPipe(whitelist+forbidNonWhitelisted+transform)`. |
| C2 | RoomEntity qua `this.dataSource.getRepository(RoomEntity)` — **KHÔNG đổi constructor**. |
| C3 | `installedAt = dto.installedAt ? new Date(dto.installedAt) : new Date()`. |
| C4 | Phòng assignable = `isActive===true` AND `currentStatus !== RoomStatus.INACTIVE`; vi phạm → 409 `ROOM_NOT_ASSIGNABLE`. |
| C5 | Thiết bị gán được khi `assetStatus ∈ {AVAILABLE, ASSIGNED}`; `retired/lost/maintenance` → 409 `EQUIPMENT_NOT_ASSIGNABLE`. |
| C6 | Re-assign phòng khác: cho phép (ghi đè). |
| C7 | Gán đúng phòng đang ở: cập nhật lại (cùng nhánh, không no-op riêng). |
| C8 | Audit **fail-separate** (transaction riêng try/catch, KHÔNG rollback — **khác UC-63 atomic**). |
| C9 | `actionType='update'`, `entityType='equipment'`, `oldValueJson={currentRoomId,assetStatus}`, `newValueJson={currentRoomId,assetStatus,assignedBy,assignedAt}`, `severity=INFO`. |
| C10 | Permission `equipment.assign` (`module_code='equipment'`, `action_code='assign'`) → `[SYSTEM_ADMIN,BUSINESS_ADMIN]`; seed KHÔNG execute. |
| C11 | KHÔNG un-assign. |

### 0.3. ⚠️ Thứ tự validate (cố định)
**equipment 404 → equipment-assignable 409 → room 404 → room-assignable 409.** Fail sớm ở thiết bị TRƯỚC khi load room cross-module.

### 0.4. ⚠️ Điểm dễ nhầm
- **Audit FAIL-SEPARATE** (C8) — vừa làm UC-63 dùng audit atomic; UC-65 phải **fail-separate** (transaction riêng + try/catch, audit fail KHÔNG rollback gán). Bám đúng `reportFault:277-305`, KHÔNG bám `deleteEquipment`.
- **KHÔNG đổi constructor** (C2) — `getRepository(RoomEntity)`, KHÔNG `@InjectRepository` (bảo vệ test UC-61/62/63/64).

### 0.5. Bảo vệ code người khác
- KHÔNG sửa `create`/`reportFault`/`deleteEquipment`/`listEquipments`/`checkDuplicate*`/endpoint cũ; KHÔNG đổi constructor.
- CHỈ ĐỌC `RoomEntity`; KHÔNG sửa module `rooms`. KHÔNG sửa `equipment.module.ts`/`equipment.entity.ts`/`EquipmentResponseDto`/`accounts/iot/auth/administration`.
- Test đặt **file riêng**, KHÔNG đụng test UC-61/62/63/64. KHÔNG tạo response DTO.

---

## T001 — [CREATE] `AssignEquipmentDto`
**File**: `src/modules/equipment/dto/assign-equipment.dto.ts`

| Field | Decorators |
| :--- | :--- |
| `roomId` | `@IsUUID('4')` (**bắt buộc** — không `@IsOptional`) |
| `installedAt?` | `@IsOptional`, `@IsISO8601()` |
| `assignmentNote?` | `@IsOptional`, `@IsString`, `@MaxLength(2000)` |

**DoD**: `roomId` bắt buộc uuid; `installedAt` ISO8601 optional; note `@MaxLength(2000)`; KHÔNG field khác (`forbidNonWhitelisted` reject); tsc sạch.

---

## T002 — [MODIFY additive] `EquipmentService.assignToRoom`
**File**: `src/modules/equipment/services/equipment.service.ts`
**Mirror**: `reportFault:205-322` (Phase B `:263-276`, audit fail-separate `:277-305`, map `:306-321`). **KHÔNG đổi constructor**; **KHÔNG đụng** method cũ.

Thêm import (additive): `RoomEntity`, `RoomStatus` từ `../../rooms/entities/room.entity.js`; `AssignEquipmentDto`. (`IsNull`/`AssetStatus`/`ConflictException`/`NotFoundException`/`AuditLogEntity`/`AuditLogSeverity` đã có.)

`assignToRoom(equipmentId: string, dto: AssignEquipmentDto, userId: string, ipAddress?: string): Promise<EquipmentResponseDto>`:

**Phase A — validate (READ, thứ tự cố định 0.3)**:
1. `equipment = equipmentRepo.findOne({ where:{ id: equipmentId, deletedAt: IsNull() } })` → `!equipment` → `NotFoundException` `EQUIPMENT_NOT_FOUND` (404).
2. `assetStatus ∈ {AssetStatus.AVAILABLE, AssetStatus.ASSIGNED}`? nếu không → `ConflictException` `EQUIPMENT_NOT_ASSIGNABLE` (409), details `{assetStatus}`.
3. `room = this.dataSource.getRepository(RoomEntity).findOne({ where:{ id: dto.roomId, deletedAt: IsNull() } })` (C2) → `!room` → `NotFoundException` `ROOM_NOT_FOUND` (404).
4. `room.isActive === true && room.currentStatus !== RoomStatus.INACTIVE`? nếu không → `ConflictException` `ROOM_NOT_ASSIGNABLE` (409), details `{roomId, isActive, currentStatus}`.
5. `oldValue = { currentRoomId: equipment.currentRoomId, assetStatus: equipment.assetStatus }`.

**Phase B — transaction (set 6 field)** (`dataSource.transaction`):
- `currentRoomId = dto.roomId`, `assetStatus = AssetStatus.ASSIGNED`, `assignedBy = userId`, `assignedAt = new Date()`, `installedAt = dto.installedAt ? new Date(dto.installedAt) : new Date()` (C3), `assignmentNote = dto.assignmentNote ?? null`; `em.save(EquipmentEntity, equipment)`.
- C6/C7 đi cùng nhánh này (ghi đè), không nhánh riêng.

**Phase C — audit fail-separate** (C8/C9): transaction RIÊNG + `try/catch` + `logger.error` khi fail (KHÔNG rollback): `em.save(AuditLogEntity, { userId, actionType:'update', entityType:'equipment', entityId:saved.id, oldValueJson:oldValue, newValueJson:{ currentRoomId:saved.currentRoomId, assetStatus:saved.assetStatus, assignedBy:saved.assignedBy, assignedAt:saved.assignedAt }, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.INFO })`.

**Map**: `return new EquipmentResponseDto({...saved})` (12 field).

**DoD**: thứ tự validate cố định (equipment 404→409→room 404→409); `getRepository(RoomEntity)` (KHÔNG đổi constructor); Phase B set 6 field; audit **fail-separate INFO** (không atomic); C6/C7 cùng nhánh; method cũ không đổi; tsc sạch.

---

## T003 — [MODIFY additive] `EquipmentController.assignToRoom`
**File**: `src/modules/equipment/controllers/equipment.controller.ts`
**Mirror**: handler `reportFault` (UC-62). **KHÔNG đụng** handler cũ.

Thêm import (additive): `AssignEquipmentDto`. (`Patch`/`Param`/`ParseUUIDPipe`/`Body`/`CurrentUser`/`Ip` đã có.)

Handler `assignToRoom`:
- `@Patch(':equipmentId/assignment')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.assign')`, `@UsePipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }))`.
- Tham số: `@Param('equipmentId', ParseUUIDPipe) equipmentId: string`, `@Body() dto: AssignEquipmentDto`, `@CurrentUser() user`, `@Ip() ipAddress`.
- `userId = user?.userId`; thiếu → throw (check JwtAuthGuard).
- `const result = await this.equipmentService.assignToRoom(equipmentId, dto, userId, ipAddress);`.
- Trả `{ success:true, message:'Phan bo thiet bi vao phong thanh cong', data: result }`.
- `@ApiResponse` 200/400/401/403/404/409.

**DoD**: `PATCH :equipmentId/assignment` + ParseUUIDPipe; guard + permission; response `{success,message,data}`; handler cũ không đổi; tsc sạch.

---

## T004 — [CREATE] Seed permission `equipment.assign` (KHÔNG execute)
**File**: `src/database/seeds/20260713000007-SeedEquipmentAssignPermission.ts`
**Mirror**: `20260713000003-SeedEquipmentCreatePermission.ts`.

- Hàm `seedEquipmentAssignPermission(dataSource)`: queryRunner + `startTransaction`.
- `INSERT INTO permissions (...) VALUES ('equipment.assign','Phân bổ thiết bị vào phòng','equipment','assign','Cho phép gán thiết bị vào phòng họp.',true) ON CONFLICT (permission_code) DO NOTHING RETURNING id`.
- Loop `roleCodes = ['SYSTEM_ADMIN','BUSINESS_ADMIN']` → `SELECT id FROM roles WHERE role_code=$1 AND is_active=true` → `INSERT role_permissions ... ON CONFLICT DO NOTHING`.
- Ghi chú NC seed-runner (team-wide). **KHÔNG execute**.

**DoD**: idempotent; 2 role đúng C10; KHÔNG chạy.

---

## T005 — [CREATE] Unit test service (file riêng)
**File**: `src/modules/equipment/tests/equipment-assign.service.spec.ts`

Instantiate `new EquipmentService(mockRepo, mockDataSource)`; mock: `equipmentRepo.findOne`; `dataSource.getRepository` → trả room repo giả `{ findOne }`; `dataSource.transaction(cb)` → `cb(fakeEm)` (call-count để reject audit ở lần 2). Cases:
- **S1**: gán `available` → phòng active OK → `currentRoomId=roomId`, `assetStatus=ASSIGNED`, `assignedBy=userId`, `assignedAt` Date, `installedAt` set, `assignmentNote`.
- **S2**: equipment không tồn tại (`findOne`→null) → 404 `EQUIPMENT_NOT_FOUND`; **KHÔNG** gọi `getRepository`/load room.
- **S3**: equipment `retired`/`lost`/`maintenance` → 409 `EQUIPMENT_NOT_ASSIGNABLE`.
- **S4**: room không tồn tại (room `findOne`→null) → 404 `ROOM_NOT_FOUND`.
- **S5**: room `isActive=false` → 409 `ROOM_NOT_ASSIGNABLE`; room `currentStatus='inactive'` → 409.
- **S6**: re-assign — equipment `assigned` phòng A → gán phòng B → `currentRoomId=B`, `assignedAt` mới.
- **S7**: gán đúng phòng đang ở (`roomId==currentRoomId`) → cập nhật lại (assignedAt refresh), không lỗi.
- **S8**: `installedAt` mặc định — không truyền `dto.installedAt` → `installedAt` = now (Date).
- **S9**: audit fail-separate — audit transaction (lần 2) reject → `assignToRoom` vẫn resolve; audit `actionType='update'`, `severity='info'`, old/new.
- **S10**: `dataSource.getRepository` được gọi với `RoomEntity`.

**DoD**: 10 cases pass; mock findOne/getRepository/transaction; static import; KHÔNG đụng test UC-61/62/63/64.

---

## T006 — [CREATE] Unit test controller (file riêng)
**File**: `src/modules/equipment/tests/equipment-assign.controller.spec.ts`

`Test.createTestingModule` + mock `EquipmentService` + `.overrideGuard(JwtAuthGuard/PermissionsGuard)`. Cases:
- **C1**: gọi service đúng `(equipmentId, dto, userId, ip)`, trả `{success,message,data}`.
- **C2**: handler guard metadata = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.assign']`.
- **C4**: thiếu `userId` → throw (check JwtAuthGuard).

**DoD**: 4 cases pass; overrideGuard tránh DI thật; static import.

---

## T007 — Cổng chất lượng (KHÔNG commit)
Chạy và ghi kết quả, **phân biệt baseline vs mới** bằng `git stash`:
1. `npx tsc --noEmit` — net +0 với file production.
2. `npx eslint` trên file đã tạo/sửa (DTO, service, controller, seed, 2 test).
3. `npx jest src/modules/equipment` — suite mới pass (S1–S10, C1–C4) + suite UC-61/62/63/64 **vẫn pass** (0 regression — đặc biệt constructor không đổi).
4. `npx jest src/modules/auth/guards` — 0 regression.
5. `git stash` lấy baseline `src/modules/equipment` + `src/modules/auth/guards`, so trước/sau.

**DoD**: tsc net +0; eslint file đã đụng sạch (seed = baseline pattern `no-unsafe`); jest equipment pass (UC-61/62/63/64 + UC-65); auth/guards 0 regression; bằng chứng git-stash. **KHÔNG commit.**

---

## Ma trận phủ ràng buộc

| Ràng buộc | Task |
| :--- | :--- |
| C1 endpoint/guard/response | T003, T006 (C1) |
| C2 getRepository (không đổi constructor) | T002, T005 (S10) |
| C3 installedAt default | T002, T005 (S8) |
| C4 room assignable 409 | T002, T005 (S5) |
| C5 equipment assignable 409 | T002, T005 (S3) |
| C6 re-assign | T002, T005 (S6) |
| C7 gán đúng phòng refresh | T002, T005 (S7) |
| C8 audit fail-separate | T002, T005 (S9) |
| C9 audit fields | T002, T005 (S9) |
| C10 permission + seed | T004, T006 (C3) |
| C11 không un-assign | T002 (không nhánh set null) |
| Thứ tự validate (0.3) | T002, T005 (S2 không load room) |

---

## KHÔNG được làm
- KHÔNG migration; KHÔNG execute/wire seed-runner; KHÔNG commit; **KHÔNG un-assign**.
- **KHÔNG đổi constructor** `EquipmentService`; KHÔNG `@InjectRepository(RoomEntity)`.
- KHÔNG sửa `create`/`reportFault`/`deleteEquipment`/`listEquipments`/`checkDuplicate*`/endpoint cũ.
- KHÔNG sửa `equipment.module.ts`/`equipment.entity.ts`/`EquipmentResponseDto`/module `rooms`/module khác.
- KHÔNG tạo response DTO; KHÔNG đụng test UC-61/62/63/64; KHÔNG UC-61/62/63/64.

---

## Thứ tự thực thi
`T001 → T002 → T003 → T004 → T005 → T006 → T007`

> Chưa code — chờ duyệt tasks.
