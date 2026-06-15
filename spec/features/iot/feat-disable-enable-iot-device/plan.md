---
name: feat-disable-enable-iot-device-plan
description: Kế hoạch hiện thực IOT-012 — POST /api/v1/iot-devices/:id/disable và /enable (status-based, ADR-008).
category: iot
---

# Implementation Plan: Vô hiệu hóa / Kích hoạt lại thiết bị IoT/Camera (IOT-012)

- **Feature ID**: IOT-012
- **Module**: `iot`
- **Spec Reference**: [spec.md](./spec.md)
- **Status**: Draft

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan.md cho IOT-012: 2 handler POST disable/enable (`@HttpCode(200)`), service.disable()/enable(), logDeviceStatusChange, seed 2 permission. Xác minh code thật (controller POST action như assign-room; audit repo chưa có logDeviceStatusChange; status enum). | Toàn bộ file (bản đầu tiên) |

---

## 1. Technical Context

- **Framework**: NestJS 11 + PostgreSQL + TypeORM. Module resolution **nodenext** → import nội bộ có đuôi `.js`.
- **Trạng thái module `iot`** (đã xác minh trong code):
  - [iot-devices.controller.ts](../../../../src/modules/iot/controllers/iot-devices.controller.ts): action endpoint hiện có dùng `@Post(':id/assign-room')` + `JwtAuthGuard` + `MockPermissionsGuard` (no-op) + `@Permissions(...)` (no-op). IOT-011 đã thêm `@Patch(':id')`.
  - [iot-devices.service.ts](../../../../src/modules/iot/services/iot-devices.service.ts): có `create`, `update` (IOT-011), `assignRoom`, `configureFaceServer`, `configureRtsp`, `checkAvailability`. Pattern transaction: `dataSource.createQueryRunner()` → `manager.save(IoTDeviceEntity, device)`. **Chưa có `disable`/`enable`**.
  - [iot-audit.repository.ts](../../../../src/modules/iot/repositories/iot-audit.repository.ts): có `logDeviceCreation`, `logDeviceUpdate`, `logAssignRoom`, `logConfigureFaceServer`, `logConfigureRtsp`. **Chưa có `logDeviceStatusChange`**.
  - [iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts): `IoTDeviceStatus` = `ONLINE|OFFLINE|DISABLED|MAINTENANCE`. `@UpdateDateColumn` tự cập nhật `updated_at` khi `save`. **KHÔNG sửa entity, KHÔNG migration schema.**
  - [iot-device-response.dto.ts](../../../../src/modules/iot/dto/iot-device-response.dto.ts): `toIotDeviceResponse()` trả snake_case + mask metadata.
- **Quan trọng — HTTP code**: NestJS `@Post()` mặc định trả **201**. Spec yêu cầu **200** cho cả 2 hành động ⇒ handler PHẢI gắn `@HttpCode(200)` (import từ `@nestjs/common`).
- **Database**: `iot_devices` + `audit_logs` đã có; `audit_logs.action_type` là varchar tự do (giá trị hiện dùng: create/update/assign_room/configure_*) ⇒ thêm `disable`/`enable` không cần thay đổi schema.

---

## 2. Danh sách thay đổi (file)

| Loại | File | Nội dung |
|---|---|---|
| **Sửa** | `src/modules/iot/services/iot-devices.service.ts` | Thêm `disable(userId, deviceId)` và `enable(userId, deviceId)`. |
| **Sửa** | `src/modules/iot/repositories/iot-audit.repository.ts` | Thêm `logDeviceStatusChange(manager, { userId, deviceId, action, oldStatus, newStatus })`. |
| **Sửa** | `src/modules/iot/controllers/iot-devices.controller.ts` | Thêm `@Post(':id/disable')` + `@Post(':id/enable')`, mỗi cái `@HttpCode(200)`. |
| **Mới (seed)** | `src/database/seeds/<timestamp>-SeedIotDeviceDisableEnablePermissions.ts` | Seed 2 permission `iot.device.disable`, `iot.device.enable` + gán role (theo pattern seed). |
| **Mới (test)** | `src/modules/iot/services/iot-devices.service.spec.ts` (bổ sung) | describe block cho `disable`/`enable`. |

> Không cần DTO (2 endpoint không body). Module wiring đã đủ (controller/service khai báo trong [iot.module.ts](../../../../src/modules/iot/iot.module.ts)).

---

## 3. Service — thuật toán

Import bổ sung: `IoTDeviceStatus` (đã import sẵn trong service).

### 3.1 `disable(userId: string | null, deviceId: string): Promise<IoTDeviceEntity>`

```text
1. Load device theo id. Không có → NotFoundException { code:'IOT_DEVICE_NOT_FOUND' }  (EC-002/404)
2. Nếu device.status === DISABLED → return device  (no-op, không transaction/audit)  (FR-003/200)
3. Transaction:
   a. oldStatus = device.status; device.status = DISABLED;
   b. manager.save(IoTDeviceEntity, device);
   c. logDeviceStatusChange(manager, { userId, deviceId, action:'disable', oldStatus, newStatus: DISABLED });
   d. commit. (catch → rollback → throw)  (FR-015)
4. return savedDevice.  (KHÔNG chạm health/last_seen/room/metadata — FR-007)
```

### 3.2 `enable(userId: string | null, deviceId: string): Promise<IoTDeviceEntity>`

```text
1. Load device theo id. Không có → NotFoundException IOT_DEVICE_NOT_FOUND.  (EC-002/404)
2. Nếu device.status !== DISABLED → return device  (no-op)  (FR-006/200)
3. Transaction:
   a. device.status = OFFLINE;
   b. manager.save(IoTDeviceEntity, device);
   c. logDeviceStatusChange(manager, { userId, deviceId, action:'enable', oldStatus: DISABLED, newStatus: OFFLINE });
   d. commit.
4. return savedDevice.  (KHÔNG chạm health/last_seen/room — FR-007)
```

- Cả 2 chỉ gán `device.status`; mọi cột khác giữ nguyên. `updated_at` tự đổi nhờ `@UpdateDateColumn` (chỉ ở nhánh có thay đổi).

---

## 4. Audit — `logDeviceStatusChange`

Mirror `logDeviceUpdate` (insert raw vào `audit_logs`):

```ts
async logDeviceStatusChange(
  entityManager: EntityManager,
  params: {
    userId: string | null;
    deviceId: string;
    action: 'disable' | 'enable';
    oldStatus: string;
    newStatus: string;
  },
): Promise<void> {
  await entityManager.query(
    `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
     VALUES ($1, $2, 'iot_devices', $3, 'info', $4::jsonb)`,
    [
      params.userId,
      params.action, // 'disable' | 'enable'
      params.deviceId,
      JSON.stringify({ changed_fields: { status: { old: params.oldStatus, new: params.newStatus } } }),
    ],
  );
}
```

- `action_type` = `'disable'` | `'enable'`; `entity_type='iot_devices'`. Không secret (SEC-01).

---

## 5. Controller — 2 handler POST

```ts
import { Post, HttpCode, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';

@Post(':id/disable')
@HttpCode(200)
@UseGuards(JwtAuthGuard, MockPermissionsGuard)
@Permissions('iot.device.disable')
async disable(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
  const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
  const device = await this.iotDevicesService.disable(userId, id);
  return { success: true, message: 'IoT device disabled successfully', data: toIotDeviceResponse(device) };
}

@Post(':id/enable')
@HttpCode(200)
@UseGuards(JwtAuthGuard, MockPermissionsGuard)
@Permissions('iot.device.enable')
async enable(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
  const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
  const device = await this.iotDevicesService.enable(userId, id);
  return { success: true, message: 'IoT device enabled successfully', data: toIotDeviceResponse(device) };
}
```

- `@HttpCode(200)` ép 200 (POST mặc định 201).
- `ParseUUIDPipe` cho `:id` → sai UUID = 400 (EC-001).
- Không `@Body()`, không DTO, không `ValidationPipe` (không có body để validate).
- Decorator quyền dùng dot-notation `iot.device.disable` / `iot.device.enable` (khớp store/seed; decorator mock no-op như IOT-011 → xem [NC-P2]).

---

## 6. Seed 2 permission

File `src/database/seeds/<timestamp>-SeedIotDeviceDisableEnablePermissions.ts` mirror [SeedIotDeviceUpdatePermission.ts](../../../../src/database/seeds/20260615000001-SeedIotDeviceUpdatePermission.ts):

- INSERT 2 permission:
  - `('iot.device.disable', 'Vô hiệu hóa thiết bị IoT', 'iot', 'device_disable', '<mô tả>', true)`
  - `('iot.device.enable', 'Kích hoạt lại thiết bị IoT', 'iot', 'device_enable', '<mô tả>', true)`
  - mỗi cái `ON CONFLICT (permission_code) DO NOTHING`.
- Gán cho role `ADMIN`, `MANAGER` qua `role_permissions` (`ON CONFLICT DO NOTHING`).
- Ghi chú: **seed-runner chưa wire là vấn đề team-wide, ngoài phạm vi feature** (xem [NC-P1]).

---

## 7. Error mapping (khớp spec §8.1)

| Tình huống | Cơ chế | HTTP | code |
|---|---|---|---|
| Sai UUID `:id` | `ParseUUIDPipe` | 400 | VALIDATION_ERROR |
| Không có JWT | `JwtAuthGuard` | 401 | UNAUTHORIZED |
| Thiếu quyền | `PermissionsGuard` (thật) | 403 | FORBIDDEN |
| Không thấy device | `NotFoundException` | 404 | IOT_DEVICE_NOT_FOUND |
| Lỗi DB | transaction rollback | 500 | INTERNAL_SERVER_ERROR |

> Không có nhánh 409 (đổi status không có ràng buộc unique). Body gửi kèm bị Nest bỏ qua (không có `@Body()`), không lỗi (EC-003).

---

## 8. Testing (ENG-01 ≥ 80%)

Bổ sung vào [iot-devices.service.spec.ts](../../../../src/modules/iot/services/iot-devices.service.spec.ts): thêm `auditRepoMock.logDeviceStatusChange = jest.fn()`.

### 8.1 `disable`
1. **Happy**: status='online' → save + logDeviceStatusChange(action='disable') 1 lần, kết quả status='disabled'. *(AC-001)*
2. **Idempotent**: status='disabled' → return device, KHÔNG transaction/save/audit. *(AC-002/FR-003)*
3. **Not found**: device null → NotFoundException. *(EC-002)*
4. **Không chạm field khác**: health_status/last_seen_at/room_id giữ nguyên sau disable. *(AC-005/FR-007)*
5. **Rollback**: logDeviceStatusChange reject → rollbackTransaction gọi. *(FR-015)*

### 8.2 `enable`
6. **Happy**: status='disabled' → save + audit(action='enable'), kết quả status='offline'. *(AC-003)*
7. **No-op khi không disabled**: status='online' → return device, không transaction/audit, status vẫn 'online'. *(AC-004/FR-006)*
8. **Not found**: device null → NotFoundException. *(EC-002)*

- Coverage ≥ 80% cho code mới. Controller/e2e: theo chuẩn module `iot` (chủ yếu unit service). Không e2e (xem [NC-P3]).

---

## 9. Ràng buộc & ngoài phạm vi (tự kiểm)

- KHÔNG sửa `IoTDeviceEntity`, KHÔNG migration schema, KHÔNG bảng mới (DATA-01).
- KHÔNG hard-delete, KHÔNG `deleted_at`, KHÔNG cascade `iot_device_events` (ADR-008 / FR-008).
- KHÔNG đụng `health_status`/`last_seen_at`/`room_id`/`metadata_json`/`device_code`/`device_type`.
- KHÔNG Prisma; import `.js` (nodenext); KHÔNG log secret (SEC-01).

---

## 10. [NEEDS CLARIFICATION] (kế thừa từ IOT-011, team-wide — không chặn)

- **[NC-P1] Seed-runner chưa wire**: `src/database/seeds/*.ts` không có orchestrator/script `seed`, không thuộc migrations glob. Plan tạo file seed theo convention; cơ chế apply là vấn đề team-wide ngoài phạm vi IOT-012. (Giống IOT-011.)
- **[NC-P2] PermissionsGuard thật**: controller `iot` dùng `MockPermissionsGuard` (no-op). 2 handler mới giữ pattern mock; enforce 403 runtime thật là task team-wide riêng. FR-012 đảm bảo ở mức thiết kế.
- **[NC-P3] Phạm vi test**: chỉ unit service (8 case) đủ theo chuẩn module `iot`, không e2e — xác nhận.

---

## 11. Definition of Done

```text
[ ] service.disable(): 404 / no-op nếu đã disabled / transaction set DISABLED + audit
[ ] service.enable(): 404 / no-op nếu khác disabled / transaction set OFFLINE + audit
[ ] IotAuditRepository.logDeviceStatusChange (action_type disable|enable, status old/new)
[ ] controller @Post(':id/disable') + @Post(':id/enable') + @HttpCode(200) + ParseUUIDPipe
[ ] Seed 2 permission iot.device.disable / iot.device.enable (ADMIN/MANAGER)
[ ] Unit test 8 case; coverage ≥ 80%
[ ] Không đụng entity/schema/baseline; không chạm health/last_seen/room/metadata; không log secret
[ ] Build/lint/test pass
```

---

> Trạng thái: **CHỜ REVIEW**. Đây là plan — chưa có tasks.md, chưa code. Dừng chờ Thiếu Chủ review.
