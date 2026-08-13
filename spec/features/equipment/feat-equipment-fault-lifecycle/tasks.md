# TASKS — EQUIP-FAULT-LIFECYCLE-001: Notify sysadmin + Xác nhận + Xử lý xong lỗi thiết bị

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới tasks.md cho EQUIP-FAULT-LIFECYCLE-001 (T001–T010). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (EQUIP-FAULT-LIFECYCLE-001) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> KHÔNG execute migration, KHÔNG commit. Mirror `reportFault`/`create` trong cùng module.

---

## 0. Ràng buộc thực thi (áp cho mọi task)

### 0.1. Bối cảnh
- Nền đã có: `EquipmentService`/`EquipmentController` (5 method/endpoint), `resolveAssetAction()` (`equipment.service.ts:209-222`), `EquipmentResponseDto`, `equipment.module.ts` (thiếu `NotificationsModule`).
- Feature này = THÊM Phase D vào `reportFault` + THÊM `confirmFault`/`resolveFault` + 2 helper + 2 handler + 1 DI + 1 module import + 3 enum + 1 migration permission.

### 0.2. 8 ràng buộc chốt (nhắc lại từ plan §0.2)
| # | Chốt |
| :--- | :--- |
| 1 | Confirm chỉ ghi `audit_logs` (`actionType='confirm'`), KHÔNG đổi field `equipments`. |
| 2 | Notify report chỉ role `SYSTEM_ADMIN`. |
| 3 | KHÔNG WebSocket — chỉ `createNotification()` in-app. |
| 4 | Permission confirm/resolve → `[SYSTEM_ADMIN, BUSINESS_ADMIN]`. |
| 5 | `lastMaintenanceAt` set CHỈ ở `resolveFault`. |
| 6 | `resolveFault` giữ nguyên `lastIssueReportedAt`/`lastIssueNote` cũ. |
| 7 | `confirmFault`/`resolveFault` KHÔNG chặn `retired/lost`. |
| 8 | Reporter gần nhất suy từ `audit_logs` (`actionType='update' AND severity='WARNING'`), KHÔNG cột mới. |

### 0.3. Bảo vệ code người khác
- KHÔNG sửa `create`/`deleteEquipment`/`listEquipments`/`assignToRoom`/`resolveAssetAction` (chỉ GỌI, không sửa nội dung). KHÔNG sửa `equipment.entity.ts`. KHÔNG sửa `rooms/meetings/accounts/iot/auth/administration` module.
- Test đặt **file riêng**, KHÔNG đụng file test UC-61/UC-62 hiện có.
- `reportFault` Phase A/B/C giữ nguyên 100% — chỉ APPEND Phase D ở cuối method (sau `return` hiện tại → đổi thành gọi Phase D trước khi return, hoặc thêm trước dòng `return new EquipmentResponseDto(...)`).

---

## T001 — [MODIFY additive] `NotificationType` — 3 giá trị mới
**File**: `src/modules/notifications/entities/notification.entity.ts`

Thêm vào cuối enum `NotificationType` (sau `PERSON_WATCHLIST_MATCH`, dòng 48):
```ts
EQUIPMENT_FAULT_REPORTED = 'equipment_fault_reported',
EQUIPMENT_FAULT_CONFIRMED = 'equipment_fault_confirmed',
EQUIPMENT_FAULT_RESOLVED = 'equipment_fault_resolved',
```

**DoD**: chỉ thêm 3 dòng cuối enum, KHÔNG đổi giá trị cũ nào; tsc sạch.

---

## T002 — [MODIFY additive] `equipment.module.ts` — import `NotificationsModule`
**File**: `src/modules/equipment/equipment.module.ts`

Thêm `import { NotificationsModule } from '../notifications/notifications.module.js';` và thêm `NotificationsModule` vào mảng `imports` (cạnh `AuthModule`).

**DoD**: build không circular dependency error; `imports` có đủ `AccountsModule, RoomsModule, AuthModule, NotificationsModule, JwtModule.register({}), TypeOrmModule.forFeature([EquipmentEntity])`.

---

## T003 — [CREATE] `ConfirmEquipmentFaultDto`, `ResolveEquipmentFaultDto`, response DTO
**Files**:
- `src/modules/equipment/dto/confirm-equipment-fault.dto.ts`
- `src/modules/equipment/dto/resolve-equipment-fault.dto.ts`
- `src/modules/equipment/dto/equipment-fault-confirmation-response.dto.ts`

Nội dung (mirror style `report-equipment-fault.dto.ts`):
- `ConfirmEquipmentFaultDto`: `confirmationNote?` — `@IsOptional @IsString @MaxLength(2000)`.
- `ResolveEquipmentFaultDto`: `healthStatus` — `@IsIn(['healthy','warning'])` **bắt buộc**; `assetStatus?` — `@IsOptional @IsIn(['active','maintenance','retired'])`; `resolutionNote` — `@IsString @IsNotEmpty @MaxLength(2000)` **bắt buộc**. Export type `ResolvedAssetAction = 'active'|'maintenance'|'retired'`.
- `EquipmentFaultConfirmationResponseDto`: plain class, constructor nhận object, gán field `equipmentId, healthStatus, confirmedBy, confirmedAt` (mirror style `EquipmentResponseDto` — plain class không decorator).

**DoD**: `@IsIn` literal đúng allowlist; `forbidNonWhitelisted` reject field lạ; import `HealthStatus` từ `../entities/equipment.entity.js` để khai kiểu; tsc sạch.

---

## T004 — [MODIFY additive] Phase D — notify trong `reportFault`
**File**: `src/modules/equipment/services/equipment.service.ts`
**Vị trí**: cuối method `reportFault`, SAU Phase C (audit, dòng 308-334 hiện tại), TRƯỚC `return new EquipmentResponseDto(...)`.

Thêm import: `NotificationsService`, `NotificationType, NotificationChannel, NotificationPriority` từ `../../notifications/entities/notification.entity.js` và `../../notifications/notifications.service.js`.

Thêm constructor param `private readonly notificationsService: NotificationsService` (additive, cuối danh sách param hiện có).

Thêm helper `resolveSystemAdminIds()` (private, raw SQL — xem plan §1.5) và Phase D:
```ts
// Phase D — notify SYSTEM_ADMIN (fail-separate, KHÔNG rollback nghiệp vụ)
try {
  const adminIds = await this.resolveSystemAdminIds();
  const room = saved.currentRoomId
    ? await this.dataSource.getRepository(RoomEntity).findOne({ where: { id: saved.currentRoomId }, select: { id: true, roomName: true } })
    : null;
  await this.notificationsService.createNotification({
    notificationType: NotificationType.EQUIPMENT_FAULT_REPORTED,
    channel: NotificationChannel.IN_APP,
    subject: 'Thiết bị hỏng cần xử lý',
    content: `Thiết bị ${saved.equipmentName} (${saved.equipmentCode})${room ? ' tại phòng ' + room.roomName : ''} vừa được báo lỗi: ${dto.issueNote}`,
    relatedEntityType: 'equipment',
    relatedEntityId: saved.id,
    recipientScope: 'user_list',
    recipientUserIds: adminIds,
    priority: NotificationPriority.HIGH,
    createdBy: userId,
    payloadJson: { healthStatus: saved.healthStatus, assetStatus: saved.assetStatus, roomId: saved.currentRoomId, issueNote: dto.issueNote },
  });
} catch (err) {
  this.logger.error(`Failed to notify SYSTEM_ADMIN for equipment fault ${saved.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
}
```

**DoD**: Phase A/B/C của `reportFault` KHÔNG đổi 1 ký tự (diff chỉ thêm); Phase D fail-separate (try/catch riêng, không throw ra ngoài); `reportFault` vẫn trả đúng response cũ; tsc sạch.

---

## T005 — [MODIFY additive] `EquipmentService.confirmFault` + `findLastFaultReportAuditLog`
**File**: `src/modules/equipment/services/equipment.service.ts`

Thêm helper `findLastFaultReportAuditLog(equipmentId)` (private — xem plan §1.4).

`confirmFault(equipmentId, dto, userId, ipAddress)`:
- **Phase A**: load equipment (`findOne`) → không có → `NotFoundException` `EQUIPMENT_NOT_FOUND` (404). `equipment.healthStatus === HealthStatus.HEALTHY` → `ConflictException` `EQUIPMENT_NO_ACTIVE_FAULT` (409).
- **Phase B**: `em.save(AuditLogEntity, { userId, actionType:'confirm', entityType:'equipment', entityId: equipment.id, newValueJson:{ confirmationNote: dto.confirmationNote ?? null, healthStatusAtConfirmation: equipment.healthStatus }, ipAddress: ipAddress ?? null, severity: AuditLogSeverity.INFO })` — **KHÔNG update `equipments`**.
- **Phase C** (fail-separate, try/catch riêng): `reporter = await findLastFaultReportAuditLog(equipmentId)`; nếu `reporter && reporter.userId !== userId` → `createNotification({ notificationType: EQUIPMENT_FAULT_CONFIRMED, recipientUserIds: [reporter.userId], ... })`.
- Return `new EquipmentFaultConfirmationResponseDto({ equipmentId: equipment.id, healthStatus: equipment.healthStatus, confirmedBy: userId, confirmedAt: new Date() })`.

**DoD**: healthy → 409; không tồn tại → 404; ghi đúng 1 dòng audit `actionType='confirm'`; KHÔNG có `em.save(EquipmentEntity, ...)` nào trong method này; notify fail-separate; tsc sạch.

---

## T006 — [MODIFY additive] `EquipmentService.resolveFault`
**File**: `src/modules/equipment/services/equipment.service.ts`
**Mirror**: `reportFault` (`:233-351`).

`resolveFault(equipmentId, dto, userId, ipAddress)`:
- **Phase A**: load equipment → 404 `EQUIPMENT_NOT_FOUND`; `healthStatus === HEALTHY` → 409 `EQUIPMENT_NO_ACTIVE_FAULT`; snapshot `oldValue = { healthStatus, assetStatus, lastMaintenanceAt }`.
- **Phase B** (`dataSource.transaction`): `equipment.healthStatus = dto.healthStatus`; `if (dto.assetStatus) equipment.assetStatus = this.resolveAssetAction(dto.assetStatus, equipment.currentRoomId)` (TÁI DÙNG, không viết lại); `equipment.lastMaintenanceAt = new Date()`; KHÔNG đụng `lastIssueReportedAt`/`lastIssueNote`; `em.save(EquipmentEntity, equipment)`.
- **Phase C** (fail-separate): audit `actionType:'update'`, `severity: AuditLogSeverity.INFO` (KHÁC `WARNING` của report), `oldValueJson`/`newValueJson` gồm `healthStatus/assetStatus/lastMaintenanceAt`.
- **Phase D** (fail-separate): `reporter = findLastFaultReportAuditLog(equipmentId)`; nếu có → `createNotification({ notificationType: EQUIPMENT_FAULT_RESOLVED, recipientUserIds:[reporter.userId], ... })`.
- Return `new EquipmentResponseDto({...saved})` (mirror map cuối `reportFault`).

**DoD**: healthy→409; không tồn tại→404; `lastMaintenanceAt` set đúng; `lastIssueReportedAt/Note` KHÔNG đổi; `resolveAssetAction` được GỌI không viết lại; audit severity=INFO; notify fail-separate; tsc sạch.

---

## T007 — [MODIFY additive] `EquipmentController.confirmFault`, `resolveFault`
**File**: `src/modules/equipment/controllers/equipment.controller.ts`
**Mirror**: `reportFault` handler (`:122-149`).

Thêm import: `ConfirmEquipmentFaultDto`, `ResolveEquipmentFaultDto`.

Handler `confirmFault`:
- `@Patch(':equipmentId/fault-confirmation')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.confirm_fault')`, `@UsePipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}))`.
- Tham số mirror `reportFault`: `@Param('equipmentId', ParseUUIDPipe)`, `@Body() dto: ConfirmEquipmentFaultDto`, `@CurrentUser()`, `@Ip()`.
- Gọi `equipmentService.confirmFault(...)`, trả `{success:true, message:'Xac nhan loi thiet bi thanh cong', data}`.

Handler `resolveFault`: tương tự, `@Patch(':equipmentId/fault-resolution')`, permission `equipment.resolve_fault`, gọi `resolveFault(...)`, message `'Cap nhat thiet bi da sua xong thanh cong'`.

Thêm `@ApiOperation`/`@ApiResponse` cho cả 2 (200/400/401/403/404/409) — mirror style handler `reportFault`.

**DoD**: 2 route mới không collision với 5 route hiện có; guard/permission đúng; response shape `{success,message,data}`; `create/reportFault/deleteEquipment/listEquipments/assignToRoom` handler cũ KHÔNG đổi; tsc sạch.

---

## T008 — [CREATE] Migration permission (KHÔNG execute)
**File**: `src/database/migrations/20260814XXXXXX-SeedEquipmentFaultConfirmResolvePermissions.ts`
**Mirror**: `20260811000003-SeedRoomDetailReadPermission.ts` (pattern `up()`/`down()` đầy đủ, có runner thật).

- `up()`: với mỗi permission trong `[{code:'equipment.confirm_fault', name:'Xac nhan loi thiet bi la that', module:'equipment', action:'confirm_fault'}, {code:'equipment.resolve_fault', name:'Cap nhat thiet bi da sua xong', module:'equipment', action:'resolve_fault'}]`:
  1. `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) SELECT ... WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permission_code=$1)`.
  2. `SELECT id FROM permissions WHERE permission_code=$1`.
  3. Với mỗi role trong `['SYSTEM_ADMIN','BUSINESS_ADMIN']`: `INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2::uuid, NOW() FROM roles r WHERE r.role_code=$1 AND r.is_active=true AND NOT EXISTS (SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id=r.id AND rp2.permission_id=$2::uuid)`.
- `down()`: `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1))` rồi `DELETE FROM permissions WHERE permission_code = ANY($1)` với `$1 = ['equipment.confirm_fault','equipment.resolve_fault']`.

**DoD**: idempotent (`WHERE NOT EXISTS`); đúng 2 role; class name + `name` property theo convention TypeORM migration (`<ClassName><timestamp>`); **KHÔNG chạy `migration:run`** trong task này — chỉ tạo file.

---

## T009 — [CREATE] Unit test
**Files** (5 file — xem plan §6 cho danh sách case chi tiết):
- `src/modules/equipment/tests/equipment-report-fault-notify.service.spec.ts` (N1-N3)
- `src/modules/equipment/tests/equipment-confirm-fault.service.spec.ts` (CF1-CF6)
- `src/modules/equipment/tests/equipment-confirm-fault.controller.spec.ts`
- `src/modules/equipment/tests/equipment-resolve-fault.service.spec.ts` (RF1-RF7)
- `src/modules/equipment/tests/equipment-resolve-fault.controller.spec.ts`

Mock `NotificationsService.createNotification` (jest mock), mock `dataSource.manager.query` cho `resolveSystemAdminIds`/raw SQL reporter lookup, mock `dataSource.transaction`/`dataSource.getRepository(AuditLogEntity).find` cho `findLastFaultReportAuditLog`.

**DoD**: toàn bộ case ở plan §6 pass; KHÔNG đụng file test UC-61/UC-62 hiện có; static import.

---

## T010 — Cổng chất lượng (KHÔNG commit, KHÔNG execute migration)
1. `npx tsc --noEmit` — net +0 lỗi với file production.
2. `npx eslint` trên toàn bộ file đã tạo/sửa (3 DTO, 1 migration, service, controller, module, notification entity, 5 test).
3. `npx jest src/modules/equipment` — suite mới pass + suite UC-61/UC-62 vẫn pass (0 regression).
4. `npx jest src/modules/notifications` — 0 regression (chỉ thêm enum, không đổi logic).
5. `git stash` lấy baseline so trước/sau cho `src/modules/equipment`, `src/modules/notifications/entities`.

**DoD**: tsc sạch; eslint sạch; jest equipment + notifications pass toàn bộ; bằng chứng git-stash. **KHÔNG commit, KHÔNG chạy migration.**

---

## Ma trận phủ ràng buộc

| Ràng buộc (§0.2) | Task |
| :--- | :--- |
| 1 confirm chỉ audit, không đổi entity | T005 |
| 2 notify report chỉ SYSTEM_ADMIN | T004 |
| 3 không WebSocket | T004, T005, T006 (chỉ `createNotification`) |
| 4 permission confirm/resolve = SYSTEM_ADMIN+BUSINESS_ADMIN | T007 (guard), T008 (seed) |
| 5 `lastMaintenanceAt` chỉ set ở resolve | T006 |
| 6 giữ `lastIssueReportedAt/Note` khi resolve | T006 |
| 7 không chặn retired/lost ở confirm/resolve | T005, T006 (không có check này, khác `reportFault`) |
| 8 reporter suy từ audit_logs | T005 (helper dùng chung) |

---

## KHÔNG được làm
- KHÔNG migration schema `equipments`; KHÔNG execute migration permission; KHÔNG commit.
- KHÔNG sửa `create`/`deleteEquipment`/`listEquipments`/`assignToRoom`/`resolveAssetAction` (chỉ gọi); KHÔNG sửa `equipment.entity.ts`; KHÔNG sửa module khác ngoài `notification.entity.ts`+`equipment.module.ts`+`equipment.service.ts`+`equipment.controller.ts`.
- KHÔNG đụng file test UC-61/UC-62.
- KHÔNG implement booking gate (`feat-room-equipment-fault-warning`) hay room search badge (`feat-room-search-equipment-badge`) — 2 feature riêng.
- **KHÔNG bắt đầu code cho tới khi có lệnh triển khai rõ ràng từ user.**

---

## Thứ tự thực thi
`T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010`

> Chưa code — chờ duyệt spec/plan/tasks + lệnh triển khai.
