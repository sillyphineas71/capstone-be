# ZNA-001 — plan.md (UC-94 Zones: gán camera vào khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo plan ZNA-001 sau spec DUYỆT + chốt OQ-1→OQ-11. 2 route (`PATCH /zones/:id/devices` batch all-or-nothing, `DELETE /zones/:id/devices/:deviceId`); 2 method vào `ZonesService`; **2 method vào `ZonesAuditRepository`**; **2 method vào `IotDevicesService` (file NGOÀI `zones`)** gồm 1 GHI nhận `EntityManager` — lần đầu `zones` ghi vào bảng của `iot`; 1 DTO; 1 migration seed permission `20260722000005`. Allowlist **5 loại** `device_type`. `ZonesService` **KHÔNG đổi constructor** (4 dependency đã đủ từ UC-92) ⇒ rủi ro hồi quy thấp hơn hẳn UC-92. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **`IoTDeviceType` có ĐỦ 5 loại của allowlist** ([iot-device.entity.ts:13-22](../../../../src/modules/iot/entities/iot-device.entity.ts)): `IP_CAMERA='ip_camera'`, `DOOR_CAMERA='door_camera'`, `ROOM_CAMERA='room_camera'`, `FACE_SERVER='face_server'`, `OCCUPANCY_SENSOR='occupancy_sensor'` — cùng 3 loại **bị loại trừ**: `MICROPHONE`, `CAPTURE_AGENT`, `DISPLAY`. ⇒ CHỐT OQ-4 **khả thi**, không cần migration/đổi enum.
- **`ZonesService` KHÔNG cần đổi constructor**: đã có đủ 4 dependency từ UC-92 ([zones.service.ts:50-58](../../../../src/modules/zones/services/zones.service.ts)) — `repo`, `DataSource`, `ZonesAuditRepository`, `IotDevicesService`. ⇒ **Khác hẳn UC-92**: không có bước "đổi constructur → suite đỏ → cập nhật provider". Test cũ chỉ cần **thêm mock method** vào các mock đã có.
- **`ZonesAuditRepository` — chữ ký để 2 method mới bám theo** ([zones-audit.repository.ts](../../../../src/modules/zones/repositories/zones-audit.repository.ts)): hằng `ZONE_ENTITY_TYPE = 'zones'` ([:5](../../../../src/modules/zones/repositories/zones-audit.repository.ts)); mỗi method `async logX(entityManager: EntityManager, params: {...}): Promise<void>` chạy `entityManager.query('INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json) VALUES ($1, '<action>', $2, $3, 'info', $4::jsonb)', [...])`. 3 method hiện có: `logZoneCreation`/`logZoneUpdate`/`logZoneDeletion`.
- **`ZonesController` cần thêm import**: hiện có `Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, UsePipes, ValidationPipe` + `CurrentUser` + guards + `ZONE_PIPE` ⇒ UC-94 **KHÔNG cần import mới nào từ `@nestjs/common`** (`Patch`, `Delete`, `Param`, `ParseUUIDPipe`, `Body`, `UsePipes` đều có sẵn); chỉ thêm import **DTO mới**.
- **`IotDevicesService` — nơi thêm 2 method** ([iot-devices.service.ts:81-94](../../../../src/modules/iot/services/iot-devices.service.ts)): constructor đã có `private readonly dataSource: DataSource` ⇒ method mới không cần inject thêm. Mẫu API-đọc-cho-module-khác đã có: `countByZoneId` (UC-92).
- **Mẫu transaction chuẩn** ([zones.service.ts `remove()`](../../../../src/modules/zones/services/zones.service.ts)): validate cross-module **NGOÀI** transaction → `createQueryRunner` → `connect` → `startTransaction` → ghi + audit → `commit` / `catch rollback` / **`finally release()`**. UC-94 copy đúng cấu trúc.
- **Baseline test** (T0 của tasks phải đếm lại): `src/modules/zones` = **7 suite / 104 test**; `src/modules/iot` = **11 suite / 168 test**.
- **Timestamp migration**: file cuối hiện tại `20260722000004-SeedZoneReadPermission.ts` ⇒ UC-94 dùng **`20260722000005`**. T0 phải đếm lại thực tế.
- **`ListIotDevicesQueryDto` KHÔNG có `zone_id`** (chỉ `room_id` — [list-iot-devices-query.dto.ts:46-49](../../../../src/modules/iot/dto/list-iot-devices-query.dto.ts)) ⇒ sau UC-94 vẫn **không có API liệt kê thiết bị của zone**; ghi nợ ở §9, KHÔNG làm trong UC-94.

## 1. Quyết định đã chốt (OQ + Constitution)

OQ-1 **batch `device_ids`, ALL-OR-NOTHING, `@ArrayMaxSize(50)`**, lỗi nêu rõ `device_id` gây lỗi · OQ-2 **`DELETE /zones/:id/devices/:deviceId` BẮT BUỘC có** · OQ-3 **CHO ĐÈ** + audit `old→new` (lệch có chủ đích với `assignRoom`) · OQ-4 **allowlist 5 loại**, không chặn theo `status` · OQ-5 zone `inactive` → **`409 ZONE_INACTIVE`** · OQ-6 audit `entity_type='zones'`, action `assign_device`/`unassign_device`, **không ghi kép** · OQ-7 **phương án (A)**: `zones` mở tx, truyền `EntityManager` xuống · OQ-8 **1 permission `zones.zone.assign_device`**, 2 role admin · OQ-9 trả `{zone, assigned_device_ids}` · OQ-10 **đính chính luật route: "static trước động" chỉ khi CÙNG SỐ SEGMENT** · OQ-11 2 nợ của `iot` ghi nhận, không sửa.

- **ARCH-01 (crux)**: `zones` **CHỈ** đọc/ghi `iot_devices` qua `IotDevicesService`; **CẤM** SQL/repository trực tiếp. `IotModule` **CẤM** import `ZonesModule`, **cấm `forwardRef`** (UC-92 OQ-1b).
- **R5 nguyên tử**: ghi `zone_id` + ghi audit phải **cùng 1 transaction** ⇒ bắt buộc truyền `EntityManager` (OQ-7).
- **SEC-01**: audit không chở `metadata_json` của thiết bị, không secret.
- **SEC-02**: `@RequirePermissions('zones.zone.assign_device')`; actor từ `@CurrentUser()`.
- **SEC-03**: `@IsUUID('4', {each:true})` + `ZONE_PIPE`; `:id`/`:deviceId` qua `ParseUUIDPipe`; audit dùng parameter binding.
- **DATA-01**: UC-94 **không xoá** gì — "gỡ gán" là `UPDATE zone_id = NULL`.
- **ARCH-02**: `@ArrayMaxSize(50)` chặn transaction kéo dài.
- **ARCH-03**: idempotent tự nhiên (gán lại đúng zone hiện tại → không đổi, không audit trùng).
- **DATA-03**: **no-migration-schema** — migration duy nhất là seed permission.

## 2. Service — method thêm vào `ZonesService`

**File**: `src/modules/zones/services/zones.service.ts` (**Modified — chỉ THÊM**; **KHÔNG** đổi constructor, **KHÔNG** đụng `create`/`update`/`remove`/`list`/`getDetail`/`loadActive`).

### 2.1. `async assignDevices(zoneId, dto, actorUserId): Promise<{ zone: ZoneEntity; assignedDeviceIds: string[] }>`
Thứ tự **bắt buộc**:
1. `const zone = await this.loadActive(zoneId);` → 404 `ZONE_NOT_FOUND` trước mọi thứ.
2. **Chặn zone inactive** (OQ-5): `zone.status === 'inactive'` → `ConflictException({ code: 'ZONE_INACTIVE', message: 'Khu vực đang ngừng sử dụng, không thể gán thiết bị' })`.
3. **Validate thiết bị — NGOÀI transaction** (mirror `remove()`, fail nhanh không tốn connection):
   - `const devices = await this.iotDevicesService.findAssignableByIds(dto.deviceIds);`
   - id nào **không có trong kết quả** → `NotFoundException({ code: 'IOT_DEVICE_NOT_FOUND', message: ..., details: { device_ids: [<id thiếu>] } })`;
   - device nào có `deviceType` **ngoài allowlist 5 loại** → `ConflictException({ code: 'DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE', details: { device_ids: [...], device_type: ... } })`.
   - **All-or-nothing (OQ-1)**: chỉ cần 1 id lỗi là **ném ngay**, không ghi gì; `details` PHẢI nêu rõ id nào.
   - **KHÔNG** chặn theo `status`/`healthStatus` (OQ-4).
4. **Tính idempotent + đè zone khác** (OQ-3/R7): từ `devices`, gom `changed = devices.filter(d => d.zoneId !== zoneId)`; các device đã đúng zone → bỏ qua (không ghi, không audit).
   - Nếu `changed.length === 0` → **no-op**: return `{ zone, assignedDeviceIds: dto.deviceIds }`, **KHÔNG** mở transaction, **KHÔNG** audit (mirror bất biến no-op của `update()` UC-91).
   - Gom `oldZoneMap` = `{ [deviceId]: d.zoneId }` để audit ghi `old_zone_id` → `new_zone_id`.
5. **Transaction** (chỉ bọc phần ghi):
   `createQueryRunner` → `connect` → `startTransaction` →
   a. `await this.iotDevicesService.setZoneForDevices(changedIds, zoneId, queryRunner.manager)`;
   b. `await this.zonesAuditRepository.logZoneAssignDevices(queryRunner.manager, { userId: actorUserId, zoneId, deviceIds: changedIds, oldZoneIds: oldZoneMap })`;
   c. `commit`; `catch` → `rollback` + rethrow; **`finally` → `release()`**.
6. Trả `{ zone, assignedDeviceIds: dto.deviceIds }` (OQ-9; controller map sang envelope).

### 2.2. `async unassignDevice(zoneId, deviceId, actorUserId): Promise<{ zone: ZoneEntity; unassignedDeviceId: string }>`
1. `const zone = await this.loadActive(zoneId);` → 404 `ZONE_NOT_FOUND`.
   *(Không chặn `inactive` ở đây: phải cho phép gỡ thiết bị khỏi zone đã ngừng dùng — nếu chặn thì zone inactive vừa không gỡ được vừa không xoá được ở UC-92.)*
2. **Xác nhận thiết bị đang thuộc ĐÚNG zone này** — NGOÀI transaction: `findAssignableByIds([deviceId])`:
   - không có → `404 IOT_DEVICE_NOT_FOUND`;
   - `device.zoneId !== zoneId` → `404` (mã đề xuất `DEVICE_NOT_IN_ZONE`) — coi như "không tồn tại quan hệ này dưới zone đó"; hành vi phải xác định và test phủ.
3. **Transaction**: `setZoneForDevices([deviceId], null, queryRunner.manager)` + `logZoneUnassignDevice(manager, { userId, zoneId, deviceId })` → commit / rollback / `finally release()`.
4. Trả `{ zone, unassignedDeviceId: deviceId }`.

- **CẤM** `this.repo.query('... iot_devices ...')` hay bất kỳ truy vấn trực tiếp nào tới bảng của module `iot` (ARCH-01) — **kể cả khi `assignRoom` đang làm điều tương tự với `rooms`** (anti-precedent, spec §0.4).

## 3. Audit repository — method thêm vào `ZonesAuditRepository`

**File**: `src/modules/zones/repositories/zones-audit.repository.ts` (**Modified — thêm 2 method**, giữ nguyên 3 method cũ + hằng `ZONE_ENTITY_TYPE`).

| Method | `action_type` | `metadata_json` |
| :--- | :--- | :--- |
| `logZoneAssignDevices(em, { userId, zoneId, deviceIds, oldZoneIds })` | `'assign_device'` | `{ device_ids: [...], old_zone_ids: { <deviceId>: <oldZoneId\|null> }, new_zone_id: <zoneId> }` |
| `logZoneUnassignDevice(em, { userId, zoneId, deviceId })` | `'unassign_device'` | `{ device_ids: [<deviceId>], old_zone_id: <zoneId>, new_zone_id: null }` |

- `entity_type = ZONE_ENTITY_TYPE` (`'zones'`), `entity_id = zoneId`, `severity = 'info'` — **1 bản ghi cho cả lô** (OQ-1 all-or-nothing ⇒ cả lô là một sự kiện).
- **SEC-01**: chỉ ghi **id**; **CẤM** ghi `metadata_json`/tên/IP/secret của thiết bị.
- Parameter binding `$1..$4` như 3 method cũ; **CẤM** nối chuỗi.

## 4. Cross-module — method thêm vào `IotDevicesService`

**File**: `src/modules/iot/services/iot-devices.service.ts` (**Modified — NGOÀI module `zones`**, thêm **đúng 2 method**).

### 4.1. `async findAssignableByIds(deviceIds: string[]): Promise<IoTDeviceEntity[]>` (đọc)
- `this.dataSource.manager.find(IoTDeviceEntity, { where: { id: In(deviceIds) } })` — trả về **những gì tìm thấy**; caller tự so sánh để biết id nào thiếu.
- Trả nguyên entity (có `zoneId`, `deviceType`) để `zones` tự quyết định — `iot` **không** phán xét về zone.
- `IoTDeviceEntity` không có soft-delete ⇒ không lọc `deletedAt`.

### 4.2. `async setZoneForDevices(deviceIds: string[], zoneId: string | null, manager?: EntityManager): Promise<{ affected: number }>` (GHI)
- **Xử lý `manager`**: `const em = manager ?? this.dataSource.manager;` — **có `manager`** → chạy trong transaction của caller (KHÔNG tự mở tx); **không có** → chạy standalone.
- Thân: `await em.update(IoTDeviceEntity, { id: In(deviceIds) }, { zoneId })` → trả `{ affected }`.
- `zoneId: string | null` — **một method cho cả gán lẫn gỡ**; `iot` coi `zoneId` là **giá trị đục**: **không** kiểm zone tồn tại, **không** kiểm `status`, **không** kiểm soft-delete (trách nhiệm của caller).
- **JSDoc bắt buộc** ghi 3 ý: (1) API cho module khác, `iot` không biết nghiệp vụ zone; (2) **ranh giới transaction do CALLER kiểm soát** khi truyền `manager` — khác `assignRoom` vốn tự mở tx; (3) mọi kiểm tra về zone thuộc caller.
- **CẤM** import bất cứ thứ gì từ `zones`; **CẤM** `forwardRef`. **`iot.module.ts` KHÔNG cần sửa** (`IotDevicesService` đã trong `exports`).
- **CẤM** sao chép anti-precedent của `assignRoom` (raw SQL sang bảng module khác).

## 5. DTO

**File net-new**: `src/modules/zones/dto/assign-zone-devices.dto.ts` — `AssignZoneDevicesDto`, **1 field**:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `deviceIds: string[]` | `device_ids` | `@Expose({ name: 'device_ids' })` `@IsArray()` `@ArrayNotEmpty()` **`@ArrayMaxSize(50)`** `@IsUUID('4', { each: true })` |

- **KHÔNG** khai `zone_id` (lấy từ path), `room_id`, toạ độ, hay field nào của `iot`.
- **KHÔNG** DTO cho gỡ — `:deviceId` trên path qua `ParseUUIDPipe`.
- Response: dùng lại `toZoneResponse` cho phần `zone`; `assigned_device_ids` là mảng string thô ⇒ **không** cần DTO response mới.

## 6. Controller — route thêm vào `ZonesController`

**File**: `src/modules/zones/controllers/zones.controller.ts` (**Modified**). Chỉ thêm import `AssignZoneDevicesDto` (các decorator cần đã có sẵn — §0).

```text
PATCH  /api/v1/zones/:id/devices             → gán (batch)
DELETE /api/v1/zones/:id/devices/:deviceId   → gỡ 1 thiết bị
```
- Cả hai: `@UseGuards(JwtAuthGuard, PermissionsGuard)` · **`@RequirePermissions('zones.zone.assign_device')`** · `@Param('id', ParseUUIDPipe)` · `@CurrentUser() user: { userId: string }`.
- Gán: `@Patch(':id/devices')` + `@UsePipes(ZONE_PIPE)` + `@Body() dto: AssignZoneDevicesDto` → `{ success: true, message: 'Devices assigned to zone successfully', data: { zone: toZoneResponse(zone), assigned_device_ids: [...] } }`.
- Gỡ: `@Delete(':id/devices/:deviceId')` + `@Param('deviceId', ParseUUIDPipe)` → `{ success: true, message: 'Device unassigned from zone successfully', data: { zone: toZoneResponse(zone), unassigned_device_id: deviceId } }`.
- **Thứ tự khai (OQ-10)**: khai `@Patch(':id/devices')` **trước** `@Patch(':id')` và `@Delete(':id/devices/:deviceId')` **trước** `@Delete(':id')`, **kèm comment đính chính**: luật "static trước động" chỉ cần khi **cùng số segment**; ở đây 2-segment vs 1-segment nên không xung đột, đặt trước chỉ để nhất quán và tránh hiểu nhầm.
- **KHÔNG** `@HttpCode` (PATCH/DELETE mặc định 200).

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| Gán / gỡ thành công | `200` | — |
| `device_ids` rỗng / >50 / không UUID | `400` | (Nest validation) |
| `:id`/`:deviceId` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission | `403` | `FORBIDDEN` |
| Zone không tồn tại / đã xoá mềm | `404` | `ZONE_NOT_FOUND` |
| Thiết bị không tồn tại (bất kỳ id nào trong lô) | `404` | `IOT_DEVICE_NOT_FOUND` |
| Gỡ thiết bị không thuộc zone này | `404` | `DEVICE_NOT_IN_ZONE` |
| Zone `inactive` (chỉ route gán) | `409` | `ZONE_INACTIVE` |
| Thiết bị sai loại | `409` | `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE` |

## 7. File list

### Net-new (3)
**Code (2)**
- `src/modules/zones/dto/assign-zone-devices.dto.ts`
- `src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts` — seed `zones.zone.assign_device` (`module_code='zones'`, `action_code='assign_device'`) → **`SYSTEM_ADMIN` + `BUSINESS_ADMIN`** (**2 role**, ⚠ **không** phải 4 như `zones.zone.read` của UC-93); `up()` idempotent, `down()` xoá `role_permissions` trước rồi `permissions`; copy pattern `20260722000003`. Đặt trong `migrations/`, **KHÔNG** trong `seeds/`.

**Test (1)**
- `src/modules/zones/dto/assign-zone-devices.dto.spec.ts`

### Modified — trong `zones` (6)
- `src/modules/zones/services/zones.service.ts` — thêm `assignDevices` + `unassignDevice`; thêm import nếu cần. **KHÔNG** đổi constructor.
- `src/modules/zones/services/zones.service.spec.ts` — thêm 2 `describe`; **bổ sung mock method** `findAssignableByIds`/`setZoneForDevices` vào mock `iotDevicesService` và 2 method audit vào mock `auditRepo` (loại (a) dựng mock).
- `src/modules/zones/repositories/zones-audit.repository.ts` — thêm 2 method.
- `src/modules/zones/repositories/zones-audit.repository.spec.ts` — test 2 method mới (gồm SEC-01).
- `src/modules/zones/controllers/zones.controller.ts` — thêm 2 route + import DTO.
- `src/modules/zones/controllers/zones.controller.spec.ts` — test 2 route mới.

### Modified — NGOÀI `zones` (2)
- `src/modules/iot/services/iot-devices.service.ts` — thêm `findAssignableByIds` + `setZoneForDevices`.
- `src/modules/iot/services/iot-devices.service.spec.ts` — test 2 method mới (gồm case **có** và **không** truyền `manager`).

> Tổng **3 net-new + 6 modified trong `zones` + 2 modified ngoài `zones`** = **11 file**. **0 migration schema** · `zones.module.ts`, `iot.module.ts`, `app.module.ts`, `data-source.ts`, entity, các DTO/mapper/constant cũ **KHÔNG đổi**.

## 8. Test (mock repo — KHÔNG DB)

**`zones.service.spec.ts` — `describe('assignDevices')`**
1. **Gán thành công (batch)**: 3 device hợp lệ, chưa thuộc zone nào → `setZoneForDevices` gọi với `(ids, zoneId, queryRunner.manager)`; `logZoneAssignDevices` gọi **trước** `commitTransaction`; `release` được gọi.
2. **404 zone**: `findOne` → null → `ZONE_NOT_FOUND`; assert **`findAssignableByIds` KHÔNG gọi**, `createQueryRunner` **KHÔNG** gọi.
3. **404 device — 1 id trong lô không tồn tại → CẢ LÔ rollback**: `findAssignableByIds` trả về 2/3 device → ném `IOT_DEVICE_NOT_FOUND` với `details.device_ids` chứa id thiếu; assert **`setZoneForDevices` KHÔNG gọi**, **không mở transaction** (all-or-nothing chặn từ trước tx).
4. **409 `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE`**: device có `deviceType='microphone'` → ném 409, không ghi gì. Kèm case dương: **cả 5 loại allowlist đều pass**.
5. **409 `ZONE_INACTIVE`**: `zone.status='inactive'` → ném 409; assert không validate device, không mở tx.
6. **Idempotent (R7)**: mọi device đã có `zoneId === zoneId` → **no-op**: `createQueryRunner` **KHÔNG** gọi, `setZoneForDevices` **KHÔNG** gọi, `logZoneAssignDevices` **KHÔNG** gọi, vẫn trả 200.
7. **Đè zone khác (OQ-3)**: device có `zoneId='z-old'` → **thành công**; assert `logZoneAssignDevices` nhận `oldZoneIds` chứa `{ <deviceId>: 'z-old' }` và `new_zone_id = zoneId`.
8. **Rollback khi audit lỗi**: `logZoneAssignDevices` reject → `rollbackTransaction` gọi, `commitTransaction` **KHÔNG** gọi, `release` **vẫn** gọi, lỗi propagate.
9. **Rollback khi `setZoneForDevices` lỗi**: tương tự case 8.
10. **`finally release()`**: assert `release` được gọi ở **cả** nhánh thành công lẫn nhánh lỗi.
11. **ARCH-01**: assert service **không** gọi `repo.query`/`repo.createQueryBuilder` cho bảng `iot_devices` (chỉ đi qua `iotDevicesService`).

**`zones.service.spec.ts` — `describe('unassignDevice')`**
12. **Gỡ thành công**: `setZoneForDevices([deviceId], null, manager)` được gọi với **`null`**; audit `logZoneUnassignDevice`; commit + release.
13. **404 zone** → `ZONE_NOT_FOUND`.
14. **404 device không tồn tại** → `IOT_DEVICE_NOT_FOUND`.
15. **Gỡ thiết bị KHÔNG thuộc zone này** (`device.zoneId !== zoneId`) → `404 DEVICE_NOT_IN_ZONE`; assert **không** ghi gì.
16. **Đóng vòng với UC-92**: sau khi gỡ, `countByZoneId` (mock) trả `0` ⇒ `remove()` chạy được — test này chứng minh chuỗi UC-92 ↔ UC-94 khép kín (§0.6 của spec).

**`zones-audit.repository.spec.ts`**
17. `logZoneAssignDevices` → `entity_type='zones'`, `action_type='assign_device'`, `entity_id=zoneId`, `severity='info'`, param bind đúng thứ tự; `metadata_json` chứa `device_ids` + `old_zone_ids` + `new_zone_id`.
18. `logZoneUnassignDevice` → `action_type='unassign_device'`, `new_zone_id: null`.
19. **SEC-01**: truyền thêm dữ liệu nhạy cảm giả lập (vd `metadataJson` của device) → payload ghi ra **không** chứa; chỉ có id.

**`zones.controller.spec.ts`**
20. `PATCH :id/devices` → gọi `service.assignDevices(id, dto, user.userId)` 1 lần; envelope `{success, message:'Devices assigned to zone successfully', data:{zone, assigned_device_ids}}`; `zone` qua `toZoneResponse` (**không** có `deleted_at`); **không** chứa tên/loại thiết bị (OQ-9).
21. `DELETE :id/devices/:deviceId` → gọi `service.unassignDevice(id, deviceId, user.userId)`; envelope đúng.
22. **Assert metadata**: `PERMISSIONS_KEY` của **cả 2** handler = `['zones.zone.assign_device']`; guard list có `JwtAuthGuard` + `PermissionsGuard`.
23. Lỗi từ service (`NotFoundException`/`ConflictException`) → propagate nguyên trạng.
24. **Không hồi quy**: 5 route cũ (GET, GET :id, POST, PATCH :id, DELETE :id) vẫn xanh, **không** bị sửa.

**`assign-zone-devices.dto.spec.ts`**
25. `device_ids` hợp lệ (1 và 50 phần tử) → 0 lỗi.
26. Mảng rỗng → lỗi `arrayNotEmpty`; 51 phần tử → lỗi `arrayMaxSize`; phần tử không phải UUID → lỗi `isUuid`.
27. Whitelist: gửi kèm `zone_id`, `room_id` → bị loại khỏi instance.

**`iot-devices.service.spec.ts`**
28. `findAssignableByIds` gọi `manager.find(IoTDeviceEntity, { where: { id: In(ids) } })` và trả đúng danh sách.
29. `setZoneForDevices` **CÓ truyền `manager`** → dùng `manager.update(...)`, **KHÔNG** gọi `dataSource.createQueryRunner` (chứng minh không tự mở tx).
30. `setZoneForDevices` **KHÔNG truyền `manager`** → dùng `dataSource.manager.update(...)`.
31. `setZoneForDevices(ids, null, m)` → `update` được gọi với `{ zoneId: null }` (nhánh gỡ).
32. **Không hồi quy**: 168 test cũ của `iot` vẫn xanh.

**Nguyên tắc**: 100% mock; **KHÔNG** DB, **KHÔNG** migration, **KHÔNG** gọi service thật của `iot`.

## 9. Gate (STOP, KHÔNG commit)

- `npm run build` = 0 error; eslint trên **11 file touched** = 0 rule mới.
- `npx jest src/modules/zones` **và** `npx jest src/modules/iot` xanh.
- **Không hồi quy**: baseline **`zones` 7 suite / 104 test** và **`iot` 11 suite / 168 test** (T0 của tasks đếm lại). **CẤM sửa assert của test cũ** — chỉ được **thêm method vào mock** (loại (a)). Test cũ fail → **DỪNG, báo cáo**.
- Coverage `ZonesService` ≥80%.
- **DI-proof**: `AppModule` compile preview mode — 0 `UnknownDependenciesException`, **0 circular** (cạnh `ZonesModule → IotModule` vẫn một chiều).
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS · **KHÔNG** live smoke · **KHÔNG** commit.
- **Bàn giao**: gọi thử 2 route trên local cần chạy seed `20260722000005` trước; thiếu → 403, không phải lỗi code. Local vẫn chưa có bảng `zones`.
- **Owed**: **API liệt kê thiết bị của zone** (`ListIotDevicesQueryDto` chưa có `zone_id` — §0) · UC-95 sơ đồ lắp đặt (đang gác) · FT-20/FT-21 tiêu thụ `zone_id` và tôn trọng `status='inactive'` · restore zone · index cho `audit_logs.metadata_json->>'device_ids'` · 2 nợ kỹ thuật của `iot` (OQ-11) · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.

## 10. Kỷ luật

- **`zones → iot` MỘT CHIỀU VĨNH VIỄN**: `IotModule` **CẤM** import `ZonesModule`; **cấm `forwardRef`**. `zones` **CẤM** query thẳng bảng `iot_devices`.
- **KHÔNG sao chép anti-precedent**: `assignRoom` query raw SQL sang bảng `rooms` — UC-94 không được làm điều tương tự với `iot_devices` (và không sửa `assignRoom`, đó là nợ riêng).
- **Lệch có chủ đích với `assignRoom`** (OQ-3): UC-94 **CHO ĐÈ** zone; `assignRoom` **CHẶN** chuyển room. **Người sau KHÔNG được "sửa cho giống"** — ghi comment tại chỗ.
- **Allowlist đúng 5 loại** (OQ-4): `IP_CAMERA`, `DOOR_CAMERA`, `ROOM_CAMERA`, `OCCUPANCY_SENSOR`, `FACE_SERVER`. **CẤM** copy allowlist 3 loại của `assignRoom` (sẽ chặn đứng FT-20/FT-21). **KHÔNG** chặn theo `status`/`healthStatus`.
- **ĐÍNH CHÍNH luật route (OQ-10)**: "static khai trước động" **chỉ áp dụng khi hai pattern CÙNG SỐ SEGMENT**. `:id/devices` (2 segment) không xung đột `:id` (1 segment). Vẫn khai trước + comment để tránh hiểu nhầm.
- **Nguyên tử (R5)**: ghi `zone_id` + audit trong **cùng** transaction; `setZoneForDevices` nhận `manager` thì **không** tự mở tx. Mọi nhánh có **`finally release()`**.
- **All-or-nothing (OQ-1)**: 1 id lỗi → cả lô fail, lỗi nêu rõ `device_id`; **cấm** best-effort.
- **Idempotent**: device đã đúng zone → bỏ qua, **không** audit trùng; cả lô đã đúng → **no-op không mở transaction**.
- **SEC-01**: audit chỉ ghi **id**, cấm ghi `metadata_json`/tên/IP/secret của thiết bị.
- **Không migration schema**: cấm thêm cột toạ độ (UC-95), cấm đổi FK/index.
- **Không sửa** `ZonesModule`, `iot.module.ts`, entity, `create()`/`update()`/`remove()`/`list()`/`getDetail()`/`loadActive()`, 3 method audit cũ, và **không** đụng UC-95.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
