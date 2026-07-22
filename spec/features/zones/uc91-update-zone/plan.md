# ZNU-001 — plan.md (UC-91 Zones: cập nhật khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo plan ZNU-001 sau spec DUYỆT + chốt OQ-1→OQ-9. **1 route** `PATCH /api/v1/zones/:id` (gộp cả `status`), **2 method** thêm vào `ZonesService` (`loadActive` private + `update`), 1 DTO + 1 constant mới, **1 migration seed permission** `zones.zone.update`. Crux = pre-check trùng mã phải có `Not(id)` **và** chỉ chạy khi mã thực sự đổi; no-op bằng **so sánh giá trị thật**. `ZonesService`/`ZonesController` là **Modified** (thêm method/route), KHÔNG net-new. No-migration-schema, no-audit, no-DataSource, no-module-change. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **`ZonesController` chưa import `Patch`/`Param`/`ParseUUIDPipe`** ([zones.controller.ts:1-10](../../../../src/modules/zones/controllers/zones.controller.ts) chỉ có `Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UsePipes, ValidationPipe`) ⇒ route UC-91 phải bổ sung 3 import từ `@nestjs/common`. Hằng `ZONE_PIPE` ([:19](../../../../src/modules/zones/controllers/zones.controller.ts)) **dùng lại**, không tạo pipe thứ hai.
- **`isUniqueViolation` là `private` NHƯNG cùng class `ZonesService`** ([zones.service.ts:67-72](../../../../src/modules/zones/services/zones.service.ts)) ⇒ method `update` mới gọi `this.isUniqueViolation(e)` được **không cần đổi visibility**. Tương tự `zoneCodeConflict()` là hàm module-level ([:12-16](../../../../src/modules/zones/services/zones.service.ts)) — gọi trực tiếp.
- **`Not` chưa được import trong `zones.service.ts`** ([:3](../../../../src/modules/zones/services/zones.service.ts) mới có `Repository, IsNull`) ⇒ phải thêm `Not` vào import `typeorm`. `NotFoundException` cũng chưa import ([:1](../../../../src/modules/zones/services/zones.service.ts) mới có `Injectable, ConflictException`) ⇒ thêm.
- **Tiền lệ `Not` + "chỉ check khi thực sự đổi"** ([iot-devices.service.ts:216-233](../../../../src/modules/iot/services/iot-devices.service.ts)): điều kiện 3 tầng `!== undefined && !== null && !== device.macAddress` **trước** khi `findOne({ where: { macAddress, id: Not(deviceId) } })`. UC-91 áp đúng cấu trúc này cho `zoneCode` (bỏ tầng `!== null` vì `zone_code` không nhận `null` — OQ-8).
- **Tiền lệ so-sánh-giá-trị-thật để no-op** ([iot-devices.service.ts:235-248](../../../../src/modules/iot/services/iot-devices.service.ts)): gom `changes` bằng `newVal !== oldVal`, rỗng → `return device` **không save, không audit**. UC-91 dùng đúng cơ chế này (OQ-4).
  - ⚠ **Lệch có chủ đích**: `iot-devices` ném `400 NO_UPDATABLE_FIELDS` khi body không có field updatable nào ([:209-214](../../../../src/modules/iot/services/iot-devices.service.ts)). UC-91 **KHÔNG** làm vậy — chốt OQ-4 theo tiền lệ ANPR UC2: body rỗng cũng **no-op 200**. Ghi rõ trong JSDoc để người đọc sau không "sửa cho giống iot-devices".
- **Migration kế tiếp**: file cuối hiện tại là `20260722000001-SeedZoneCreatePermission.ts` ⇒ UC-91 dùng **`20260722000002-SeedZoneUpdatePermission.ts`**. `data-source.ts` glob `./migrations/*.{ts,js}` nên file mới tự nhận, không cần đăng ký.
- **`ZonesModule` KHÔNG cần sửa**: `AuthModule` + `controllers: [ZonesController]` + `providers: [ZonesService]` đã có từ UC-90 ⇒ thêm method/route không đụng wiring.
- **Mapper `toZoneResponse`** ([zone-response.dto.ts](../../../../src/modules/zones/dto/zone-response.dto.ts)) trả đủ 11 khoá snake_case, có `status`, không có `deleted_at` ⇒ dùng lại nguyên, **không** viết mapper mới cho UC-91.
- **`ZoneEntity.status`** khai `string` ([zone.entity.ts:47-48](../../../../src/modules/zones/entities/zone.entity.ts)), không phải union type ⇒ gán `ZoneStatus` vào `entity.status` compile được, không cần đổi entity (**cấm** đổi entity ở UC-91).

## 1. Quyết định đã chốt (OQ + Constitution)

OQ-1 **cho sửa TẤT CẢ field** (gồm `zone_code`, `zone_type`) · OQ-2 `ZONE_STATUSES = ['active','inactive']` trong `constants/zone-status.constant.ts` · OQ-3 **GỘP 1 route** `PATCH /zones/:id` (không tách `/status`, không `setStatus`, không `UpdateZoneStatusDto`) · OQ-4 **no-op 200** bằng **so sánh giá trị thật** · OQ-5 **1 permission** `zones.zone.update` → `SYSTEM_ADMIN` + `BUSINESS_ADMIN` · OQ-6 tái dùng `zoneCodeConflict()` + `isUniqueViolation()`, pre-check có `Not(id)` và chỉ chạy khi mã thực sự đổi · OQ-7 không mâu thuẫn mới · OQ-8 `undefined` giữ / `null` xoá / có giá trị gán, `metadata_json` replace toàn bộ · OQ-9 `ZONE_NOT_FOUND`.

- **Ràng buộc kèm OQ-1 (ghi vào JSDoc service)**: `zone_code` nay **vừa đổi được (UC-91) vừa tái dùng được sau soft-delete (UC-90 OQ-3)** ⇒ mọi báo cáo/truy vết lịch sử PHẢI khoá theo **`zone_id`**, **KHÔNG** theo `zone_code`.
- **SEC-02** route mutating → `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('zones.zone.update')`; thiếu decorator = **endpoint hở im lặng** (`PermissionsGuard` `return true` khi không metadata).
- **SEC-03** DTO `class-validator` + `ZONE_PIPE` tường minh; `:id` qua `ParseUUIDPipe`; chỉ dùng repository API.
- **DATA-01** mọi lookup lọc `deletedAt: IsNull()`; zone đã soft-delete → **404**, không "hồi sinh" ngầm.
- **ARCH-01** controller → service → repository; thêm vào file có sẵn, không tạo tầng mới.
- **ARCH-03 ĐẠT** — natural idempotency (`constitution.md:45-46`): PATCH cùng payload nhiều lần cho cùng kết quả (lần 2 trở đi rơi vào no-op), `UQ_zones_code_active` chặn trùng mã.
- **ENG-03** lỗi nghiệp vụ ném `{code, message}`; `23505` → 409 sạch; 0 stack ra client.
- **DATA-03 no-migration-schema** — migration duy nhất là seed permission.

## 2. Service — method thêm vào `ZonesService`

**File**: `src/modules/zones/services/zones.service.ts` (**Modified** — thêm 2 method, thêm import `Not`, `NotFoundException`).

### 2.1. `private async loadActive(id: string): Promise<ZoneEntity>`
- `repo.findOne({ where: { id, deletedAt: IsNull() } })` → null → `throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Không tìm thấy khu vực' })` (OQ-9).
- Fold existence + soft-delete vào 1 query. **Không** có phần ownership (zone là dữ liệu dùng chung — khác `loadOwned` của ANPR).
- Đặt `private` để UC-92 (xoá zone) tái dùng khi cần — cùng class nên gọi được.

### 2.2. `async update(id: string, dto: UpdateZoneDto): Promise<ZoneEntity>`
Thứ tự bước **bắt buộc**:

1. `const entity = await this.loadActive(id);` — 404 ở đây, trước mọi thứ khác.
2. **Gom `updates`** (chỉ field `!== undefined`), kiểu `Partial<Pick<ZoneEntity, 'zoneCode'|'zoneName'|'zoneType'|'status'|'building'|'floor'|'description'|'metadataJson'>>`:
   - `zoneCode`: nếu gửi → `normalizeZoneCode(dto.zoneCode)` **rồi mới** đưa vào `updates` (chuẩn hoá trước mọi so sánh — cấm trim/uppercase rời rạc);
   - `zoneName`, `zoneType`, `status`: gán thẳng (không nhận `null` — DTO đã chặn);
   - `building`, `floor`, `description`, `metadataJson`: gán thẳng, **giữ nguyên `null`** nếu client gửi `null` (OQ-8 — `null` = xoá).
3. **Pre-check trùng mã** — chỉ chạy khi `updates.zoneCode !== undefined && updates.zoneCode !== entity.zoneCode`:
   - `repo.findOne({ where: { zoneCode: updates.zoneCode, deletedAt: IsNull(), id: Not(id) } })` → có row → `throw zoneCodeConflict()`.
   - **`Not(id)` bắt buộc**: thiếu → PATCH gửi lại chính mã cũ tự đụng chính mình → 409 sai.
   - **Điều kiện "thực sự đổi" bắt buộc**: bỏ đi thì mỗi PATCH kèm `zone_code` không đổi vẫn tốn 1 query thừa (và với `Not(id)` thì vô hại nhưng lãng phí) — mirror tiền lệ `iot-devices`.
4. **Lọc field đổi giá trị thật** (OQ-4): duyệt `updates`, so `newVal !== oldVal` với `entity[key]`; gom danh sách key đổi.
   - `metadataJson` là object ⇒ so sánh tham chiếu sẽ **luôn khác**. Chấp nhận: gửi `metadata_json` = coi như có thay đổi (replace toàn bộ, OQ-8). Ghi rõ trong JSDoc để không ai tưởng là bug.
5. Nếu **không key nào đổi** → **`return entity`** ngay: KHÔNG `save`, `updated_at` không nhảy (OQ-4). Controller vẫn trả 200 + entity nguyên trạng.
6. `Object.assign(entity, <chỉ các field đã đổi>)` → `try { return await this.repo.save(entity) } catch (e) { if (this.isUniqueViolation(e)) throw zoneCodeConflict(); throw e; }` (OQ-6).
   - Lỗi DB khác `23505` **ném nguyên**, không nuốt thành 409.

- **KHÔNG** transaction, **KHÔNG** audit, **KHÔNG** `DataSource`/`queryRunner` (nợ giữ tới UC-92).
- **KHÔNG** có `setStatus` (OQ-3).
- **KHÔNG** đụng method `create` của UC-90.

## 3. DTO

### 3.1. `src/modules/zones/constants/zone-status.constant.ts` (net-new)
- `export const ZONE_STATUSES = ['active', 'inactive'] as const;` + `export type ZoneStatus = (typeof ZONE_STATUSES)[number];`
- Mirror y hệt style `zone-type.constant.ts` (`as const` + `@IsIn`, **không** TS `enum`) — nhất quán toàn module.
- JSDoc bắt buộc ghi: `inactive` = khu vực **ngừng sử dụng**; **FT-20/FT-21 sau này PHẢI tôn trọng** (không nhận event mới cho zone `inactive`); **UC-91 KHÔNG implement việc chặn đó**. Cột `status` là `varchar(30)` không CHECK ⇒ mở rộng giá trị sau **không cần migration**, chỉ sửa hằng số.

### 3.2. `src/modules/zones/dto/update-zone.dto.ts` (net-new) — `UpdateZoneDto`
Mọi field `@IsOptional`; `@Expose` + `@MaxLength` khớp đúng DB như `CreateZoneDto`.

| Property | Field API | Decorator | `null`? |
| :--- | :--- | :--- | :---: |
| `zoneCode?: string` | `zone_code` | `@Expose({name:'zone_code'}) @IsOptional @IsString @IsNotEmpty @MaxLength(80)` | ✗ |
| `zoneName?: string` | `zone_name` | `@Expose({name:'zone_name'}) @IsOptional @IsString @IsNotEmpty @MaxLength(150)` | ✗ |
| `zoneType?: ZoneType` | `zone_type` | `@Expose({name:'zone_type'}) @IsOptional @IsIn([...ZONE_TYPES])` | ✗ |
| `status?: ZoneStatus` | `status` | `@IsOptional @IsIn([...ZONE_STATUSES])` | ✗ |
| `building?: string \| null` | `building` | `@IsOptional @IsString @MaxLength(100)` | ✓ |
| `floor?: string \| null` | `floor` | `@IsOptional @IsString @MaxLength(30)` | ✓ |
| `description?: string \| null` | `description` | `@IsOptional @IsString @MaxLength(255)` | ✓ |
| `metadataJson?: Record<string, unknown> \| null` | `metadata_json` | `@Expose({name:'metadata_json'}) @IsOptional @IsObject` | ✓ |

- **Cơ chế cho phép `null`**: `class-validator` `@IsOptional()` bỏ qua validate khi giá trị là `null` **hoặc** `undefined` ⇒ 4 field nullable tự động nhận `null` mà không cần decorator thêm. Ngược lại, 4 field **không** cho `null` cần chặn tường minh — cách rẻ nhất là `@IsNotEmpty()` (cho `zone_code`/`zone_name`) và `@IsIn([...])` (cho `zone_type`/`status`, vì `null` không nằm trong danh sách nên sẽ **fail validate**). ⚠ Nhưng `@IsOptional()` sẽ **bỏ qua cả hai** khi giá trị là `null` ⇒ **phải dùng `@ValidateIf((_, v) => v !== undefined)` thay cho `@IsOptional()`** ở 4 field không-nullable, để `null` bị validate và trả 400. Đây là điểm dễ sai nhất của DTO này — tasks phải có test riêng.
- **KHÔNG** khai `id`/`created_at`/`updated_at`/`deleted_at` — `whitelist:true` loại sạch.
- **KHÔNG** tạo `UpdateZoneStatusDto` (OQ-3).
- Response: dùng lại `toZoneResponse` — **không** thêm file mapper.

## 4. Controller — route thêm vào `ZonesController`

**File**: `src/modules/zones/controllers/zones.controller.ts` (**Modified** — thêm 1 route + 3 import).

```text
PATCH /api/v1/zones/:id
```
- `@Patch(':id')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('zones.zone.update')` · `@UsePipes(ZONE_PIPE)`.
- Tham số: `@Param('id', ParseUUIDPipe) id: string`, `@Body() dto: UpdateZoneDto`.
- Handler: `zonesService.update(id, dto)` → envelope inline `{ success: true, message: 'Zone updated successfully', data: toZoneResponse(entity) }`.
- **KHÔNG** `@HttpCode(...)`: PATCH mặc định 200 trong Nest — đúng yêu cầu.
- **KHÔNG** `@CurrentUser()` (service không nhận actor, chưa audit).

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| Cập nhật thành công | `200` | — |
| Không field nào đổi giá trị thật (kể cả body rỗng) | `200` (no-op, không `save`) | — |
| DTO sai: giá trị ngoài `ZONE_TYPES`/`ZONE_STATUSES`, vượt `MaxLength`, `null` cho field không-nullable, `zone_name`/`zone_code` rỗng | `400` | (Nest validation) |
| `:id` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission `zones.zone.update` | `403` | `FORBIDDEN` (guard) |
| Zone không tồn tại / đã soft-delete | `404` | `ZONE_NOT_FOUND` |
| Đổi `zone_code` trùng zone đang sống khác (pre-check hoặc race 23505) | `409` | `ZONE_CODE_EXISTS` |

## 5. File list

### Net-new
**Code (3)**
- `src/modules/zones/constants/zone-status.constant.ts`
- `src/modules/zones/dto/update-zone.dto.ts`
- `src/database/migrations/20260722000002-SeedZoneUpdatePermission.ts` — seed `zones.zone.update` (`module_code='zones'`, `action_code='update'`), gán `SYSTEM_ADMIN` + `BUSINESS_ADMIN`; `up()` idempotent (`ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT`; `role_permissions` `ON CONFLICT DO NOTHING`), `down()` xoá `role_permissions` trước rồi `permissions`. Copy nguyên pattern [20260722000001-SeedZoneCreatePermission.ts](../../../../src/database/migrations/20260722000001-SeedZoneCreatePermission.ts). **Đặt trong `migrations/`, KHÔNG đặt trong `seeds/`.**

**Test (1)**
- `src/modules/zones/dto/update-zone.dto.spec.ts`

### Modified
- `src/modules/zones/services/zones.service.ts` — thêm `loadActive` + `update`; thêm import `Not` (typeorm) và `NotFoundException` (@nestjs/common). **KHÔNG** đụng `create`, `zoneCodeConflict`, `isUniqueViolation`.
- `src/modules/zones/services/zones.service.spec.ts` — thêm `describe` cho `update` (giữ nguyên 8 test của UC-90).
- `src/modules/zones/controllers/zones.controller.ts` — thêm route `@Patch(':id')` + import `Patch`, `Param`, `ParseUUIDPipe`. **KHÔNG** đụng route `POST`.
- `src/modules/zones/controllers/zones.controller.spec.ts` — thêm test cho route PATCH (giữ nguyên 4 test của UC-90).

> Tổng **4 net-new (3 code + 1 test) + 4 modified (2 code + 2 test)** = **8 file**. **0 migration schema** · `zones.module.ts` **KHÔNG đổi** (wiring đủ từ UC-90) · `zone.entity.ts`, `zone-response.dto.ts`, `zone-type.constant.ts`, `normalize-zone-code.ts`, `create-zone.dto.ts` **KHÔNG đổi** · `app.module.ts`, `data-source.ts` **KHÔNG đổi**.

## 6. Test (mock repo — KHÔNG DB)

**`zones.service.spec.ts`** — `describe('update')`, mock `{ findOne, save }` (thêm `save` trả entity đã merge):
1. **Happy path** → đổi `zone_name` + `building` → `save` gọi 1 lần, entity mang giá trị mới, các field khác giữ nguyên.
2. **404 — zone không tồn tại**: `findOne` (lượt load) trả `null` → `NotFoundException` `{code:'ZONE_NOT_FOUND'}`; assert **`save` KHÔNG gọi**.
3. **404 — zone đã soft-delete**: assert `findOne` được gọi với `where` chứa `deletedAt: IsNull()` (bản ghi đã xoá không lọt) → 404; `save` không gọi.
4. **Đổi `zone_code` sang mã của zone khác → 409**: `findOne` lượt 1 trả entity, lượt 2 (pre-check) trả row khác → `ConflictException` `{code:'ZONE_CODE_EXISTS'}`; `save` không gọi. Assert pre-check `where` có **`id: Not(id)`** và `deletedAt: IsNull()`.
5. **Gửi lại đúng `zone_code` của chính nó → KHÔNG 409** (bảo vệ `Not(id)` + điều kiện "thực sự đổi"): entity đang `GATE-01`, dto gửi `'gate-01'` (chuẩn hoá ra `GATE-01`) → assert **`findOne` chỉ được gọi 1 lần** (không chạy pre-check) và **không** ném 409. Nếu không đổi field nào khác → no-op 200.
6. **Race `23505`**: pre-check pass (`findOne` lượt 2 trả `null`) nhưng `save` reject `{driverError:{code:'23505'}}` → `ConflictException ZONE_CODE_EXISTS`, **cùng payload** case 4; assert không rò `'23505'`/`'duplicate key'`.
7. **Lỗi DB khác** (`'23503'`) → ném **nguyên lỗi**, không thành 409.
8. **No-op — body rỗng** → `save` **KHÔNG** gọi, trả entity nguyên trạng.
9. **No-op — gửi đúng giá trị đang có** (`zone_name` trùng giá trị hiện tại) → `save` **KHÔNG** gọi (chứng minh so-sánh-giá-trị-thật, không chỉ dựa `undefined`).
10. **`undefined` giữ nguyên**: chỉ gửi `zone_name` → assert `building`/`floor`/`description`/`metadataJson`/`zoneType`/`status` **không** bị đụng.
11. **`null` xoá giá trị**: gửi `building: null` trên entity đang có `building='A'` → entity sau update có `building === null`, `save` được gọi.
12. **Chuẩn hoá `zone_code`**: gửi `'  gate-02  '` → giá trị dùng cho **cả** pre-check **và** `save` đều là `'GATE-02'`.
13. **`metadata_json` replace**: entity đang `{a:1}`, gửi `{b:2}` → sau update là `{b:2}` (không merge thành `{a:1,b:2}`).

**`update-zone.dto.spec.ts`** — `plainToInstance` + `validate` cho các case validate; `ValidationPipe.transform` cho case whitelist (mirror UC-90):
- body rỗng `{}` → **0 lỗi** (mọi field optional);
- `zone_type: 'garden'` → lỗi `isIn`; `status: 'disabled'` → lỗi `isIn` (chỉ `active`/`inactive`);
- `zone_code` 81 ký tự / `zone_name` 151 / `building` 101 / `floor` 31 / `description` 256 → lỗi `maxLength`;
- `zone_code: ''` / `zone_name: ''` → lỗi `isNotEmpty`;
- **`null` cho field không-nullable** (`zone_code`, `zone_name`, `zone_type`, `status`) → **có lỗi validate** (test bảo vệ quyết định `@ValidateIf` ở §3.2 — đây là điểm dễ sai nhất);
- **`null` cho field nullable** (`building`, `floor`, `description`, `metadata_json`) → **0 lỗi**;
- whitelist qua `new ValidationPipe({whitelist:true, transform:true}).transform(body, {type:'body', metatype: UpdateZoneDto})` với body chứa `id`/`created_at`/`deleted_at` → 3 field lạ bị loại, field hợp lệ còn nguyên.

**`zones.controller.spec.ts`** — thêm:
- route PATCH gọi `service.update(id, dto)` đúng 1 lần; envelope `{success:true, message:'Zone updated successfully', data}` qua `toZoneResponse`; không lộ `deleted_at`;
- assert metadata `PERMISSIONS_KEY` của handler PATCH = `['zones.zone.update']` + guard list có `JwtAuthGuard` và `PermissionsGuard`;
- service ném `NotFoundException`/`ConflictException` → controller **không nuốt**, propagate nguyên trạng;
- **route POST của UC-90 không hồi quy** (4 test cũ vẫn xanh).

**`:id` không phải UUID → 400**: do `ParseUUIDPipe` ở tầng framework — kiểm bằng assert metadata pipe của param (hoặc gọi trực tiếp `new ParseUUIDPipe().transform('abc', {type:'param'})` rejects). **Không** dựng e2e/HTTP thật.

**Nguyên tắc**: 100% mock repository/service; **KHÔNG** kết nối DB, **KHÔNG** chạy migration.

## 7. Gate (STOP, KHÔNG commit)

Điều kiện đóng plan → chỉ sang `tasks.md` **sau khi Thiếu Chủ duyệt plan này**.

Gate dự kiến khi code (ghi để tasks bám theo, **chưa chạy gì ở bước này**):
- `npm run build` = 0 error; eslint trên **8 file touched** = 0 rule mới;
- `npx jest src/modules/zones` xanh — gồm **cả 23 test của UC-90 không hồi quy** + test mới của UC-91;
- coverage `ZonesService` ≥80% (ENG-01);
- **DI-proof**: `AppModule` compile (preview mode) — 0 `UnknownDependenciesException`, 0 circular. Kỳ vọng không đổi vì wiring không đụng, nhưng vẫn phải chạy vì service/controller đổi;
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS chung · **KHÔNG** live smoke · **KHÔNG** commit.
- **Bàn giao**: muốn gọi thử `PATCH /api/v1/zones/:id` trên local thì phải chạy `20260722000002` (seed permission) trước; thiếu → **403 `FORBIDDEN`**, không phải lỗi code. Local hiện **chưa có bảng `zones`** (ghi nhận từ UC-90 T0) nên còn cần `20260721000001` trước đó nữa — **chỉ local, KHÔNG RDS**.

**Owed (ghi, KHÔNG làm)**: UC-92 xoá zone **+ audit cho cả cụm zone (nợ OQ-8 của UC-90, nay nặng hơn vì UC-91 cho sửa mã/loại/trạng thái mà không lưu dấu vết ai sửa)** · UC-93 list/detail (FE vẫn chưa có cách lấy `id`) · UC-94 gán camera · FT-20/FT-21 tôn trọng `status='inactive'` · snapshot `zone_type` tại thời điểm sinh log · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.

## 8. Kỷ luật

- **No-migration-schema**: cấm `CREATE/ALTER` trên bảng `zones` (kể cả thêm `updated_by`, kể cả CHECK cho `status`). Migration duy nhất = seed permission.
- **No-audit / No-DataSource / No-transaction** — nợ giữ tới UC-92; ai thêm `queryRunner` là lệch quyết định.
- **`deletedAt: IsNull()` trong MỌI lookup** (AGENTS.md §5.5 rule 1).
- **`Not(id)` + điều kiện "mã thực sự đổi"** là bắt buộc ở pre-check (OQ-6) — bỏ `Not(id)` là bug 409 giả.
- **1 nguồn chuẩn hoá**: mọi nơi đụng `zone_code` gọi `normalizeZoneCode`; cấm trim/uppercase rời rạc.
- **No-op bằng so sánh giá trị thật** (OQ-4), **không** ném `400 NO_UPDATABLE_FIELDS` như `iot-devices`.
- **1 route, 1 permission** (OQ-3, OQ-5): cấm tạo route `/status`, cấm tạo `setStatus`, cấm seed permission thứ hai.
- **Không đổi** `zone.entity.ts`, `zones.module.ts`, `zone-response.dto.ts`, `create-zone.dto.ts`, `normalize-zone-code.ts`, `zone-type.constant.ts`, `app.module.ts`, `data-source.ts`.
- **Không đụng** `create()` của UC-90 và 23 test đã xanh.
- KHÔNG WebSocket/notification · KHÔNG đụng `gate_access_logs`, `zone_presence_events`, `vehicle_control_list`, `rooms`, `iot_devices`.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
