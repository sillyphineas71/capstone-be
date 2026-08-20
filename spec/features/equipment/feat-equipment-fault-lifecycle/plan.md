# PLAN — EQUIP-FAULT-LIFECYCLE-001: Notify sysadmin + Xác nhận + Xử lý xong lỗi thiết bị

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-08-14 | Tạo mới plan.md cho EQUIP-FAULT-LIFECYCLE-001. | Toàn bộ file |
| 2026-08-20 | ĐẢO NGƯỢC quyết định #3: notify report giờ gửi `BUSINESS_ADMIN` (không còn `SYSTEM_ADMIN`) — theo yêu cầu người dùng, xem `spec.md` changelog cùng ngày. | Mục 0.2 (dòng #3), Phase D |

> Dựa trên `spec.md` (EQUIP-FAULT-LIFECYCLE-001) đã duyệt. **CHỈ kế hoạch** — KHÔNG code, KHÔNG task breakdown.
> Mirror pattern `reportFault`/`create` (UC-61/UC-62) trong cùng module. THÊM additive vào `EquipmentService`/`EquipmentController`/`EquipmentModule` sẵn có.

---

## 0. Ràng buộc & quyết định đã chốt (không mở lại)

### 0.1. Bối cảnh
- Module `equipment` đã có nền UC-61/UC-62: `EquipmentService`/`EquipmentController` đầy đủ 5 method (`create, reportFault, deleteEquipment, listEquipments, assignToRoom`), `EquipmentResponseDto`, `resolveAssetAction()` helper (`services/equipment.service.ts:209-222`), wiring `AccountsModule/RoomsModule/AuthModule/JwtModule` trong `equipment.module.ts`.
- Feature này = **THÊM** `confirmFault`/`resolveFault` vào service + 2 handler vào controller + Phase D vào `reportFault` **sẵn có** (KHÔNG tạo service/controller mới, KHÔNG sửa 4 method còn lại).
- Bảng `equipments` đã đủ cột (`health_status`, `asset_status`, `last_issue_reported_at`, `last_issue_note`, `last_maintenance_at`) ⇒ **KHÔNG migration schema**. Chỉ migration permission.

### 0.2. 8 ràng buộc chốt (từ spec §11)
| # | Chốt |
| :--- | :--- |
| 1 | "Đã xác nhận" chỉ lưu ở `audit_logs` (`actionType='confirm'`), KHÔNG thêm cột `equipments`. |
| 2 | (thuộc spec khác — booking gate chỉ `faulty/offline`, không liên quan file sửa ở đây) |
| 3 | Notification report chỉ gửi role `BUSINESS_ADMIN` (raw SQL — đảo ngược 2026-08-20, trước đó là `SYSTEM_ADMIN`). |
| 4 | KHÔNG WebSocket real-time — chỉ `notificationsService.createNotification()` (in-app inbox). |
| 5 | Permission `equipment.confirm_fault`/`equipment.resolve_fault` → `[SYSTEM_ADMIN, BUSINESS_ADMIN]`. |
| 6 | `lastMaintenanceAt=now()` set CHỈ ở `resolveFault`, KHÔNG set ở `confirmFault`. |
| 7 | `resolveFault` KHÔNG xóa `lastIssueReportedAt`/`lastIssueNote` cũ — giữ làm lịch sử. |
| 8 | `confirmFault`/`resolveFault` KHÔNG kế thừa chặn `retired/lost` của `reportFault` (§7.2 spec). |

### 0.3. Xác nhận module cần sửa
`equipment.module.ts` hiện có `AccountsModule, RoomsModule, AuthModule, JwtModule.register({}), TypeOrmModule.forFeature([EquipmentEntity])` — **THIẾU** `NotificationsModule` ⇒ **PHẢI THÊM** (mirror `anpr.module.ts:52` — import trực tiếp, không cần `forwardRef`, không circular vì `NotificationsModule` không import ngược).

---

## 1. Kiến trúc & luồng

### 1.1. Phase D — notify (thêm vào `reportFault` đã có)
```
EquipmentService.reportFault(...)   [KHÔNG đổi Phase A/B/C hiện có]
  → Phase C (audit, đã có, không đổi)
  → Phase D (THÊM) — fail-separate, try/catch riêng:
      1. resolveSystemAdminIds() — raw SQL, mirror resolveAdmins() (stranger-alert.service.ts:165-179)
      2. load RoomEntity theo saved.currentRoomId (nếu có) lấy roomName cho content
      3. notificationsService.createNotification({
           notificationType: NotificationType.EQUIPMENT_FAULT_REPORTED,
           channel: NotificationChannel.IN_APP,
           subject: 'Thiết bị hỏng cần xử lý',
           content: `Thiết bị ${saved.equipmentName} (${saved.equipmentCode})${roomName ? ' tại phòng ' + roomName : ''} vừa được báo lỗi: ${dto.issueNote}`,
           relatedEntityType: 'equipment', relatedEntityId: saved.id,
           recipientScope: 'user_list', recipientUserIds: adminIds,
           priority: NotificationPriority.HIGH, createdBy: userId,
           payloadJson: { healthStatus: saved.healthStatus, assetStatus: saved.assetStatus, roomId: saved.currentRoomId, issueNote: dto.issueNote },
         })
      catch → logger.error, KHÔNG throw
  → return (không đổi map response hiện có)
```

### 1.2. `confirmFault` (MỚI)
```
PATCH /api/v1/equipments/:equipmentId/fault-confirmation
  → EquipmentController.confirmFault (THÊM)
      JwtAuthGuard(class) → PermissionsGuard('equipment.confirm_fault') → ValidationPipe(ConfirmEquipmentFaultDto)
      @Param('equipmentId', ParseUUIDPipe) @Body() dto @CurrentUser() @Ip()
  → EquipmentService.confirmFault(equipmentId, dto, userId, ipAddress) (THÊM)
      Phase A — validate:
        - load equipment → không có → 404 EQUIPMENT_NOT_FOUND
        - healthStatus === HEALTHY → 409 EQUIPMENT_NO_ACTIVE_FAULT
      Phase B — ghi audit (KHÔNG update equipments, KHÔNG transaction cho entity):
        - em.save(AuditLogEntity, { userId, actionType:'confirm', entityType:'equipment', entityId,
            newValueJson:{ confirmationNote: dto.confirmationNote ?? null, healthStatusAtConfirmation: equipment.healthStatus },
            ipAddress, severity: AuditLogSeverity.INFO })
      Phase C — notify reporter (fail-separate):
        - reporterId = findLastFaultReportAuditLog(equipmentId)?.userId
        - nếu có và !== userId → createNotification(EQUIPMENT_FAULT_CONFIRMED, recipientUserIds:[reporterId])
      → { equipmentId, healthStatus: equipment.healthStatus, confirmedBy: userId, confirmedAt: new Date() }
  → 200 { success, message, data }
```

### 1.3. `resolveFault` (MỚI)
```
PATCH /api/v1/equipments/:equipmentId/fault-resolution
  → EquipmentController.resolveFault (THÊM)
      JwtAuthGuard(class) → PermissionsGuard('equipment.resolve_fault') → ValidationPipe(ResolveEquipmentFaultDto)
  → EquipmentService.resolveFault(equipmentId, dto, userId, ipAddress) (THÊM)
      Phase A — validate:
        - load equipment → không có → 404 EQUIPMENT_NOT_FOUND
        - healthStatus === HEALTHY → 409 EQUIPMENT_NO_ACTIVE_FAULT
        - snapshot oldValue { healthStatus, assetStatus, lastMaintenanceAt }
      Phase B — transaction cập nhật:
        - equipment.healthStatus = dto.healthStatus
        - if (dto.assetStatus) equipment.assetStatus = resolveAssetAction(dto.assetStatus, equipment.currentRoomId)  // TÁI DÙNG helper có sẵn
        - equipment.lastMaintenanceAt = new Date()
        - KHÔNG đổi lastIssueReportedAt/lastIssueNote (giữ lịch sử)
        - em.save(EquipmentEntity, equipment)
      Phase C — audit fail-separate: actionType:'update', severity: AuditLogSeverity.INFO (KHÁC WARNING của report)
      Phase D — notify reporter (fail-separate), giống confirmFault, notificationType=EQUIPMENT_FAULT_RESOLVED
      → new EquipmentResponseDto({...saved})  // TÁI DÙNG shape reportFault
  → 200 { success, message, data }
```

### 1.4. Helper mới — `findLastFaultReportAuditLog`
```ts
private async findLastFaultReportAuditLog(equipmentId: string): Promise<{ userId: string } | null> {
  const rows = await this.dataSource.getRepository(AuditLogEntity).find({
    where: { entityType: 'equipment', entityId: equipmentId, actionType: 'update', severity: AuditLogSeverity.WARNING },
    order: { createdAt: 'DESC' },
    take: 1,
  });
  return rows[0] ? { userId: rows[0].userId } : null;
}
```
Dùng chung cho cả `confirmFault` và `resolveFault`.

### 1.5. Helper mới — `resolveBusinessAdminIds` (đổi tên 2026-08-20, trước đó là `resolveSystemAdminIds`)
```ts
private async resolveBusinessAdminIds(): Promise<string[]> {
  const rows: Array<{ id: string }> = await this.dataSource.manager.query(
    `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN roles r ON r.id = ur.role_id
      WHERE r.role_code = 'BUSINESS_ADMIN' AND u.deleted_at IS NULL`,
  );
  return rows.map((r) => r.id);
}
```
Mirror chính xác `resolveAdmins()`/`resolveRecipients()` đã có ở `stranger-alert.service.ts`/`vehicle-control-alert.service.ts`.

### 1.6. Mirror pattern (trỏ dòng thật)
| Thành phần mới | Mirror từ |
| :--- | :--- |
| Phase D notify trong `reportFault` | `stranger-alert.service.ts:124-132` (gọi `createNotification`) |
| `resolveSystemAdminIds()` | `stranger-alert.service.ts:165-179` (`resolveAdmins()`), `vehicle-control-alert.service.ts:254-264` (`resolveRecipients()`) |
| `confirmFault`/`resolveFault` cấu trúc 3-phase | `reportFault` chính nó (`equipment.service.ts:233-351`) |
| Transaction cập nhật trong `resolveFault` | `reportFault` Phase B (`:291-306`) |
| Audit fail-separate | `reportFault` Phase C (`:308-334`) |
| Controller handler mới | `EquipmentController.reportFault` (`:122-149`) |
| Seed permission migration | `20260811000003-SeedRoomDetailReadPermission.ts` (pattern up/down mới nhất, KHÔNG dùng seed cũ trong `seeds/`) |

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/modules/equipment/dto/confirm-equipment-fault.dto.ts` | `ConfirmEquipmentFaultDto` |
| `src/modules/equipment/dto/resolve-equipment-fault.dto.ts` | `ResolveEquipmentFaultDto` |
| `src/modules/equipment/dto/equipment-fault-confirmation-response.dto.ts` | `EquipmentFaultConfirmationResponseDto` (response nhẹ cho confirm) |
| `src/database/migrations/20260814XXXXXX-SeedEquipmentFaultConfirmResolvePermissions.ts` | Seed 2 permission mới (migration thật, có runner) |
| `src/modules/equipment/tests/equipment-confirm-fault.service.spec.ts` | Unit test service `confirmFault` |
| `src/modules/equipment/tests/equipment-confirm-fault.controller.spec.ts` | Unit test controller `confirmFault` |
| `src/modules/equipment/tests/equipment-resolve-fault.service.spec.ts` | Unit test service `resolveFault` |
| `src/modules/equipment/tests/equipment-resolve-fault.controller.spec.ts` | Unit test controller `resolveFault` |
| `src/modules/equipment/tests/equipment-report-fault-notify.service.spec.ts` | Unit test Phase D (notify) của `reportFault` |

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/notifications/entities/notification.entity.ts` | THÊM 3 giá trị enum `NotificationType`: `EQUIPMENT_FAULT_REPORTED`, `EQUIPMENT_FAULT_CONFIRMED`, `EQUIPMENT_FAULT_RESOLVED`. KHÔNG đổi giá trị cũ. |
| `src/modules/equipment/equipment.module.ts` | THÊM `NotificationsModule` vào `imports`. |
| `src/modules/equipment/services/equipment.service.ts` | THÊM Phase D vào `reportFault`; THÊM `confirmFault`, `resolveFault`, `findLastFaultReportAuditLog`, `resolveSystemAdminIds`; THÊM constructor inject `NotificationsService`. KHÔNG đụng `create`/`deleteEquipment`/`listEquipments`/`assignToRoom`/`resolveAssetAction`. |
| `src/modules/equipment/controllers/equipment.controller.ts` | THÊM handler `confirmFault`, `resolveFault`. KHÔNG đụng 5 handler hiện có. |

> KHÔNG sửa `equipment.entity.ts` (không thêm cột — §0.2 spec).

---

## 3. Thiết kế chi tiết

### 3.1. Constructor `EquipmentService` (SỬA — additive)
```ts
constructor(
  @InjectRepository(EquipmentEntity) private readonly equipmentRepo: Repository<EquipmentEntity>,
  private readonly dataSource: DataSource,
  private readonly notificationsService: NotificationsService,  // THÊM
) {}
```

### 3.2. Chữ ký method mới
```ts
confirmFault(equipmentId: string, dto: ConfirmEquipmentFaultDto, userId: string, ipAddress?: string): Promise<EquipmentFaultConfirmationResponseDto>
resolveFault(equipmentId: string, dto: ResolveEquipmentFaultDto, userId: string, ipAddress?: string): Promise<EquipmentResponseDto>
```

### 3.3. Error handling map (2 endpoint mới)
| Tình huống | Exception | HTTP | `error.code` |
| :--- | :--- | :--- | :--- |
| DTO sai (`confirmationNote` quá dài, `healthStatus` resolve ngoài allowlist, `resolutionNote` rỗng) | `ValidationPipe` | 400 | (validation) |
| Thiết bị không tồn tại | `NotFoundException` | 404 | `EQUIPMENT_NOT_FOUND` |
| `healthStatus === healthy` (không có fault active) | `ConflictException` | 409 | `EQUIPMENT_NO_ACTIVE_FAULT` |
| Chưa đăng nhập | `JwtAuthGuard` | 401 | — |
| Thiếu quyền | `PermissionsGuard` | 403 | — |

Payload chuẩn: `{success:false,message,error:{code,details},timestamp:new Date().toISOString(),path}` — mirror `reportFault`.

---

## 4. RBAC + Seed migration

### 4.1. Permission
| permission_code | permission_name | module_code | action_code | roles |
| :--- | :--- | :--- | :--- | :--- |
| `equipment.confirm_fault` | Xác nhận lỗi thiết bị là thật | `equipment` | `confirm_fault` | `SYSTEM_ADMIN, BUSINESS_ADMIN` |
| `equipment.resolve_fault` | Cập nhật thiết bị đã sửa xong | `equipment` | `resolve_fault` | `SYSTEM_ADMIN, BUSINESS_ADMIN` |

### 4.2. Migration
Copy chính xác cấu trúc `up()`/`down()` của `20260811000003-SeedRoomDetailReadPermission.ts`:
- `up()`: với mỗi permission — `INSERT INTO permissions (...) SELECT ... WHERE NOT EXISTS (...)`, `SELECT id FROM permissions WHERE permission_code=...`, loop role → `INSERT INTO role_permissions (...) SELECT r.id, $2::uuid, NOW() FROM roles r WHERE r.role_code=$1 AND r.is_active=true AND NOT EXISTS (...)`.
- `down()`: `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE permission_code = ANY($1))` rồi `DELETE FROM permissions WHERE permission_code = ANY($1)`.
- Idempotent, an toàn chạy lại. Đặt trong `src/database/migrations/` (CÓ runner — khác `seeds/` không runner).

**KHÔNG execute migration trong giai đoạn plan/tasks** — chỉ tạo file, chờ lệnh riêng để chạy `npm run migration:run`.

---

## 5. NotificationType — giá trị mới

| Giá trị enum | Dùng khi |
| :--- | :--- |
| `EQUIPMENT_FAULT_REPORTED = 'equipment_fault_reported'` | Phase D của `reportFault`, gửi BUSINESS_ADMIN |
| `EQUIPMENT_FAULT_CONFIRMED = 'equipment_fault_confirmed'` | `confirmFault`, gửi reporter |
| `EQUIPMENT_FAULT_RESOLVED = 'equipment_fault_resolved'` | `resolveFault`, gửi reporter |

Chỉ thêm giá trị enum trên cột `varchar` sẵn có của `notifications.notification_type` — KHÔNG đổi schema bảng `notifications`.

---

## 6. Test plan (liệt kê — implement ở bước sau)

### 6.1. `equipment-report-fault-notify.service.spec.ts`
- **N1**: report thành công → `notificationsService.createNotification` được gọi đúng 1 lần với `notificationType=EQUIPMENT_FAULT_REPORTED`, `recipientUserIds` = kết quả `resolveSystemAdminIds()`.
- **N2**: `resolveSystemAdminIds()` trả `[]` → `createNotification` vẫn gọi (hoặc bỏ qua tùy quyết định code — ghi rõ khi implement) nhưng KHÔNG throw, `reportFault` vẫn trả 200.
- **N3**: `createNotification` reject → `reportFault` vẫn resolve 200 (fail-separate).

### 6.2. `equipment-confirm-fault.service.spec.ts`
- **CF1**: thiết bị `faulty` → confirm OK, `audit_logs` có `actionType='confirm'`, `equipments.health_status` KHÔNG đổi.
- **CF2**: thiết bị `healthy` → 409 `EQUIPMENT_NO_ACTIVE_FAULT`.
- **CF3**: thiết bị không tồn tại → 404.
- **CF4**: tìm được reporter khác actor → `createNotification(EQUIPMENT_FAULT_CONFIRMED)` gọi đúng 1 lần với `recipientUserIds:[reporterId]`.
- **CF5**: reporter === actor hiện tại → KHÔNG gọi notify (tự confirm lỗi mình report — không cần tự nhắc mình).
- **CF6**: không tìm được reporter (audit rỗng) → không lỗi, không gọi notify.

### 6.3. `equipment-resolve-fault.service.spec.ts`
- **RF1**: `healthStatus='healthy'` → OK, `data.healthStatus='healthy'`, `lastMaintenanceAt` set, `lastIssueNote`/`lastIssueReportedAt` giữ nguyên.
- **RF2**: `healthStatus='warning'` → OK.
- **RF3**: có `assetStatus` → resolve qua `resolveAssetAction()` đúng (test `active`→ASSIGNED/AVAILABLE, `retired`→RETIRED).
- **RF4**: thiết bị `healthy` → 409 `EQUIPMENT_NO_ACTIVE_FAULT`.
- **RF5**: thiết bị không tồn tại → 404.
- **RF6**: audit fail-separate — `em.save(AuditLogEntity)` reject → `resolveFault` vẫn resolve.
- **RF7**: notify reporter đúng `EQUIPMENT_FAULT_RESOLVED`.

### 6.4. Controller specs
- Mirror `equipment-report-fault.controller.spec.ts` (guard metadata, `@RequirePermissions`, response shape) cho cả 2 handler mới.

---

## 7. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| Circular dependency khi import `NotificationsModule` vào `EquipmentModule` | Đã verify `NotificationsModule` (`notifications.module.ts:50-76`) KHÔNG import `EquipmentModule`/`RoomsModule`/`MeetingsModule` — chỉ export `TypeOrmModule`+`NotificationsService`. An toàn, có 3 tiền lệ (`AnprModule`, `FaceAccessModule`, `AlertsModule`). |
| Nhầm audit log của `assignToRoom` (cũng `actionType='update'`) với report | Phân biệt bằng `severity`: report=`WARNING`, assign=`INFO` (đã verify §0.3 spec). |
| Sửa nhầm `reportFault` Phase A/B/C hiện có | Chỉ THÊM Phase D ở cuối method; đọc lại diff đảm bảo Phase A/B/C không đổi. |
| Seed permission đặt nhầm `seeds/` (không có runner) | BẮT BUỘC đặt `src/database/migrations/`, mirror `20260811000003-SeedRoomDetailReadPermission.ts`. |
| `resolveAssetAction()` là `private` — gọi được từ `resolveFault`? | Cùng class `EquipmentService` → gọi trực tiếp được, không cần đổi visibility. |

---

## 8. Tác động code người khác

- **KHÔNG sửa** `create`/`deleteEquipment`/`listEquipments`/`assignToRoom` trong `EquipmentService`, KHÔNG sửa 5 endpoint hiện có ngoài việc thêm Phase D vào `reportFault`.
- **KHÔNG sửa** `equipment.entity.ts` (không thêm cột).
- **SỬA additive**: `notification.entity.ts` (+3 enum value), `equipment.module.ts` (+1 import), `equipment.service.ts`, `equipment.controller.ts`.
- **KHÔNG đụng** `rooms/meetings/accounts/iot/auth/administration` module (chỉ đọc tham chiếu `RoomEntity`, `AuditLogEntity` đã import sẵn).

---

## 9. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/modules/equipment/dto/confirm-equipment-fault.dto.ts`
- [ ] `src/modules/equipment/dto/resolve-equipment-fault.dto.ts`
- [ ] `src/modules/equipment/dto/equipment-fault-confirmation-response.dto.ts`
- [ ] `src/database/migrations/20260814XXXXXX-SeedEquipmentFaultConfirmResolvePermissions.ts` (KHÔNG execute)
- [ ] 5 file test (§2.1)

**SỬA (additive)**
- [ ] `src/modules/notifications/entities/notification.entity.ts` (+3 enum)
- [ ] `src/modules/equipment/equipment.module.ts` (+`NotificationsModule`)
- [ ] `src/modules/equipment/services/equipment.service.ts` (+Phase D, +2 method, +2 helper, +DI)
- [ ] `src/modules/equipment/controllers/equipment.controller.ts` (+2 handler)

**KHÔNG làm**: migration schema `equipments`; execute migration permission; sửa `create`/4 method còn lại/`equipment.entity.ts`/module khác ngoài `notifications.entity.ts`; implement booking gate hay room search badge (2 spec riêng).
