# TASKS — UC-63: Xóa thiết bị (Delete equipment — soft delete)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-63 (T001–T006). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (UC-63) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> Phạm vi: chỉ soft-delete + gỡ tham chiếu phòng. KHÔNG create/báo lỗi/tìm kiếm/tái phân bổ.
> Tuân **DATA-01**: soft-delete bắt buộc, CẤM hard-delete. KHÔNG migration, KHÔNG execute seed, KHÔNG commit.
> Mirror `deleteUser` UC-10 (soft-delete + audit **atomic**) + `create` UC-61 (structure).

---

## 0. Ràng buộc thực thi (áp cho mọi task)

### 0.1. Bối cảnh
- Nền UC-61 (`create`) + UC-62 (`reportFault`): `EquipmentService` (có `dataSource` + `equipmentRepo`), `EquipmentController`, `EquipmentResponseDto`, wiring đủ.
- Entity `EquipmentEntity` có `@DeleteDateColumn deletedAt` → soft-delete được, KHÔNG migration.
- UC-63 = THÊM `deleteEquipment` (service) + handler (controller). Mirror `deleteUser` (`accounts/services/users.service.ts`): Phase A validate `:585-763`, `softDelete` `:728`, audit atomic `:744-762`.

### 0.2. 8 ràng buộc chốt (C1–C8)
| # | Chốt |
| :--- | :--- |
| C1 | `DELETE /api/v1/equipments/:equipmentId` (`ParseUUIDPipe`), **200**, response `{success,message}` (KHÔNG `data`), guard + `@RequirePermissions('equipment.delete')`. |
| C2 | `asset_status` sau xóa = `AssetStatus.RETIRED`. |
| C3 | KHÔNG chặn xóa thiết bị `assigned` — cho xóa + gỡ tham chiếu. |
| C4 | KHÔNG đụng `iot_devices.equipment_id`. |
| C5 | Permission `equipment.delete` (`module_code='equipment'`, `action_code='delete'`) → `[SYSTEM_ADMIN,BUSINESS_ADMIN]`; seed KHÔNG execute. |
| C6 | **AUDIT ATOMIC trong transaction** (KHÁC UC-61/62 fail-separate — chủ đích). Gỡ ref + softDelete + audit cùng 1 transaction; audit fail → rollback. **KHÔNG try/catch nuốt lỗi audit.** |
| C7 | `actionType='delete'`, `entityType='equipment'`, `oldValueJson` snapshot trước xóa `{equipmentCode,equipmentName,equipmentType,serialNumber,assetStatus,healthStatus,currentRoomId}`, `severity=WARNING`. |
| C8 | `tem.softDelete` BẮT BUỘC, CẤM hard-delete (DATA-01). |

### 0.3. Bảo vệ code người khác
- KHÔNG sửa `create`/`reportFault`/`checkDuplicate*`/`POST /equipments`/`PATCH :id/fault`. KHÔNG sửa `equipment.module.ts`/`equipment.entity.ts`/`rooms/accounts/iot/auth/administration` (chỉ ĐỌC). KHÔNG đụng `iot_devices.equipment_id`.
- Test đặt **file riêng**, KHÔNG đụng test UC-61/62.
- **KHÔNG tạo DTO** (delete không body). **KHÔNG tạo response DTO** (trả `{success,message}`).

---

## T001 — [MODIFY additive] `EquipmentService.deleteEquipment`
**File**: `src/modules/equipment/services/equipment.service.ts`
**Mirror**: `deleteUser` `:585-763` (Phase A `:588-597`, softDelete `:728`, audit atomic `:744-762`). **KHÔNG đụng** `create`/`reportFault`/`checkDuplicate*`.

Thêm import (additive): `IsNull` (`typeorm`). `NotFoundException` đã có từ UC-62.

`deleteEquipment(equipmentId: string, userId: string, ipAddress?: string): Promise<void>`:

**Phase A — validate (READ, ngoài transaction)**:
1. `const equipment = await this.equipmentRepo.findOne({ where: { id: equipmentId, deletedAt: IsNull() } });`
   - `!equipment` → `NotFoundException` code `EQUIPMENT_NOT_FOUND` (idempotent: đã soft-delete cũng 404).
2. KHÔNG kiểm `assigned` (C3).
3. Snapshot `oldValue = { equipmentCode, equipmentName, equipmentType, serialNumber, assetStatus, healthStatus, currentRoomId }`.

**Phase B — transaction ATOMIC** (`this.dataSource.transaction(async (tem) => {...})`, C6):
1. **UPDATE gỡ ref + retired TRƯỚC softDelete**: `tem.update(EquipmentEntity, equipmentId, { currentRoomId: null, assignedBy: null, assignedAt: null, installedAt: null, assignmentNote: null, assetStatus: AssetStatus.RETIRED })`.
2. **softDelete** (C8): `tem.softDelete(EquipmentEntity, equipmentId)`.
3. **Audit ATOMIC** (C6/C7): `tem.create(AuditLogEntity, { userId, actionType:'delete', entityType:'equipment', entityId:equipmentId, oldValueJson:oldValue, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.WARNING })` → `tem.save(AuditLogEntity, auditLog)`. **KHÔNG** bọc try/catch → audit fail kéo rollback cả transaction.

`Conflict/NotFound` payload chuẩn: `{success:false,message,error:{code,details},timestamp,path:'/api/v1/equipments/...'}`.

**DoD**: Phase A load `deletedAt:IsNull()`→404; Phase B atomic đúng thứ tự (update TRƯỚC softDelete); audit trong transaction KHÔNG try/catch; `softDelete` (không `delete`/`remove`); trả `Promise<void>`; `create`/`reportFault` không đổi; tsc sạch.

---

## T002 — [MODIFY additive] `EquipmentController.deleteEquipment`
**File**: `src/modules/equipment/controllers/equipment.controller.ts`
**Mirror**: handler `reportFault` (UC-62). **KHÔNG đụng** `create`/`reportFault`.

Thêm import (additive): `Delete` (`@nestjs/common`). `Param`/`ParseUUIDPipe` đã có từ UC-62.

Handler `deleteEquipment`:
- `@Delete(':equipmentId')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.delete')`.
- Tham số: `@Param('equipmentId', ParseUUIDPipe) equipmentId: string`, `@CurrentUser() user`, `@Ip() ipAddress`.
- `userId = user?.userId`; thiếu → throw (check JwtAuthGuard).
- `await this.equipmentService.deleteEquipment(equipmentId, userId, ipAddress)`.
- Trả `{ success: true, message: 'Xoa thiet bi thanh cong' }` (**KHÔNG `data`** — C1).
- `@ApiResponse` 200/401/403/404.
- **KHÔNG** `@UsePipes(ValidationPipe)` (delete không body).

**DoD**: `DELETE :equipmentId` + `ParseUUIDPipe`; guard + permission; response `{success,message}` không data; `create`/`reportFault` không đổi; tsc sạch.

---

## T003 — [CREATE] Seed permission `equipment.delete` (KHÔNG execute)
**File**: `src/database/seeds/20260713000005-SeedEquipmentDeletePermission.ts`
**Mirror**: `20260713000003-SeedEquipmentCreatePermission.ts`.

- Hàm `seedEquipmentDeletePermission(dataSource)`: queryRunner + `startTransaction`.
- `INSERT INTO permissions (...) VALUES ('equipment.delete','Xóa thiết bị','equipment','delete','Cho phép xóa mềm thiết bị khỏi danh mục.',true) ON CONFLICT (permission_code) DO NOTHING RETURNING id`.
- Loop `roleCodes = ['SYSTEM_ADMIN','BUSINESS_ADMIN']` → `SELECT id FROM roles WHERE role_code=$1 AND is_active=true` → `INSERT role_permissions ... ON CONFLICT DO NOTHING`.
- Ghi chú NC seed-runner (team-wide). **KHÔNG execute**.

**DoD**: idempotent; 2 role đúng C5; KHÔNG chạy.

---

## T004 — [CREATE] Unit test service (file riêng)
**File**: `src/modules/equipment/tests/equipment-delete.service.spec.ts`

Instantiate `new EquipmentService(mockRepo, mockDataSource)`; mock `dataSource.transaction(cb)` → `cb(fakeTem)` (fake `tem` có `update`, `softDelete`, `create`, `save`). Cases:
- **S1**: xóa OK → `tem.softDelete(EquipmentEntity, id)` gọi; `tem.update` set `currentRoomId=null`, `assetStatus=RETIRED`, `assigned*=null`.
- **S2**: thiết bị `assigned` (có `currentRoomId`) → xóa OK, `update` gỡ ref (KHÔNG chặn — C3).
- **S3**: `findOne`→null → `NotFoundException` `EQUIPMENT_NOT_FOUND`; **`transaction` KHÔNG gọi**.
- **S4**: idempotent — đã soft-delete (`findOne({deletedAt:IsNull()})`→null) → 404 (không xóa lại).
- **S5**: soft-delete KHÔNG hard-delete — assert `tem.softDelete` gọi; `tem.delete`/`tem.remove` **KHÔNG** gọi.
- **S6**: audit atomic — `tem.save(AuditLogEntity,...)` gọi TRONG transaction; `actionType='delete'`, `entityType='equipment'`, có `oldValueJson` (snapshot), `severity=WARNING`.
- **S7**: audit fail → rollback — mock `tem.save(AuditLogEntity)` reject → `deleteEquipment` **rejects/throw** (KHÔNG nuốt lỗi) → chứng minh khác fail-separate.
- **S8**: thứ tự — `tem.update` (gỡ ref) gọi **TRƯỚC** `tem.softDelete` (assert `invocationCallOrder` / thứ tự mock).

**DoD**: 8 cases pass; mock Repository/DataSource; static import; KHÔNG đụng test UC-61/62.

---

## T005 — [CREATE] Unit test controller (file riêng)
**File**: `src/modules/equipment/tests/equipment-delete.controller.spec.ts`

`Test.createTestingModule` + mock `EquipmentService` + `.overrideGuard(JwtAuthGuard/PermissionsGuard)`. Cases:
- **C1**: gọi service đúng `(equipmentId, userId, ip)`, trả `{success,message}` (**KHÔNG `data`**).
- **C2**: handler guard metadata = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.delete']`.
- **C4**: thiếu `userId` → throw (check JwtAuthGuard).

**DoD**: 4 cases pass; overrideGuard tránh DI thật; static import.

---

## T006 — Cổng chất lượng (KHÔNG commit)
Chạy và ghi kết quả, **phân biệt baseline vs mới** bằng `git stash`:
1. `npx tsc --noEmit` — net +0 với file production.
2. `npx eslint` trên file đã tạo/sửa (service, controller, seed, 2 test).
3. `npx jest src/modules/equipment` — suite mới pass (S1–S8, C1–C4) + suite UC-61/62 **vẫn pass** (0 regression).
4. `npx jest src/modules/auth/guards` — 0 regression.
5. `git stash` lấy baseline `src/modules/equipment` + `src/modules/auth/guards`, so trước/sau.

**DoD**: tsc net +0 (production sạch); eslint file đã đụng sạch (seed = baseline pattern `no-unsafe`); jest equipment pass (UC-61 + UC-62 + UC-63); auth/guards 0 regression; bằng chứng git-stash. **KHÔNG commit.**

---

## Ma trận phủ ràng buộc

| Ràng buộc | Task |
| :--- | :--- |
| C1 endpoint/guard/response {success,message} | T002, T005 (C1) |
| C2 asset_status=RETIRED | T001, T004 (S1) |
| C3 không chặn assigned | T001, T004 (S2) |
| C4 không đụng iot | T001 (không truy vấn iot), §0.3 |
| C5 permission + seed 2 role | T003, T005 (C3) |
| C6 audit atomic (không fail-separate) | T001 (Phase B), T004 (S6/S7) |
| C7 audit fields | T001, T004 (S6) |
| C8 soft-delete (không hard) | T001, T004 (S5) |

---

## KHÔNG được làm
- KHÔNG migration; KHÔNG execute/wire seed-runner; KHÔNG commit; **KHÔNG hard-delete** (`delete`/`remove`).
- KHÔNG sửa `create`/`reportFault`/`checkDuplicate*`/`POST /equipments`/`PATCH :id/fault`.
- KHÔNG sửa `equipment.module.ts`/`equipment.entity.ts`/module khác; KHÔNG đụng `iot_devices.equipment_id`.
- KHÔNG tạo DTO/response DTO; KHÔNG đụng test UC-61/62; KHÔNG UC-61/62/64/65.

---

## Thứ tự thực thi
`T001 → T002 → T003 → T004 → T005 → T006`

> Chưa code — chờ duyệt tasks.
