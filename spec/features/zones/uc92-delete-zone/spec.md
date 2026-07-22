# ZND-001 — UC-92 (Zones): Xoá khu vực

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo spec ZND-001 (UC-92): xoá mềm khu vực + cảnh báo/chặn khi còn thiết bị-sự kiện, và **trả nợ audit** đã hẹn từ UC-90 OQ-8. RECON code thật (`loadActive` tái dùng được, `softDelete` KHÔNG kích hoạt FK action ⇒ `ON DELETE RESTRICT`/`SET NULL` vô hiệu, `IotAuditRepository` là mẫu audit, `IotModule` KHÔNG import `ZonesModule` nên không có circular). Crux = xử lý zone còn tham chiếu + boundary khi phải đọc `iot_devices`. 8 OPEN QUESTIONS chờ Thiếu Chủ. | Toàn bộ |
| 2026-07-22 | Thiếu Chủ CHỐT OQ-1→OQ-8 + bổ sung **OQ-1b (quyết định kiến trúc MỚI)**. OQ-1=**chặn theo THIẾT BỊ (409), KHÔNG chặn theo LOG**; kiểm tra thiết bị PHẢI qua `IotDevicesService` (DI), cấm query thẳng bảng `iot_devices` · **OQ-1b=hướng phụ thuộc `zones → iot` MỘT CHIỀU vĩnh viễn; `IotModule` TUYỆT ĐỐI KHÔNG import `ZonesModule`; hệ quả: UC-94 đặt route ở phía zones (`PATCH /api/v1/zones/:id/devices`), KHÔNG phải `PATCH /iot-devices/:id/zone`, để tránh `forwardRef`** · OQ-2=**audit MỨC 2 (cả create/update/delete)**, tạo `ZonesAuditRepository` mới trong module `zones`, `ZonesService` nhận thêm `DataSource`, bọc transaction — sửa lại `create()` UC-90 và `update()` UC-91 · OQ-3=`200` + `data:null` · OQ-4=`404` cho DELETE lần 2 · OQ-5=restore NGOÀI scope · OQ-6=1 permission `zones.zone.delete`, 2 role admin · OQ-7=`ZONE_HAS_DEVICES` · OQ-8=**SỬA comment sai trong 2 entity của module `zones`** (chỉ JSDoc, không đổi logic/FK). | §7 (đổi tiêu đề + kết luận từng OQ + thêm OQ-1b); §1/§3/§4 bỏ nhánh không chọn |

> **SPEC-ONLY.** Chưa plan/tasks/code. Kế thừa toàn bộ convention đã chốt ở [ZNC-001 / UC-90](../uc90-create-zone/spec.md) và [ZNU-001 / UC-91](../uc91-update-zone/spec.md) — permission 3 tầng `module_code='zones'`, role `SYSTEM_ADMIN`+`BUSINESS_ADMIN`, soft-delete bắt buộc, lọc `deletedAt IS NULL`, `loadActive()` tái dùng, `ZONE_NOT_FOUND`, envelope inline, `ZONE_PIPE`, `ParseUUIDPipe`, base path `/api/v1/zones` — **KHÔNG mở lại**. UC-92 **thêm method vào `ZonesService` và route vào `ZonesController` đã có**. KHÔNG migration schema, KHÔNG hard-delete.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZonesService` hiện tại ([zones.service.ts](../../../../src/modules/zones/services/zones.service.ts))
- Constructor **chỉ** `@InjectRepository(ZoneEntity) repo` ([:48-51](../../../../src/modules/zones/services/zones.service.ts)) — **chưa có `DataSource`**. Nếu UC-92 ghi audit trong transaction thì đây là thay đổi đầu tiên chạm constructor kể từ UC-90 (OQ-2).
- **`private async loadActive(id)`** ([:96-107](../../../../src/modules/zones/services/zones.service.ts)) đã fold existence + `deletedAt: IsNull()` → 404 `ZONE_NOT_FOUND` ⇒ **tái dùng nguyên cho UC-92**, không viết helper thứ hai. Vì đang `private` trong cùng class nên method mới gọi được.
- JSDoc class ([:39-40](../../../../src/modules/zones/services/zones.service.ts)) ghi rõ: *"KHÔNG audit... Audit cho cả cụm zone làm ở UC-92 (xóa zone)"* — đây chính là nợ UC-92 phải trả (OQ-2).

### 0.2. `ZonesController` ([zones.controller.ts](../../../../src/modules/zones/controllers/zones.controller.ts))
- 2 route hiện có: `@Post()` và `@Patch(':id')`; hằng `ZONE_PIPE` ([:19](../../../../src/modules/zones/controllers/zones.controller.ts)) — UC-92 dùng lại.
- `Param`/`ParseUUIDPipe` **đã được import** từ UC-91 ⇒ route `DELETE :id` chỉ cần thêm `Delete` (và `HttpCode`/`HttpStatus` đã có sẵn từ UC-90 nếu chọn 204).

### 0.3. ⚠ CRUX KỸ THUẬT — `softDelete()` KHÔNG kích hoạt FK action
- Ràng buộc FK thật tới `zones`:

| Bảng | Cột | FK action | NULL? | Nguồn |
| :--- | :--- | :--- | :---: | :--- |
| `iot_devices` | `zone_id` | `ON DELETE SET NULL` | nullable | [20260721000002:17-20](../../../../src/database/migrations/20260721000002-AddZoneIdToIotDevices.ts) |
| `iot_device_events` | `zone_id` | `ON DELETE SET NULL` | nullable | [20260721000003](../../../../src/database/migrations/20260721000003-AddZoneIdToIotDeviceEvents.ts) |
| `gate_access_logs` | `zone_id` | **`ON DELETE RESTRICT`** | **NOT NULL** | [20260721000004:32-33,19](../../../../src/database/migrations/20260721000004-CreateGateAccessLogsTable.ts) |
| `zone_presence_events` | `zone_id` | **`ON DELETE RESTRICT`** | **NOT NULL** | [20260721000005:29-30,18](../../../../src/database/migrations/20260721000005-CreateZonePresenceEventsTable.ts) |

- **`repo.softDelete(id)` chỉ phát `UPDATE zones SET deleted_at = now()`** — KHÔNG phải `DELETE FROM`. Hệ quả **bắt buộc phải hiểu đúng**:
  1. `ON DELETE RESTRICT` của `gate_access_logs`/`zone_presence_events` **KHÔNG BAO GIỜ kích hoạt** ⇒ DB **không** chặn xoá mềm zone còn log. Ý định "không cho xoá zone khi còn event" ghi trong entity ([zone-presence-event.entity.ts:22](../../../../src/modules/zones/entities/zone-presence-event.entity.ts), [gate-access-log.entity.ts:24](../../../../src/modules/zones/entities/gate-access-log.entity.ts)) **chỉ đúng với hard-delete** — với soft-delete nó là **hàng rào giấy**.
  2. `ON DELETE SET NULL` của `iot_devices.zone_id` **cũng KHÔNG kích hoạt** ⇒ sau khi xoá mềm, `iot_devices.zone_id` **vẫn trỏ tới zone đã chết** (dangling reference hợp lệ về mặt FK vì hàng `zones` vẫn tồn tại).
  3. ⇒ Mọi hành vi "chặn" hay "tự gỡ" phải do **application** làm, DB không giúp gì. Đây là gốc của OQ-1.
- Ngược lại: vì hàng `zones` không bị xoá vật lý nên **không có nguy cơ vỡ FK** — log lịch sử vẫn join được về zone (kể cả zone đã xoá mềm), đúng yêu cầu "log là append-only, không mất lịch sử".

### 0.4. Đếm "còn thiết bị / còn sự kiện" — boundary KHÔNG đối xứng
- `GateAccessLogEntity` và `ZonePresenceEventEntity` **thuộc module `zones`** và đã nằm trong `TypeOrmModule.forFeature` của [zones.module.ts:29-33](../../../../src/modules/zones/zones.module.ts) ⇒ đếm "còn sự kiện" là **truy vấn nội bộ module**, KHÔNG đụng ARCH-01.
- `IoTDeviceEntity.zoneId` ([iot-device.entity.ts:60-61](../../../../src/modules/iot/entities/iot-device.entity.ts)) thuộc module `iot` ⇒ đếm "còn thiết bị" **bắt buộc đi qua module khác** → đụng ARCH-01, xem OQ-1.
- **Kiểm tra circular import (kết quả THẬT)**: [iot.module.ts:20-32](../../../../src/modules/iot/iot.module.ts) chỉ import `TypeOrmModule.forFeature`, `AuthModule`, `JwtModule`, `CacheModule` — **KHÔNG import `ZonesModule`**. `IotModule` `exports: [TypeOrmModule, IotDevicesService, IotDeviceEventsService]` ([:41](../../../../src/modules/iot/iot.module.ts)) ⇒ `ZonesModule` có thể `imports: [IotModule]` và inject `IotDevicesService` **mà KHÔNG tạo circular import** ở thời điểm này. Rủi ro: UC-94 (gán camera vào zone) rất có thể khiến `iot` cần biết về `zones` → chiều ngược lại có thể xuất hiện sau, phải tính trước.
- ⚠ `IotDevicesService` **hiện chưa có** method nào theo `zone_id` (grep `zoneId` chỉ thấy khai báo entity) ⇒ phương án (a)/(c) của OQ-1 đều buộc **thêm method vào module `iot`** — tức UC-92 phải sửa file ngoài module `zones`.

### 0.5. Mẫu soft-delete có sẵn
- `repo.softDelete(id)` — tiền lệ [media-files.service.ts](../../../../src/modules/recording/services/media-files.service.ts) và ANPR UC2 `softDeleteOwned` ([vehicle-registration.service.ts:194-198](../../../../src/modules/anpr/services/vehicle-registration.service.ts)): `loadOwned` (đảm bảo tồn tại + chưa xoá) → `repo.softDelete(id)` → trả `void`.
- Controller ANPR UC2 trả `{ success, message: 'Vehicle deleted successfully', data: null }` với **HTTP 200** ([vehicle-registration.controller.ts:227-239](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)) — chốt OQ-4 của UC2. Đây là tiền lệ duy nhất cho DELETE trong repo → tham chiếu cho OQ-3.

### 0.6. Mẫu audit ([iot-audit.repository.ts](../../../../src/modules/iot/repositories/iot-audit.repository.ts), [iot-devices.service.ts:96-176](../../../../src/modules/iot/services/iot-devices.service.ts))
- `IotAuditRepository` là **repository riêng của module `iot`**, mỗi method nhận `entityManager: EntityManager` + params, chạy raw SQL:
  `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json) VALUES (...)` ([:17-27](../../../../src/modules/iot/repositories/iot-audit.repository.ts)).
- Cột thật của `audit_logs` dùng ở đây: `user_id`, `action_type` (`'create'`/`'update'`/`'disable'`/…), `entity_type` (chuỗi tên bảng, vd `'iot_devices'`), `entity_id`, `severity` (`'info'`), `metadata_json` (jsonb).
- Service gọi trong **transaction**: `queryRunner.connect()` → `startTransaction()` → save → `logDeviceCreation(queryRunner.manager, …)` → `commitTransaction()`, catch → `rollbackTransaction()`, finally → `release()` ([iot-devices.service.ts:100-175](../../../../src/modules/iot/services/iot-devices.service.ts)).
- **SEC-01 trong audit**: repo này chủ động `maskSensitiveMetadata` / `delete safeMetadata.rtsp_password` ([:114-116, 177-181](../../../../src/modules/iot/repositories/iot-audit.repository.ts)) — zone không có secret nhưng `metadata_json` của zone là túi tự do nên phải cân nhắc có ghi nguyên vào audit không.
- ⇒ **Quan trọng cho boundary**: audit KHÔNG buộc import module khác — mẫu đúng là tạo **`ZonesAuditRepository` mới trong module `zones`** (mirror `IotAuditRepository`), không tái dùng `IotAuditRepository` (entity_type của nó hard-code `'iot_devices'`).
- `userId` để ghi audit lấy từ `@CurrentUser()`; hiện `ZonesController` **chưa dùng** `@CurrentUser` ở route nào (UC-90/91 cố ý không nhận actor) ⇒ UC-92 sẽ là route đầu tiên cần nó.

### 0.7. CLAUDE.md §17 — nhóm thao tác cần audit
Liệt kê rõ *"Create/update/delete user"*, *"Role/permission change"*, *"Room auto-release"*, *"System config/policy change"*, *"Manual override room/meeting status"*, và **"Không ghi secret/token/password vào audit log"**. Xoá một khu vực (dữ liệu nền của điểm danh cổng + hiện diện) thuộc nhóm thao tác quan trọng cần truy vết ⇒ ủng hộ việc trả nợ audit tại UC-92 (OQ-2).

### 0.8. Bảng `zones` không có cột người thao tác
[20260721000001-CreateZonesTable.ts:14-28](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts): không có `created_by`/`updated_by`/`deleted_by` ⇒ **`audit_logs` là nơi DUY NHẤT** lưu được ai tạo/sửa/xoá zone. Prompt cấm thêm cột ⇒ audit là lối thoát duy nhất.

---

## 1. Scope (UC-92)

### TRONG scope
1. **Xoá mềm 1 zone**: `DELETE /api/v1/zones/:id` → `repo.softDelete(id)` (set `deleted_at`). **CẤM hard-delete** (DATA-01).
2. **404** khi zone không tồn tại hoặc đã xoá mềm — tái dùng `loadActive()` + mã `ZONE_NOT_FOUND`.
3. **Chặn xoá khi zone còn THIẾT BỊ** (CHỐT OQ-1): còn `iot_devices` gán `zone_id` → `409 ZONE_HAS_DEVICES`. **KHÔNG** chặn theo log (`gate_access_logs`/`zone_presence_events` vẫn cho xoá). Kiểm tra thiết bị **qua `IotDevicesService` (DI)**, cấm query thẳng bảng của module `iot` (ARCH-01).
4. **Ghi `audit_logs` cho CẢ 3 thao tác** create/update/delete (CHỐT OQ-2 mức 2) — trả nợ UC-90 OQ-8. Tạo `ZonesAuditRepository` mới trong module `zones`; `ZonesService` nhận thêm `DataSource`; **sửa lại `create()` (UC-90) và `update()` (UC-91)** để bọc transaction + ghi audit.
5. **Sửa JSDoc sai** trong `gate-access-log.entity.ts` và `zone-presence-event.entity.ts` (CHỐT OQ-8) — chỉ comment, KHÔNG đổi logic/FK.
6. **1 migration seed permission** `zones.zone.delete` → `SYSTEM_ADMIN` + `BUSINESS_ADMIN` (CHỐT OQ-6).
7. Unit test cho method mới (mock repo + mock `IotDevicesService`, không DB).

### NGOÀI scope (UC sau — KHÔNG làm)
- **UC-93 (xem/tra cứu)**: `GET /zones`, `GET /zones/:id`, filter, phân trang.
- **UC-94 (gán camera vào zone)**: ghi `iot_devices.zone_id`. ⚠ Theo CHỐT OQ-1b, route của UC-94 sẽ đặt ở **phía `zones`** (`PATCH /api/v1/zones/:id/devices`) — ghi ở đây để UC-94 bám theo, KHÔNG làm trong UC-92.
- **Khôi phục zone đã xoá mềm** (restore/un-delete) — **NGOÀI scope** (CHỐT OQ-5), hệ quả ghi ở §8.
- **Xoá hàng loạt** (bulk delete), **hard-delete/purge** dữ liệu cũ, **cron dọn zone**.
- **KHÔNG** migration schema: không thêm `deleted_by`, không đổi FK, không đổi `ON DELETE RESTRICT` thành gì khác.
- **KHÔNG** đụng `gate_access_logs`/`zone_presence_events` ở mức ghi/xoá — và theo CHỐT OQ-1 thì **cũng không cần đếm** chúng (không chặn theo log).
- **KHÔNG** WebSocket/notification khi zone bị xoá.
- **KHÔNG** để `IotModule` import `ZonesModule` (CHỐT OQ-1b — phụ thuộc một chiều `zones → iot`).
- ⚠ `create()`/`update()` của UC-90/UC-91 **SẼ bị sửa** (bọc transaction + audit) theo CHỐT OQ-2 — đây là ngoại lệ có chủ đích, hành vi nghiệp vụ phải giữ nguyên.

## 2. DTO

**Không cần DTO body** — `DELETE /zones/:id` chỉ có path param.

- `:id` qua `@Param('id', ParseUUIDPipe)` (đã là convention).
- **KHÔNG** có query `?force=` (CHỐT OQ-1 chọn chặn thẳng, không có đường vòng tự gỡ camera).
- **KHÔNG** dùng `toZoneResponse()` — DELETE trả `data: null` (CHỐT OQ-3), không cần mapper.

## 3. Service (đề xuất — thêm method vào `ZonesService`)

**`async remove(id: string, actorUserId: string): Promise<void>`** (tên method chờ thống nhất; ANPR dùng `softDeleteOwned`, ở đây không có ownership nên `remove`/`softDelete` hợp lý hơn):

1. `const entity = await this.loadActive(id);` — 404 `ZONE_NOT_FOUND` trước mọi thứ.
2. **Kiểm tra THIẾT BỊ** (CHỐT OQ-1): gọi `IotDevicesService` (DI) đếm `iot_devices` có `zone_id = id`; `> 0` → `throw ConflictException({ code: 'ZONE_HAS_DEVICES', … })`. **KHÔNG** đếm `gate_access_logs`/`zone_presence_events` — không chặn theo log.
3. **Xoá mềm**: `softDelete` — KHÔNG `repo.delete()`, KHÔNG `remove()`.
4. **Ghi audit**: `zonesAuditRepository.logZoneDeletion(manager, { userId: actorUserId, zoneId: id, … })` với `action_type='delete'`, `entity_type='zones'`, `entity_id=id`.
5. Bước 3+4 nằm trong **cùng transaction** (`DataSource.createQueryRunner`, mirror `iot-devices`) — "đã xoá nhưng không có audit" là mất dấu vết vĩnh viễn.

- ⚠ Bước 5 phá vỡ nguyên tắc "no `DataSource`" của UC-90/91 — **ngoại lệ có chủ đích** (CHỐT OQ-2); `create()`/`update()` cũng chuyển sang cùng cơ chế, hành vi nghiệp vụ **giữ nguyên**.
- `actorUserId` lấy từ `@CurrentUser()`, **KHÔNG** từ body/param (SEC).

## 4. Controller (đề xuất — thêm route vào `ZonesController`)

```text
DELETE /api/v1/zones/:id
```
- `@Delete(':id')` + `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('zones.zone.delete')` + `@Param('id', ParseUUIDPipe)` + `@CurrentUser()` (route đầu tiên của module cần actor — §0.6).
- Response (CHỐT OQ-3): `200` + `{ success: true, message: 'Zone deleted successfully', data: null }`.
- **KHÔNG** cần `@UsePipes(ZONE_PIPE)` — không có body/query (CHỐT OQ-1: không có `?force=`).

**HTTP status dự kiến**

| Tình huống | Status | `code` |
| :--- | ---: | :--- |
| Xoá mềm thành công | `200` + `data: null` | — |
| `:id` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission | `403` | `FORBIDDEN` (guard) |
| Zone không tồn tại / đã xoá mềm | `404` | `ZONE_NOT_FOUND` |
| Zone còn **thiết bị** được gán (không tính log) | `409` | `ZONE_HAS_DEVICES` |

## 5. Requirements (EARS)

- **R1**: **WHEN** người dùng có permission gửi `DELETE /api/v1/zones/:id` trên zone đang sống **và không còn thiết bị nào gán vào** **→** hệ thống set `deleted_at`, ghi audit, trả `200` + `data: null`.
- **R2**: **WHILE** thực hiện xoá, hệ thống PHẢI dùng `repo.softDelete` — **CẤM** `DELETE FROM zones` dưới mọi hình thức (DATA-01).
- **R3**: **IF** `:id` không tồn tại **hoặc** zone đã bị xoá mềm (gồm cả lần gọi DELETE thứ hai — CHỐT OQ-4) **→** trả `404 ZONE_NOT_FOUND`, **KHÔNG** ghi gì vào DB (gồm cả audit).
- **R4 (crux, CHỐT OQ-1)**: **IF** còn ít nhất 1 `iot_devices` có `zone_id = :id` **→** trả `409 ZONE_HAS_DEVICES`, **KHÔNG** xoá, **KHÔNG** ghi audit. **WHERE** zone còn bản ghi `gate_access_logs`/`zone_presence_events` nhưng **không** còn thiết bị **→** vẫn cho xoá bình thường.
- **R4b (ARCH-01)**: **WHILE** kiểm tra thiết bị, module `zones` PHẢI gọi qua `IotDevicesService` (DI); **CẤM** truy vấn trực tiếp bảng `iot_devices`.
- **R5**: **WHILE** xoá mềm, hệ thống **KHÔNG** được xoá/sửa bản ghi `gate_access_logs`, `zone_presence_events`, `iot_device_events` — đây là log append-only (AGENTS.md §5.5 rule 3).
- **R6 (CHỐT OQ-2)**: **WHEN** bất kỳ thao tác **create / update / delete** zone thành công **→** hệ thống ghi 1 bản ghi `audit_logs` với `entity_type='zones'`, `action_type ∈ {'create','update','delete'}`, `entity_id=<zone id>`, `user_id=<actor từ JWT>`.
- **R7**: **IF** ghi audit thất bại **→** thao tác xoá PHẢI rollback (không có trạng thái "đã xoá mà không có dấu vết").
- **R8**: **WHILE** ghi audit, hệ thống **KHÔNG** được ghi secret/token/password (CLAUDE.md §17) — cân nhắc `metadata_json` của zone (§0.6).
- **R9 (SEC-02)**: **WHILE** xử lý route, request PHẢI qua `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('zones.zone.delete')`; thiếu token → `401`, thiếu quyền → `403`, **KHÔNG** ghi gì vào DB.
- **R10**: **WHERE** zone đã bị xoá mềm, `zone_code` của nó được phép dùng lại khi tạo zone mới (UC-90 OQ-3) — UC-92 **KHÔNG** được thêm ràng buộc chặn điều này.
- **R11**: **WHILE** mọi truy vấn của UC-92, điều kiện `deleted_at IS NULL` PHẢI có mặt khi tìm zone (AGENTS.md §5.5 rule 1).

## 6. Constitution

| Rule | Áp dụng trong UC-92 |
| :--- | :--- |
| **DATA-01 (crux)** | Soft-delete bắt buộc (`repo.softDelete`), hard-delete bị cấm tuyệt đối. Zone là entity business-critical (dữ liệu nền của FT-20/FT-21). |
| **SEC-01** | Audit KHÔNG ghi secret; `metadata_json` của zone là túi tự do nên phải cân nhắc mask/loại trước khi đưa vào `audit_logs` (§0.6). |
| **SEC-02** | Route mutating → guard đầy đủ + `@RequirePermissions`; `actorUserId` từ JWT, không từ body. |
| **SEC-03** | `:id` qua `ParseUUIDPipe`; chỉ dùng repository API/parameter binding, không nối chuỗi SQL. |
| **ARCH-01 (crux)** | Module `zones` **KHÔNG** query thẳng bảng `iot_devices` — gọi qua `IotDevicesService` (DI). `ZonesModule` import `IotModule`; **`IotModule` TUYỆT ĐỐI KHÔNG import `ZonesModule`** — phụ thuộc **một chiều `zones → iot`, vĩnh viễn** (CHỐT OQ-1b). Chi phí: phải thêm method đếm theo `zone_id` vào module `iot`. |
| **ARCH-03** | Gọi DELETE lần 2 → `404` (CHỐT OQ-4), không tạo tác dụng phụ ⇒ natural idempotency đạt. |
| **ENG-01** | Test ≥80%: happy path, 404, còn tham chiếu (theo OQ-1), audit được ghi, rollback khi audit lỗi. |
| **ENG-02** | Chưa có Swagger → miễn như UC-90/91; EARS tag trong JSDoc. |
| **ENG-03** | Lỗi nghiệp vụ `{code, message}`; không lộ stack. |
| **ENG-04** | Không thêm dependency. |

## 7. OPEN QUESTIONS — ĐÃ CHỐT

> Thiếu Chủ đã chốt OQ-1 → OQ-8 ngày 2026-07-22, **bổ sung thêm OQ-1b** (quyết định kiến trúc mới về hướng phụ thuộc module). Phần *Đề xuất/Phân tích* giữ nguyên để lưu vết; dòng **KẾT LUẬN** là quyết định cuối. **Plan/tasks/code KHÔNG được mở lại.**

- **OQ-1 (CRUX) — Zone còn thiết bị/sự kiện thì xử lý thế nào?**
  Nền tảng: `softDelete` không kích hoạt FK action nào (§0.3) ⇒ DB **không** chặn, cũng **không** tự gỡ. Ba phương án:

  | | (a) CHẶN | (b) CHO XOÁ (dangling) | (c) CHO XOÁ + tự gỡ camera |
  | :--- | :--- | :--- | :--- |
  | Hành vi | còn thiết bị (và/hoặc còn log) → `409` | soft-delete luôn | set `iot_devices.zone_id = NULL` rồi soft-delete |
  | Ưu | An toàn nhất, admin buộc dọn trước; đúng tinh thần `ON DELETE RESTRICT` mà DB không thực thi được | Đơn giản nhất, 0 cross-module, giữ `zones` độc lập | Không để dangling; camera "về kho" chờ gán zone khác |
  | Nhược | **Không xoá được zone nào đã từng có log** (log append-only, không bao giờ giảm) ⇒ zone gần như bất tử nếu chặn theo log | `iot_devices.zone_id` trỏ zone chết; mọi query theo zone phải tự join `zones.deleted_at IS NULL` (AGENTS.md §5.5 rule 1 đã cảnh báo đúng tình huống này) | Xuyên module (ARCH-01), ghi vào bảng của `iot`; mất thông tin "camera từng thuộc zone nào" |
  | Boundary | Đếm log = nội bộ; đếm device = **xuyên module** | Không đụng | **Xuyên module (ghi)** |

  *Đề xuất*: **kết hợp có phân biệt** — **chặn theo THIẾT BỊ** (`409` nếu còn `iot_devices` gán zone), **KHÔNG chặn theo LOG** (log chỉ tăng, chặn theo log = zone bất tử).
  *Lý do*: camera là cấu hình đang sống, gỡ được và nên do người vận hành gỡ có ý thức (tránh im lặng làm hỏng luồng ingestion FT-20/FT-21); còn log là lịch sử, giữ nguyên và vẫn join được về zone đã xoá mềm nên không cản trở gì.
  *Chi phí phải chấp nhận nếu chọn đề xuất này*: `ZonesModule` phải import `IotModule` và **`IotDevicesService` phải có method đếm theo `zone_id` (hiện CHƯA có — §0.4)** ⇒ UC-92 phải sửa file thuộc module `iot`, vượt ra ngoài thư mục `zones`.
  **KẾT LUẬN — CHỐT: chặn theo THIẾT BỊ, KHÔNG chặn theo LOG.** Còn `iot_devices` gán `zone_id` → `409 ZONE_HAS_DEVICES`; còn bản ghi `gate_access_logs`/`zone_presence_events` → **vẫn cho xoá**. Kiểm tra thiết bị **PHẢI qua `IotDevicesService` (DI)**, **CẤM** query thẳng bảng `iot_devices` từ module `zones` (ARCH-01).

- **OQ-1b (MỚI — quyết định kiến trúc) — Hướng phụ thuộc giữa `zones` và `iot`.**
  **KẾT LUẬN — CHỐT: `zones → iot`, MỘT CHIỀU, VĨNH VIỄN.** `ZonesModule` được phép `imports: [IotModule]`; **`IotModule` TUYỆT ĐỐI KHÔNG được import `ZonesModule`**.
  **Hệ quả bắt buộc cho UC-94 (gán camera vào zone)**: route đặt ở **phía `zones`** — **`PATCH /api/v1/zones/:id/devices`**, **KHÔNG** phải `PATCH /iot-devices/:id/zone` — để `iot` không bao giờ cần biết về `zones`, tránh phải dùng `forwardRef`. UC-94 PHẢI bám ràng buộc này.

- **OQ-2 — Phạm vi audit (nợ từ UC-90 OQ-8).** Ba mức:
  1. **Chỉ audit `delete`** — thêm `ZonesAuditRepository` + transaction cho riêng `remove()`; `create()`/`update()` giữ nguyên không audit.
  2. **Audit cả 3 thao tác** — phải **sửa lại `create()` (UC-90) và `update()` (UC-91)**: đổi constructor sang có `DataSource`, bọc transaction, viết thêm `logZoneCreation`/`logZoneUpdate`, và **sửa/bổ sung test đã xanh của 2 UC trước**.
  3. **Hoãn tiếp** sang task riêng sau UC-94.

  *Đề xuất*: **mức 2 (audit cả 3)**.
  *Lý do*: bảng `zones` không có `created_by`/`updated_by` (§0.8) nên `audit_logs` là nơi duy nhất; nếu chỉ audit delete thì vẫn **không biết ai đổi `zone_code`/`zone_type`/`status`** — đúng cái rủi ro UC-91 §8 đã cảnh báo. Làm 1 lần cho cả cụm rẻ hơn quay lại sửa lần thứ ba. Đổi lại: UC-92 phình to, chạm code + test của 2 UC đã commit.
  *Nếu ưu tiên giữ UC-92 gọn* → mức 1, và ghi nợ audit create/update thành task riêng có deadline rõ.
  **KẾT LUẬN — CHỐT: MỨC 2 — audit cả 3 thao tác (create/update/delete).** Tạo **`ZonesAuditRepository` mới trong module `zones`** (mirror `IotAuditRepository`; **KHÔNG** tái dùng repo của `iot` vì `entity_type` hard-code `'iot_devices'`). `ZonesService` nhận thêm `DataSource`, bọc transaction; **sửa lại `create()` (UC-90) và `update()` (UC-91)** — ngoại lệ có chủ đích với nguyên tắc "no `DataSource`". `entity_type='zones'`, `action_type ∈ {'create','update','delete'}`, `user_id` từ `@CurrentUser()`.

- **OQ-3 — Response của DELETE.** *Đề xuất*: **`200` + `{ success, message: 'Zone deleted successfully', data: null }`** (tiền lệ ANPR UC2, §0.5).
  *Lý do*: nhất quán với DELETE duy nhất đang có trong repo; envelope `{success, message, data}` giữ đồng nhất toàn hệ thống; `204` sẽ là ngoại lệ duy nhất không có envelope, FE phải xử lý riêng.
  *Phương án thay thế*: trả zone đã xoá (có `deleted_at`) nếu FE cần hiển thị thời điểm xoá ngay — nhưng hiện `toZoneResponse` **không** trả `deleted_at` nên sẽ phải sửa mapper (đụng file UC-90).
  **KẾT LUẬN — CHỐT: `200` + `{ success: true, message: 'Zone deleted successfully', data: null }`.** KHÔNG `204`, KHÔNG trả entity (tránh phải sửa `toZoneResponse` để lộ `deleted_at`).

- **OQ-4 — Gọi DELETE lần thứ hai (zone đã xoá mềm).** *Đề xuất*: **`404 ZONE_NOT_FOUND`**.
  *Lý do*: `loadActive()` đã lọc `deletedAt IS NULL` nên 404 là hành vi tự nhiên, không cần code thêm; nhất quán với UC-91 (PATCH lên zone đã xoá cũng 404). ARCH-03 vẫn đạt vì lần 2 **không tạo tác dụng phụ nào**.
  *Phương án thay thế*: trả `200` no-op cho client dễ retry — nhưng sẽ cần nhánh code riêng và làm lệch với `loadActive`.
  **KẾT LUẬN — CHỐT: `404 ZONE_NOT_FOUND`** — hành vi tự nhiên của `loadActive()`, không cần nhánh code riêng. ARCH-03 vẫn đạt (lần 2 không tạo tác dụng phụ).

- **OQ-5 — Khôi phục (restore/un-delete).** *Đề xuất*: **NGOÀI scope UC-92**, ghi thành nợ.
  *Lý do*: restore không nằm trong mô tả UC-92; hơn nữa restore có xung đột nghiệp vụ thật — trong lúc zone A bị xoá mềm, `zone_code` của nó **có thể đã bị zone B chiếm** (UC-90 OQ-3), khôi phục sẽ đụng partial unique và cần chính sách riêng (đổi mã khi restore?). Không nên nhét vào UC-92.
  **KẾT LUẬN — CHỐT: NGOÀI scope UC-92.** Hệ quả (ghi §8): zone xoá nhầm **không có đường khôi phục qua API** — chỉ sửa được bằng SQL tay; và `zone_code` của nó có thể đã bị zone khác chiếm (UC-90 OQ-3) nên restore về sau cần chính sách riêng.

- **OQ-6 — Permission và role.** *Đề xuất*: **1 permission `zones.zone.delete`**, role **`SYSTEM_ADMIN` + `BUSINESS_ADMIN`** (giữ nguyên như UC-90/91).
  *Lý do*: nhất quán; và với soft-delete + (nếu chốt OQ-1 là chặn theo thiết bị) thì mức độ phá huỷ đã được giới hạn.
  *Phương án thay thế cần cân*: **chỉ `SYSTEM_ADMIN`** vì xoá là thao tác phá huỷ và **hiện không có đường khôi phục** (OQ-5).
  **KẾT LUẬN — CHỐT: 1 permission `zones.zone.delete`, role `SYSTEM_ADMIN` + `BUSINESS_ADMIN`.** Lý do Thiếu Chủ: `BUSINESS_ADMIN` đã sửa được `zone_code`/`zone_type`/`status` ở UC-91, cấm xoá là không nhất quán; soft-delete + chặn-theo-thiết-bị đã giới hạn mức phá huỷ.

- **OQ-7 — Mã lỗi mới (chỉ cần nếu OQ-1 chốt CHẶN).** *Đề xuất*: **`ZONE_HAS_DEVICES`**, message `'Khu vực còn thiết bị được gán, hãy gỡ thiết bị trước khi xoá'`; kèm `details` số lượng thiết bị còn lại nếu muốn FE hiển thị.
  *Lý do*: tên nói đúng nguyên nhân và đúng hành động cần làm, hơn `ZONE_IN_USE` (mơ hồ: "in use" bởi log hay bởi thiết bị?). Nếu sau này chặn thêm điều kiện khác thì thêm mã riêng, không gộp.
  **KẾT LUẬN — CHỐT: `ZONE_HAS_DEVICES`**, message `'Khu vực còn thiết bị được gán, hãy gỡ thiết bị trước khi xoá'`. Có thể kèm `details` **số lượng** thiết bị còn lại; **KHÔNG** lộ danh sách/định danh thiết bị.

- **OQ-8 — Mâu thuẫn giữa prompt/luật.** Phát hiện **1 điểm cần Thiếu Chủ xác nhận cách hiểu** (không phải mâu thuẫn của prompt này):
  - Entity `gate-access-log.entity.ts:24` và `zone-presence-event.entity.ts:22` ghi *"`zone_id` dùng ON DELETE RESTRICT: **không cho xoá zone khi còn log/event**"* — nhưng như §0.3 chứng minh, với soft-delete thì RESTRICT **không bao giờ kích hoạt**, nên câu này **đang mô tả sai hành vi thực tế** của hệ thống (nó chỉ đúng nếu ai đó hard-delete, mà hard-delete thì bị DATA-01 cấm).
  - Đề xuất: coi đây là **comment gây hiểu nhầm cần sửa lại** (1 dòng JSDoc mỗi file, không đổi logic).
  **KẾT LUẬN — CHỐT: SỬA trong UC-92.** Hai file nằm **trong module `zones`** (không phải cross-module) nên thuộc phạm vi. Sửa JSDoc (1–2 dòng mỗi file) để nói đúng: `ON DELETE RESTRICT` chỉ có tác dụng với **hard-delete** (vốn bị DATA-01 cấm); việc chặn/không-chặn xoá zone do **application** quyết định (CHỐT OQ-1: chặn theo thiết bị, không chặn theo log). **KHÔNG đổi logic, KHÔNG đổi FK.**
  - Ngoài điểm trên: các lệch đã biết (4 role thật, error envelope thiếu `timestamp`/`path`, chưa Swagger, 5 file `spec/global/` rỗng) giữ nguyên như UC-90/91, **không mở lại**.

## 8. Residuals / known-gaps

- **Dangling `iot_devices.zone_id`** (nếu OQ-1 chốt (b)): FK vẫn hợp lệ nhưng trỏ zone đã chết; **mọi** query theo zone ở FT-20/FT-21 phải tự thêm `zones.deleted_at IS NULL` — đúng cảnh báo AGENTS.md §5.5 rule 1. Nếu quên, camera thuộc zone đã xoá vẫn "hoạt động" trong báo cáo.
- **`ON DELETE RESTRICT` là hàng rào giấy** với soft-delete (§0.3): tài liệu/entity đang mô tả một sự bảo vệ **không tồn tại trên thực tế**. Đây là hiểu nhầm dễ lan sang UC sau (OQ-8).
- **Không có đường khôi phục** nếu OQ-5 chốt ngoài scope: xoá nhầm phải sửa bằng SQL tay. Kết hợp với việc `zone_code` có thể bị chiếm lại (UC-90 OQ-3) ⇒ khôi phục về sau càng phức tạp.
- **`deleted_by` không tồn tại**: ngay cả khi audit được ghi (OQ-2), tra "ai xoá zone này" phải đi qua `audit_logs`, không đọc thẳng từ bảng `zones`.
- **Nếu OQ-2 chốt mức 2**: UC-92 sẽ **sửa code + test đã commit của UC-90/UC-91** — rủi ro hồi quy 52 test hiện có; plan phải tính bước chạy lại toàn bộ `src/modules/zones`.
- **Nếu OQ-1 chốt (a)/(c)**: `ZonesModule` → `IotModule` là cạnh phụ thuộc **mới**; UC-94 (gán camera vào zone) có thể cần chiều ngược lại → phải thiết kế trước để tránh circular (vd đặt logic gán ở phía `iot`, hoặc tách port/interface).
- **Chưa có UC-93**: vẫn chưa có cách liệt kê zone qua API ⇒ FE không có màn hình nào để bấm nút xoá. UC-93 là phụ thuộc chặn thực tế của cả UC-91 lẫn UC-92.
- **Không có global exception filter / Swagger / 5 file `spec/global/` rỗng**: nợ toàn hệ thống, giữ nguyên.

---

> **Spec ĐÃ DUYỆT**, OQ-1 → OQ-8 (+ OQ-1b) đã chốt (2026-07-22). Bước kế tiếp: [plan.md](./plan.md) (plan-only, chưa code, chưa `tasks.md`).
