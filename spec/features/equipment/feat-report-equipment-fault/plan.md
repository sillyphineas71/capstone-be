# PLAN — UC-62: Cập nhật trạng thái lỗi thiết bị (Report / update equipment fault)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-62 (thêm reportFault vào EquipmentService/Controller sẵn có). | Toàn bộ file |

> Dựa trên `spec.md` (UC-62) đã duyệt. **CHỈ kế hoạch** — KHÔNG code, KHÔNG task breakdown.
> Phạm vi: chỉ báo lỗi / chuyển bảo trì. KHÔNG create/xóa/tìm kiếm/phân bổ. KHÔNG recovery (về healthy).
> KHÔNG migration, KHÔNG execute seed. Mirror pattern UC-61 (`create`) trong cùng module.

---

## 0. Ràng buộc & quyết định đã chốt (không mở lại)

### 0.1. Bối cảnh
- Module `equipment` đã có nền UC-61: `EquipmentService` (`services/equipment.service.ts`), `EquipmentController` (`controllers/equipment.controller.ts`), `EquipmentResponseDto`, wiring đầy đủ.
- UC-62 = [Missing] → **THÊM** `reportFault` vào service + `reportFault` handler vào controller **sẵn có** (KHÔNG tạo service/controller mới).
- Bảng `equipments` đã tồn tại ⇒ **KHÔNG migration**.

### 0.2. 10 ràng buộc chốt (từ spec)
| # | Chốt |
| :--- | :--- |
| 1 | `PATCH /api/v1/equipments/:equipmentId/fault` (`ParseUUIDPipe`), 200, `JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions('equipment.report_fault')`, `ValidationPipe(whitelist+forbidNonWhitelisted+transform)`, response `{success,message,data:EquipmentResponseDto}`. |
| 2 | Permission `equipment.report_fault` (`module_code='equipment'`, `action_code='report_fault'`) → `[SYSTEM_ADMIN,BUSINESS_ADMIN,MANAGER,INTERNAL_USER]`; seed KHÔNG execute. |
| 3 | `ReportEquipmentFaultDto`: `healthStatus?` (`@IsIn(['warning','faulty','offline'])`), `assetStatus?` (`@IsIn(['maintenance'])`), `issueNote` **bắt buộc** (`@IsNotEmpty @IsString @MaxLength(2000)`); ràng buộc ≥1 status kiểm ở service → 422 `FAULT_NO_CHANGE`. |
| 4 | Chỉ chiều "xấu đi": chặn `healthy/unknown/available/assigned/retired/lost` (chặn ở DTO qua `@IsIn` literal). Set healthy/available → 422. |
| 5 | Set `healthStatus`(nếu có), `assetStatus`(nếu có), `lastIssueReportedAt=now`, `lastIssueNote=dto.issueNote`. KHÔNG set `lastMaintenanceAt`. Giữ nguyên `currentRoomId`. |
| 6 | Load (`deletedAt IS NULL`) → 404 `EQUIPMENT_NOT_FOUND`; `assetStatus∈{retired,lost}` → 409 `EQUIPMENT_NOT_REPORTABLE`. |
| 7 | Cập nhật TRONG transaction; audit NGOÀI transaction riêng fail-separate: `actionType='update'`, `entityType='equipment'`, `oldValueJson={healthStatus,assetStatus}`, `newValueJson={healthStatus,assetStatus,lastIssueReportedAt,issueNote}`, `severity=WARNING`, `ipAddress`; KHÔNG rollback. |
| 8 | Tái dùng `EquipmentResponseDto` (UC-61). KHÔNG tạo response DTO mới. |
| 9 | KHÔNG migration, KHÔNG mutation ngoài `reportFault`, KHÔNG recovery. |
| 10 | KHÔNG sửa `create`/module khác. |

### 0.3. Xác nhận module KHÔNG cần sửa
`equipment.module.ts` đã có `AuthModule` (dòng 15), `JwtModule.register({})` (16), `controllers:[EquipmentController]` (19), `providers:[EquipmentService]` (20). ⇒ **KHÔNG sửa module** (guard DI đã sẵn từ UC-61).

---

## 1. Kiến trúc & luồng

```
PATCH /api/v1/equipments/:equipmentId/fault
  → EquipmentController.reportFault (THÊM)
      JwtAuthGuard(class) → PermissionsGuard('equipment.report_fault') → ValidationPipe(ReportEquipmentFaultDto)
      @Param('equipmentId', ParseUUIDPipe) @Body() dto @CurrentUser() @Ip()
  → EquipmentService.reportFault(equipmentId, dto, userId, ipAddress) (THÊM)
      Phase A — validate:
        - ≥1 trong (healthStatus, assetStatus)? không → 422 FAULT_NO_CHANGE
        - load equipment (deletedAt IS NULL) → 404 EQUIPMENT_NOT_FOUND
        - assetStatus ∈ {retired, lost} → 409 EQUIPMENT_NOT_REPORTABLE
        - snapshot oldValue {healthStatus, assetStatus}
      Phase B — transaction:
        - set healthStatus?/assetStatus?, lastIssueReportedAt=now, lastIssueNote=dto.issueNote
        - KHÔNG set lastMaintenanceAt; giữ currentRoomId
        - em.save(EquipmentEntity)
      Phase C — audit fail-separate (transaction riêng, try/catch, WARNING, không rollback)
      → new EquipmentResponseDto(saved)
  → 200 { success, message, data }
```

### 1.1. Mirror UC-61 (trỏ method/dòng thật)
| Thành phần UC-62 | Mirror từ UC-61 |
| :--- | :--- |
| `EquipmentService.reportFault` | `EquipmentService.create` — `services/equipment.service.ts:85-186` (cấu trúc: validate → `dataSource.transaction` → audit fail-separate → map). |
| Transaction cập nhật | `create` `:124-150` (`dataSource.transaction(async em => em.save(EquipmentEntity, ...))`). |
| Audit fail-separate | `create` `:151-177` (transaction riêng, `try/catch`, `em.create(AuditLogEntity,...)`, `logger.error` khi fail). |
| `ConflictException`/exception payload | `checkDuplicateCode` `:63-83` (`{success,message,error:{code,details},timestamp,path:EQUIPMENTS_PATH}`). |
| Map response | `create` `:180-185` (`new EquipmentResponseDto({...saved})`). |
| `EquipmentController.reportFault` | `EquipmentController.create` — `controllers/equipment.controller.ts:36-88` (guards + `@RequirePermissions` + `@UsePipes(ValidationPipe)` + `@CurrentUser` + `@Ip`, trả `{success,message,data}`). |
| Seed permission | `src/database/seeds/20260713000003-SeedEquipmentCreatePermission.ts` (queryRunner + `ON CONFLICT DO NOTHING`, loop role). |

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/modules/equipment/dto/report-equipment-fault.dto.ts` | `ReportEquipmentFaultDto` — input validate. |
| `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentReportFaultPermission.ts` | Seed `equipment.report_fault` (KHÔNG execute). |
| `src/modules/equipment/tests/equipment-report-fault.service.spec.ts` | Unit test service reportFault. |
| `src/modules/equipment/tests/equipment-report-fault.controller.spec.ts` | Unit test controller (RBAC + response). |

> Test đặt file riêng để KHÔNG đụng `equipment.service.spec.ts`/`equipment.controller.spec.ts` (UC-61).

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/equipment/services/equipment.service.ts` | THÊM method `reportFault` (+ import DTO mới, `NotFoundException`). KHÔNG đụng `create`/`checkDuplicate*`. |
| `src/modules/equipment/controllers/equipment.controller.ts` | THÊM handler `reportFault` (+ import `Patch`, `Param`, `ParseUUIDPipe`, DTO mới). KHÔNG đụng `create`. |

> KHÔNG sửa `equipment.module.ts` (§0.3). KHÔNG tạo response DTO (tái dùng `EquipmentResponseDto`).

---

## 3. Thiết kế `EquipmentService.reportFault()`

### 3.1. Chữ ký
```
reportFault(equipmentId: string, dto: ReportEquipmentFaultDto, userId: string, ipAddress?: string): Promise<EquipmentResponseDto>
```
Dùng lại constructor sẵn có (`equipmentRepo`, `dataSource`, `logger`), `EQUIPMENTS_PATH` (đổi path detail — xem §5).

### 3.2. Phase A — validate
1. **≥1 status**: nếu `!dto.healthStatus && !dto.assetStatus` → `UnprocessableEntityException` code `FAULT_NO_CHANGE`.
2. **Load**: `equipmentRepo.findOne({ where:{ id: equipmentId } })` (mặc định loại soft-deleted) → không có → `NotFoundException` code `EQUIPMENT_NOT_FOUND`.
3. **Trạng thái cho phép**: `equipment.assetStatus ∈ {AssetStatus.RETIRED, AssetStatus.LOST}` → `ConflictException` code `EQUIPMENT_NOT_REPORTABLE`.
4. Snapshot `oldValue = { healthStatus: equipment.healthStatus, assetStatus: equipment.assetStatus }`.

### 3.3. Phase B — transaction cập nhật
```
const saved = await dataSource.transaction(async em => {
  if (dto.healthStatus) equipment.healthStatus = dto.healthStatus;
  if (dto.assetStatus)  equipment.assetStatus  = dto.assetStatus;
  equipment.lastIssueReportedAt = new Date();
  equipment.lastIssueNote = dto.issueNote;
  // KHÔNG set lastMaintenanceAt; KHÔNG đụng currentRoomId / assigned_*
  return em.save(EquipmentEntity, equipment);
});
```

### 3.4. Phase C — audit fail-separate
Transaction riêng, `try/catch`, `logger.error` khi fail (mirror `create:151-177`):
`em.save(AuditLogEntity, { userId, actionType:'update', entityType:'equipment', entityId:saved.id, oldValueJson:oldValue, newValueJson:{ healthStatus:saved.healthStatus, assetStatus:saved.assetStatus, lastIssueReportedAt:saved.lastIssueReportedAt, issueNote:saved.lastIssueNote }, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.WARNING })`.

### 3.5. Map
`return new EquipmentResponseDto({ id, equipmentCode, equipmentName, equipmentType, serialNumber, brand, model, purchaseDate, assetStatus, healthStatus, currentRoomId, createdAt })` (đúng shape UC-61).

---

## 4. DTO — `ReportEquipmentFaultDto`

| Field | Decorators | Ghi chú |
| :--- | :--- | :--- |
| `healthStatus?` | `@IsOptional`, `@IsIn(['warning','faulty','offline'])` | Chặn `healthy/unknown/...` ở DTO (ràng buộc 4). Kiểu khai `HealthStatus` (giá trị con). |
| `assetStatus?` | `@IsOptional`, `@IsIn(['maintenance'])` | Chỉ `maintenance`. |
| `issueNote` | `@IsString`, `@IsNotEmpty`, `@MaxLength(2000)` | **Bắt buộc** (ràng buộc 3). |

- Ràng buộc "≥1 status" **KHÔNG** biểu diễn được thuần bằng decorator độc lập ⇒ kiểm ở **service** (Phase A.1) → 422 `FAULT_NO_CHANGE`.
- `@IsIn` literal thay `@IsEnum` để **giới hạn tập con** enum (chỉ chiều xấu đi). Import `HealthStatus/AssetStatus` từ entity chỉ để khai kiểu; giá trị allowlist là literal.
- `forbidNonWhitelisted` reject field lạ.

---

## 5. Error handling map

| Tình huống | Exception | HTTP | `error.code` |
| :--- | :--- | :--- | :--- |
| DTO sai / `issueNote` rỗng / enum ngoài allowlist (healthy/available) | `ValidationPipe` | 400/422 | (validation) |
| Cả 2 status trống | `UnprocessableEntityException` | 422 | `FAULT_NO_CHANGE` |
| Thiết bị không tồn tại | `NotFoundException` | 404 | `EQUIPMENT_NOT_FOUND` |
| `retired/lost` | `ConflictException` | 409 | `EQUIPMENT_NOT_REPORTABLE` |
| Chưa đăng nhập | `JwtAuthGuard` | 401 | — |
| Thiếu quyền | `PermissionsGuard` | 403 | — |

Payload chuẩn: `{success:false,message,error:{code,details},timestamp:new Date().toISOString(),path:'/api/v1/equipments/:equipmentId/fault'}`.
> Ghi chú: `EQUIPMENTS_PATH` hiện là `/api/v1/equipments`. Với reportFault đề xuất path detail đúng ngữ cảnh; có thể build path từ `equipmentId` hoặc dùng hằng riêng — thống nhất khi code (không ảnh hưởng logic).

---

## 6. Audit plan
- 1 dòng `audit_logs` mỗi lần reportFault thành công.
- `actionType='update'`, `entityType='equipment'`, `severity=WARNING` (sự cố thiết bị), có `oldValueJson`/`newValueJson`.
- Ghi **ngoài** transaction cập nhật (fail-separate) — audit fail chỉ `logger.error`, KHÔNG rollback.
- KHÔNG log secret.

---

## 7. RBAC + Seed

### 7.1. Permission
| Thuộc tính | Giá trị |
| :--- | :--- |
| `permission_code` | `equipment.report_fault` |
| `permission_name` | `Báo lỗi / chuyển bảo trì thiết bị` |
| `module_code` | `equipment` |
| `action_code` | `report_fault` |
| roles | `['SYSTEM_ADMIN','BUSINESS_ADMIN','MANAGER','INTERNAL_USER']` (P1 — spec §8) |

### 7.2. Seed
- Mirror `SeedEquipmentCreatePermission` (queryRunner + `ON CONFLICT (permission_code) DO NOTHING RETURNING id`, loop role → `role_permissions`).
- Idempotent; **KHÔNG execute/wire runner** (ghi chú NC seed-runner team-wide như các seed hiện có).

---

## 8. Route order (ghi chú cho UC sau)
- Endpoint mới `PATCH :equipmentId/fault` là **leaf tĩnh** dưới `:equipmentId`; hiện controller chỉ có `POST /` (UC-61) ⇒ **không collision**.
- **Lưu ý UC sau (63/65)**: nếu thêm `PATCH :equipmentId` (update tổng quát) hoặc `DELETE :equipmentId`, phải đảm bảo route tĩnh (`/fault`, `/status`...) khai TRƯỚC hoặc dùng path phân biệt để param không nuốt. Ghi để tránh lỗi routing về sau.

---

## 9. Test plan (liệt kê — implement ở bước sau)

### 9.1. Service (`equipment-report-fault.service.spec.ts`)
- **S1**: `healthStatus='faulty'` OK → `data.healthStatus='faulty'`, `lastIssueReportedAt` được set, `lastIssueNote=dto.issueNote`.
- **S2**: `assetStatus='maintenance'` OK → `data.assetStatus='maintenance'`.
- **S3**: cả 2 status trống → 422 `FAULT_NO_CHANGE` (không load/không save).
- **S4**: thiết bị không tồn tại → 404 `EQUIPMENT_NOT_FOUND`.
- **S5**: `retired` → 409 `EQUIPMENT_NOT_REPORTABLE`; `lost` → 409.
- **S6**: `currentRoomId` giữ nguyên sau khi chuyển maintenance (không set null).
- **S7**: KHÔNG set `lastMaintenanceAt` (giữ giá trị cũ/null).
- **S8**: audit fail-separate — `em.save(AuditLogEntity)` reject → reportFault vẫn resolve; audit `actionType='update'`, có old/new.
> (healthy/available bị chặn ở **DTO** → phủ ở controller/DTO test, không cần ở service.)

### 9.2. Controller (`equipment-report-fault.controller.spec.ts`)
- **C1**: gọi service đúng `(equipmentId, dto, userId, ip)`, trả `{success,message,data}`.
- **C2**: handler metadata guard = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.report_fault']`.
- **C4**: (DTO) `healthStatus='healthy'` → `@IsIn` reject (422); `assetStatus='available'` → reject.

---

## 10. Business rules mapping (FR)

| FR | Xử lý |
| :--- | :--- |
| FR-01 endpoint | Controller `reportFault` (§1). |
| FR-02 permission | `@RequirePermissions('equipment.report_fault')`. |
| FR-03 404 | Phase A.2. |
| FR-04 retired/lost 409 | Phase A.3. |
| FR-05 ≥1 status | Phase A.1 → `FAULT_NO_CHANGE`. |
| FR-06 giá trị enum con | DTO `@IsIn`. |
| FR-07 set issue fields, không lastMaintenanceAt | Phase B. |
| FR-08 giữ currentRoomId | Phase B (không đụng). |
| FR-09 audit fail-separate | Phase C. |
| FR-10 response | Map `EquipmentResponseDto`. |
| FR-11 chặn healthy/available | DTO `@IsIn`. |

---

## 11. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| Sửa nhầm `create` | Chỉ THÊM method mới; đọc lại diff đảm bảo `create:85-186` không đổi. |
| `@IsIn` literal lệch enum value | Đối chiếu `HealthStatus`/`AssetStatus` trong `equipment.entity.ts` (`warning/faulty/offline`, `maintenance`). |
| "≥1 status" không kiểm được ở DTO | Kiểm ở service Phase A.1 (đã nêu). |
| `NotFoundException` chưa import | THÊM vào import `@nestjs/common` (additive). |
| Route param nuốt (tương lai) | §8 ghi chú. |
| Test đụng spec UC-61 | Đặt file test riêng (§2.1). |
| Audit metadata `severity` | Dùng `AuditLogSeverity.WARNING` (enum có sẵn `audit-log.entity.ts`). |

---

## 12. Tác động code người khác

- **KHÔNG sửa** `create` (UC-61) trong `EquipmentService`, **KHÔNG sửa** endpoint `POST /equipments`.
- **KHÔNG sửa** `equipment.module.ts` (wiring đã đủ), **KHÔNG sửa** `rooms/accounts/iot/auth/administration` (chỉ đọc tham chiếu).
- **SỬA additive**: `equipment.service.ts` (+`reportFault`), `equipment.controller.ts` (+`reportFault` handler) — chỉ THÊM, không đổi code cũ.
- Còn lại là file mới: 1 DTO, 1 seed, 2 test.
- KHÔNG migration, KHÔNG execute seed, KHÔNG recovery.

---

## 13. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/modules/equipment/dto/report-equipment-fault.dto.ts`
- [ ] `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentReportFaultPermission.ts` (KHÔNG execute)
- [ ] `src/modules/equipment/tests/equipment-report-fault.service.spec.ts`
- [ ] `src/modules/equipment/tests/equipment-report-fault.controller.spec.ts`

**SỬA (additive)**
- [ ] `src/modules/equipment/services/equipment.service.ts` (+`reportFault`, không đụng `create`)
- [ ] `src/modules/equipment/controllers/equipment.controller.ts` (+`reportFault` handler, không đụng `create`)

**KHÔNG làm**: migration; execute/wire seed-runner; sửa `create`/`equipment.module.ts`/module khác; mutation ngoài `reportFault`; recovery (về healthy); UC-61/63/64/65.
