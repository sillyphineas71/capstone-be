# ZNA-001 — UC-94 (Zones): Gán camera vào khu vực

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo spec ZNA-001 (UC-94): gán/gỡ device↔zone để định tuyến sự kiện theo khu vực — mảnh cuối FT-17 Core. RECON code thật (`ZonesService` 4 dependency + mẫu transaction, `ZonesAuditRepository`, `IotDevicesService.countByZoneId` + **tiền lệ `assignRoom` đầy đủ**, `IoTDeviceEntity.zoneId`, FK `SET NULL`). Crux = **lần đầu module `zones` GHI vào bảng của `iot`** ⇒ phải chốt ranh giới transaction cross-module + phạm vi batch. Phát hiện quan trọng: **UC-92 chặn xoá zone khi còn thiết bị ⇒ nếu UC-94 không có endpoint GỠ thì zone đã gán camera KHÔNG BAO GIỜ xoá được**. 11 OPEN QUESTIONS chờ Thiếu Chủ. | Toàn bộ |
| 2026-07-22 | Thiếu Chủ CHỐT OQ-1→OQ-11. OQ-1=batch `device_ids`, **ALL-OR-NOTHING**, `@ArrayMaxSize(50)` · OQ-2=`DELETE /zones/:id/devices/:deviceId`, **BẮT BUỘC có trong UC-94** · OQ-3=**CHO ĐÈ** + audit `old→new` (lệch có chủ đích với `assignRoom`) · **OQ-4=allowlist ĐÚNG 5 LOẠI `IP_CAMERA`/`DOOR_CAMERA`/`ROOM_CAMERA`/`OCCUPANCY_SENSOR`/`FACE_SERVER` — SỬA đề xuất ban đầu của agent (3 loại copy từ `assignRoom`)**: thiếu `DOOR_CAMERA`+`OCCUPANCY_SENSOR` là chặn đứng FT-20/FT-21; không chặn theo `status` · OQ-5=chặn zone `inactive` → `409 ZONE_INACTIVE` · OQ-6=audit `entity_type='zones'`, action `assign_device`/`unassign_device`, KHÔNG ghi kép sang `iot_devices` · OQ-7=**phương án (A)**: `zones` mở tx, truyền `EntityManager` xuống `setZoneForDevices(deviceIds, zoneId, manager?)` · OQ-8=1 permission `zones.zone.assign_device`, 2 role admin · OQ-9=trả `{zone, assigned_device_ids}`, không lộ dữ liệu thiết bị · **OQ-10=ĐÍNH CHÍNH luật module: "static trước động" chỉ áp dụng khi CÙNG SỐ SEGMENT** · OQ-11=2 nợ kỹ thuật của `iot` ghi nhận, không sửa. | §8 (đổi tiêu đề + kết luận từng OQ); §2/§3/§4/§5 bỏ nhánh không chọn |

> **SPEC-ONLY.** Chưa plan/tasks/code. Kế thừa toàn bộ convention đã chốt ở [ZNC-001/UC-90](../uc90-create-zone/spec.md), [ZNU-001/UC-91](../uc91-update-zone/spec.md), [ZND-001/UC-92](../uc92-delete-zone/spec.md), [ZNL-001/UC-93](../uc93-list-zone/spec.md) — **KHÔNG mở lại**, đặc biệt: **hướng phụ thuộc `zones → iot` MỘT CHIỀU vĩnh viễn** và **route đặt ở phía `zones`** (`PATCH /api/v1/zones/:id/devices`). UC-94 thêm method vào `ZonesService` + route vào `ZonesController` + **method GHI vào `IotDevicesService`**. KHÔNG migration schema, KHÔNG sửa `ZonesModule`.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZonesService` — nền đã đủ cho cross-module + transaction ([zones.service.ts](../../../../src/modules/zones/services/zones.service.ts))
- Constructor **4 dependency** ([:50-58](../../../../src/modules/zones/services/zones.service.ts)): `@InjectRepository(ZoneEntity) repo`, `DataSource`, `ZonesAuditRepository`, **`IotDevicesService`** — UC-94 **không cần đổi constructor**, mọi thứ cần đã có sẵn.
- **`private loadActive(id)`** ([:125-136](../../../../src/modules/zones/services/zones.service.ts)) → 404 `ZONE_NOT_FOUND`; tái dùng.
- **Mẫu transaction chuẩn** trong `remove()` ([:345-...](../../../../src/modules/zones/services/zones.service.ts)): `loadActive` → gọi cross-module **NGOÀI** transaction (fail nhanh) → `createQueryRunner` → `connect` → `startTransaction` → ghi + audit → `commit` / `catch rollback` / **`finally release()`**.
- **Tiền lệ gọi cross-module**: `await this.iotDevicesService.countByZoneId(id)` — hiện **chỉ ĐỌC**. UC-94 sẽ là lần đầu **GHI**.

### 0.2. `ZonesController` — 5 route, thứ tự hiện tại ([zones.controller.ts](../../../../src/modules/zones/controllers/zones.controller.ts))
Thứ tự khai: `@Get()` → `@Get(':id')` → `@Post()` → `@Patch(':id')` → `@Delete(':id')`. Hằng `ZONE_PIPE`, `@CurrentUser() user: { userId: string }` đã dùng ở POST/PATCH/DELETE.

⚠ **Phân tích xung đột route cho `@Patch(':id/devices')`** (OQ-10): pattern `:id` trong Nest/Express khớp **đúng một segment**, nên `/zones/<uuid>/devices` (**2 segment**) **KHÔNG** bị `@Patch(':id')` (**1 segment**) nuốt ⇒ **không có xung đột thật**. Luật "static trước động" chỉ áp dụng khi **cùng số segment** (vd `@Get('statistics')` vs `@Get(':id')`). Kết luận đề xuất ở OQ-10.

### 0.3. `ZonesAuditRepository` — đã có, cần thêm method cho UC-94 ([zones-audit.repository.ts](../../../../src/modules/zones/repositories/zones-audit.repository.ts))
- Hằng `ZONE_ENTITY_TYPE = 'zones'`; mỗi method nhận **`entityManager: EntityManager`** (chạy trong transaction của caller) + params, raw SQL parameter-bound vào `audit_logs` (`user_id, action_type, entity_type, entity_id, severity, metadata_json`).
- 3 method hiện có: `logZoneCreation` (`'create'`), `logZoneUpdate` (`'update'`), `logZoneDeletion` (`'delete'`).
- **SEC-01**: `logZoneUpdate` thay nội dung `metadataJson` bằng cờ `{ changed: true }` — nguyên tắc "audit không chở dữ liệu tự do".
- ⇒ UC-94 cần **method mới** (OQ-6), **không** tái dùng được 3 method trên (`action_type` hard-code).

### 0.4. ⭐ Tiền lệ ĐẦY ĐỦ: `IotDevicesService.assignRoom` ([iot-devices.service.ts:661-770](../../../../src/modules/iot/services/iot-devices.service.ts))
Đây là bản mẫu gần nhất cho "gán thiết bị vào một thực thể khác". Trình tự thật:
1. Load device → không có → `404 IOT_DEVICE_NOT_FOUND` ([:667-676](../../../../src/modules/iot/services/iot-devices.service.ts)).
2. **Chặn theo trạng thái thiết bị**: `DISABLED` / `MAINTENANCE` / health `FAULTY` → `409 DEVICE_NOT_ACTIVE` ([:684-693](../../../../src/modules/iot/services/iot-devices.service.ts)). Ngay trên đó có comment **`[NEEDS CLARIFICATION]`** ([:678-683](../../../../src/modules/iot/services/iot-devices.service.ts)) nói `OFFLINE` **cố ý không chặn** vì thiết bị mới tạo mặc định `OFFLINE` — **nợ kỹ thuật có sẵn**, chưa ai chốt.
3. **Allowlist `device_type`**: `FACE_SERVER`, `IP_CAMERA`, `ROOM_CAMERA` → ngoài danh sách → `409 DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM` ([:695-706](../../../../src/modules/iot/services/iot-devices.service.ts)).
4. **Idempotent**: gán lại đúng room hiện tại → `return device` không ghi gì ([:708-711](../../../../src/modules/iot/services/iot-devices.service.ts)).
5. **CHẶN chuyển đổi**: đang thuộc room KHÁC → `409 DEVICE_ALREADY_ASSIGNED_TO_ROOM` ([:713-718](../../../../src/modules/iot/services/iot-devices.service.ts)) — **không cho đè**, buộc gỡ trước. Đây là dữ kiện chính cho OQ-3.
6. **Transaction TỰ QUẢN**: `assignRoom` tự `createQueryRunner` ([:741-769](../../../../src/modules/iot/services/iot-devices.service.ts)), ghi `save` + `logAssignRoom(queryRunner.manager, { oldRoomId, newRoomId })` rồi commit/rollback/`finally release()`. **Không** nhận `EntityManager` từ ngoài ⇒ nếu UC-94 gọi thẳng kiểu này thì audit của `zones` sẽ nằm **ngoài** transaction của `iot` → mất tính nguyên tử. Dữ kiện chính cho OQ-7.
- ⚠ **ANTI-PRECEDENT (không được bắt chước)**: `assignRoom` validate room bằng **raw SQL thẳng vào bảng `rooms`** ([:721-725](../../../../src/modules/iot/services/iot-devices.service.ts)) — module `iot` đọc bảng của module `rooms`, **vi phạm ARCH-01 theo chiều ngược lại**. UC-94 **TUYỆT ĐỐI KHÔNG** sao chép kiểu này (zones không được `SELECT ... FROM iot_devices`).

### 0.5. `IoTDeviceEntity` ([iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts))
- `zoneId: string | null` ([:60-61](../../../../src/modules/iot/entities/iot-device.entity.ts)) — nullable, **song song** `roomId` (không thay thế).
- `deviceType: IoTDeviceType` (`face_server | ip_camera | room_camera | ...`), `status: IoTDeviceStatus` (`online|offline|disabled|maintenance`), `healthStatus`.
- **KHÔNG có soft-delete** ⇒ mọi truy vấn thiết bị không cần lọc `deletedAt`.

### 0.6. FK `zone_id` và tương tác với UC-92 ([20260721000002-AddZoneIdToIotDevices.ts](../../../../src/database/migrations/20260721000002-AddZoneIdToIotDevices.ts))
- `zone_id uuid NULL`, FK `ON DELETE SET NULL` ([:17-20](../../../../src/database/migrations/20260721000002-AddZoneIdToIotDevices.ts)), index `IDX_iot_devices_zone_id` ([:22-24](../../../../src/database/migrations/20260721000002-AddZoneIdToIotDevices.ts)).
- ⚠ `ON DELETE SET NULL` **không bao giờ kích hoạt** vì zone dùng soft-delete (UC-92 §0.3).
- ⭐ **PHÁT HIỆN QUAN TRỌNG — UC-94 là điều kiện để UC-92 dùng được**: UC-92 **chặn xoá zone khi `countByZoneId > 0`** (`409 ZONE_HAS_DEVICES`, yêu cầu "hãy gỡ thiết bị trước khi xoá"). Nhưng **hiện tại KHÔNG có endpoint nào set `iot_devices.zone_id`** ⇒ một khi UC-94 cho gán, nếu **không có đường GỠ** thì zone đó **vĩnh viễn không xoá được qua API**. ⇒ Endpoint gỡ (OQ-2) **không phải tuỳ chọn**, nó là **phụ thuộc bắt buộc** để lời hứa của UC-92 thành hiện thực.

### 0.7. Mẫu seed permission ([20260722000004-SeedZoneReadPermission.ts](../../../../src/database/migrations/20260722000004-SeedZoneReadPermission.ts), [...0003](../../../../src/database/migrations/20260722000003-SeedZoneDeletePermission.ts))
- Cấu trúc `permission = {code, name, module:'zones', action, description}` + mảng `roles`; `up()` idempotent; `down()` xoá `role_permissions` trước rồi `permissions`.
- Tiền lệ role: **2 role** (`SYSTEM_ADMIN`+`BUSINESS_ADMIN`) cho `create`/`update`/`delete`; **4 role** cho `read`.
- Timestamp cuối hiện tại `20260722000004` ⇒ UC-94 dùng **`20260722000005`**.

---

## 1. Scope (UC-94)

### TRONG scope
1. **Gán thiết bị vào zone**: `PATCH /api/v1/zones/:id/devices` (vị trí route ĐÃ CHỐT ở UC-92 OQ-1b). Số lượng thiết bị mỗi lần gọi **chờ OQ-1**.
2. **Gỡ gán thiết bị khỏi zone** (set `zone_id = NULL`) — **bắt buộc phải có** (§0.6); hình thức endpoint **chờ OQ-2**.
3. **Method GHI mới trên `IotDevicesService`** để `zones` set `zone_id` **mà không** query thẳng bảng `iot_devices` (ARCH-01). Chữ ký + ranh giới transaction **chờ OQ-7**.
4. **Validate**: zone tồn tại & đang sống (`loadActive`); thiết bị tồn tại; các ràng buộc khác (loại thiết bị, trạng thái thiết bị, zone `inactive`, thiết bị đang thuộc zone khác) **chờ OQ-3/OQ-4/OQ-5**.
5. **Audit** thao tác gán/gỡ **chờ OQ-6** (nếu có: thêm method vào `ZonesAuditRepository`).
6. **1 migration seed permission** (`20260722000005`), tên + role **chờ OQ-8**.
7. Unit test cho method mới (mock `IotDevicesService`, mock repo — **không DB**).

### NGOÀI scope (KHÔNG làm)
- **UC-95 — sơ đồ lắp đặt camera** (Extended, đang gác): toạ độ/vị trí lắp, `layout_json`, bản đồ khu vực. **KHÔNG** thêm cột toạ độ.
- **FT-20 / FT-21**: định tuyến sự kiện thật theo `zone_id` (`gate_access_logs`, `zone_presence_events`), tôn trọng `status='inactive'` — UC-94 chỉ **cung cấp dữ liệu gán**, không tiêu thụ.
- **Đọc/hiển thị danh sách thiết bị của zone** như một endpoint riêng (`GET /zones/:id/devices`) — nếu cần thì là UC khác; xem OQ-9 về việc response có nên chứa thiết bị không.
- **Gán zone cho thiết bị từ phía `iot`** (`PATCH /iot-devices/:id/zone`) — **CẤM** (UC-92 OQ-1b).
- **Đụng `room_id`**: `zone_id` và `room_id` song song, UC-94 **không** đọc/ghi/đối chiếu `room_id`.
- **KHÔNG** migration schema (không cột mới, không đổi FK/index).
- **KHÔNG** sửa `ZonesModule` (đã đủ), **KHÔNG** đụng `create()`/`update()`/`remove()`/`list()`/`getDetail()`/`loadActive()`.
- **KHÔNG** để `IotModule` import `ZonesModule`; **CẤM `forwardRef`**.

## 2. DTO (đề xuất — mô tả, KHÔNG code)

**`AssignZoneDevicesDto`** (`src/modules/zones/dto/assign-zone-devices.dto.ts`) — **1 field duy nhất** (CHỐT OQ-1):

| Field API | Property | Ràng buộc |
| :--- | :--- | :--- |
| `device_ids` | `deviceIds: string[]` | `@Expose({name:'device_ids'})` `@IsArray` `@ArrayNotEmpty` **`@ArrayMaxSize(50)`** `@IsUUID('4', { each: true })` |

- **KHÔNG** khai `zone_id` trong body — lấy từ `:id` trên path (tránh 2 nguồn sự thật).
- **KHÔNG** khai `room_id`, toạ độ, hay bất kỳ field nào của module `iot`.
- **KHÔNG cần DTO cho gỡ** (CHỐT OQ-2: endpoint riêng, `:deviceId` trên path qua `ParseUUIDPipe`).
- `whitelist: true` (`ZONE_PIPE`) loại mọi field thừa.

## 3. Service (đề xuất — thêm method vào `ZonesService`)

**`async assignDevices(zoneId: string, dto: AssignZoneDevicesDto, actorUserId: string)`** — thứ tự CHỐT:
1. `const zone = await this.loadActive(zoneId);` → 404 `ZONE_NOT_FOUND` trước mọi thứ.
2. `zone.status === 'inactive'` → `409 ZONE_INACTIVE` (CHỐT OQ-5).
3. **Validate thiết bị** qua `IotDevicesService` (CHỐT OQ-4: tồn tại → 404; `device_type` ∈ 5 loại → nếu không, `409 DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE`; **KHÔNG** chặn theo `status`/`healthStatus`) — đặt **NGOÀI** transaction để fail nhanh (mirror `remove()` §0.1). Lỗi phải nêu rõ **`device_id` nào** gây lỗi (CHỐT OQ-1: all-or-nothing).
4. **Transaction** (`createQueryRunner` → `connect` → `startTransaction`):
   a. `iotDevicesService.setZoneForDevices(deviceIds, zoneId, queryRunner.manager)` (CHỐT OQ-7 — truyền `EntityManager`);
   b. `zonesAuditRepository.logZoneAssignDevices(...)` (CHỐT OQ-6, có `old_zone_id`→`new_zone_id` cho thiết bị bị đè — CHỐT OQ-3);
   c. `commit`; `catch` → `rollback` + rethrow; **`finally` → `release()`**.
5. Trả `{ zone, assigned_device_ids }` (CHỐT OQ-9).

**`async unassignDevice(zoneId: string, deviceId: string, actorUserId: string)`** (CHỐT OQ-2 — endpoint riêng): `loadActive` → xác nhận thiết bị **đang thuộc đúng zone này** → transaction { `setZoneForDevices([deviceId], null, manager)` + `logZoneUnassignDevice` } → commit.

- **CẤM** `this.repo.query('... iot_devices ...')` hay bất kỳ truy vấn trực tiếp nào tới bảng của module `iot` (ARCH-01) — kể cả khi `assignRoom` đang làm điều tương tự với `rooms` (§0.4 anti-precedent).
- **CẤM** đụng `create`/`update`/`remove`/`list`/`getDetail`/`loadActive`.

## 4. Cross-module — method thêm vào `IotDevicesService`

Đây là **crux kiến trúc** của UC-94 (§3 của prompt). Nguyên tắc: **`iot` nhận `zoneId` như một giá trị đục (opaque), KHÔNG hiểu ngữ nghĩa zone** — không kiểm zone tồn tại, không kiểm zone `status`, không import gì từ `zones`.

**Chữ ký ĐÃ CHỐT (OQ-7 phương án A):**

```text
async setZoneForDevices(
  deviceIds: string[],
  zoneId: string | null,
  manager?: EntityManager,
): Promise<{ affected: number; devices: IoTDeviceEntity[] }>
```

- `zoneId: string | null` — **một method duy nhất** cho cả gán (`zoneId`) lẫn gỡ (`null`); `iot` không cần biết đó là "gán" hay "gỡ".
- **`manager?: EntityManager`** — nhận `EntityManager` từ caller để chạy trong transaction của `zones`; nếu không truyền thì tự dùng `this.dataSource.manager`. Đây chính là pattern `ZonesAuditRepository` đang dùng (§0.3) và là cách **duy nhất** giữ nguyên tử giữa "ghi `zone_id`" và "ghi audit" (R5).
- **Method đọc phụ trợ** (CHỐT OQ-4) — vd `findAssignableByIds(deviceIds): Promise<IoTDeviceEntity[]>` — để `zones` biết id nào không tồn tại / sai loại **mà không** query bảng `iot_devices`.
- **Allowlist `device_type` (CHỐT OQ-4 — ĐÚNG 5 loại)**: `IP_CAMERA`, `DOOR_CAMERA`, `ROOM_CAMERA`, `OCCUPANCY_SENSOR`, `FACE_SERVER`. Loại trừ `MICROPHONE`, `CAPTURE_AGENT`, `DISPLAY`.
  ⚠ **KHÔNG** copy allowlist 3 loại của `assignRoom` (thiết kế cho **phòng họp**): thiếu `DOOR_CAMERA` thì camera cổng không gán được zone cổng (chặn FT-20), thiếu `OCCUPANCY_SENSOR` thì cảm biến đếm người không gán được zone hành lang (chặn FT-21) — tức chặn đứng lý do tồn tại của Zone.
- JSDoc bắt buộc ghi: *"API cho module khác. `iot` KHÔNG biết nghiệp vụ zone; mọi kiểm tra về zone (tồn tại, `status`, soft-delete) thuộc trách nhiệm caller."*
- **CẤM** import bất kỳ thứ gì từ `zones` vào module `iot`; **CẤM** `forwardRef`.
- `iot.module.ts` **không cần sửa** — `IotDevicesService` đã nằm trong `exports`.

## 5. Controller (đề xuất — thêm route vào `ZonesController`)

```text
PATCH  /api/v1/zones/:id/devices              → gán (batch, all-or-nothing)
DELETE /api/v1/zones/:id/devices/:deviceId    → gỡ 1 thiết bị
```
- Cả hai: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + **`@RequirePermissions('zones.zone.assign_device')`** (CHỐT OQ-8, dùng chung cho gán lẫn gỡ) + `@Param('id', ParseUUIDPipe)` + `@CurrentUser() user: { userId: string }`.
- Route gán: `@UsePipes(ZONE_PIPE)` + `@Body() dto: AssignZoneDevicesDto`.
- Route gỡ: thêm `@Param('deviceId', ParseUUIDPipe)`.
- **Thứ tự khai (CHỐT OQ-10)**: `:id/devices` (**2 segment**) **không** xung đột với `:id` (**1 segment**) — luật "static trước động" chỉ áp dụng khi **CÙNG SỐ SEGMENT**. Vẫn khai `@Patch(':id/devices')` **trước** `@Patch(':id')` kèm comment giải thích để người sau không hiểu nhầm luật.
- **KHÔNG** `@HttpCode` (PATCH/DELETE mặc định 200).

**HTTP status dự kiến**

| Tình huống | Status | `code` |
| :--- | ---: | :--- |
| Gán/gỡ thành công | `200` | — |
| Body sai (`device_ids` rỗng/không UUID/vượt `N`) | `400` | (Nest validation) |
| `:id` hoặc `:deviceId` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission | `403` | `FORBIDDEN` (guard) |
| Zone không tồn tại / đã xoá mềm | `404` | `ZONE_NOT_FOUND` |
| Thiết bị không tồn tại | `404` | `IOT_DEVICE_NOT_FOUND` (mirror `assignRoom`) |
| Zone `inactive` (nếu OQ-5 chặn) | `409` | `ZONE_INACTIVE` |
| Thiết bị sai loại (nếu OQ-4 chặn) | `409` | `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE` |
| Thiết bị đang thuộc zone khác (nếu OQ-3 chặn) | `409` | `DEVICE_ALREADY_ASSIGNED_TO_ZONE` |

## 6. Requirements (EARS)

- **R1**: **WHEN** người dùng có permission gọi route gán trên zone đang sống với thiết bị hợp lệ **→** hệ thống set `iot_devices.zone_id = :id` cho các thiết bị đó, ghi audit (nếu OQ-6 chốt có), trả `200`.
- **R2**: **IF** `:id` không tồn tại hoặc zone đã soft-delete **→** `404 ZONE_NOT_FOUND`, **KHÔNG** ghi gì (kể cả `iot_devices`).
- **R3**: **IF** bất kỳ `device_id` nào không tồn tại **→** `404 IOT_DEVICE_NOT_FOUND`; hành vi với phần còn lại của batch theo OQ-1 (all-or-nothing hay best-effort).
- **R4 (crux ARCH-01)**: **WHILE** thực hiện mọi thao tác, module `zones` **CHỈ** được đọc/ghi `iot_devices` qua `IotDevicesService`; **CẤM** SQL/repository trực tiếp tới bảng của module `iot`.
- **R5 (crux nguyên tử)**: **IF** ghi `zone_id` thành công nhưng ghi audit thất bại (hoặc ngược lại) **→** toàn bộ PHẢI rollback; **KHÔNG** được tồn tại trạng thái "thiết bị đã đổi zone nhưng không có dấu vết" (điều kiện: OQ-6 chốt có audit, OQ-7 chốt truyền `EntityManager`).
- **R6**: **WHILE** mở transaction, mọi nhánh (thành công/lỗi) PHẢI `release()` trong `finally` — thiếu là rò connection pool.
- **R7**: **WHEN** gán lại **đúng** zone mà thiết bị đang thuộc **→** idempotent: không đổi dữ liệu, không sinh audit trùng, trả `200` (mirror `assignRoom` §0.4 bước 4).
- **R8**: **WHERE** thiết bị đang thuộc zone **khác** **→** hành vi theo OQ-3 (đè + ghi `old_zone_id`→`new_zone_id` vào audit, **hoặc** `409 DEVICE_ALREADY_ASSIGNED_TO_ZONE`); PHẢI xác định, **KHÔNG** để "tuỳ trường hợp".
- **R9**: **WHEN** gỡ gán **→** `iot_devices.zone_id` được set `NULL`; sau đó zone PHẢI xoá được qua UC-92 (`countByZoneId` giảm về 0) — đây là điều kiện đóng vòng với UC-92 (§0.6).
- **R10**: **WHILE** ghi audit, **KHÔNG** ghi secret hay `metadata_json` của thiết bị (SEC-01, mirror `logZoneUpdate`).
- **R11 (SEC-02)**: **WHILE** xử lý mọi route, request PHẢI qua `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions`; `actorUserId` lấy từ `@CurrentUser()`, **KHÔNG** từ body.
- **R12**: **WHERE** zone có `status='inactive'` **→** hành vi theo OQ-5; nếu cho phép gán thì phải ghi rõ FT-20/FT-21 vẫn có trách nhiệm bỏ qua zone `inactive`.

## 7. Constitution

| Rule | Áp dụng trong UC-94 |
| :--- | :--- |
| **ARCH-01 (crux)** | `zones` ghi `iot_devices` **chỉ** qua `IotDevicesService`; `iot` không import `zones`, không hiểu nghiệp vụ zone. **Không** lặp lại anti-precedent `assignRoom → SELECT FROM rooms` (§0.4). |
| **SEC-01** | Audit không chở `metadata_json`/secret của thiết bị; chỉ ghi id + `old_zone_id`/`new_zone_id`. |
| **SEC-02** | Route mutating → guard đầy đủ + `@RequirePermissions`; actor từ JWT. |
| **SEC-03** | DTO validate (`@IsUUID('4', {each:true})`) + `ZONE_PIPE`; `:id`/`:deviceId` qua `ParseUUIDPipe`; repository API/parameter binding. |
| **DATA-01** | UC-94 **không xoá** gì: "gỡ gán" là `UPDATE zone_id = NULL`, không phải delete. Lookup zone luôn lọc `deleted_at IS NULL`. |
| **ARCH-02** | Batch phải có **giới hạn kích thước** (OQ-1) để transaction không kéo dài > 2s. |
| **ARCH-03** | Idempotency tự nhiên (R7): gán lại cùng zone → không đổi gì. Gỡ thiết bị đã gỡ → no-op hoặc 404, chốt ở OQ-2. |
| **ENG-01** | Test ≥80%: happy path, 404 zone, 404 device, idempotent, thiết bị thuộc zone khác, rollback khi audit lỗi, `release()` được gọi. |
| **ENG-03** | Lỗi `{code, message}`; không lộ stack/SQL. |
| **ENG-04** | Không thêm dependency. |

## 8. OPEN QUESTIONS — ĐÃ CHỐT

> Thiếu Chủ đã chốt OQ-1 → OQ-11 ngày 2026-07-22. Phần *Đề xuất/Phân tích* giữ nguyên để lưu vết; dòng **KẾT LUẬN** là quyết định cuối. **Plan/tasks/code KHÔNG được mở lại.** Một điểm **khác** đề xuất ban đầu của agent: **OQ-4** (allowlist mở rộng từ 3 → **5 loại**).

- **OQ-1 (CRUX) — Gán 1 hay NHIỀU thiết bị mỗi lần?** *Đề xuất*: **batch `{ device_ids: [...] }`, ALL-OR-NOTHING**, có **giới hạn `@ArrayMaxSize(50)`**.
  *Lý do*: route đã chốt là `PATCH /zones/:id/devices` (danh từ **số nhiều**) ⇒ ngữ nghĩa "gán tập thiết bị này vào zone"; màn hình quản trị thường multi-select cả dàn camera của một cổng. All-or-nothing giữ đúng tính nguyên tử với audit (R5) và dễ suy luận: hoặc cả lô vào zone, hoặc không gì cả. Giới hạn 50 để transaction không kéo dài (ARCH-02).
  *Rủi ro*: 1 thiết bị lỗi làm hỏng cả lô — UX phải báo rõ id nào gây lỗi; best-effort thì ngược lại, dễ để lại trạng thái nửa vời và audit rối.
  **KẾT LUẬN — CHỐT: batch `{ device_ids: [...] }`, ALL-OR-NOTHING, `@ArrayMaxSize(50)`.** Một thiết bị lỗi → **cả lô rollback**; thông điệp lỗi PHẢI nêu rõ **`device_id` nào** gây lỗi.

- **OQ-2 (bắt buộc phải quyết) — Hình thức GỠ gán.** *Đề xuất*: **endpoint riêng `DELETE /api/v1/zones/:id/devices/:deviceId`**.
  *Lý do*: rõ nghĩa, không mập mờ như "PATCH với `device_ids: []`" (không phân biệt được "gỡ hết" và "không làm gì"); và khớp hướng route đã chốt (vẫn ở phía `zones`).
  ⭐ *Đây KHÔNG phải tuỳ chọn*: §0.6 chứng minh UC-92 chặn xoá zone khi còn thiết bị, mà **không có endpoint nào set `zone_id`** ⇒ nếu UC-94 chỉ cho gán mà không cho gỡ thì **zone đã gán camera vĩnh viễn không xoá được qua API**, chỉ sửa được bằng SQL tay.
  *Phương án thay thế*: `DELETE /zones/:id/devices` với body `{ device_ids }` (gỡ nhiều), hoặc gỡ-tất-cả.
  **KẾT LUẬN — CHỐT: endpoint riêng `DELETE /api/v1/zones/:id/devices/:deviceId`, BẮT BUỘC có trong UC-94**, không được hoãn — thiếu nó thì tính năng xoá zone của UC-92 chết trên thực tế (§0.6).

- **OQ-3 — Thiết bị đang thuộc zone KHÁC: đè hay chặn?** *Đề xuất*: **CHO ĐÈ** (chuyển zone), ghi `old_zone_id` → `new_zone_id` vào audit.
  *Lý do*: zone là **nhóm logic** (cổng/hành lang/bãi xe), khác `room` là vị trí lắp vật lý — camera được gán lại zone là thao tác vận hành bình thường (đổi phân vùng giám sát). Chặn sẽ buộc client gọi 2 lần (gỡ rồi gán) và tạo cửa sổ nửa vời.
  ⚠ *Lệch tiền lệ*: `assignRoom` **chặn** (`409 DEVICE_ALREADY_ASSIGNED_TO_ROOM`, §0.4 bước 5). Nếu Thiếu Chủ muốn nhất quán với `iot` thì chọn chặn.
  *Rủi ro của việc đè*: log đã sinh (`gate_access_logs`, `zone_presence_events`) mang `zone_id` **cũ** và là append-only ⇒ báo cáo theo `zone_id` cho **quá khứ vẫn đúng**, nhưng báo cáo "thiết bị X thuộc zone nào" theo trạng thái hiện tại sẽ khác lịch sử. Audit `old→new` là bằng chứng duy nhất cho lần chuyển.
  **KẾT LUẬN — CHỐT: CHO ĐÈ (chuyển zone)**, ghi `old_zone_id` → `new_zone_id` vào audit. **Lệch CÓ CHỦ ĐÍCH** với `assignRoom` (chặn): `zone` là **nhóm logic**, `room` là **vị trí lắp vật lý**; gán lại zone là thao tác vận hành bình thường, chặn sẽ buộc client gọi 2 lần và tạo cửa sổ thiết bị không thuộc zone nào. **Người sau KHÔNG được "sửa cho giống `assignRoom`".**

- **OQ-4 — Validate thiết bị đến đâu?** *Đề xuất*: kiểm **tồn tại** (404) + **allowlist `device_type`** = `FACE_SERVER`, `IP_CAMERA`, `ROOM_CAMERA` (mirror `assignRoom` §0.4 bước 3) → `409 DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE`. **KHÔNG** chặn theo `status`/`healthStatus`.
  *Lý do không chặn status*: gán zone là **cấu hình định tuyến logic**, không phải thao tác vận hành thiết bị; chặn `DISABLED`/`MAINTENANCE` sẽ cản admin chuẩn bị cấu hình trước khi bật thiết bị. Ngoài ra tiền lệ `assignRoom` ở đúng chỗ này còn đang treo `[NEEDS CLARIFICATION]` về `OFFLINE` (§0.4) — không nên nhân bản một quy tắc chưa ai chốt.
  *Method cần thêm ở `iot`* (để `zones` không query thẳng bảng): `findAssignableByIds(deviceIds)` hoặc `validateAssignable(deviceIds)` trả về danh sách thiết bị + id nào thiếu/sai loại.
  **KẾT LUẬN — CHỐT (SỬA đề xuất agent): allowlist ĐÚNG 5 LOẠI** — `IP_CAMERA`, **`DOOR_CAMERA`**, `ROOM_CAMERA`, **`OCCUPANCY_SENSOR`**, `FACE_SERVER`; ngoài danh sách → `409 DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE`. Loại trừ `MICROPHONE`, `CAPTURE_AGENT`, `DISPLAY`.
  *Lý do sửa*: đề xuất ban đầu chỉ 3 loại vì **copy allowlist của `assignRoom`** — nhưng allowlist đó thiết kế cho **phòng họp**, không phải **khuôn viên**. Thiếu `DOOR_CAMERA` ⇒ camera cổng không gán được zone cổng (chặn FT-20); thiếu `OCCUPANCY_SENSOR` ⇒ cảm biến đếm người không gán được zone hành lang (chặn FT-21) — tức chặn đứng lý do tồn tại của Zone.
  Giữ nguyên phần **KHÔNG chặn theo `status`/`healthStatus`** (lý do agent nêu đúng).

- **OQ-5 — Zone `status='inactive'` có cho gán không?** *Đề xuất*: **CHẶN** → `409 ZONE_INACTIVE`.
  *Lý do*: UC-91 chốt `inactive` = "khu vực ngừng sử dụng" và FT-20/FT-21 **phải** bỏ qua zone inactive. Gán camera vào zone inactive tạo cấu hình chết: thiết bị sinh event mà không phân hệ nào tiêu thụ — sai âm thầm, khó phát hiện.
  *Phương án thay thế*: cho phép (coi là chuẩn bị cấu hình trước khi kích hoạt zone) — khi đó phải ghi rõ trách nhiệm bỏ qua thuộc FT-20/21.
  **KẾT LUẬN — CHỐT: CHẶN → `409 ZONE_INACTIVE`.**

- **OQ-6 — Audit cho gán/gỡ?** *Đề xuất*: **CÓ**, `entity_type = 'zones'`, `entity_id = <zone id>`, `action_type = 'assign_device'` / `'unassign_device'`; thêm 2 method vào `ZonesAuditRepository`; `metadata_json` = `{ device_ids, old_zone_id?, new_zone_id? }`.
  *Lý do chọn `entity_type='zones'`*: đây là **quyết định quản trị khu vực**, thực hiện qua endpoint của `zones`, actor được kiểm bằng permission của `zones`; và `ZonesAuditRepository` vốn hard-code `'zones'`.
  *Phản biện cần cân*: hàng dữ liệu thực sự đổi lại nằm ở bảng **`iot_devices`** — tra "thiết bị X từng đổi zone khi nào" sẽ không thấy nếu chỉ tra theo `entity_type='iot_devices'`. Có thể (a) ghi 1 bản `zones`, (b) ghi 1 bản `iot_devices` qua `IotAuditRepository`, hoặc (c) ghi cả hai.
  **KẾT LUẬN — CHỐT: (a) — chỉ `entity_type='zones'`**, `entity_id = <zone id>`, `action_type = 'assign_device'` / `'unassign_device'`; thêm **2 method** vào `ZonesAuditRepository`; `metadata_json = { device_ids, old_zone_id?, new_zone_id? }`. **KHÔNG** ghi kép sang `entity_type='iot_devices'` (tránh nhân đôi bản ghi + kéo module `iot` vào transaction audit). **SEC-01**: không ghi `metadata_json` của thiết bị, không ghi secret.
  *Nợ ghi nhận (§9)*: tra "thiết bị X từng đổi zone khi nào" phải lọc `metadata_json->>'device_ids'` — **không có index**.

- **OQ-7 (CRUX kiến trúc) — Ranh giới transaction cross-module.** Hai phương án:
  | | (A) `zones` mở tx, truyền `EntityManager` xuống `iot` **(đề xuất)** | (B) `IotDevicesService` tự mở tx (giống `assignRoom`) |
  | :--- | :--- | :--- |
  | Nguyên tử | ✅ `zone_id` + audit của `zones` **cùng 1 transaction** | ❌ 2 transaction rời: ghi `zone_id` commit xong, audit lỗi → **thiết bị đã đổi zone mà không có dấu vết** (vi phạm R5) |
  | Ghép với tiền lệ | Khớp `ZonesAuditRepository` (nhận `EntityManager`) | Khớp `assignRoom` |
  | Nhược | `iot` phải thêm tham số `manager?` — hé lộ chi tiết hạ tầng ra API công khai | Đơn giản hơn, nhưng mất tính nguyên tử |

  *Đề xuất*: **(A)** — `IotDevicesService.setZoneForDevices(deviceIds, zoneId, manager?)`; khi `manager` được truyền thì dùng nó, không tự mở tx. Đây là cách **duy nhất** thoả R5 mà vẫn giữ ARCH-01 (zones không chạm bảng của iot).
  *Rủi ro*: nếu sau này `iot` muốn thêm logic phụ (ví dụ emit event) trong cùng method, ranh giới tx bị caller kiểm soát có thể gây bất ngờ — phải ghi rõ trong JSDoc.
  **KẾT LUẬN — CHỐT: phương án (A).** `ZonesService` mở `queryRunner` và truyền `EntityManager` xuống `setZoneForDevices(deviceIds, zoneId, manager?)`; khi `manager` được truyền thì dùng nó, **không** tự mở transaction. JSDoc PHẢI cảnh báo: ranh giới transaction do caller kiểm soát.

- **OQ-8 — Permission.** *Đề xuất*: **1 permission `zones.zone.assign_device`** dùng cho **cả gán lẫn gỡ**, role **`SYSTEM_ADMIN` + `BUSINESS_ADMIN`** (như mọi thao tác ghi của cụm zone).
  *Lý do*: gán và gỡ là hai nửa của cùng một nghiệp vụ "quản lý thiết bị của khu vực"; tách permission lúc này là seed một quyền không ai dùng khác đi (bài học từ UC-91 OQ-5).
  *Phương án thay thế*: tách `assign_device`/`unassign_device` nếu muốn cho phép ai đó gán mà không được gỡ — hiện chưa có nhu cầu.
  **KẾT LUẬN — CHỐT: 1 permission `zones.zone.assign_device`** (`module_code='zones'`, `action_code='assign_device'`) cho **cả gán lẫn gỡ**, role **`SYSTEM_ADMIN` + `BUSINESS_ADMIN`**.

- **OQ-9 — Response trả gì?** *Đề xuất*: `{ success, message: 'Devices assigned to zone successfully', data: { zone: toZoneResponse(zone), assigned_device_ids: [...] } }`.
  *Lý do*: `assigned_device_ids` chỉ **phản chiếu lại id client vừa gửi** (không phải dữ liệu mới của module `iot`) nên **không lộ** thông tin thiết bị; `zone` giúp FE cập nhật lại state mà không cần gọi thêm.
  *Phản biện*: trả **thông tin thiết bị đầy đủ** (tên, loại, trạng thái) sẽ tiện cho FE nhưng biến endpoint của `zones` thành cửa đọc dữ liệu `iot` — lệch boundary, và `toZoneResponse` không có chỗ chứa. Phương án tối giản: `data: null` + `meta: { assigned_count }`.
  **KẾT LUẬN — CHỐT: `{ success, message, data: { zone: toZoneResponse(zone), assigned_device_ids: [...] } }`** cho gán; gỡ trả `{ zone, unassigned_device_id }` (hoặc tương đương). **KHÔNG** trả thông tin thiết bị (tên/loại/trạng thái) — không biến endpoint của `zones` thành cửa đọc dữ liệu `iot`.

- **OQ-10 — Thứ tự khai route.** *Đề xuất*: **không có xung đột kỹ thuật** (§0.2: `:id/devices` 2 segment vs `:id` 1 segment), nhưng vẫn **khai `@Patch(':id/devices')` TRƯỚC `@Patch(':id')`** kèm comment, để nhất quán với luật module đã chốt ở UC-93 và tránh việc người sau thêm route cùng số segment rồi vấp.
  *Lưu ý*: luật "static trước động" chỉ **thực sự cần** khi hai pattern cùng số segment và có thể khớp lẫn nhau (vd `@Get('statistics')` vs `@Get(':id')`).
  **KẾT LUẬN — CHỐT + ĐÍNH CHÍNH LUẬT MODULE**: luật "static khai trước động" **chỉ áp dụng khi hai pattern CÙNG SỐ SEGMENT** và có thể khớp lẫn nhau. `:id/devices` (2 segment) **không** xung đột với `:id` (1 segment). Vẫn khai `@Patch(':id/devices')` **trước** `@Patch(':id')` kèm comment giải thích, để người sau không hiểu nhầm luật. Bản đính chính này phải vào **plan §Kỷ luật**.

- **OQ-11 — Mâu thuẫn giữa prompt và file luật.** Rà soát: **không có mâu thuẫn mới**. Hai điểm cần Thiếu Chủ **ghi nhận** (không phải quyết định của UC-94):
  1. **Anti-precedent ARCH-01 trong module `iot`**: `assignRoom` truy vấn thẳng bảng `rooms` bằng raw SQL ([iot-devices.service.ts:721-725](../../../../src/modules/iot/services/iot-devices.service.ts)) — vi phạm service boundary theo chiều `iot → rooms`. UC-94 **không sửa** (ngoài phạm vi) nhưng cũng **không được sao chép**. Đề nghị ghi thành nợ kỹ thuật riêng.
  2. **`[NEEDS CLARIFICATION]` treo sẵn** trong `assignRoom` về việc có chặn `OFFLINE` hay không ([:678-683](../../../../src/modules/iot/services/iot-devices.service.ts)) — liên quan trực tiếp tới OQ-4; nếu Thiếu Chủ chốt quy tắc trạng thái cho zone thì nên chốt luôn cho room để hai chỗ không lệch nhau.
  - Các lệch đã biết khác (4 role thật, error envelope thiếu `timestamp`/`path`, chưa Swagger, 5 file `spec/global/` rỗng) giữ nguyên như UC-90→93, **không mở lại**.
  **KẾT LUẬN — XÁC NHẬN**: 2 điểm trên là **nợ kỹ thuật riêng, KHÔNG sửa trong UC-94**; UC-94 **không sao chép** cả hai. Các lệch đã biết khác giữ nguyên.

## 9. Residuals / known-gaps

- **Vòng đời gán ↔ xoá zone**: UC-92 chặn xoá khi còn thiết bị, UC-94 (nếu có gỡ) là đường thoát duy nhất. Nếu OQ-2 chốt **không** làm gỡ ở UC-94 thì phải mở task riêng **ngay**, nếu không tính năng xoá zone của UC-92 coi như chết trên thực tế (§0.6).
- **Chưa có endpoint xem thiết bị của zone**: sau UC-94, admin gán được nhưng **không có cách liệt kê** thiết bị đang thuộc zone qua API (`countByZoneId` chỉ trả số). FE sẽ phải gọi `GET /iot-devices?...` của module `iot` (nếu filter theo `zone_id` được hỗ trợ — **hiện `ListIotDevicesQueryDto` chỉ có `room_id`, KHÔNG có `zone_id`**). Đây là khoảng trống thật, cần UC riêng.
- **`ON DELETE SET NULL` vẫn là hàng rào giấy** (§0.6, kế thừa phát hiện UC-92): mọi bảo vệ toàn vẹn `zone_id` đều nằm ở tầng application.
- **Không có snapshot `zone_id` theo thời điểm**: nếu OQ-3 chốt cho đè, "thiết bị X thuộc zone nào tại thời điểm T" chỉ tra được qua `audit_logs` (và chỉ khi OQ-6 chốt có audit). Log `gate_access_logs`/`zone_presence_events` có `zone_id` riêng nên báo cáo quá khứ không sai — nhưng đối soát cấu hình thì phụ thuộc audit.
- **`room_id` và `zone_id` song song, không ràng buộc chéo**: một camera có thể thuộc room A và zone B mâu thuẫn nhau về mặt vật lý; UC-94 không kiểm. Cần quyết định kiến trúc `zones` ↔ `rooms` (nợ từ UC-90).
- **UC-95 (sơ đồ lắp đặt)** đang gác: khi làm sẽ cần toạ độ/vị trí — **không** nhét vào `metadata_json` của zone hay device một cách tuỳ tiện, nên thiết kế đàng hoàng.
- **Không có global exception filter / Swagger / 5 file `spec/global/` rỗng**: nợ toàn hệ thống, giữ nguyên.

---

> **Spec ĐÃ DUYỆT**, OQ-1 → OQ-11 đã chốt (2026-07-22). Bước kế tiếp: [plan.md](./plan.md) (plan-only, chưa code, chưa `tasks.md`).
