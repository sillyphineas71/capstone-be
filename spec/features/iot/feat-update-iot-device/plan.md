---
name: feat-update-iot-device-plan
description: Kế hoạch hiện thực IOT-011 — PATCH /api/v1/iot-devices/:id cập nhật device_name, ip_address, mac_address, network_identifier.
category: iot
---

# Implementation Plan: Cập nhật thông tin thiết bị IoT/Camera (IOT-011)

- **Feature ID**: IOT-011
- **Module**: `iot`
- **Spec Reference**: [spec.md](./spec.md)
- **Status**: Draft

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan.md cho IOT-011: tái dùng IotDevicesController/Service/AuditRepository, thêm UpdateIotDeviceDto + service.update() + logDeviceUpdate + PATCH handler. Ghi nhận xác minh thực tế (không có global ValidationPipe; cơ chế seed chưa wire; PermissionsGuard là mock). | Toàn bộ file (bản đầu tiên) |
| 2026-06-15 | Chốt NC-P1..P4: seed theo convention `seeds/` (runner team-wide ngoài phạm vi); giữ MockPermissionsGuard + `@Permissions('iot.device.update')`; SỬA DTO `device_name` dùng `@ValidateIf(o=>o.deviceName!==undefined)` (bỏ `@IsOptional`) ⇒ null=400; test = unit 7 case + 1 DTO transform, không e2e, `created_by_name`=null OK. Mục 12 → "Quyết định đã chốt". | Mục 3 (DTO device_name), Mục 12 |

---

## 1. Technical Context

- **Framework**: NestJS 11 + PostgreSQL + TypeORM. Module resolution **nodenext** → mọi import nội bộ phải có đuôi `.js`.
- **Trạng thái hiện tại của module `iot`** (đã xác minh trong code):
  - [iot-devices.controller.ts](../../../../src/modules/iot/controllers/iot-devices.controller.ts): đã có `POST /` (create) và `POST /:id/assign-room`. Dùng `JwtAuthGuard` + **`MockPermissionsGuard`** (no-op) + decorator `@Permissions(...)` **no-op**. Pipe đặt **theo route** (`@UsePipes`), `forbidNonWhitelisted: false`.
  - [iot-devices.service.ts](../../../../src/modules/iot/services/iot-devices.service.ts): đã có `create`, `assignRoom`, `configureFaceServer`, `configureRtsp`, `checkAvailability`, các callback. **Chưa có `update`**. Pattern transaction dùng `dataSource.createQueryRunner()` + `manager.save(IoTDeviceEntity, ...)`.
  - [iot-audit.repository.ts](../../../../src/modules/iot/repositories/iot-audit.repository.ts): có `logDeviceCreation`, `logAssignRoom`, `logConfigureFaceServer`, `logConfigureRtsp`. **Chưa có `logDeviceUpdate`**.
  - [iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts): `IoTDeviceEntity` đã có đủ field. `@UpdateDateColumn` tự cập nhật `updated_at` khi `save`. **KHÔNG sửa entity, KHÔNG migration schema.**
  - [iot-device-response.dto.ts](../../../../src/modules/iot/dto/iot-device-response.dto.ts): `toIotDeviceResponse()` trả snake_case + `maskSensitiveMetadata(metadata_json)`.
  - [mac.util.ts](../../../../src/common/utils/mac.util.ts): `normalizeMacAddress()` (trim → thay `-`→`:` → uppercase, trả `null` nếu rỗng).
- **Quan trọng — đính chính so với brief**: dự án **KHÔNG có global `ValidationPipe`** trong [main.ts](../../../../src/main.ts) (`main.ts` chỉ set prefix `api/v1`). Validation hoàn toàn **route-level** qua `@UsePipes`. ⇒ Không cần "override global"; chỉ cần khai báo pipe riêng cho route PATCH với `forbidNonWhitelisted: true`.
- **Database**: baseline v3.2 Compact, bảng `iot_devices` + `audit_logs` đã có. Không thêm bảng/cột.

---

## 2. Danh sách thay đổi (file)

| Loại | File | Nội dung |
|---|---|---|
| **Mới** | `src/modules/iot/dto/update-iot-device.dto.ts` | `UpdateIotDeviceDto` — 4 field allowlist (đều có thể vắng mặt; 3 field kết nối nhận null, `device_name` không nhận null), map snake↔camel qua `@Expose`. |
| **Sửa** | `src/modules/iot/repositories/iot-audit.repository.ts` | Thêm method `logDeviceUpdate(manager, { userId, deviceId, changes })`. |
| **Sửa** | `src/modules/iot/services/iot-devices.service.ts` | Thêm method `update(userId, deviceId, dto)`. |
| **Sửa** | `src/modules/iot/controllers/iot-devices.controller.ts` | Thêm handler `@Patch(':id')` với route ValidationPipe `forbidNonWhitelisted: true`. |
| **Mới (seed)** | `src/database/seeds/<timestamp>-SeedIotDeviceUpdatePermission.ts` | Seed permission `iot.device.update` + gán role (theo pattern seed hiện có). **Xem [NC-P1].** |
| **Mới (test)** | `src/modules/iot/services/iot-devices.service.spec.ts` (bổ sung) | Thêm describe block cho `update`. |

> Module wiring: `IotDevicesController` và `IotDevicesService` đã được khai báo trong [iot.module.ts](../../../../src/modules/iot/iot.module.ts) → không cần đăng ký provider mới.

---

## 3. DTO: `UpdateIotDeviceDto`

Bám đúng cách [create-iot-device.dto.ts](../../../../src/modules/iot/dto/create-iot-device.dto.ts) map `snake_case` (API) ↔ `camelCase` (class) bằng `@Expose({ name })`. Mọi field đều **có thể vắng mặt** (partial); 3 field kết nối cho phép `null` để xóa, riêng `device_name` (NOT NULL) **không** nhận null.

```ts
import { IsString, IsNotEmpty, MaxLength, IsOptional, IsIP, IsMACAddress, ValidateIf } from 'class-validator';
import { Expose, Transform } from 'class-transformer';
import { normalizeMacAddress } from '../../../common/utils/mac.util.js';

export class UpdateIotDeviceDto {
  // device_name: NOT NULL ở DB. KHÔNG dùng @IsOptional (vì @IsOptional cho null lọt qua).
  // @ValidateIf chỉ skip khi field VẮNG mặt (undefined); nếu gửi null → rơi vào @IsString/@IsNotEmpty → 400.
  @Expose({ name: 'device_name' })
  @ValidateIf((o) => o.deviceName !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  deviceName?: string;

  // ip_address: cho null để xóa. Chỉ validate IP khi value khác null.
  @Expose({ name: 'ip_address' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIP()
  ipAddress?: string | null;

  // mac_address: normalize trước, cho null để xóa, validate MAC khi khác null.
  @Expose({ name: 'mac_address' })
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : normalizeMacAddress(value)))
  @ValidateIf((_, v) => v !== null)
  @IsMACAddress()
  macAddress?: string | null;

  @Expose({ name: 'network_identifier' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(150)
  networkIdentifier?: string | null;
}
```

**Cơ chế null/undefined của từng field** (đã chốt NC-P3):
- **3 field kết nối** (`ipAddress`, `macAddress`, `networkIdentifier`): dùng `@IsOptional()` + `@ValidateIf((_, v) => v !== null)`. `@IsOptional` cho `null` lọt qua (chấp nhận xóa = set NULL); `@ValidateIf` chỉ chạy `@IsIP/@IsMACAddress/@IsString` khi value khác null.
- **`device_name`** (cột NOT NULL): **KHÔNG** dùng `@IsOptional()`. Dùng `@ValidateIf((o) => o.deviceName !== undefined)` để: field vắng mặt (undefined) → skip toàn bộ; nhưng nếu gửi `null` → KHÔNG bị skip → rơi vào `@IsString`/`@IsNotEmpty` → **400** (đúng quyết định null=400). Đây là điểm khác biệt then chốt so với 3 field kia.

---

## 4. ValidationPipe & xử lý PATCH partial (điểm dễ sai)

### 4.1 Pipe theo route
Handler PATCH dùng pipe riêng (vì pipe route create đang để `forbidNonWhitelisted: false`):

```ts
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
```

- `whitelist: true` + `forbidNonWhitelisted: true` ⇒ field ngoài allowlist (vd `device_code`, `status`, `metadata_json`, `room_id`...) → **400** (thỏa FR-003, EC-004).
- `transform: true` + `@Expose` ⇒ map `snake_case` body → camelCase DTO.

### 4.2 Phân biệt "không gửi" (undefined) vs "gửi = null" (set NULL)
- class-transformer: nếu body **có** key `ip_address: null` → `dto.ipAddress === null`; nếu body **không có** key → `dto.ipAddress === undefined`.
- ⇒ Trong service, build `updates` bằng cách duyệt 4 thuộc tính và **chỉ nạp khi `!== undefined`**:
  ```ts
  const FIELDS = ['deviceName', 'ipAddress', 'macAddress', 'networkIdentifier'] as const;
  const updates: Partial<IoTDeviceEntity> = {};
  for (const f of FIELDS) if (dto[f] !== undefined) updates[f] = dto[f];
  ```
- `updates[f] = null` ⇒ set NULL (FR-009). `undefined` ⇒ không đụng tới cột đó.
- **Lưu ý kiểm chứng**: với `forbidNonWhitelisted`, để gửi `ip_address: null` qua được, key vẫn phải thuộc allowlist — đúng (nó nằm trong DTO). OK.

---

## 5. Thuật toán `IotDevicesService.update()`

Chữ ký: `async update(userId: string | null, deviceId: string, dto: UpdateIotDeviceDto): Promise<IoTDeviceEntity>`

```text
1. Load device theo id (dataSource.manager.findOne(IoTDeviceEntity, { where: { id: deviceId } })).
   - Không có → NotFoundException { code: 'IOT_DEVICE_NOT_FOUND' }  (EC-002 / 404)
2. Build `updates` từ dto (chỉ field !== undefined) như mục 4.2.
   - updates rỗng → BadRequestException { code: 'NO_UPDATABLE_FIELDS' }  (EC-003 / 400)
3. Nếu 'macAddress' in updates và updates.macAddress != null và khác device.macAddress hiện tại:
   - findOne(IoTDeviceEntity, { where: { macAddress: updates.macAddress, id: Not(deviceId) } })
   - Trùng → ConflictException { code: 'MAC_ADDRESS_EXISTS' }  (FR-007 / 409)
   (mac đã được normalize ở DTO; so sánh trên giá trị normalized)
4. Idempotent: so sánh từng field trong `updates` với giá trị hiện tại của device.
   - Nếu KHÔNG có field nào đổi giá trị thực → return device (không mở transaction, không save, không audit).  (FR-005 / 200)
5. Mở transaction (createQueryRunner):
   a. Gán các field đã đổi vào device, manager.save(IoTDeviceEntity, device).
   b. iotAuditRepository.logDeviceUpdate(manager, { userId, deviceId, changes }) với
      changes = { field: { old, new } } cho các field thực sự đổi.
   c. commit. (catch → rollback → throw)  (FR-016)
6. Return savedDevice (controller map qua toIotDeviceResponse).
```

- **Không** chạm `status` / `healthStatus` / `lastSeenAt` (FR-010): `updates` không bao giờ chứa các field này (không nằm trong DTO).
- `updated_at` tự đổi nhờ `@UpdateDateColumn` khi `save` (chỉ ở nhánh có thay đổi).
- `Not` import từ `typeorm`.

---

## 6. Audit: `IotAuditRepository.logDeviceUpdate`

Thêm method mirror `logAssignRoom` (insert raw vào `audit_logs`):

```ts
async logDeviceUpdate(
  entityManager: EntityManager,
  params: { userId: string | null; deviceId: string; changes: Record<string, { old: unknown; new: unknown }> },
): Promise<void> {
  await entityManager.query(
    `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
     VALUES ($1, 'update', 'iot_devices', $2, 'info', $3::jsonb)`,
    [params.userId, params.deviceId, JSON.stringify({ changed_fields: params.changes })],
  );
}
```

- `action_type='update'`, `entity_type='iot_devices'` — nhất quán với create/assign_room.
- 4 field allowlist không chứa secret nên `changes` an toàn (SEC-01). Không cần mask thêm, nhưng **không** đưa `metadata_json` vào đây.

---

## 7. Controller: `@Patch(':id')`

Mirror `assignRoom` handler hiện có:

```ts
@Patch(':id')
@UseGuards(JwtAuthGuard, MockPermissionsGuard)
@Permissions('iot.device.update')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
async update(
  @Req() req: any,
  @Param('id', ParseUUIDPipe) id: string,
  @Body() dto: UpdateIotDeviceDto,
) {
  const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
  const device = await this.iotDevicesService.update(userId, id, dto);
  return { success: true, message: 'IoT device updated successfully', data: toIotDeviceResponse(device) };
}
```

- `ParseUUIDPipe` cho `:id` → sai UUID = 400 (EC-001).
- Decorator quyền dùng **`iot.device.update`** (dot-notation) — xem mục 8 và [NC-P2].
- `created_by_name` trong response sẽ là `null` (UC update không truy vấn `users`) — chấp nhận; xem [NC-P4].

---

## 8. Permission & Seed

### 8.1 Format permission (đã xác minh)
- Seed thật dùng **dot-notation**: `permission_code` kiểu `meeting.participant.remove`, kèm cột `module_code`, `action_code` (xem [SeedRemoveParticipantPermissions.ts](../../../../src/database/seeds/20260611000001-SeedRemoveParticipantPermissions.ts)).
- Bảng permission map trong API Contract cũng dot: `iot.device.create`, `iot.device.configure`.
- ⇒ Spec dùng `iot.device.update` là **đúng format**, **không sửa spec**.
- ⚠️ Decorator mock trong controller hiện tại dùng colon (`iot_devices:create`) nhưng guard là **no-op** nên không có hiệu lực. Handler mới sẽ dùng dot `iot.device.update` cho khớp store.

### 8.2 Seed đề xuất
Tạo file `src/database/seeds/<timestamp>-SeedIotDeviceUpdatePermission.ts` theo đúng pattern hiện có:
- `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)` với `('iot.device.update', 'Cập nhật thông tin thiết bị IoT', 'iot', 'device_update', '...', true)` + `ON CONFLICT DO NOTHING`.
- Gán cho role `ADMIN`, `MANAGER` (giống các seed khác) qua `role_permissions`.

### 8.3 ⚠️ Vấn đề cơ chế chạy seed → [NC-P1]
Đã xác minh: các file `src/database/seeds/*.ts` **không** được import/đăng ký ở bất kỳ đâu, **không** nằm trong migrations glob ([data-source.ts](../../../../src/database/data-source.ts) chỉ load `./migrations/*`), và **không** có script `seed` trong `package.json`. ⇒ Cơ chế thực thi seed hiện chưa rõ. Plan tạm bám convention file seed; cần Thiếu Chủ xác nhận cách apply (xem [NC-P1]).

---

## 9. Error mapping (khớp spec §8.1)

| Tình huống | Exception | HTTP | code |
|---|---|---|---|
| Sai UUID `:id` | (ParseUUIDPipe) | 400 | VALIDATION_ERROR |
| Field ngoài allowlist | (ValidationPipe) | 400 | VALIDATION_ERROR |
| Body rỗng allowlist | `BadRequestException` | 400 | NO_UPDATABLE_FIELDS |
| Không có JWT | `JwtAuthGuard` | 401 | UNAUTHORIZED |
| Thiếu quyền | (PermissionsGuard thật) | 403 | FORBIDDEN |
| Không thấy device | `NotFoundException` | 404 | IOT_DEVICE_NOT_FOUND |
| MAC trùng | `ConflictException` | 409 | MAC_ADDRESS_EXISTS |
| Lỗi DB | (transaction rollback → 500) | 500 | INTERNAL_SERVER_ERROR |

---

## 10. Testing (ENG-01 ≥ 80%)

### 10.1 Unit test — `IotDevicesService.update` (bổ sung vào [iot-devices.service.spec.ts](../../../../src/modules/iot/services/iot-devices.service.spec.ts))
Bổ sung `auditRepoMock.logDeviceUpdate = jest.fn()` vào mock hiện có. Các case:
1. **Happy**: đổi `deviceName` + `ipAddress` → save gọi 1 lần, `logDeviceUpdate` gọi 1 lần, trả device mới.
2. **Idempotent**: gửi giá trị trùng hiện tại → KHÔNG `createQueryRunner`/`save`/`logDeviceUpdate`, trả device cũ.
3. **MAC trùng**: `findOne` (exclude self) trả 1 device khác → `ConflictException` MAC_ADDRESS_EXISTS.
4. **Not found**: `findOne` device chính trả null → `NotFoundException` IOT_DEVICE_NOT_FOUND.
5. **Body rỗng**: dto không field allowlist → `BadRequestException` NO_UPDATABLE_FIELDS.
6. **Set null (clear)**: `ipAddress: null` (key hiện diện) → device.ipAddress = null, save gọi.
7. **Không đụng status**: sau update, device.status/healthStatus/lastSeenAt giữ nguyên giá trị ban đầu.

### 10.2 Controller / e2e
- Theo pattern hiện có module `iot` (chủ yếu unit test service). **Đề xuất**: thêm test nhẹ cho mapping DTO (snake↔camel, null vs undefined) vì đây là điểm dễ sai — có thể là 1 spec nhỏ cho DTO transform. e2e không bắt buộc nếu các UC `iot` khác cũng chưa có e2e (giữ nhất quán). Xem [NC-P4].

---

## 11. Ràng buộc & ngoài phạm vi (tự kiểm)

- KHÔNG sửa `IoTDeviceEntity`, KHÔNG migration schema, KHÔNG bảng mới (DATA-01).
- KHÔNG đụng `room_id` / `stream_url` / Face Server config / `status` / `health_status` / `last_seen_at` / `metadata_json` / `equipment_id` / `agent_version` / `firmware_version` / `mqtt_topic`.
- KHÔNG dùng Prisma; KHÔNG `synchronize`. Import `.js` (nodenext).
- KHÔNG log secret (SEC-01).

---

## 12. Quyết định đã chốt (Resolved)

| # | Quyết định |
|---|---|
| **NC-P1** | **Seed theo convention `seeds/`**: tạo file `SeedIotDeviceUpdatePermission.ts` trong `src/database/seeds/` (mirror `SeedRemoveParticipantPermissions.ts`). Việc **seed-runner chưa được wire** (không orchestrator/script `seed`) là **vấn đề team-wide, NGOÀI phạm vi feature IOT-011** — không xử lý trong feature này; team sẽ chạy/áp dụng theo cơ chế chung. |
| **NC-P2** | **Giữ `MockPermissionsGuard`** (no-op) + decorator `@Permissions('iot.device.update')`, đúng pattern IOT-001/002. Enforce 403 runtime thật là **task team-wide riêng** (PermissionsGuard thật), không thuộc IOT-011. FR-013 đảm bảo ở mức thiết kế. |
| **NC-P3** | **`device_name: null` ⇒ 400.** DTO `device_name` dùng `@ValidateIf((o) => o.deviceName !== undefined)` + `@IsString` + `@IsNotEmpty` + `@MaxLength(150)`, **BỎ `@IsOptional`** (vì `@IsOptional` sẽ cho `null` lọt). 3 field kết nối còn lại giữ `@IsOptional` (cho null = xóa). |
| **NC-P4** | **Test**: unit test `service.update` **7 case** + **1 test DTO transform** (snake↔camel, null vs undefined, device_name null=400). **Không e2e.** Response `created_by_name = null` được chấp nhận (UC update không truy vấn `users`). |

---

## 13. Definition of Done (cho bước implement sau)

```text
[ ] UpdateIotDeviceDto (4 field, optional, map snake↔camel, null cho 3 field kết nối)
[ ] Route PATCH /:id với ValidationPipe forbidNonWhitelisted=true + ParseUUIDPipe
[ ] service.update(): 404 / NO_UPDATABLE_FIELDS / MAC 409 / idempotent / set null / transaction + audit
[ ] IotAuditRepository.logDeviceUpdate (action_type='update')
[ ] Seed permission iot.device.update (theo chốt NC-P1)
[ ] Unit test 7 case + DTO transform; coverage ≥ 80%
[ ] Không đụng entity/schema/baseline; không log secret
[ ] Build/lint/test pass
```

---

> Trạng thái: **CHỜ REVIEW**. Plan đã chốt NC-P1..P4 (Mục 12). `tasks.md` đã được tạo. Chưa code. Dừng chờ Thiếu Chủ review.
