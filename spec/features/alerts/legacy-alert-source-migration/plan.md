# ASM-001 — plan.md (3d Alerts / SAVP: hợp nhất nguồn cảnh báo cũ)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ASM-001 cùng lượt với spec. Chỉ sửa 2 service hiện có + wiring import module, KHÔNG entity/migration DDL mới (có 0 migration schema, nhưng KHÔNG cần permission mới — 3d không thêm endpoint). | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2. **Code 3d chỉ bắt đầu SAU KHI UC-122 VÀ UC-123 đã code xong** (cần `AlertRulesService.findEffectiveRule` + `AlertsService.recordAlert` tồn tại thật).

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `VehicleControlAlertService` constructor hiện tại: `vehicleControlListService, notificationsService, configService, dataSource` — thêm 2 param: `alertRulesService: AlertRulesService`, `alertsService: AlertsService`.
- `StrangerAlertService` constructor hiện tại: `dataSource, configService, websocketService, notificationsService` — thêm 2 param tương tự.
- `AnprModule` (chứa `VehicleControlAlertService`) và `FaceAccessModule` (chứa `StrangerAlertService`) — xác nhận đường dẫn `*.module.ts` thật, đọc `imports` hiện tại trước khi thêm `AlertsModule` (tránh trùng lặp nếu đã có import gián tiếp).
- Không có migration mới ở 3d — KHÔNG cần xác nhận timestamp tiếp theo.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §2 (7 quyết định: zoneId null cho cả 2 nguồn, giữ notification song song + thứ tự gọi, isNew không gate notification, KHÔNG sửa bug role_code, severity tường minh cho vehicle/mặc định cho stranger, tái dùng payload có sẵn, sourceEventId null). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi, KHÔNG migration
0 thay đổi schema. 0 file migration.

## 3. Sửa `VehicleControlAlertService` (modified)
```
src/modules/anpr/services/vehicle-control-alert.service.ts
```
- Constructor thêm `private readonly alertRulesService: AlertRulesService, private readonly alertsService: AlertsService`.
- Trong `evaluate()`, SAU đoạn throttle pass (`this.lastAlertAt.set(...)`), TRƯỚC `resolveRecipients()`:
```ts
const { suppressed, rule } = await this.alertRulesService.findEffectiveRule('vehicle_control_match', null);
if (suppressed) return; // AF1: rule tắt tường minh — dừng cả recordAlert lẫn notification

try {
  const severity = isBlocklist ? 'high' : 'medium';
  await this.alertsService.recordAlert({
    alertType: 'vehicle_control_match',
    zoneId: null,
    severity,
    ruleId: rule?.id ?? null,
    payloadJson: {
      plateNumber: match.plateNumber,
      listType: match.listType,
      reason: match.reason,
      channelId: context.channelId,
      direction: context.direction,
      controlListEntryId: match.id,
    },
  });
} catch (e) {
  this.logger.error(`recordAlert failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`);
  // NotThrow — KHÔNG chặn notification cũ (spec R5).
}
```
- Phần còn lại (`resolveRecipients()` + `createNotification()`) GIỮ NGUYÊN 100%.

## 4. Sửa `StrangerAlertService` (modified)
```
src/modules/face-access/services/stranger-alert.service.ts
```
- Constructor thêm `alertRulesService: AlertRulesService`, `alertsService: AlertsService`.
- Trong `onStranger()`, SAU throttle pass, TRƯỚC đoạn `// WS room-scoped`:
```ts
const { suppressed, rule } = await this.alertRulesService.findEffectiveRule('stranger', null);
if (suppressed) return; // AF1: dừng CẢ WS lẫn notification

try {
  await this.alertsService.recordAlert({
    alertType: 'stranger',
    zoneId: null,
    ruleId: rule?.id ?? null,
    payloadJson: meta, // tái dùng object `meta` đã build sẵn (deviceId/roomId/strangerId/similarity/capturedAt)
  });
} catch (e) {
  this.logger.error(`recordAlert failed (device=${evt.deviceId}): ${e instanceof Error ? e.message : 'unknown'}`);
  // NotThrow — KHÔNG chặn WS/notification cũ (spec R5).
}
```
- Phần còn lại (WS + `resolveAdmins()` + notification + email opt-in) GIỮ NGUYÊN 100% — **KHÔNG sửa bug `role_code='admin'`** (spec §2.4/§7).

## 5. Wiring module (modified)
```
src/modules/anpr/anpr.module.ts
src/modules/face-access/face-access.module.ts
```
- Thêm `AlertsModule` vào `imports` của cả 2 (nếu chưa có sẵn qua import gián tiếp — xác nhận ở T0).

## 6. File list
### Modified (4 file)
- `src/modules/anpr/services/vehicle-control-alert.service.ts` (+ `.spec.ts` cập nhật)
- `src/modules/face-access/services/stranger-alert.service.ts` (+ `.spec.ts` cập nhật)
- `src/modules/anpr/anpr.module.ts`
- `src/modules/face-access/face-access.module.ts`
> Tổng **0 net-new + 4 modified** (không tính 2 file `.spec.ts` cập nhật thêm case). 0 migration, 0 entity.

## 7. Test (mock service — KHÔNG DB)
- `VehicleControlAlertService.evaluate()`: suppressed=true → `recordAlert`/`createNotification` đều KHÔNG bị gọi; suppressed=false → `recordAlert` gọi trước `createNotification` (assert thứ tự qua mock call order), severity đúng theo `listType`; `recordAlert` throw → `createNotification` VẪN được gọi (assert NotThrow).
- `StrangerAlertService.onStranger()`: 3 case tương tự, thay kiểm cả WS lẫn notification khi suppressed.
- Coverage phần sửa **≥80%** (dòng mới thêm).

## 8. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/anpr src/modules/face-access src/modules/alerts` xanh (KHÔNG hồi quy UC1/UC8/UC9/SAL-001 test cũ); coverage phần sửa ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: bug `role_code='admin'` · `zoneId` thật · `sourceEventId` thật · cảnh báo camera offline.

## 9. Kỷ luật
- **SAFETY-01**: mọi lỗi `recordAlert()`/`findEffectiveRule()` PHẢI bị nuốt, KHÔNG phá luồng cũ.
- **ARCH-01/02**: chiều import `anpr/face-access → alerts`, KHÔNG `forwardRef`.
- KHÔNG sửa bug `role_code` ở đây — residual riêng.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md (SAU khi UC-122+UC-123 code xong). KHÔNG tự code.
