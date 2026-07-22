# ZNA-001 — tasks.md (UC-94 Zones: gán camera vào khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo tasks ZNA-001 sau plan DUYỆT: T0 verify → T1 `AssignZoneDevicesDto` → T2 `ZonesAuditRepository` +2 method → T3 `IotDevicesService` +2 method (**file NGOÀI `zones`**, gồm 1 GHI nhận `EntityManager`) → T4 `assignDevices()`+`unassignDevice()` → T5 controller 2 route → T6 migration seed (**2 ROLE**) → T-GATE. **KHÔNG có task đổi constructor** (`ZonesService` đã đủ 4 dependency từ UC-92) và **KHÔNG có task wiring module** ⇒ rủi ro hồi quy thấp hơn hẳn UC-92. | Toàn bộ |
| 2026-07-22 | **BỎ case 16 của plan §8** (*"đóng vòng với UC-92: sau khi gỡ, `countByZoneId` mock trả 0 ⇒ `remove()` chạy được"*) — đây là **test giả**: `countByZoneId` là mock nên case chỉ chứng minh "mock trả 0 thì `remove()` chạy" (điều UC-92 đã test), **không** chứng minh được chuỗi thật gỡ camera → `zone_id` về NULL trong DB → `countByZoneId` thật giảm → zone xoá được. Lập luận vòng tròn và tạo **cảm giác an tâm giả**. Chuyển thành mục **Owed** ở T-GATE: chỉ verify được bằng smoke test DB thật. Case 12 đã phủ đủ phần unit test hợp lệ. | T4b (bỏ case 16), T-GATE (thêm Owed) |

| 2026-07-22 | Review phát hiện lỗ hổng **`device_ids` trùng lặp gây `404` báo SAI** (đã kiểm chứng): bộ decorator cũ KHÔNG chặn `[A, A, B]` → SQL `In()` tự khử trùng trả 2 row → nếu kiểm "id thiếu" bằng so sánh độ dài thì `3 !== 2` ⇒ ném `IOT_DEVICE_NOT_FOUND` **dù cả 2 thiết bị đều tồn tại**. Fix **3 lớp**: (1) T1 thêm **`@ArrayUnique()`**; (2) T4 chốt xác định id thiếu bằng **HIỆU TẬP HỢP**, CẤM so sánh `length`; (3) T1b thêm **case 26b** `[U1,U1,U2]` → lỗi `arrayUnique`. Giữ cả 2 lớp đầu là defense-in-depth và để `details` nêu chính xác id nào thiếu. | T1 (decorator + AC), T1b (case 26b + AC), T4 (bước 3) |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại plan §1 (OQ-1→OQ-11) và plan §10 (Kỷ luật). **KHÔNG** sửa `ZonesModule`, `iot.module.ts`, `app.module.ts`, `data-source.ts`, entity, các DTO/mapper/constant cũ, 3 method audit cũ, hay `assignRoom`. **KHÔNG** làm gì thuộc UC-95 (sơ đồ lắp đặt — đang gác).

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T5b → T6 → T-GATE.

> **Phụ thuộc**: DTO (T1) + audit method (T2) + 2 method `iot` (T3) đều phải **có trước** service (T4 gọi cả ba) · service trước controller (T5) · migration (T6) độc lập nhưng phải **cùng commit** với controller (thiếu seed = 403).
>
> **KHÔNG có task đổi constructor** — `ZonesService` đã có đủ 4 dependency (`repo`, `DataSource`, `ZonesAuditRepository`, `IotDevicesService`) từ UC-92 ⇒ **không** có bước "suite đỏ → cập nhật provider" như UC-92. **KHÔNG có task wiring module** — `ZonesModule` và `iot.module.ts` đều đã đủ.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu tiên. Đọc CODE THẬT, dán xác nhận từng mục. **Thiếu / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **Baseline 2 con số** (đối chiếu ở T-GATE): `src/modules/zones` — **kỳ vọng 7 suite / 104 test**; `src/modules/iot` — **kỳ vọng 11 suite / 168 test**. Lệch → ghi nhận và báo **trước khi** code.
2. **`IoTDeviceType` có ĐỦ 5 giá trị allowlist** ([iot-device.entity.ts:13-22](../../../../src/modules/iot/entities/iot-device.entity.ts)) — **dán enum thật** vào báo cáo. Kỳ vọng: `IP_CAMERA='ip_camera'`, `DOOR_CAMERA='door_camera'`, `ROOM_CAMERA='room_camera'`, `FACE_SERVER='face_server'`, `OCCUPANCY_SENSOR='occupancy_sensor'`; 3 loại **bị loại trừ**: `MICROPHONE`, `CAPTURE_AGENT`, `DISPLAY`. Thiếu bất kỳ giá trị nào → **DỪNG** (allowlist đã chốt sẽ không code được).
3. **`ZonesService` constructor VẪN 4 dependency**, **không cần đổi** ([zones.service.ts:50-58](../../../../src/modules/zones/services/zones.service.ts)). Ghi lại **bộ mock hiện có** trong [zones.service.spec.ts](../../../../src/modules/zones/services/zones.service.spec.ts) (`repo`, `queryBuilder`, `queryRunner`, `dataSource`, `auditRepo`, `iotDevicesService`) để biết **cần thêm method nào** vào mock đã có (T4b).
4. **`ZonesAuditRepository`** ([zones-audit.repository.ts](../../../../src/modules/zones/repositories/zones-audit.repository.ts)): hằng `ZONE_ENTITY_TYPE = 'zones'`; 3 method hiện có (`logZoneCreation`/`logZoneUpdate`/`logZoneDeletion`) đều theo dạng `async logX(entityManager: EntityManager, params: {...}): Promise<void>` + raw SQL parameter-bound `$1..$4::jsonb`. 2 method mới ở T2 phải bám đúng khuôn này.
5. **`ZonesController` có 5 route** (`@Get()`, `@Get(':id')`, `@Post()`, `@Patch(':id')`, `@Delete(':id')`) và **KHÔNG cần import mới** từ `@nestjs/common` (`Patch`, `Delete`, `Param`, `ParseUUIDPipe`, `Body`, `UsePipes` đều có sẵn; `CurrentUser`, guards, `ZONE_PIPE` cũng vậy) ⇒ T5 chỉ thêm import **DTO mới**.
6. **`IotDevicesService`**: constructor đã có `private readonly dataSource: DataSource` ([iot-devices.service.ts:81-94](../../../../src/modules/iot/services/iot-devices.service.ts)) ⇒ 2 method mới **không cần inject thêm**. Xác nhận `countByZoneId` (mẫu API đọc cho module khác, UC-92) và **`iot.module.ts` đã export `IotDevicesService`** ⇒ **KHÔNG sửa module**.
7. **Timestamp migration**: đếm thực tế trong `src/database/migrations/` — **kỳ vọng file cuối là `20260722000004-SeedZoneReadPermission.ts`** ⇒ UC-94 lấy **`20260722000005`**. Nếu đã tồn tại `20260722000005*` → lấy số kế tiếp chưa dùng và **ghi rõ**.

- **AC**: dán xác nhận đủ **7 mục** kèm bằng chứng (path + trích dẫn ngắn); mục 1 ghi rõ **2 con số baseline**; mục 2 **dán enum thật**; mục 7 ghi rõ timestamp chốt.

## T1 — `AssignZoneDevicesDto` (code) — plan §5, OQ-1, SEC-03
- File net-new: `src/modules/zones/dto/assign-zone-devices.dto.ts`, class `AssignZoneDevicesDto` — **đúng 1 field**:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `deviceIds: string[]` | `device_ids` | `@Expose({ name: 'device_ids' })` `@IsArray()` `@ArrayNotEmpty()` **`@ArrayUnique()`** **`@ArrayMaxSize(50)`** `@IsUUID('4', { each: true })` |

- `@ArrayMaxSize(50)` là ràng buộc **ARCH-02** (chặn transaction kéo dài), không phải con số tuỳ tiện — ghi lý do trong JSDoc.
- ⚠ **`@ArrayUnique()` BẮT BUỘC (lớp 1 chống 404 báo sai)**: thiếu nó thì `[A, A, B]` **pass validate** → `findAssignableByIds` dùng SQL `In()` **tự khử trùng** chỉ trả 2 row → nếu service kiểm "id thiếu" bằng so sánh độ dài thì `3 !== 2` ⇒ ném **`404 IOT_DEVICE_NOT_FOUND` dù cả 2 thiết bị đều tồn tại**. Thông báo dẫn sai hướng, rất khó debug.
- **CẤM khai** `zone_id` (lấy từ path `:id`, tránh 2 nguồn sự thật), `room_id`, toạ độ, hay bất kỳ field nào của module `iot`.
- **KHÔNG** DTO cho gỡ — `:deviceId` trên path qua `ParseUUIDPipe`.
- **AC**: đúng 1 field; đủ **5 decorator validate** (`@IsArray`, `@ArrayNotEmpty`, **`@ArrayUnique`**, `@ArrayMaxSize(50)`, `@IsUUID('4',{each:true})`) + `@Expose`; 0 field cấm; JSDoc nêu lý do `@ArrayMaxSize(50)` **và** `@ArrayUnique()`.

## T1b — Test `AssignZoneDevicesDto` — plan §8 mục 25-27
File net-new: `src/modules/zones/dto/assign-zone-devices.dto.spec.ts`:
25. `device_ids` hợp lệ **1 phần tử** và **50 phần tử** → 0 lỗi.
26. Mảng rỗng → lỗi `arrayNotEmpty`; **51 phần tử** → lỗi `arrayMaxSize`; phần tử không phải UUID → lỗi `isUuid`.
26b. **Trùng lặp (lớp 3 chống 404 báo sai)**: `device_ids = [U1, U1, U2]` → **có lỗi `arrayUnique`**.
27. **Whitelist**: `new ValidationPipe({whitelist:true, transform:true}).transform(body, {type:'body', metatype: AssignZoneDevicesDto})` với body chứa `zone_id`, `room_id` → cả 2 bị loại khỏi instance; `deviceIds` còn nguyên.
- **AC**: 4 nhóm case xanh; case biên 50 (pass), 51 (fail) và **case trùng lặp → `arrayUnique`** bắt buộc có mặt.

## T2 — `ZonesAuditRepository` +2 method (code) — plan §3, OQ-6, SEC-01
Thêm vào `src/modules/zones/repositories/zones-audit.repository.ts` (**Modified — giữ nguyên 3 method cũ + hằng `ZONE_ENTITY_TYPE`**):

| Method | `action_type` | `metadata_json` |
| :--- | :--- | :--- |
| `logZoneAssignDevices(em, { userId, zoneId, deviceIds, oldZoneIds })` | `'assign_device'` | `{ device_ids: [...], old_zone_ids: { <deviceId>: <oldZoneId\|null> }, new_zone_id: <zoneId> }` |
| `logZoneUnassignDevice(em, { userId, zoneId, deviceId })` | `'unassign_device'` | `{ device_ids: [<deviceId>], old_zone_id: <zoneId>, new_zone_id: null }` |

- `entity_type = ZONE_ENTITY_TYPE` (`'zones'`), `entity_id = zoneId`, `severity = 'info'`; **1 bản ghi cho cả lô** (all-or-nothing ⇒ cả lô là một sự kiện).
- **SEC-01 (bắt buộc)**: chỉ ghi **id**; **CẤM** ghi `metadata_json`/tên/IP/secret của thiết bị. JSDoc phải nói rõ.
- Parameter binding `$1..$4` như 3 method cũ; **CẤM** nối chuỗi.
- **AC**: đúng 2 method mới, 3 method cũ **không đổi**; `entity_type='zones'` + `severity='info'` ở cả hai; 0 chỗ nối chuỗi SQL; payload chỉ chứa id.

## T2b — Test 2 method audit mới — plan §8 mục 17-19
Thêm vào `src/modules/zones/repositories/zones-audit.repository.spec.ts` (**giữ nguyên test cũ**):
17. `logZoneAssignDevices` → `query` gọi 1 lần; SQL chứa `'assign_device'` + `'info'`; params: `userId`, `'zones'`, `zoneId`, JSON chứa `device_ids` + `old_zone_ids` + `new_zone_id`.
18. `logZoneUnassignDevice` → SQL chứa `'unassign_device'`; `metadata_json.new_zone_id === null`; `old_zone_id === zoneId`.
19. **SEC-01**: truyền params kèm dữ liệu nhạy cảm giả lập (vd device có `metadataJson: { rtsp_password: 'x' }` trong dữ liệu gọi) → payload ghi ra **không** chứa `rtsp_password`/giá trị đó; chỉ có id.
- **AC**: 3 case xanh; case SEC-01 bắt buộc có và assert không rò dữ liệu thiết bị.

## T3 — `IotDevicesService` +2 method (code) — plan §4, OQ-4/OQ-7, ARCH-01
**File NGOÀI module `zones`**: `src/modules/iot/services/iot-devices.service.ts` (**Modified — thêm đúng 2 method**).

### 3.1. `async findAssignableByIds(deviceIds: string[]): Promise<IoTDeviceEntity[]>` (ĐỌC)
- `this.dataSource.manager.find(IoTDeviceEntity, { where: { id: In(deviceIds) } })` — trả **những gì tìm thấy**; caller tự so sánh để biết id nào thiếu.
- Trả **nguyên entity** (có `zoneId`, `deviceType`) để `zones` tự quyết định — `iot` **không** phán xét về zone.
- `IoTDeviceEntity` không có soft-delete ⇒ **không** lọc `deletedAt`.

### 3.2. `async setZoneForDevices(deviceIds: string[], zoneId: string | null, manager?: EntityManager): Promise<{ affected: number }>` (GHI)
- **Xử lý `manager` (CRUX OQ-7)**: `const em = manager ?? this.dataSource.manager;` — **có `manager`** → chạy trong transaction của caller, **TUYỆT ĐỐI KHÔNG tự mở transaction**; **không có** → chạy standalone.
- Thân: `await em.update(IoTDeviceEntity, { id: In(deviceIds) }, { zoneId })` → trả `{ affected }`.
- `zoneId: string | null` — **một method cho cả gán lẫn gỡ**; `iot` coi `zoneId` là **giá trị đục**: **KHÔNG** kiểm zone tồn tại, **KHÔNG** kiểm `status`, **KHÔNG** kiểm soft-delete (trách nhiệm của caller).
- **JSDoc bắt buộc 3 ý**: (1) API cho module khác, `iot` KHÔNG biết nghiệp vụ zone; (2) **ranh giới transaction do CALLER kiểm soát** khi truyền `manager` — **khác `assignRoom`** vốn tự mở tx; (3) mọi kiểm tra về zone thuộc caller.
- **CẤM** import bất cứ thứ gì từ `zones`; **CẤM** `forwardRef`. **`iot.module.ts` KHÔNG sửa** (đã export).
- **CẤM** sao chép anti-precedent của `assignRoom` (raw SQL sang bảng của module khác). **KHÔNG** đụng `assignRoom`.
- **AC**: đúng 2 method mới; `setZoneForDevices` dùng `manager ?? this.dataSource.manager` và **0 chỗ** `createQueryRunner`; JSDoc đủ 3 ý; 0 import từ `zones`; `assignRoom` và `iot.module.ts` không bị chạm.

## T3b — Test 2 method mới của `IotDevicesService` — plan §8 mục 28-31
Thêm vào `src/modules/iot/services/iot-devices.service.spec.ts` (**giữ nguyên test cũ**; bổ sung mock `manager.find`/`manager.update` nếu chưa có — loại (a) dựng mock):
28. `findAssignableByIds` → gọi `manager.find(IoTDeviceEntity, { where: { id: In(ids) } })`, trả đúng danh sách mock.
29. **`setZoneForDevices` CÓ truyền `manager`** → dùng `manager.update(...)`; assert **`dataSource.createQueryRunner` KHÔNG được gọi** (chứng minh không tự mở transaction) và `dataSource.manager.update` **không** được dùng.
30. **`setZoneForDevices` KHÔNG truyền `manager`** → dùng `dataSource.manager.update(...)`.
31. `setZoneForDevices(ids, null, m)` → `update` được gọi với `{ zoneId: null }` (nhánh gỡ).
- **AC**: 4 case xanh; **bắt buộc có cả 2 nhánh `manager`** (case 29 và 30); test cũ của `iot` không hồi quy.

## T4 — `ZonesService`: `assignDevices()` + `unassignDevice()` (code) — plan §2, OQ-1/3/4/5/7/9
Thêm vào `src/modules/zones/services/zones.service.ts` (**Modified — chỉ THÊM**). **KHÔNG** đổi constructor; **KHÔNG** đụng `create`/`update`/`remove`/`list`/`getDetail`/`loadActive`.

### 4.1. `assignDevices(zoneId, dto, actorUserId)` — thứ tự **bắt buộc**
1. `const zone = await this.loadActive(zoneId);` → 404 `ZONE_NOT_FOUND` trước mọi thứ.
2. **Chặn zone inactive** (OQ-5): `zone.status === 'inactive'` → `ConflictException({ code: 'ZONE_INACTIVE', message: 'Khu vực đang ngừng sử dụng, không thể gán thiết bị' })`.
3. **Validate thiết bị — NGOÀI transaction** (fail nhanh, không tốn connection): `findAssignableByIds(dto.deviceIds)`
   - **Xác định id thiếu bằng HIỆU TẬP HỢP (lớp 2 chống 404 báo sai)**: so `new Set(dto.deviceIds)` với `new Set(devices.map(d => d.id))`, lấy phần chênh làm `details.device_ids`. **CẤM** dùng `dto.deviceIds.length !== devices.length` — SQL `In()` tự khử trùng nên so độ dài sẽ báo 404 sai khi input có id trùng. Giữ cả 2 lớp (DTO `@ArrayUnique` + hiệu tập hợp) là **defense-in-depth**: ai gỡ nhầm decorator thì service vẫn đúng, và `details` nêu **chính xác id nào** thiếu thay vì chỉ biết "có id thiếu".
   - có id thiếu → `NotFoundException({ code: 'IOT_DEVICE_NOT_FOUND', details: { device_ids: [<id thiếu>] } })`;
   - `deviceType` ngoài **allowlist 5 loại** (`IP_CAMERA`, `DOOR_CAMERA`, `ROOM_CAMERA`, `OCCUPANCY_SENSOR`, `FACE_SERVER`) → `ConflictException({ code: 'DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE', details: { device_ids: [...] } })`;
   - **All-or-nothing (OQ-1)**: 1 id lỗi là ném ngay, **không ghi gì**, `details` PHẢI nêu rõ id nào;
   - **KHÔNG** chặn theo `status`/`healthStatus` (OQ-4).
4. **Lọc idempotent + gom old zone** (OQ-3/R7): `changed = devices.filter(d => d.zoneId !== zoneId)`; gom `oldZoneMap = { [deviceId]: d.zoneId }`.
   - `changed.length === 0` → **NO-OP**: trả về ngay, **KHÔNG mở transaction**, **KHÔNG audit** (mirror bất biến no-op của `update()` UC-91).
5. **Transaction** chỉ bọc phần ghi: `createQueryRunner` → `connect` → `startTransaction` → `setZoneForDevices(changedIds, zoneId, qr.manager)` → `logZoneAssignDevices(qr.manager, {...oldZoneIds})` → `commit`; `catch` → `rollback` + rethrow; **`finally` → `release()`**.
6. Trả `{ zone, assignedDeviceIds: dto.deviceIds }`.

### 4.2. `unassignDevice(zoneId, deviceId, actorUserId)`
1. `loadActive(zoneId)` → 404 `ZONE_NOT_FOUND`.
   ⚠ **KHÔNG chặn `inactive`** ở route gỡ — nếu chặn thì zone inactive **vừa không gỡ được vừa không xoá được** ở UC-92 (kẹt cứng). Ghi comment tại chỗ để người sau không "sửa cho đối xứng với route gán".
2. `findAssignableByIds([deviceId])` — NGOÀI transaction: không có → `404 IOT_DEVICE_NOT_FOUND`; `device.zoneId !== zoneId` → **`404 DEVICE_NOT_IN_ZONE`**.
3. **Transaction**: `setZoneForDevices([deviceId], null, qr.manager)` + `logZoneUnassignDevice(qr.manager, {...})` → commit / rollback / **`finally release()`**.
4. Trả `{ zone, unassignedDeviceId: deviceId }`.

- **CẤM** `this.repo.query('... iot_devices ...')` hay bất kỳ truy vấn trực tiếp nào tới bảng của module `iot` (ARCH-01) — **kể cả khi `assignRoom` đang làm điều tương tự với `rooms`** (anti-precedent).
- **AC**: 2 method mới đúng thứ tự bước; validate **ngoài** transaction; no-op **không mở transaction/không audit**; đè zone khác **thành công + audit `old→new`**; `unassignDevice` **không** chặn `inactive`; mọi nhánh có `finally release()`; 0 truy vấn trực tiếp bảng `iot_devices`; constructor và 6 method cũ không bị sửa.

## T4b — Test `assignDevices()` + `unassignDevice()` — plan §8 mục 1-15 (**KHÔNG có case 16**)
Thêm 2 `describe` vào `zones.service.spec.ts`; **bổ sung method vào mock có sẵn** (loại (a)): `iotDevicesService.findAssignableByIds`/`setZoneForDevices`, `auditRepo.logZoneAssignDevices`/`logZoneUnassignDevice`.

**`describe('assignDevices')`**
1. **Gán thành công (batch 3 device)** → `setZoneForDevices` gọi với `(ids, zoneId, queryRunner.manager)`; `logZoneAssignDevices` gọi **trước** `commitTransaction`; `release` được gọi.
2. **404 zone** → `ZONE_NOT_FOUND`; assert **`findAssignableByIds` KHÔNG gọi**, `createQueryRunner` **KHÔNG** gọi.
3. **404 device — 1 id trong lô không tồn tại → CẢ LÔ fail**: `findAssignableByIds` trả 2/3 → `IOT_DEVICE_NOT_FOUND` với `details.device_ids` chứa id thiếu; assert `setZoneForDevices` **KHÔNG** gọi, **không mở transaction**.
4. **409 `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ZONE`**: device `deviceType='microphone'` → 409, không ghi gì. **Kèm case dương**: cả **5 loại allowlist** đều pass.
5. **409 `ZONE_INACTIVE`**: `zone.status='inactive'` → 409; assert **không** validate device, **không** mở tx.
6. **Idempotent (R7)**: mọi device đã có `zoneId === zoneId` → **no-op**: `createQueryRunner`/`setZoneForDevices`/`logZoneAssignDevices` **đều KHÔNG** gọi, vẫn trả kết quả bình thường.
7. **Đè zone khác (OQ-3)**: device có `zoneId='z-old'` → **thành công**; assert `logZoneAssignDevices` nhận `oldZoneIds` chứa `{ <deviceId>: 'z-old' }` và `new_zone_id = zoneId`.
8. **Rollback khi audit lỗi**: `logZoneAssignDevices` reject → `rollbackTransaction` gọi, `commitTransaction` **KHÔNG** gọi, `release` **vẫn** gọi, lỗi propagate.
9. **Rollback khi `setZoneForDevices` lỗi**: tương tự case 8.
10. **`finally release()`**: assert `release` được gọi ở **cả** nhánh thành công lẫn nhánh lỗi.
11. **ARCH-01**: assert service **không** gọi `repo.query`/`repo.createQueryBuilder` để đụng `iot_devices` — mọi truy cập đi qua `iotDevicesService`.

**`describe('unassignDevice')`**
12. **Gỡ thành công**: `setZoneForDevices` gọi với **`null`** ở tham số `zoneId`; `logZoneUnassignDevice` được ghi; commit + release.
13. **404 zone** → `ZONE_NOT_FOUND`.
14. **404 device không tồn tại** → `IOT_DEVICE_NOT_FOUND`.
15. **Gỡ thiết bị KHÔNG thuộc zone này** (`device.zoneId !== zoneId`) → **`404 DEVICE_NOT_IN_ZONE`**; assert **không** ghi gì.

> ⚠ **KHÔNG có case 16.** Plan §8 case 16 ("đóng vòng với UC-92 qua `countByZoneId` mock") đã bị **bỏ**: `countByZoneId` là mock nên case đó chỉ chứng minh "mock trả 0 thì `remove()` chạy" — lập luận vòng tròn, không chứng minh được chuỗi thật, và tạo cảm giác an tâm giả. Chuyển thành mục **Owed** ở T-GATE.

- **AC**: **15 case** xanh (không có case 16); case 6 (no-op), 7 (đè zone), 8/9 (rollback), 15 (`DEVICE_NOT_IN_ZONE`) bắt buộc có mặt; **104 test cũ của `zones` không hồi quy**; coverage `ZonesService` ≥80%.

## T5 — Controller: 2 route (code) — plan §6, OQ-8/9/10, SEC-02
Thêm vào `src/modules/zones/controllers/zones.controller.ts` (**Modified**); chỉ thêm import **`AssignZoneDevicesDto`** (decorator đã có sẵn — T0 mục 5).

```text
PATCH  /api/v1/zones/:id/devices             → gán (batch)
DELETE /api/v1/zones/:id/devices/:deviceId   → gỡ 1 thiết bị
```
- Cả hai: `@UseGuards(JwtAuthGuard, PermissionsGuard)` · **`@RequirePermissions('zones.zone.assign_device')`** · `@Param('id', ParseUUIDPipe)` · `@CurrentUser() user: { userId: string }`.
- Gán: `@Patch(':id/devices')` + `@UsePipes(ZONE_PIPE)` + `@Body() dto` → `{ success: true, message: 'Devices assigned to zone successfully', data: { zone: toZoneResponse(zone), assigned_device_ids: [...] } }`.
- Gỡ: `@Delete(':id/devices/:deviceId')` + `@Param('deviceId', ParseUUIDPipe)` → `{ success: true, message: 'Device unassigned from zone successfully', data: { zone: toZoneResponse(zone), unassigned_device_id: deviceId } }`.
- **OQ-9**: **CẤM** trả thông tin thiết bị (tên/loại/trạng thái) — `assigned_device_ids` chỉ phản chiếu id client gửi.
- **Thứ tự khai + comment đính chính (OQ-10)**: khai `@Patch(':id/devices')` **trước** `@Patch(':id')` và `@Delete(':id/devices/:deviceId')` **trước** `@Delete(':id')`, kèm comment ghi rõ: luật "static trước động" **chỉ cần khi hai pattern CÙNG SỐ SEGMENT**; ở đây 2-segment vs 1-segment nên **không** xung đột, đặt trước chỉ để nhất quán và tránh hiểu nhầm.
- **KHÔNG** `@HttpCode` (PATCH/DELETE mặc định 200). **KHÔNG** đụng 5 route cũ.
- **AC**: đúng 2 route mới; cả hai có 2 guard + `zones.zone.assign_device` + `@CurrentUser`; khai trước route 1-segment tương ứng + có comment đính chính; envelope đúng, không lộ dữ liệu thiết bị; 5 route cũ không đổi.

## T5b — Test controller — plan §8 mục 20-24
Thêm vào `zones.controller.spec.ts`:
20. `PATCH :id/devices` → gọi `service.assignDevices(id, dto, user.userId)` 1 lần; envelope `{success, message:'Devices assigned to zone successfully', data:{zone, assigned_device_ids}}`; `zone` qua `toZoneResponse` (**không** có `deleted_at`); assert `data` **không** chứa tên/loại/trạng thái thiết bị (OQ-9).
21. `DELETE :id/devices/:deviceId` → gọi `service.unassignDevice(id, deviceId, user.userId)`; envelope đúng.
22. **Assert metadata**: `PERMISSIONS_KEY` của **cả 2** handler = `['zones.zone.assign_device']`; guard list có `JwtAuthGuard` **và** `PermissionsGuard`.
23. Lỗi từ service (`NotFoundException` / `ConflictException`) → propagate nguyên trạng.
24. **Không hồi quy**: test của 5 route cũ vẫn xanh, **không** bị sửa.
- **AC**: 5 nhóm case xanh; case 22 bắt buộc (assert cả 2 handler); 0 test cũ bị sửa.

## T6 — Migration seed permission (code) — plan §7, OQ-8, SEC-02
- File: **`src/database/migrations/20260722000005-SeedZoneAssignDevicePermission.ts`** (timestamp chốt ở T0 mục 7), class `SeedZoneAssignDevicePermission20260722000005` + field `name` trùng tên class.
- **Đặt trong `migrations/`, TUYỆT ĐỐI KHÔNG trong `src/database/seeds/`** (folder `seeds/` không có runner — AGENTS.md §5.5 rule 4).
- Copy pattern [20260722000003-SeedZoneDeletePermission.ts](../../../../src/database/migrations/20260722000003-SeedZoneDeletePermission.ts):
  - `permission = { code: 'zones.zone.assign_device', name: <ASCII không dấu>, module: 'zones', action: 'assign_device', description: <ASCII không dấu> }`;
  - ⚠ **`roles` có ĐÚNG 2 PHẦN TỬ**: `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']`. **KHÁC UC-93** — `zones.zone.read` dùng **4 role** (`20260722000004`). **CẤM copy nhầm mảng 4 phần tử**: copy nhầm sẽ **cấp quyền gán/gỡ thiết bị cho `MANAGER` và `EMPLOYEE`**, tức nhân viên thường sửa được cấu hình định tuyến sự kiện của toàn khuôn viên.
  - **CẤM** `ADMIN`/`INTERNAL_USER` (mã lỗi thời, `WHERE role_code` không khớp → im lặng không insert);
  - `up()` idempotent: INSERT `ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id` → `return` nếu vẫn không có → vòng lặp gán `role_permissions` `ON CONFLICT DO NOTHING`;
  - `down()`: xoá `role_permissions` **trước**, rồi `permissions`.
- Chỉ tạo file, **KHÔNG chạy** `migration:run`.
- **AC**: đúng tên/vị trí; `permission_code='zones.zone.assign_device'`, `module_code='zones'`, `action_code='assign_device'`; **đúng 2 role**; `up()` chạy lại không lỗi/không nhân bản; `down()` đúng thứ tự.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- `npm run build` = **0 error**.
- eslint trên **11 file touched** (3 net-new: DTO + DTO spec + migration; 6 modified trong `zones`; 2 modified ngoài `zones`) = **0 rule mới**.
- `npx jest src/modules/zones` **và** `npx jest src/modules/iot` **đều xanh**.
- **KHÔNG HỒI QUY (đối chiếu baseline T0 mục 1)**: `zones` phải có **≥104 test cũ vẫn xanh** + test mới UC-94; `iot` giữ nguyên **168 test cũ** + test mới. **Test cũ fail → DỪNG, báo cáo, KHÔNG sửa test cho qua.** Chỉ được **thêm method vào mock** đã có (loại (a)); **CẤM** đổi assert nghiệp vụ.
- Coverage `ZonesService` **≥80%**.
- **DI-proof**: `AppModule` compile ở **preview mode** — 0 `UnknownDependenciesException`, **0 circular**; đặc biệt xác nhận cạnh `ZonesModule → IotModule` **vẫn một chiều** (`IotModule` không import `ZonesModule`, không `forwardRef`). Throwaway xoá sạch.
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS chung · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file + kết quả jest (**tách rõ test cũ vs mới, cả 2 module**) + coverage + DI-proof.
- **Bàn giao**: gọi thử 2 route trên local cần chạy seed **`20260722000005`** trước; thiếu → **403 `FORBIDDEN`**, không phải lỗi code. Local vẫn **chưa có bảng `zones`** nên cần `20260721000001` trước nữa — **chỉ local, KHÔNG RDS**.
- **Owed (ghi, KHÔNG làm)**:
  - ⭐ **Chuỗi UC-92 ↔ UC-94 (gỡ camera → zone xoá được) CHỈ kiểm chứng được bằng smoke test với DB thật** — unit test mock **không** chứng minh được vì `countByZoneId` là mock (lý do bỏ case 16, xem CHANGELOG).
  - **API liệt kê thiết bị của zone** — `ListIotDevicesQueryDto` chưa có `zone_id` (chỉ `room_id`) ⇒ sau UC-94 admin gán được nhưng không liệt kê được.
  - UC-95 sơ đồ lắp đặt (đang gác) · FT-20/FT-21 tiêu thụ `zone_id` + tôn trọng `status='inactive'` · restore zone · index cho `audit_logs.metadata_json->>'device_ids'` · 2 nợ kỹ thuật của `iot` (OQ-11: anti-precedent raw SQL sang `rooms`, `[NEEDS CLARIFICATION]` về `OFFLINE`) · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.
- **AC**: bảng gate đầy đủ + báo cáo tick: all-or-nothing (1 id lỗi → cả lô fail, `details` nêu id) ✓ · idempotent no-op **không mở transaction/không audit** ✓ · đè zone khác + audit `old→new` ✓ · allowlist **đúng 5 loại**, không chặn theo `status` ✓ · `ZONE_INACTIVE` chặn ở route gán, **KHÔNG** chặn ở route gỡ ✓ · `setZoneForDevices` dùng `manager` của caller, **0 `createQueryRunner`** trong `iot` ✓ · rollback khi audit/ghi lỗi + `finally release()` ✓ · audit `entity_type='zones'`, SEC-01 chỉ ghi id ✓ · `@RequirePermissions('zones.zone.assign_device')` trên cả 2 handler ✓ · migration seed **2 role** ✓ · `IotModule` KHÔNG import `ZonesModule`, DI-proof 0 circular ✓ · 0 migration schema ✓ · `ZonesModule`/`iot.module.ts` không đổi ✓ · 104 + 168 test cũ không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-94
- **T0** → baseline 2 module · enum 5 loại · constructor 4 dependency (không đổi) · chữ ký audit repo · controller 5 route + không cần import mới · `iot` export sẵn · timestamp `...0005`
- **T1/T1b** → `AssignZoneDevicesDto` (`device_ids`, `@ArrayMaxSize(50)`) + test biên 50/51
- **T2/T2b** → 2 method audit mới (`assign_device`/`unassign_device`) + case SEC-01
- **T3/T3b** → **cross-module**: `findAssignableByIds` (đọc) + `setZoneForDevices` (ghi, `manager?`) + test **cả 2 nhánh `manager`**
- **T4/T4b** → `assignDevices()` (validate ngoài tx · all-or-nothing · idempotent no-op · đè zone) + `unassignDevice()` (không chặn `inactive`) + 15 case
- **T5/T5b** → 2 route + comment đính chính luật route + assert permission cả 2 handler
- **T6** → migration seed `zones.zone.assign_device` → **2 role** (khác 4 role của UC-93)
- **T-GATE** → gate 2 module + không hồi quy 104/168 + DI-proof một chiều + STOP + Owed (gồm nợ smoke test UC-92↔UC-94)
