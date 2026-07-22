# ZNU-001 — UC-91 (Zones): Cập nhật khu vực

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo spec ZNU-001 (UC-91): sửa thông tin / loại / trạng thái zone trên nền ZNC-001 (UC-90) đã commit. RECON code thật (`ZonesService.create`, `zoneCodeConflict`, `isUniqueViolation`, `ZonesController` + `ZONE_PIPE`, mẫu PATCH của ANPR UC2, tiền lệ `Not(id)` khi check trùng lúc update). Crux = phạm vi field được sửa + trùng `zone_code` khi đổi mã (phải loại chính nó khỏi pre-check). 9 OPEN QUESTIONS mới chờ Thiếu Chủ. | Toàn bộ |
| 2026-07-22 | Thiếu Chủ CHỐT OQ-1→OQ-9. **OQ-1=cho sửa TẤT CẢ field, gồm cả `zone_code` (KHÁC đề xuất agent là cấm đổi mã)** — vì "xoá mềm + tạo lại" sinh `zone_id` MỚI, làm `iot_devices.zone_id` trỏ vào zone chết và tách lịch sử log thành 2 zone · OQ-2=`['active','inactive']` trong `constants/zone-status.constant.ts` · **OQ-3=GỘP 1 route `PATCH /zones/:id` (KHÁC đề xuất agent là tách `/status`)** — vì OQ-5 dùng chung 1 permission nên tách route không đổi được gì về bảo mật · OQ-4=no-op 200, xác định "không đổi" bằng **so sánh giá trị thật** · OQ-5=1 permission `zones.zone.update` · OQ-6=tái dùng `zoneCodeConflict()`+`isUniqueViolation()`, pre-check có `Not(id)` và chỉ chạy khi mã thực sự đổi · OQ-7=không mâu thuẫn mới · OQ-8=`undefined` giữ / `null` xoá / có giá trị gán, `metadata_json` replace toàn bộ · OQ-9=`ZONE_NOT_FOUND`. | §7 (đổi tiêu đề + kết luận từng OQ); §2/§3/§4 bỏ phương án tách route + `UpdateZoneStatusDto`/`setStatus`, thêm `zone_code`/`zone_type`/`status` vào `UpdateZoneDto`; §4 bảng status và §5 (R8, R12) sửa cho khớp |

> **SPEC-ONLY.** Chưa plan/tasks/code. Kế thừa toàn bộ convention đã chốt ở [ZNC-001 / UC-90](../uc90-create-zone/spec.md) — permission 3 tầng `module_code='zones'`, role `SYSTEM_ADMIN`+`BUSINESS_ADMIN`, `normalizeZoneCode`, `ZONE_TYPES`, lọc `deletedAt IS NULL`, không audit tới UC-92, envelope inline, `ValidationPipe` tường minh, base path `/api/v1/zones`, mapper `toZoneResponse` — **KHÔNG mở lại**. UC-91 **thêm method vào `ZonesService` và route vào `ZonesController` đã có**, KHÔNG tạo service/controller/module mới, KHÔNG migration schema.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZonesService` hiện tại — chỉ có `create` ([zones.service.ts](../../../../src/modules/zones/services/zones.service.ts))
- Constructor chỉ `@InjectRepository(ZoneEntity) repo` ([:26-29](../../../../src/modules/zones/services/zones.service.ts)) — không `DataSource`. UC-91 giữ nguyên (nợ audit tới UC-92).
- Helper module-level **`zoneCodeConflict()`** ([:12-16](../../../../src/modules/zones/services/zones.service.ts)) trả `ConflictException({code:'ZONE_CODE_EXISTS', message:'Mã khu vực đã tồn tại'})` — **tái dùng nguyên cho UC-91** (OQ-6).
- **`private isUniqueViolation(e)`** ([:67-72](../../../../src/modules/zones/services/zones.service.ts)) đọc `driverError.code ?? code`, so `'23505'`. Hiện là `private` trong cùng class ⇒ method mới của UC-91 gọi được **không cần đổi visibility**.
- Pattern `create` ([:31-64](../../../../src/modules/zones/services/zones.service.ts)): normalize → pre-check `findOne({where:{zoneCode, deletedAt: IsNull()}})` → `repo.create` → `repo.save` trong `try/catch` bắt 23505.
- ⚠ **Khác biệt then chốt của UC-91**: pre-check của `create` không cần loại trừ bản ghi nào, nhưng khi **update** thì zone đang sửa **chính nó** đã mang `zone_code` đó ⇒ pre-check phải loại chính nó, nếu không PATCH giữ nguyên mã sẽ tự đụng chính mình và trả 409 sai. Tiền lệ repo: `findOne(IoTDeviceEntity, { where: { macAddress: updates.macAddress, id: Not(deviceId) } })` ([iot-devices.service.ts:222-225](../../../../src/modules/iot/services/iot-devices.service.ts)) — dùng `Not(id)` từ `typeorm`.

### 0.2. `ZonesController` hiện tại — 1 route POST ([zones.controller.ts](../../../../src/modules/zones/controllers/zones.controller.ts))
- `@Controller('zones')` ([:30](../../../../src/modules/zones/controllers/zones.controller.ts)); hằng module-level `ZONE_PIPE = new ValidationPipe({whitelist:true, transform:true})` ([:19](../../../../src/modules/zones/controllers/zones.controller.ts)) — **route UC-91 dùng lại đúng hằng này**.
- Route `create` ([:34-47](../../../../src/modules/zones/controllers/zones.controller.ts)): `@Post()` + `@HttpCode(CREATED)` + `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('zones.zone.create')` + `@UsePipes(ZONE_PIPE)`; envelope inline `{success, message, data: toZoneResponse(entity)}`.
- Comment cảnh báo tại [:27-28](../../../../src/modules/zones/controllers/zones.controller.ts): thiếu `@RequirePermissions` = endpoint hở im lặng (`PermissionsGuard` `return true` khi không có metadata) — áp dụng y nguyên cho route UC-91.
- **Chưa import `Param`/`ParseUUIDPipe`/`Patch`** — UC-91 sẽ phải bổ sung import. Tiền lệ `:id`: `@Param('id', ParseUUIDPipe)` ([iot-devices.controller.ts:70](../../../../src/modules/iot/controllers/iot-devices.controller.ts)).

### 0.3. DTO + mapper đã có ([create-zone.dto.ts](../../../../src/modules/zones/dto/create-zone.dto.ts), [zone-response.dto.ts](../../../../src/modules/zones/dto/zone-response.dto.ts))
- `CreateZoneDto`: `@Expose({name:'zone_code'})` + `@IsString @IsNotEmpty @MaxLength(80)`; `zoneType` **required** `@IsIn([...ZONE_TYPES])`; `building`/`floor`/`description` `@IsOptional` + MaxLength 100/30/255; `metadataJson` `@Expose({name:'metadata_json'}) @IsOptional @IsObject`. **KHÔNG** có `status` (UC-90 cố ý loại).
- `toZoneResponse(entity)` trả snake_case đủ 11 khoá, **không** có `deleted_at` — UC-91 dùng lại, không viết mapper mới.
- `ZONE_TYPES` (`as const`, 5 giá trị) + type `ZoneType` tại [zone-type.constant.ts](../../../../src/modules/zones/constants/zone-type.constant.ts) — UC-91 tái dùng.

### 0.4. Entity + ràng buộc DB ([zone.entity.ts](../../../../src/modules/zones/entities/zone.entity.ts), [20260721000001-CreateZonesTable.ts](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts))
- `@DeleteDateColumn deletedAt` ([zone.entity.ts:56-57](../../../../src/modules/zones/entities/zone.entity.ts)) ⇒ `repo.findOne` mặc định đã loại bản ghi soft-deleted, nhưng UC-90 vẫn khai `deletedAt: IsNull()` tường minh — UC-91 giữ nguyên phong cách đó.
- `status` là `varchar(30)` DEFAULT `'active'`, **KHÔNG CHECK, KHÔNG enum** ([:23](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts)) ⇒ tập giá trị hợp lệ phải do app định nghĩa → OQ-2.
- `UQ_zones_code_active` là **partial unique** `WHERE deleted_at IS NULL` ([:32-35](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts)) ⇒ nếu cho đổi `zone_code` (OQ-1) thì safety-net 23505 vẫn cần.
- **Không có cột `updated_by`** ⇒ UC-91 không lưu được ai sửa; `@UpdateDateColumn updatedAt` chỉ cho biết *khi nào*. Kết hợp với "chưa audit tới UC-92" ⇒ khoảng trống truy vết, ghi §8.

### 0.5. Mẫu UC update gần nhất — ANPR UC2 ([spec](../../anpr/uc2-plate-management/spec.md), [vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts))
- **Tách route `/status` riêng** khỏi PATCH metadata (OQ-3 của UC2, chốt tách) — controller: `@Patch('vehicle-registrations/:id')` và `@Patch('vehicle-registrations/:id/status')` ([vehicle-registration.controller.ts:185-224](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
- **Ngữ nghĩa 3 trạng thái của field PATCH** ([:162-181](../../../../src/modules/anpr/services/vehicle-registration.service.ts)): `undefined` → giữ nguyên; `null` → set null (xoá giá trị); có giá trị → gán. Cờ `changed` gom lại: **không field nào gửi → no-op, KHÔNG `save`, trả entity nguyên trạng (200)**.
- `setStatus` tách method riêng, nhận union type `'active'|'disabled'` khai trong DTO ([update-vehicle-status.dto.ts](../../../../src/modules/anpr/dto/update-vehicle-status.dto.ts)).
- Load bản ghi qua 1 helper dùng chung (`loadOwned`), fold điều kiện vào `findOne` → không khớp → `NotFoundException({code,message})`.

### 0.6. Tiền lệ "chỉ giữ field thực sự đổi" ([iot-devices.service.ts:235-236](../../../../src/modules/iot/services/iot-devices.service.ts))
- `const changes: Record<string, {old, new}> = {}` — chỉ ghi nhận field **đổi giá trị thật** (so sánh với giá trị hiện tại), phục vụ idempotency + audit. UC-91 chưa audit nên chỉ cần phần so sánh để quyết định no-op → liên quan OQ-4.

### 0.7. Tập giá trị `status` ở các domain lân cận (tham chiếu cho OQ-2)
- `RoomStatus` = `available | occupied | reserved | maintenance | inactive` ([room.entity.ts:20-26](../../../../src/modules/rooms/entities/room.entity.ts)).
- `IoTDeviceStatus` = `online | offline | disabled | maintenance` ([iot-device.entity.ts:24-29](../../../../src/modules/iot/entities/iot-device.entity.ts)).
- `vehicle_registrations.status` = `active | disabled` (ANPR UC2, chốt 2 giá trị).
- ⇒ Repo **không có một chuẩn `status` duy nhất**; mỗi bảng tự định nghĩa. `zones.status` phải chốt tay → OQ-2.

### 0.8. Mẫu seed permission mới nhất ([20260722000001-SeedZoneCreatePermission.ts](../../../../src/database/migrations/20260722000001-SeedZoneCreatePermission.ts))
- Cấu trúc: field `permission = {code, name, module, action, description}` + `roles = ['SYSTEM_ADMIN','BUSINESS_ADMIN']`; `up()` INSERT `ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback SELECT → gán `role_permissions` `ON CONFLICT DO NOTHING`; `down()` xoá `role_permissions` trước rồi `permissions`.
- UC-91 copy nguyên pattern, timestamp **sau** `20260722000001` (số permission cần seed phụ thuộc OQ-5).

---

## 1. Scope (UC-91)

### TRONG scope
1. **Sửa thông tin zone**: `zone_name`, `building`, `floor`, `description`, `metadata_json` — chắc chắn nằm trong scope.
2. **Sửa `zone_type`** và **sửa `zone_code`** (CHỐT OQ-1 — cho sửa tất cả field).
3. **Đổi `status`** — tập giá trị `['active','inactive']` (CHỐT OQ-2), đi chung route `PATCH /zones/:id` (CHỐT OQ-3).
4. **Method mới trong `ZonesService`** (không tạo service mới) + **route mới trong `ZonesController`** (không tạo controller mới).
5. **DTO update** mới; **tái dùng** `toZoneResponse`, `ZONE_TYPES`, `normalizeZoneCode`, `zoneCodeConflict`, `isUniqueViolation`.
6. **1 migration seed permission** `zones.zone.update` (CHỐT OQ-5), gán `SYSTEM_ADMIN` + `BUSINESS_ADMIN`.
7. **404 `ZONE_NOT_FOUND`** khi zone không tồn tại / đã soft-delete; **409 `ZONE_CODE_EXISTS`** khi đổi `zone_code` trùng zone đang sống khác (CHỐT OQ-6, OQ-9).
8. Unit test cho method mới + DTO (mock repo, không DB).

### NGOÀI scope (UC sau — KHÔNG làm)
- **UC-92 (xoá zone)**: `DELETE /zones/:id`, `repo.softDelete`, **và audit cho cả cụm zone** (nợ từ UC-90 OQ-8) — KHÔNG làm ở đây.
- **UC-93 (xem/tra cứu)**: `GET /zones`, `GET /zones/:id`, filter, phân trang. ⚠ Hệ quả: sau UC-91 client vẫn chưa có cách liệt kê zone để lấy `id` — ghi §8.
- **UC-94 (gán camera vào zone)**: ghi `iot_devices.zone_id`, `iot_device_events.zone_id`.
- **Khôi phục zone đã soft-delete** (un-delete/restore) — KHÔNG thuộc UC-91.
- **KHÔNG** migration schema: không thêm cột (kể cả `updated_by`), không đổi index, không thêm CHECK cho `status`/`zone_type`.
- **KHÔNG** audit log, **KHÔNG** transaction, **KHÔNG** `DataSource`/`queryRunner` (kế thừa UC-90).
- **KHÔNG** WebSocket/notification khi zone đổi trạng thái.
- **KHÔNG** đụng `gate_access_logs`, `zone_presence_events`, `vehicle_control_list`, `rooms`.
- **KHÔNG** sửa wiring `ZonesModule` (đã có `AuthModule` + `controllers` + `providers` từ UC-90).

## 2. DTO (đề xuất — mô tả, KHÔNG code)

**`UpdateZoneDto`** (`src/modules/zones/dto/update-zone.dto.ts`) — tất cả field `@IsOptional`, giữ nguyên `@Expose` + `@MaxLength` khớp DB như `CreateZoneDto`:

| Field API | Property | Ràng buộc | Ghi chú |
| :--- | :--- | :--- | :--- |
| `zone_code` | `zoneCode` | `@IsOptional @IsString @IsNotEmpty @MaxLength(80)` | **Sửa được** (CHỐT OQ-1). KHÔNG nhận `null`. Chuẩn hoá bằng `normalizeZoneCode` ở service. |
| `zone_name` | `zoneName` | `@IsOptional @IsString @IsNotEmpty @MaxLength(150)` | Sửa được. KHÔNG nhận `null`. `@IsNotEmpty` để không cho set rỗng. |
| `zone_type` | `zoneType` | `@IsOptional @IsIn([...ZONE_TYPES])` | **Sửa được** (CHỐT OQ-1). KHÔNG nhận `null`. |
| `status` | `status` | `@IsOptional @IsIn([...ZONE_STATUSES])` | **Nằm trong CHÍNH DTO này** (CHỐT OQ-3 — gộp 1 route). KHÔNG nhận `null`. |
| `building` | `building` | `@IsOptional @IsString @MaxLength(100)` | Nhận `null` = xoá giá trị (CHỐT OQ-8). |
| `floor` | `floor` | `@IsOptional @IsString @MaxLength(30)` | Nhận `null` = xoá giá trị. |
| `description` | `description` | `@IsOptional @IsString @MaxLength(255)` | Nhận `null` = xoá giá trị. |
| `metadata_json` | `metadataJson` | `@IsOptional @IsObject` | **Replace toàn bộ**, KHÔNG merge sâu (CHỐT OQ-8). Nhận `null` = xoá. |

- **KHÔNG** khai `id`/`created_at`/`updated_at`/`deleted_at` — `whitelist:true` loại sạch.
- Thêm hằng **`ZONE_STATUSES`** (`as const`, `['active','inactive']`) + type `ZoneStatus` vào **`src/modules/zones/constants/zone-status.constant.ts`** (file mới, song song `zone-type.constant.ts`) — không nhét chuỗi rời rạc vào DTO. JSDoc ghi rõ: `inactive` = khu vực ngừng sử dụng, FT-20/FT-21 sau này PHẢI tôn trọng (không nhận event mới), nhưng **UC-91 KHÔNG implement việc chặn đó**.
- **KHÔNG** tạo `UpdateZoneStatusDto` (CHỐT OQ-3 gộp route).

## 3. Service (đề xuất — thêm method vào `ZonesService`)

**Helper dùng chung** `private async loadActive(id: string): Promise<ZoneEntity>`:
- `repo.findOne({ where: { id, deletedAt: IsNull() } })` → null → `NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Không tìm thấy khu vực' })` (CHỐT OQ-9).
- Fold existence + soft-delete vào 1 query, mirror `loadOwned` của ANPR UC2 (bỏ phần ownership — zone là dữ liệu dùng chung, không có chủ sở hữu).

**`async update(id: string, dto: UpdateZoneDto): Promise<ZoneEntity>`** — thứ tự bước (CHỐT):
1. `const entity = await this.loadActive(id);`
2. Gom `updates` từ những field **thực sự được gửi** (`!== undefined`), chuẩn hoá `zoneCode` bằng `normalizeZoneCode` ngay tại bước này (bắt buộc dùng lại đúng hàm — UC-90 đã chốt).
3. **Pre-check trùng mã** — chỉ chạy khi `updates.zoneCode !== undefined` **và** `updates.zoneCode !== entity.zoneCode`: `repo.findOne({ where: { zoneCode, deletedAt: IsNull(), id: Not(id) } })` → có → `throw zoneCodeConflict()`.
   - **`Not(id)` là bắt buộc** (§0.1): thiếu nó thì PATCH gửi lại chính mã cũ sẽ tự đụng chính mình → 409 sai.
   - Điều kiện "mã thực sự đổi" mirror đúng tiền lệ `iot-devices` (kiểm `!== device.macAddress` trước khi query).
4. **So sánh giá trị thật** để lọc field đổi (`newVal !== oldVal`, mirror `changes` của `iot-devices`); nếu **không field nào đổi** → **no-op: KHÔNG `save`, trả entity nguyên trạng, HTTP 200** (CHỐT OQ-4). `updated_at` không nhảy.
5. Gán các field đã đổi vào entity → `try { return await repo.save(entity) } catch (e) { if (this.isUniqueViolation(e)) throw zoneCodeConflict(); throw e; }` — safety-net 23505 phòng race (CHỐT OQ-6).

**KHÔNG** có method `setStatus` riêng (CHỐT OQ-3) — `status` là một field trong `UpdateZoneDto`, đi chung luồng `update`.

- Giữ nguyên `@InjectRepository` thuần, **KHÔNG** transaction/audit/`DataSource` (kế thừa UC-90 OQ-8).
- SEC-03: chỉ dùng repository API, không nối chuỗi SQL.

## 4. Controller (đề xuất — thêm route vào `ZonesController`)

Thêm vào `ZonesController` đã có (`@Controller('zones')`), dùng lại `ZONE_PIPE`; bổ sung import `Patch`, `Param`, `ParseUUIDPipe`.

**Đúng 1 route (CHỐT OQ-3 — gộp, xử lý cả `status`):**
```text
PATCH /api/v1/zones/:id
```
`@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('zones.zone.update')` (CHỐT OQ-5) + `@UsePipes(ZONE_PIPE)` + `@Param('id', ParseUUIDPipe)` → `zonesService.update(id, dto)` → `{success:true, message:'Zone updated successfully', data: toZoneResponse(entity)}` (200).

**KHÔNG** có route `PATCH /zones/:id/status` riêng.

**HTTP status dự kiến**

| Tình huống | Status | `code` |
| :--- | ---: | :--- |
| Cập nhật thành công | `200` | — |
| Body không có field nào **đổi giá trị thật** (kể cả body rỗng) | `200` (no-op, không `save`) | — |
| DTO sai (giá trị ngoài danh sách, vượt `MaxLength`, `zone_name` rỗng) | `400` | (Nest validation) |
| `:id` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission | `403` | `FORBIDDEN` (guard) |
| Zone không tồn tại hoặc đã soft-delete | `404` | `ZONE_NOT_FOUND` (OQ-9) |
| Đổi `zone_code` trùng zone đang sống khác (pre-check hoặc race 23505) | `409` | `ZONE_CODE_EXISTS` |

## 5. Requirements (EARS)

- **R1**: **WHEN** người dùng có permission gửi `PATCH /api/v1/zones/:id` với các field hợp lệ trên một zone **đang sống** **→** hệ thống cập nhật **đúng những field được gửi**, trả `200` + envelope chứa zone sau cập nhật (qua `toZoneResponse`).
- **R2 (crux)**: **IF** `:id` không tồn tại **hoặc** zone đã soft-delete (`deleted_at IS NOT NULL`) **→** trả `404 ZONE_NOT_FOUND`, **KHÔNG** ghi gì vào DB.
- **R3 (crux)**: **WHERE** request đổi `zone_code` sang giá trị (sau `normalizeZoneCode`) đang thuộc về **một zone đang sống khác** **→** trả `409 ZONE_CODE_EXISTS` và **KHÔNG** lưu. Pre-check PHẢI loại trừ chính bản ghi đang sửa (`id: Not(:id)`).
- **R4**: **WHEN** request đổi `zone_code` thành **đúng giá trị hiện tại của chính nó** (không đổi thực sự) **→** KHÔNG được coi là trùng, KHÔNG trả 409.
- **R5**: **IF** hai request đồng thời cùng đổi sang một `zone_code` và cùng qua pre-check **→** `UQ_zones_code_active` chặn ở DB (`23505`); hệ thống PHẢI dịch thành `409 ZONE_CODE_EXISTS`, **KHÔNG** để lỗi driver/stack lọt ra client (ENG-03).
- **R6**: **WHILE** xử lý mọi lookup của UC-91, điều kiện `deleted_at IS NULL` PHẢI có mặt (AGENTS.md §5.5 rule 1).
- **R7**: **IF** field không được gửi (`undefined`) **→** giữ nguyên giá trị hiện tại; hệ thống **KHÔNG** được ghi đè bằng `null` hay giá trị mặc định.
- **R8** (CHỐT OQ-4): **IF** không field nào **đổi giá trị thật** so với bản ghi hiện tại (body rỗng, hoặc gửi đúng giá trị đang có) **→** hệ thống trả `200` với bản ghi nguyên trạng, **KHÔNG** gọi `save`, `updated_at` **KHÔNG** thay đổi.
- **R9**: **IF** `status` nằm ngoài tập giá trị đã chốt (OQ-2) **hoặc** `zone_type` ngoài `ZONE_TYPES` **→** trả `400`, **KHÔNG** cập nhật.
- **R10 (SEC-02)**: **WHILE** xử lý route UC-91, request PHẢI qua `JwtAuthGuard` + `PermissionsGuard` với `@RequirePermissions`; thiếu token → `401`, thiếu quyền → `403`, và **KHÔNG** ghi gì vào DB.
- **R11**: **IF** body chứa field ngoài DTO (`id`, `created_at`, `deleted_at`, và `status` nếu tách route) **→** `whitelist` loại bỏ; client **KHÔNG** đổi được khoá chính, timestamp hay trạng thái xoá mềm.
- **R12** (CHỐT OQ-8): **IF** client gửi `null` cho `building`/`floor`/`description`/`metadata_json` **→** hệ thống set NULL (xoá giá trị). **IF** client gửi `null` cho `zone_code`/`zone_name`/`zone_type`/`status` **→** trả `400` (các field này là dữ liệu bắt buộc của bản ghi, không được xoá). `metadata_json` khi có giá trị được **thay thế toàn bộ**, KHÔNG merge sâu.

## 6. Constitution

| Rule | Áp dụng trong UC-91 |
| :--- | :--- |
| **SEC-01** | Không đụng secret. `metadata_json` KHÔNG được dùng để chứa mật khẩu/token camera (giữ nguyên cảnh báo từ UC-90). |
| **SEC-02** | Endpoint mutating → guard đầy đủ + `@RequirePermissions` (R10). Thiếu decorator = hở im lặng (§0.2). |
| **SEC-03** | DTO `class-validator` + `ValidationPipe({whitelist,transform})` tường minh; `:id` qua `ParseUUIDPipe`; chỉ dùng repository API. |
| **DATA-01** | UC-91 không xoá gì; mọi lookup lọc `deleted_at IS NULL` (R6). Sửa zone đã soft-delete bị chặn bằng 404 (R2) — không "hồi sinh" ngầm. |
| **ARCH-01** | controller → service → repository; thêm vào `ZonesService`/`ZonesController` có sẵn, không tạo tầng mới. |
| **ARCH-03** | Idempotency tự nhiên: PATCH cùng payload nhiều lần cho cùng kết quả; `UQ_zones_code_active` chặn trùng mã. Đạt theo `constitution.md:45-46` (natural idempotency design) — **không** cần `Idempotency-Key`. |
| **ENG-01** | Unit test ≥80% cho method mới: happy path, 404, đổi mã trùng → 409, giữ nguyên mã của chính mình → 200, race 23505, no-op, `undefined` giữ nguyên giá trị. |
| **ENG-02** | Repo chưa có Swagger → miễn như UC-90, ghi nợ §8. EARS tag (R1…R12) đặt trong JSDoc. |
| **ENG-03** | Lỗi nghiệp vụ ném `{code, message}`; `23505` dịch thành 409 sạch; không lộ stack. |
| **ENG-04** | Không thêm dependency. |

## 7. OPEN QUESTIONS — ĐÃ CHỐT

> Thiếu Chủ đã chốt toàn bộ OQ-1 → OQ-9 ngày 2026-07-22. Phần *Đề xuất/Lý do* giữ nguyên để lưu vết phân tích; dòng **KẾT LUẬN** là quyết định cuối cùng. **Plan/tasks/code KHÔNG được mở lại.** Hai điểm quyết định **khác** đề xuất ban đầu của agent: **OQ-1** (cho sửa `zone_code`) và **OQ-3** (gộp 1 route).

- **OQ-1 (crux) — Field nào được phép sửa?** *Đề xuất*: cho sửa `zone_name`, `building`, `floor`, `description`, `metadata_json` (an toàn tuyệt đối); **cho sửa `zone_type`**; **KHÔNG cho sửa `zone_code`**.
  *Lý do*: `zone_code` là định danh nghiệp vụ mà người vận hành dùng để đối chiếu báo cáo và cấu hình thiết bị; đổi mã khiến mọi báo cáo/tài liệu đã in theo mã cũ sai lệch trong khi `zone_id` vẫn giữ nguyên — muốn đổi mã thì xoá mềm + tạo lại (UC-90 đã cho tái dùng mã, OQ-3 của UC-90). Ngược lại `zone_type` là phân loại vận hành, có thể gán sai lúc tạo và **phải** sửa được, nếu không sẽ buộc xoá/tạo lại và mất `zone_id` — vỡ lịch sử.
  *Rủi ro cần Thiếu Chủ cân*: đổi `zone_type` từ `gate` → `room` làm ngữ nghĩa dữ liệu lịch sử đã sinh (`gate_access_logs`, `zone_presence_events`) không còn khớp loại hiện tại; báo cáo FT-20/FT-21 đọc theo `zone_type` **tại thời điểm truy vấn** sẽ diễn giải lại quá khứ. Nếu Thiếu Chủ muốn tránh, có 2 hướng: (a) cấm luôn đổi `zone_type`, (b) chỉ cấm khi zone đã có log — nhưng (b) buộc `zones` phải query sang bảng log, **vi phạm boundary module** và tăng phạm vi UC-91.
  **KẾT LUẬN — CHỐT (KHÁC đề xuất agent): cho sửa TẤT CẢ field, gồm cả `zone_code`.** Lý do Thiếu Chủ: phương án thay thế mà agent đề xuất ("xoá mềm + tạo lại") sinh **`zone_id` MỚI** ⇒ `iot_devices.zone_id` đã gán sẽ trỏ vào zone chết, và lịch sử log bị tách làm 2 zone — **phá đúng cái mà việc cấm đổi mã định bảo vệ**. Đổi mã giữ nguyên `zone_id` nên toàn vẹn dữ liệu không đổi; rủi ro còn lại chỉ là báo cáo giấy in theo mã cũ (vấn đề quy trình, không phải dữ liệu).
  **Ràng buộc kèm theo (bắt buộc)**: mọi báo cáo/truy vết lịch sử phải khoá theo **`zone_id`**, **KHÔNG** theo `zone_code` — `zone_code` nay vừa có thể đổi (UC-91) vừa có thể tái dùng sau soft-delete (UC-90 OQ-3).

- **OQ-2 — Tập giá trị hợp lệ của `status`** (nợ ghi ở [UC-90 §8](../uc90-create-zone/spec.md)). *Đề xuất*: **`['active', 'inactive']`** (đúng 2 giá trị), khai `ZONE_STATUSES` trong `constants/zone-status.constant.ts`, validate `@IsIn`.
  *Lý do*: DB default là `'active'`; zone chỉ cần phân biệt "còn dùng" và "ngừng dùng". `maintenance` là trạng thái của **thiết bị/phòng** (`IoTDeviceStatus`, `RoomStatus` — §0.7), không phải của khu vực vật lý; thêm giá trị chưa có nghiệp vụ tiêu thụ chỉ tạo nợ. Mở rộng sau **không cần migration** (varchar không CHECK), chỉ sửa hằng số.
  *Câu hỏi kèm theo*: zone `inactive` có bị loại khỏi luồng ingestion FT-20/FT-21 không, hay chỉ ẩn khỏi UI?
  **KẾT LUẬN — CHỐT: `['active','inactive']`**, khai `ZONE_STATUSES` (`as const`) + type `ZoneStatus` trong `src/modules/zones/constants/zone-status.constant.ts`, validate `@IsIn`. Ngữ nghĩa ghi vào JSDoc: `inactive` = khu vực **ngừng sử dụng**; **FT-20/FT-21 sau này PHẢI tôn trọng** (không nhận event mới cho zone `inactive`) — nhưng **UC-91 KHÔNG implement việc chặn đó**.

- **OQ-3 — Cấu trúc route: gộp hay tách `/status`?** *Đề xuất*: **tách** `PATCH /zones/:id/status` riêng (mirror ANPR UC2 §0.5).
  *Lý do*: đổi trạng thái là hành vi vận hành khác hẳn sửa thông tin mô tả — tách route cho phép gán permission riêng (OQ-5), ghi audit riêng ở UC-92 sau này, và tránh trường hợp client gửi PATCH metadata kèm `status` ngoài ý muốn.
  *Đánh đổi*: 2 route + 2 DTO thay vì 1, nhiều code hơn cho một UC nhỏ.
  **KẾT LUẬN — CHỐT (KHÁC đề xuất agent): GỘP 1 route `PATCH /api/v1/zones/:id`, xử lý cả `status`.** Lý do Thiếu Chủ: OQ-5 chốt dùng **chung 1 permission**, nên tách route chỉ thêm 1 DTO + 1 route + 1 bộ test cho đúng một field mà **không đổi được gì về bảo mật**. **KHÔNG** tạo `UpdateZoneStatusDto`, **KHÔNG** tạo method `setStatus` — `status` là một field trong `UpdateZoneDto`.

- **OQ-4 — PATCH không có field nào thay đổi.** *Đề xuất*: **no-op, trả `200`** kèm bản ghi nguyên trạng, **không** gọi `save` (mirror ANPR UC2 OQ-5 đã chốt).
  *Lý do*: nhất quán với tiền lệ duy nhất trong repo; client retry/gửi lại form không đổi gì thì không nên nhận lỗi. Tránh cập nhật `updated_at` vô nghĩa.
  *Câu hỏi phụ*: "không thay đổi" tính theo **field vắng mặt** (`undefined`) hay theo **so sánh giá trị thật** (gửi đúng giá trị đang có cũng coi là không đổi — mirror `changes` của iot-devices §0.6)?
  **KẾT LUẬN — CHỐT: no-op trả `200`** kèm bản ghi nguyên trạng, **KHÔNG** gọi `save`. Xác định "không đổi" bằng **so sánh giá trị thật** (`newVal !== oldVal`), mirror `changes` của [iot-devices.service.ts:235-248](../../../../src/modules/iot/services/iot-devices.service.ts) — **không** chỉ dựa vào field vắng mặt. Gửi lại đúng giá trị đang có ⇒ vẫn no-op, `updated_at` **không** nhảy. (Lệch có chủ đích với `iot-devices` — bảng đó trả `400 NO_UPDATABLE_FIELDS` khi body rỗng; UC-91 theo tiền lệ ANPR UC2: no-op 200.)

- **OQ-5 — Số lượng permission.** *Đề xuất*: **1 permission `zones.zone.update`** dùng cho cả 2 route (nếu OQ-3 chốt tách).
  *Lý do*: hiện chưa có nhu cầu phân vai "người sửa thông tin" khác "người đổi trạng thái"; cả hai đều là `SYSTEM_ADMIN`/`BUSINESS_ADMIN`. Thêm `zones.zone.set_status` lúc này là seed một permission không ai dùng khác đi.
  *Phương án thay thế*: nếu tương lai muốn cho `MANAGER` bật/tắt zone mà không sửa được thông tin thì cần permission riêng — tách sau vẫn được (thêm migration seed mới), không phải breaking change.
  **KẾT LUẬN — CHỐT: 1 permission `zones.zone.update`**, `module_code='zones'`, `action_code='update'`, gán `SYSTEM_ADMIN` + `BUSINESS_ADMIN`.

- **OQ-6 — Xác nhận tái dùng `zoneCodeConflict()` + safety-net `23505`.** *Đề xuất*: **CÓ** — dùng đúng helper và mã lỗi `ZONE_CODE_EXISTS` của UC-90, giữ nguyên `try/catch` bắt `23505`, **và bổ sung `id: Not(:id)`** vào pre-check (§0.1).
  *Lý do*: hai UC cùng vi phạm một ràng buộc DB thì phải trả cùng một mã lỗi; client không cần biết mình thua ở create hay update.
  *Lưu ý*: nếu OQ-1 chốt **cấm** đổi `zone_code` thì toàn bộ nhánh này không cần thiết. Hai OQ này gắn nhau.
  **KẾT LUẬN — CHỐT: tái dùng `zoneCodeConflict()` + `isUniqueViolation()` của UC-90.** Vì OQ-1 cho đổi mã nên nhánh này là **bắt buộc**, không phải phòng thủ. Pre-check PHẢI có `id: Not(id)` **và** chỉ chạy khi mã **thực sự đổi** (`normalizeZoneCode(dto.zoneCode) !== entity.zoneCode`) — mirror đúng tiền lệ `iot-devices` ([:217-233](../../../../src/modules/iot/services/iot-devices.service.ts)). Bắt buộc dùng lại `normalizeZoneCode()`, **cấm** tự trim/uppercase rời rạc.

- **OQ-7 — Mâu thuẫn giữa prompt và file luật.** Rà soát cho UC-91: **không phát hiện mâu thuẫn mới**. Các lệch đã biết vẫn nguyên trạng và đã được chốt cách xử ở UC-90 (OQ-7.1→7.5): 4 role code thật, error envelope thiếu `timestamp`/`path` do không có global exception filter, natural idempotency đạt ARCH-03, chưa có Swagger, 5 file `spec/global/` rỗng 0 byte. UC-91 **kế thừa nguyên** các quyết định đó, không mở lại.
  **KẾT LUẬN — XÁC NHẬN: không có mâu thuẫn mới.** Cách hiểu trên là đúng; UC-91 kế thừa nguyên quyết định UC-90, không mở lại.

- **OQ-8 — Ngữ nghĩa cập nhật `metadata_json` và các field nullable.** *Đề xuất*: `metadata_json` **replace toàn bộ** (không merge sâu); gửi `null` cho `building`/`floor`/`description`/`metadata_json` = **xoá giá trị** (set NULL); không gửi = giữ nguyên.
  *Lý do*: merge sâu khiến client không bao giờ xoá được một khoá con và hành vi khó đoán; replace là hợp đồng đơn giản, rõ ràng. Phân biệt `undefined` (giữ) / `null` (xoá) là tiền lệ đã có ở ANPR UC2 (§0.5).
  *Lưu ý kỹ thuật*: cho phép `null` cần `@IsOptional()` (đã chấp nhận `null`) — phải test rõ ràng 3 nhánh `undefined` / `null` / có giá trị.
  **KẾT LUẬN — CHỐT: `undefined` = giữ nguyên · `null` = xoá giá trị (set NULL) · có giá trị = gán.** `metadata_json` **replace toàn bộ**, KHÔNG merge sâu. Nhận `null` chỉ áp dụng cho `building`, `floor`, `description`, `metadata_json`. `zone_code`, `zone_name`, `zone_type`, `status` **KHÔNG** cho `null` (dữ liệu bắt buộc của bản ghi).

- **OQ-9 — Mã lỗi 404.** *Đề xuất*: **`ZONE_NOT_FOUND`**, message tiếng Việt `'Không tìm thấy khu vực'`.
  *Lý do*: nhất quán với `VEHICLE_NOT_FOUND`/`DEVICE_NOT_FOUND` trong repo và với `ZONE_CODE_EXISTS` của UC-90. Zone là dữ liệu dùng chung (không có chủ sở hữu) nên **không** áp dụng cơ chế "fold ownership → giấu tồn tại" của ANPR UC2 — 404 ở đây thuần tuý là không tồn tại.
  **KẾT LUẬN — CHỐT: `ZONE_NOT_FOUND`**, message `'Không tìm thấy khu vực'`. Không áp dụng fold-ownership.

## 8. Residuals / known-gaps

- **Không truy vết được ai sửa**: bảng `zones` không có `updated_by` (§0.4) và UC-91 vẫn **chưa** ghi `audit_logs` (kế thừa UC-90 OQ-8, nợ dời sang UC-92). Sau UC-91, hệ thống cho phép sửa mã/loại/trạng thái khu vực mà **không lưu dấu vết người thực hiện ở bất kỳ đâu** — rủi ro này lớn hơn ở UC-91 so với UC-90 vì sửa là thao tác lặp lại nhiều lần. Nếu Thiếu Chủ thấy không chấp nhận được, cần nâng audit lên làm trước UC-92.
- **Chưa có UC-93 (list/detail)**: client vẫn không có cách lấy `id` zone ngoài response lúc tạo ⇒ UC-91 chưa dùng được trên UI thực tế. UC-93 là phụ thuộc chặn cho cả UC-91 lẫn UC-92.
- **Đổi `zone_type` làm lệch diễn giải lịch sử** (chi tiết ở OQ-1): `gate_access_logs`/`zone_presence_events` là append-only, không lưu snapshot `zone_type` tại thời điểm sinh event. Nếu FT-20/FT-21 cần chính xác theo thời điểm, sau này phải thêm cột snapshot — **migration ALTER trên bảng đã áp production**, nên cân nhắc sớm.
- **`status` chưa có nghiệp vụ tiêu thụ**: chốt tập giá trị ở OQ-2 nhưng chưa UC nào đọc `zones.status` để chặn/lọc. Nguy cơ trở thành field trang trí nếu FT-20/FT-21 không tôn trọng.
- **Không có global exception filter / Swagger**: nợ toàn hệ thống, giữ nguyên như UC-90.
- **5 file `spec/global/` rỗng 0 byte**: nợ cấp nhóm, không xử trong UC-91.
- **Quan hệ `zones` ↔ `rooms` vẫn chưa định nghĩa**: một phòng họp có thể vừa là `rooms` vừa là zone `zone_type='room'`; UC-91 cho đổi tên/loại zone càng làm hai nguồn dữ liệu dễ lệch nhau. Cần quyết định kiến trúc riêng, ngoài phạm vi UC-91.
- **Kiểm thử race `23505`**: như UC-90, mock repository ném lỗi có `driverError.code = '23505'`; không tái hiện bằng DB thật.

---

> **Spec ĐÃ DUYỆT**, OQ-1 → OQ-9 đã chốt (2026-07-22). Bước kế tiếp: [plan.md](./plan.md) (plan-only, chưa code, chưa `tasks.md`).
