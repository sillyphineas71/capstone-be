# PLAN — UC-63: Xóa thiết bị (Delete equipment — soft delete)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-63 (soft-delete + gỡ tham chiếu phòng, audit atomic). | Toàn bộ file |

> Dựa trên `spec.md` (UC-63) đã duyệt. **CHỈ kế hoạch** — KHÔNG code, KHÔNG task breakdown.
> Phạm vi: chỉ soft-delete thiết bị + gỡ tham chiếu phòng. KHÔNG create/báo lỗi/tìm kiếm/tái phân bổ.
> Tuân **DATA-01**: soft-delete bắt buộc, CẤM hard-delete. KHÔNG migration, KHÔNG execute seed.
> Mirror: `deleteUser` UC-10 (soft-delete + audit **atomic**) + `create` UC-61 (structure).

---

## 0. Ràng buộc & quyết định đã chốt (C1–C8, không mở lại)

### 0.1. Bối cảnh
- Module `equipment` có nền UC-61 (`create`) + UC-62 (`reportFault`): `EquipmentService`, `EquipmentController`, `EquipmentResponseDto`, wiring đủ.
- Entity `EquipmentEntity` có `@DeleteDateColumn deletedAt` (đã verify) ⇒ soft-delete được, **KHÔNG migration**.
- UC-63 = [Missing] → **THÊM** `deleteEquipment` vào service + handler vào controller sẵn có.

### 0.2. 8 ràng buộc chốt
| # | Chốt |
| :--- | :--- |
| C1 | `DELETE /api/v1/equipments/:equipmentId` (`ParseUUIDPipe`), **200**, response `{success,message}` (KHÔNG `data`), guard + `@RequirePermissions('equipment.delete')`. |
| C2 | `asset_status` sau xóa = `AssetStatus.RETIRED`. |
| C3 | KHÔNG chặn xóa thiết bị đang `assigned` — cho xóa + gỡ tham chiếu phòng. |
| C4 | KHÔNG đụng `iot_devices.equipment_id` (dangling ref chấp nhận được). |
| C5 | Permission `equipment.delete` (`module_code='equipment'`, `action_code='delete'`) → `[SYSTEM_ADMIN, BUSINESS_ADMIN]` (KHÔNG Internal/Manager); seed KHÔNG execute. |
| C6 | **AUDIT ATOMIC trong transaction** (khác UC-61/62 fail-separate — chủ đích, mirror `deleteUser`). Gỡ ref + softDelete + audit cùng 1 transaction; audit fail → rollback xóa. |
| C7 | `actionType='delete'`, `entityType='equipment'`, `oldValueJson` snapshot trước xóa `{equipmentCode,equipmentName,equipmentType,serialNumber,assetStatus,healthStatus,currentRoomId}`, `severity=WARNING`. |
| C8 | Soft-delete BẮT BUỘC (`softDelete`/set `deleted_at`), CẤM hard-delete (DATA-01). |

### 0.3. Xác nhận KHÔNG cần sửa
`equipment.module.ts` (wiring đủ từ UC-61: `AuthModule`, `JwtModule`, controllers, providers), `equipment.entity.ts` (đã có `deletedAt`). ⇒ **KHÔNG sửa**.

---

## 1. Kiến trúc & luồng

```
DELETE /api/v1/equipments/:equipmentId
  → EquipmentController.deleteEquipment (THÊM)
      JwtAuthGuard(class) → PermissionsGuard('equipment.delete')
      @Param('equipmentId', ParseUUIDPipe) @CurrentUser() @Ip()
  → EquipmentService.deleteEquipment(equipmentId, userId, ipAddress) (THÊM)
      Phase A — validate (READ, ngoài transaction):
        - findOne({ where:{ id, deletedAt: IsNull() } }) → null → 404 EQUIPMENT_NOT_FOUND (idempotent)
        - KHÔNG chặn assigned (C3)
        - snapshot oldValue cho audit
      Phase B — transaction ATOMIC (C6):
        1. Gỡ tham chiếu phòng: set currentRoomId=null, assignedBy/assignedAt/installedAt/assignmentNote=null,
           assetStatus=RETIRED  (UPDATE field TRƯỚC softDelete — §3.4)
        2. softDelete(EquipmentEntity, equipmentId)  (set deleted_at — C8)
        3. audit ATOMIC: save(AuditLogEntity, {...})  (audit fail → rollback cả transaction — KHÔNG try/catch)
      → { success, message }  (KHÔNG data — C1)
  → 200 { success, message }
```

### 1.1. Mirror (trỏ dòng thật)
| Thành phần UC-63 | Mirror |
| :--- | :--- |
| Cấu trúc Phase A validate → Phase B transaction | `deleteUser` — `accounts/services/users.service.ts:585-763` (A: load `deletedAt:IsNull()` `:588-597`, gom check; B: transaction `:726-763`). |
| `softDelete` trong transaction | `deleteUser` `:728` (`tem.softDelete(UserEntity, targetUserId)`). |
| Audit **atomic** trong transaction (WARNING, oldValueJson snapshot) | `deleteUser` `:744-762` (`tem.create(AuditLogEntity,{ actionType, entityType, entityId, severity:WARNING, oldValueJson })` + `tem.save`). |
| Load `deletedAt: IsNull()` → 404 | `deleteUser` `:588-597` (`where:{ id, deletedAt: IsNull() }`). |
| Exception payload chuẩn | `equipment.service.ts` `create`/`reportFault` (`{success,message,error:{code,details},timestamp,path}`). |
| Controller handler (guard + `@RequirePermissions` + `@CurrentUser` + `@Ip`) | `EquipmentController.reportFault` — `controllers/equipment.controller.ts` (UC-62). |
| Seed permission | `src/database/seeds/20260713000003-SeedEquipmentCreatePermission.ts`. |

> Lưu ý: `deleteUser` inject `dataSource` và dùng `this.dataSource.manager`/`this.dataSource.transaction`. `EquipmentService` đã có `dataSource` + `equipmentRepo` (constructor UC-61) ⇒ dùng lại, KHÔNG đổi constructor.

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentDeletePermission.ts` | Seed `equipment.delete` (KHÔNG execute). |
| `src/modules/equipment/tests/equipment-delete.service.spec.ts` | Unit test service `deleteEquipment`. |
| `src/modules/equipment/tests/equipment-delete.controller.spec.ts` | Unit test controller (RBAC + response). |

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/equipment/services/equipment.service.ts` | THÊM `deleteEquipment` (+ import `IsNull` từ `typeorm`; `NotFoundException` đã có từ UC-62). KHÔNG đụng `create`/`reportFault`/`checkDuplicate*`. |
| `src/modules/equipment/controllers/equipment.controller.ts` | THÊM handler `deleteEquipment` (+ import `Delete` từ `@nestjs/common`; `Param`/`ParseUUIDPipe` đã có từ UC-62). KHÔNG đụng `create`/`reportFault`. |

> KHÔNG tạo DTO (delete không có body). KHÔNG tạo response DTO (trả `{success,message}`). KHÔNG sửa module/entity/iot.

---

## 3. Thiết kế `EquipmentService.deleteEquipment()`

### 3.1. Chữ ký
```
deleteEquipment(equipmentId: string, userId: string, ipAddress?: string): Promise<void>
```
(Controller tự bọc `{success,message}`; hoặc service trả `void` như `deleteUser`. Đề xuất **`Promise<void>`** — mirror `deleteUser`.)

### 3.2. Phase A — validate (READ, ngoài transaction)
1. `const equipment = await this.equipmentRepo.findOne({ where:{ id: equipmentId, deletedAt: IsNull() } });`
   - `!equipment` → `NotFoundException` code `EQUIPMENT_NOT_FOUND` (bao gồm đã soft-delete → idempotent §6 spec).
2. KHÔNG kiểm `assigned` (C3 — cho xóa).
3. Snapshot:
   ```
   const oldValue = {
     equipmentCode: equipment.equipmentCode,
     equipmentName: equipment.equipmentName,
     equipmentType: equipment.equipmentType,
     serialNumber: equipment.serialNumber,
     assetStatus: equipment.assetStatus,
     healthStatus: equipment.healthStatus,
     currentRoomId: equipment.currentRoomId,
   };
   ```

### 3.3. Phase B — transaction ATOMIC (C6)
```
await this.dataSource.transaction(async (tem) => {
  // 1. Gỡ tham chiếu phòng + retired (UPDATE field TRƯỚC softDelete)
  await tem.update(EquipmentEntity, equipmentId, {
    currentRoomId: null,
    assignedBy: null,
    assignedAt: null,
    installedAt: null,
    assignmentNote: null,
    assetStatus: AssetStatus.RETIRED,
  });

  // 2. Soft-delete (set deleted_at) — DATA-01
  await tem.softDelete(EquipmentEntity, equipmentId);

  // 3. Audit ATOMIC — audit fail → toàn bộ transaction rollback (KHÔNG try/catch)
  const auditLog = tem.create(AuditLogEntity, {
    userId,
    actionType: 'delete',
    entityType: 'equipment',
    entityId: equipmentId,
    oldValueJson: oldValue,
    ipAddress: ipAddress ?? null,
    severity: AuditLogSeverity.WARNING,
  });
  await tem.save(AuditLogEntity, auditLog);
});
```

### 3.4. ⚠️ Thứ tự an toàn: UPDATE field TRƯỚC softDelete
- `tem.softDelete` chỉ set `deleted_at` (không xóa dòng). `tem.update(EquipmentEntity, id, {...})` theo **id** vẫn chạy trên dòng đã soft-deleted (TypeORM `update` không tự lọc `deleted_at`), nên về kỹ thuật thứ tự đảo vẫn tác dụng.
- **Tuy nhiên** để rõ ràng ngữ nghĩa và tránh phụ thuộc hành vi ngầm: **UPDATE field (gỡ ref + retired) TRƯỚC, softDelete SAU**. Nêu rõ trong code (comment). Cả 2 trong cùng transaction ⇒ atomic.

### 3.5. Không dùng fail-separate
Khác UC-61/62: **KHÔNG** bọc audit trong `try/catch` riêng. Audit nằm trong cùng `dataSource.transaction` với softDelete ⇒ audit lỗi kéo rollback xóa (C6 — đảm bảo mọi lần xóa đều có vết audit).

---

## 4. Controller `deleteEquipment`

- `@Delete(':equipmentId')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.delete')`.
- Tham số: `@Param('equipmentId', ParseUUIDPipe) equipmentId: string`, `@CurrentUser() user`, `@Ip() ipAddress`.
- `userId = user?.userId`; thiếu → throw (check JwtAuthGuard).
- Gọi `await this.equipmentService.deleteEquipment(equipmentId, userId, ipAddress)`.
- Trả `{ success:true, message:'Xoa thiet bi thanh cong' }` (KHÔNG `data` — C1).
- `@ApiResponse` 200/401/403/404.
- **KHÔNG** `@UsePipes(ValidationPipe)` body (delete không body); ParseUUIDPipe cho param là đủ.

---

## 5. Error handling map

| Tình huống | Exception | HTTP | `error.code` |
| :--- | :--- | :--- | :--- |
| `equipmentId` không phải UUID | `ParseUUIDPipe` | 400 | — |
| Thiết bị không tồn tại / đã soft-delete | `NotFoundException` | 404 | `EQUIPMENT_NOT_FOUND` |
| Chưa đăng nhập | `JwtAuthGuard` | 401 | — |
| Thiếu quyền | `PermissionsGuard` | 403 | — |
| Lỗi transaction (kể cả audit) | rollback | 500 | — |

Payload `NotFoundException`: `{success:false,message,error:{code:'EQUIPMENT_NOT_FOUND',details:{equipmentId}},timestamp,path:'/api/v1/equipments/:equipmentId'}`.

---

## 6. Audit plan (nhấn khác biệt có chủ đích)
- 1 dòng `audit_logs` mỗi lần xóa thành công.
- `actionType='delete'`, `entityType='equipment'`, `oldValueJson`=snapshot trước xóa (C7), `severity=WARNING`.
- **ATOMIC** trong transaction (C6) — **khác UC-61/62** (fail-separate). Lý do: xóa là hành động phá hủy, phải đảm bảo vết audit; audit fail ⇒ rollback xóa (không cho phép xóa "âm thầm" thiếu log). Ghi rõ đây là khác biệt chủ đích, mirror `deleteUser`.
- KHÔNG log secret.

---

## 7. RBAC + Seed

### 7.1. Permission
| Thuộc tính | Giá trị |
| :--- | :--- |
| `permission_code` | `equipment.delete` |
| `permission_name` | `Xóa thiết bị` |
| `module_code` | `equipment` |
| `action_code` | `delete` |
| roles | `['SYSTEM_ADMIN','BUSINESS_ADMIN']` (C5 — KHÔNG Internal/Manager) |

### 7.2. Seed
- Mirror `SeedEquipmentCreatePermission` (queryRunner + `ON CONFLICT (permission_code) DO NOTHING RETURNING id`, loop 2 role → `role_permissions`).
- Idempotent; **KHÔNG execute/wire runner** (ghi chú NC seed-runner team-wide).

---

## 8. Route order (ghi chú)
- `DELETE :equipmentId` là cặp **method+path** riêng; controller hiện có `POST /` (UC-61) + `PATCH :equipmentId/fault` (UC-62). Khác HTTP method / khác path ⇒ **không collision**.
- Không có route `DELETE` tĩnh nào khác trong controller ⇒ `:equipmentId` param không bị nuốt. An toàn.
- Lưu ý UC sau (65): nếu thêm `DELETE :equipmentId/room-assignment` (gỡ khỏi phòng), route tĩnh phải khai trước — ghi để tránh lỗi routing.

---

## 9. Business rules mapping (FR)

| FR | Xử lý |
| :--- | :--- |
| FR-01 endpoint DELETE | Controller `deleteEquipment` (§4). |
| FR-02 permission | `@RequirePermissions('equipment.delete')`. |
| FR-03 404 / idempotent | Phase A.1 (`deletedAt: IsNull()`). |
| FR-04 soft-delete (DATA-01) | Phase B.2 (`softDelete`). |
| FR-05 gỡ tham chiếu phòng | Phase B.1 (`currentRoomId=null` + clear `assigned_*`). |
| FR-06 asset_status=retired | Phase B.1. |
| FR-07 audit atomic WARNING | Phase B.3 (§6). |
| FR-08 1 transaction atomic | Phase B (toàn bộ trong `dataSource.transaction`). |
| FR-09 response 200 {success,message} | §4. |
| FR-10 không chặn assigned | Phase A (không kiểm). |

---

## 10. Test plan (liệt kê — implement ở bước sau; FILE RIÊNG)

### 10.1. Service (`equipment-delete.service.spec.ts`)
- **S1**: xóa OK → gọi `softDelete`; `update` set `currentRoomId=null`, `assetStatus=RETIRED`, `assigned_*=null`.
- **S2**: thiết bị đang `assigned` (có `currentRoomId`) → xóa OK, `update` gỡ ref (không chặn — C3).
- **S3**: thiết bị không tồn tại (`findOne`→null) → `NotFoundException` `EQUIPMENT_NOT_FOUND`; KHÔNG gọi transaction.
- **S4**: idempotent — đã soft-delete (`findOne({deletedAt:IsNull()})`→null) → 404 (không xóa lại).
- **S5**: soft-delete KHÔNG hard-delete — assert gọi `tem.softDelete` (KHÔNG `tem.delete`/`remove`).
- **S6**: audit atomic — assert `tem.save(AuditLogEntity,...)` gọi TRONG cùng transaction; `actionType='delete'`, `entityType='equipment'`, có `oldValueJson`, `severity=WARNING`.
- **S7**: audit fail → rollback — mock `tem.save(AuditLogEntity)` reject → `deleteEquipment` **throw** (KHÔNG nuốt lỗi); chứng minh khác fail-separate (transaction reject lan ra).
- **S8**: thứ tự — `update` (gỡ ref) gọi TRƯỚC `softDelete` (assert call order).

### 10.2. Controller (`equipment-delete.controller.spec.ts`)
- **C1**: gọi service đúng `(equipmentId, userId, ip)`, trả `{success,message}` (KHÔNG `data`).
- **C2**: handler guard metadata = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.delete']`.
- **C4**: (tùy) thiếu `userId` → throw.

---

## 11. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| Sửa nhầm `create`/`reportFault` | Chỉ THÊM method mới; diff phải là insertions thuần. |
| Hard-delete lọt (vi phạm DATA-01) | Chỉ dùng `softDelete`; test S5 assert không gọi `delete`/`remove`. |
| Audit fail-separate lọt (sai C6) | Audit trong cùng transaction, KHÔNG try/catch; test S7 assert throw khi audit fail. |
| `update` sau `softDelete` không tác dụng | UPDATE field TRƯỚC softDelete (§3.4); test S8 assert thứ tự. |
| `IsNull` chưa import | THÊM `import { IsNull } from 'typeorm'` (additive). |
| Đụng `iot_devices.equipment_id` | KHÔNG chạm (C4); không truy vấn/không update iot. |
| Test đụng UC-61/62 | File test riêng (§2.1). |

---

## 12. Tác động code người khác

- **KHÔNG sửa** `create`/`reportFault`/`checkDuplicate*`/`POST /equipments`/`PATCH :id/fault`.
- **KHÔNG sửa** `equipment.module.ts` (wiring đủ), `equipment.entity.ts`, `rooms/accounts/iot/auth/administration` (chỉ ĐỌC).
- **KHÔNG đụng** `iot_devices.equipment_id` (dangling ref chấp nhận được — C4).
- **SỬA additive**: `equipment.service.ts` (+`deleteEquipment`, +import `IsNull`), `equipment.controller.ts` (+handler, +import `Delete`) — chỉ THÊM.
- Còn lại là file mới: 1 seed, 2 test.
- KHÔNG migration, KHÔNG execute seed, KHÔNG hard-delete.

---

## 13. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentDeletePermission.ts` (KHÔNG execute)
- [ ] `src/modules/equipment/tests/equipment-delete.service.spec.ts`
- [ ] `src/modules/equipment/tests/equipment-delete.controller.spec.ts`

**SỬA (additive)**
- [ ] `src/modules/equipment/services/equipment.service.ts` (+`deleteEquipment`, +import `IsNull`; không đụng `create`/`reportFault`)
- [ ] `src/modules/equipment/controllers/equipment.controller.ts` (+handler `deleteEquipment`, +import `Delete`)

**KHÔNG làm**: migration; execute/wire seed-runner; hard-delete; sửa `create`/`reportFault`/`equipment.module.ts`/`equipment.entity.ts`/module khác/iot; đụng file test UC-61/62; UC-61/62/64/65.
