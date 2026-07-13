# TASKS — UC-62: Cập nhật trạng thái lỗi thiết bị (Report / update equipment fault)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-62 (T001–T007). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (UC-62) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> Phạm vi: chỉ báo lỗi / chuyển bảo trì. KHÔNG create/xóa/tìm kiếm/phân bổ. KHÔNG recovery.
> KHÔNG migration, KHÔNG execute seed, KHÔNG commit. Mirror UC-61 (`create`) trong cùng module.

---

## 0. Ràng buộc thực thi (áp cho mọi task)

### 0.1. Bối cảnh
- Nền UC-61 đã có: `EquipmentService.create` (`services/equipment.service.ts:85-186`), `EquipmentController.create` (`controllers/equipment.controller.ts:36-88`), `EquipmentResponseDto`, module wiring đủ (`AuthModule`:15, `JwtModule`:16, `controllers`:19, `providers`:20).
- UC-62 = THÊM `reportFault` vào service + handler vào controller **sẵn có**. Mirror `create`.

### 0.2. 10 ràng buộc chốt
| # | Chốt |
| :--- | :--- |
| 1 | `PATCH /api/v1/equipments/:equipmentId/fault` (`ParseUUIDPipe`), 200, guard + `@RequirePermissions('equipment.report_fault')`, `ValidationPipe(whitelist+forbidNonWhitelisted+transform)`, response `{success,message,data:EquipmentResponseDto}`. |
| 2 | Permission `equipment.report_fault` (`module_code='equipment'`, `action_code='report_fault'`) → `[SYSTEM_ADMIN,BUSINESS_ADMIN,MANAGER,INTERNAL_USER]`; seed KHÔNG execute. |
| 3 | DTO: `healthStatus?` `@IsIn(['warning','faulty','offline'])`, `assetStatus?` `@IsIn(['maintenance'])`, `issueNote` bắt buộc `@IsString @IsNotEmpty @MaxLength(2000)`. "≥1 status" kiểm Ở SERVICE → 422 `FAULT_NO_CHANGE`. |
| 4 | **CHỐT STATUS CODE**: lỗi DTO (healthy/available/enum ngoài allowlist/issueNote rỗng) qua ValidationPipe = **400** (mặc định Nest, KHÔNG cấu hình `errorHttpStatusCode`). Lỗi nghiệp vụ ở service: `FAULT_NO_CHANGE`=422, `EQUIPMENT_NOT_FOUND`=404, `EQUIPMENT_NOT_REPORTABLE`=409. **DTO=400, service=422/404/409**. Test assert **400** cho healthy/available. |
| 5 | Set `healthStatus`(nếu có), `assetStatus`(nếu có), `lastIssueReportedAt=now`, `lastIssueNote=dto.issueNote`. KHÔNG set `lastMaintenanceAt`. Giữ nguyên `currentRoomId`. |
| 6 | **CHỐT LOAD**: `findOne({ where:{ id } })` — entity có `@DeleteDateColumn` nên tự loại soft-deleted (đã verify); thêm `deletedAt: IsNull()` được phép (không bắt buộc). Không có → 404 `EQUIPMENT_NOT_FOUND`. `assetStatus∈{retired,lost}` → 409 `EQUIPMENT_NOT_REPORTABLE`. |
| 7 | Cập nhật TRONG `dataSource.transaction`; audit NGOÀI transaction riêng fail-separate: `actionType='update'`, `entityType='equipment'`, `entityId`, `oldValueJson={healthStatus,assetStatus}`, `newValueJson={healthStatus,assetStatus,lastIssueReportedAt,lastIssueNote}`, `severity=WARNING`, `ipAddress`. KHÔNG rollback khi audit fail. |
| 8 | **CHỐT RESPONSE**: TÁI DÙNG `EquipmentResponseDto` (UC-61). KHÔNG thêm issue fields. KHÔNG tạo response DTO mới. |
| 9 | KHÔNG migration, KHÔNG mutation ngoài `reportFault`, KHÔNG recovery. |
| 10 | KHÔNG sửa `create`/module khác/entity. |

### 0.3. Bảo vệ code người khác
- KHÔNG sửa `create`/`checkDuplicate*`/`POST /equipments`. KHÔNG sửa `equipment.module.ts` (đủ từ UC-61). KHÔNG sửa `rooms/accounts/iot/auth/administration`/`equipment.entity.ts` (chỉ ĐỌC).
- Test đặt **file riêng**, KHÔNG đụng `equipment.service.spec.ts`/`equipment.controller.spec.ts` (UC-61).

---

## T001 — [CREATE] `ReportEquipmentFaultDto`
**File**: `src/modules/equipment/dto/report-equipment-fault.dto.ts`

Nội dung:
- `healthStatus?`: `@IsOptional`, `@IsIn(['warning','faulty','offline'])` (kiểu khai `HealthStatus`; **KHÔNG** `@IsEnum` full — chặn `healthy/unknown`).
- `assetStatus?`: `@IsOptional`, `@IsIn(['maintenance'])` (kiểu khai `AssetStatus`; chặn `available/assigned/retired/lost`).
- `issueNote`: `@IsString`, `@IsNotEmpty`, `@MaxLength(2000)` — **bắt buộc**.
- KHÔNG khai field khác → `forbidNonWhitelisted` reject.

**DoD**: `@IsIn` literal (không `@IsEnum` full) cho 2 status; `issueNote` bắt buộc; import `HealthStatus/AssetStatus` từ `../entities/equipment.entity.js` để khai kiểu; tsc sạch. Ràng buộc "≥1 status" KHÔNG ở DTO (chuyển T002).

---

## T002 — [MODIFY additive] `EquipmentService.reportFault`
**File**: `src/modules/equipment/services/equipment.service.ts`
**Mirror**: `create` `:85-186` (audit `:151-177`). **KHÔNG đụng** `create`/`checkDuplicate*`.

Thêm import (additive): `NotFoundException` (`@nestjs/common`), `ReportEquipmentFaultDto`.

`reportFault(equipmentId: string, dto: ReportEquipmentFaultDto, userId: string, ipAddress?: string): Promise<EquipmentResponseDto>`:

**Phase A — validate (trước khi save)**:
1. **≥1 status**: `!dto.healthStatus && !dto.assetStatus` → `UnprocessableEntityException` code `FAULT_NO_CHANGE` (422). KIỂM TRƯỚC — có thể trước hoặc sau load; theo plan kiểm ≥1 status trước, **không save**.
2. **Load**: `equipmentRepo.findOne({ where:{ id: equipmentId } })` → không có → `NotFoundException` code `EQUIPMENT_NOT_FOUND` (404).
3. **Trạng thái**: `equipment.assetStatus ∈ {AssetStatus.RETIRED, AssetStatus.LOST}` → `ConflictException` code `EQUIPMENT_NOT_REPORTABLE` (409).
4. **Snapshot**: `oldValue = { healthStatus: equipment.healthStatus, assetStatus: equipment.assetStatus }`.

**Phase B — transaction cập nhật** (`dataSource.transaction`):
- `if (dto.healthStatus) equipment.healthStatus = dto.healthStatus;`
- `if (dto.assetStatus) equipment.assetStatus = dto.assetStatus;`
- `equipment.lastIssueReportedAt = new Date();`
- `equipment.lastIssueNote = dto.issueNote;`
- **KHÔNG** set `lastMaintenanceAt`; **KHÔNG** đụng `currentRoomId`/`assigned_*`.
- `return em.save(EquipmentEntity, equipment);`

**Phase C — audit fail-separate** (transaction riêng, `try/catch`, `logger.error` khi fail, KHÔNG rollback):
`em.save(AuditLogEntity, { userId, actionType:'update', entityType:'equipment', entityId:saved.id, oldValueJson:oldValue, newValueJson:{ healthStatus:saved.healthStatus, assetStatus:saved.assetStatus, lastIssueReportedAt:saved.lastIssueReportedAt, lastIssueNote:saved.lastIssueNote }, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.WARNING })`.

**Map**: `return new EquipmentResponseDto({...saved})` (shape UC-61, KHÔNG thêm issue fields).

**DoD**: đúng 3 phase; ≥1 status kiểm Phase A → 422; load→404; retired/lost→409; giữ `currentRoomId`; KHÔNG set `lastMaintenanceAt`; audit fail-separate WARNING; `create` không đổi (diff chỉ thêm); tsc sạch.

---

## T003 — [MODIFY additive] `EquipmentController.reportFault`
**File**: `src/modules/equipment/controllers/equipment.controller.ts`
**Mirror**: `create` `:36-88`. **KHÔNG đụng** `create`.

Thêm import (additive): `Patch`, `Param`, `ParseUUIDPipe` (`@nestjs/common`), `ReportEquipmentFaultDto`.

Handler `reportFault`:
- `@Patch(':equipmentId/fault')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.report_fault')`, `@UsePipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }))`.
- Tham số: `@Param('equipmentId', ParseUUIDPipe) equipmentId: string`, `@Body() dto: ReportEquipmentFaultDto`, `@CurrentUser() user`, `@Ip() ipAddress`.
- `userId = user?.userId`; thiếu → throw (check JwtAuthGuard).
- Gọi `equipmentService.reportFault(equipmentId, dto, userId, ipAddress)`; trả `{ success:true, message:'Cap nhat trang thai loi thiet bi thanh cong', data }`.
- `@ApiResponse` cho 200/400/401/403/404/409/422.

**DoD**: `PATCH :equipmentId/fault` đúng ràng buộc 1; ParseUUIDPipe; guard + permission; response `{success,message,data}`; `create` không đổi; tsc sạch.

---

## T004 — [CREATE] Seed permission `equipment.report_fault` (KHÔNG execute)
**File**: `src/database/seeds/20260713000004-SeedEquipmentReportFaultPermission.ts`
**Mirror**: `20260713000003-SeedEquipmentCreatePermission.ts`.

- Hàm `seedEquipmentReportFaultPermission(dataSource)`: queryRunner + `startTransaction`.
- `INSERT INTO permissions (...) VALUES ('equipment.report_fault','Báo lỗi / chuyển bảo trì thiết bị','equipment','report_fault','Cho phép báo lỗi và chuyển thiết bị sang bảo trì.',true) ON CONFLICT (permission_code) DO NOTHING RETURNING id`.
- Loop `roleCodes = ['SYSTEM_ADMIN','BUSINESS_ADMIN','MANAGER','INTERNAL_USER']` → `SELECT id FROM roles WHERE role_code=$1 AND is_active=true` → `INSERT role_permissions ... ON CONFLICT DO NOTHING`.
- Ghi chú NC seed-runner (team-wide). **KHÔNG execute**.

**DoD**: idempotent; 4 role đúng ràng buộc 2; KHÔNG chạy.

---

## T005 — [CREATE] Unit test service (file riêng)
**File**: `src/modules/equipment/tests/equipment-report-fault.service.spec.ts`

Instantiate `new EquipmentService(mockRepo, mockDataSource)`; mock `dataSource.transaction(cb)` → `cb(fakeEm)`. Cases:
- **S1**: `healthStatus='faulty'` + `issueNote` → OK; `data.healthStatus='faulty'`, `lastIssueReportedAt` set, `lastIssueNote=dto.issueNote`.
- **S2**: `assetStatus='maintenance'` → OK; `data.assetStatus='maintenance'`.
- **S3**: cả 2 status trống → `UnprocessableEntityException` `FAULT_NO_CHANGE`; **không** gọi save (assert transaction không chạy hoặc findOne không dẫn tới save).
- **S4**: `findOne` trả null → `NotFoundException` `EQUIPMENT_NOT_FOUND`.
- **S5**: equipment `retired` → `ConflictException` `EQUIPMENT_NOT_REPORTABLE`; lặp `lost` → 409.
- **S6**: `currentRoomId` giữ nguyên sau maintenance (không set null).
- **S7**: KHÔNG set `lastMaintenanceAt` (giữ giá trị cũ/null).
- **S8**: audit fail-separate — `em.save(AuditLogEntity)` reject → `reportFault` vẫn resolve; audit `actionType='update'`, có `oldValueJson`/`newValueJson`, `severity=WARNING`.

**DoD**: 8 cases pass; mock Repository/DataSource; static import; KHÔNG đụng file test UC-61.

---

## T006 — [CREATE] Unit test controller/DTO (file riêng)
**File**: `src/modules/equipment/tests/equipment-report-fault.controller.spec.ts`

`Test.createTestingModule` + mock `EquipmentService` + `.overrideGuard(JwtAuthGuard/PermissionsGuard)`. Cases:
- **C1**: gọi service đúng `(equipmentId, dto, userId, ip)`, trả `{success,message,data}`.
- **C2**: handler guard metadata = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.report_fault']`.
- **C4**: (DTO) `healthStatus='healthy'` qua `validate()` (class-validator) → có lỗi (biểu thị ValidationPipe → **400**); `assetStatus='available'` → có lỗi. **Assert 400/lỗi validation, KHÔNG assert 422** (ràng buộc 4).

**DoD**: 4 cases pass; C4 khẳng định healthy/available bị chặn ở DTO (400); overrideGuard tránh DI thật; static import.

---

## T007 — Cổng chất lượng (KHÔNG commit)
Chạy và ghi kết quả, **phân biệt baseline vs mới** bằng `git stash`:
1. `npx tsc --noEmit` — net +0 với file production.
2. `npx eslint` trên file đã tạo/sửa (DTO, service, controller, seed, 2 test).
3. `npx jest src/modules/equipment` — suite mới pass (S1–S8, C1–C4) + suite UC-61 vẫn pass (0 regression).
4. `npx jest src/modules/auth/guards` — 0 regression.
5. `git stash` lấy baseline `src/modules/equipment` + `src/modules/auth/guards`, so trước/sau.

**DoD**: tsc net +0 (production sạch); eslint file đã đụng sạch (hoặc seed = baseline pattern `no-unsafe`); jest equipment pass (UC-61 + UC-62); auth/guards 0 regression; bằng chứng git-stash. **KHÔNG commit.**

---

## Ma trận phủ ràng buộc

| Ràng buộc | Task |
| :--- | :--- |
| 1 endpoint/guard/response | T003 |
| 2 permission + seed 4 role | T004, T006 (C3) |
| 3 DTO + ≥1 status ở service | T001, T002 (Phase A.1), T005 (S3) |
| 4 status code DTO=400 vs service=422/404/409 | T006 (C4), T005 (S3/S4/S5) |
| 5 update fields / giữ currentRoomId / không lastMaintenanceAt | T002, T005 (S6/S7) |
| 6 load 404 / retired-lost 409 | T002 (Phase A.2/A.3), T005 (S4/S5) |
| 7 transaction + audit fail-separate | T002 (Phase B/C), T005 (S8) |
| 8 tái dùng EquipmentResponseDto | T002, T003 |
| 9/10 không migration/recovery/sửa create | mọi task (§0.3) |

---

## KHÔNG được làm
- KHÔNG migration; KHÔNG execute/wire seed-runner; KHÔNG commit.
- KHÔNG sửa `create`/`checkDuplicate*`/`POST /equipments`; KHÔNG sửa `equipment.module.ts`/`equipment.entity.ts`/module khác.
- KHÔNG mutation ngoài `reportFault`; KHÔNG recovery (set `healthy/available`).
- KHÔNG đụng file test UC-61.

---

## Thứ tự thực thi
`T001 → T002 → T003 → T004 → T005 → T006 → T007`

> Chưa code — chờ duyệt tasks.
