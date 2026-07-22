# ZNU-001 — tasks.md (UC-91 Zones: cập nhật khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo tasks ZNU-001 sau plan DUYỆT: T0 verify → T1 constant `ZONE_STATUSES` → T2 DTO (**`@ValidateIf` cho 4 field không-nullable — BẮT BUỘC, sai là `zone_code` thành chuỗi `"NULL"`**) → T3 service (`loadActive` + `update`, crux `Not(id)` + so-sánh-giá-trị-thật) → T4 controller route PATCH → T5 migration seed permission → T-GATE. Mỗi task 1 AC, code/test tách. KHÔNG task wiring module (đã đủ từ UC-90). No-migration-schema, no-audit, no-DataSource. | Toàn bộ |
| 2026-07-22 | Review phát hiện T3b **thiếu test dương** cho đúng 2 quyết định trọng tâm UC-91: OQ-1 (cho sửa `zone_type`) và OQ-3 (gộp `status` vào cùng route) — 13 case cũ chỉ chứng minh 2 field này *không bị đụng* khi không gửi (case 10). Bổ sung **case 14 (đổi `status`)** và **case 15 (đổi `zone_type`)**; tổng service test UC-91 = **15 case**. | T3b (thêm case 14/15 + cập nhật AC) |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại plan §1 (OQ-1→OQ-9) và plan §8 (Kỷ luật). **KHÔNG** sửa `zone.entity.ts`, `zones.module.ts`, `zone-response.dto.ts`, `create-zone.dto.ts`, `normalize-zone-code.ts`, `zone-type.constant.ts`, `app.module.ts`, `data-source.ts`. **KHÔNG** đụng `create()` của UC-90 và các test đã xanh.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T-GATE.

> Phụ thuộc: constant **trước** DTO (DTO import `ZONE_STATUSES`) · DTO **trước** service (service nhận `UpdateZoneDto`) · service **trước** controller · migration độc lập nhưng phải **cùng commit** với controller (thiếu = 403).

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu tiên. Đọc CODE THẬT, dán xác nhận từng mục. **Thiếu mục / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **`ZonesController` import hiện tại** ([zones.controller.ts:1-10](../../../../src/modules/zones/controllers/zones.controller.ts)): xác nhận **chưa có** `Patch`, `Param`, `ParseUUIDPipe` (mới có `Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UsePipes, ValidationPipe`) → T4 phải bổ sung 3 import. Xác nhận hằng `ZONE_PIPE` ([:19](../../../../src/modules/zones/controllers/zones.controller.ts)) tồn tại → **dùng lại**, cấm tạo pipe thứ hai.
2. **`zones.service.ts` import hiện tại** ([zones.service.ts:1-6](../../../../src/modules/zones/services/zones.service.ts)): xác nhận **chưa có** `Not` (từ `typeorm`, hiện chỉ `Repository, IsNull`) và **chưa có** `NotFoundException` (từ `@nestjs/common`, hiện chỉ `Injectable, ConflictException`) → T3 phải bổ sung. Xác nhận `zoneCodeConflict()` là hàm **module-level** ([:12-16](../../../../src/modules/zones/services/zones.service.ts)) và `isUniqueViolation()` là `private` **cùng class** ([:67-72](../../../../src/modules/zones/services/zones.service.ts)) → method mới gọi được, **KHÔNG** đổi visibility, **KHÔNG** copy lại logic.
3. **`ZoneEntity.status` khai kiểu `string`** ([zone.entity.ts:47-48](../../../../src/modules/zones/entities/zone.entity.ts)), không phải union → gán `ZoneStatus` compile được ⇒ **KHÔNG** sửa entity (cấm theo plan §8).
4. **Timestamp migration**: xác nhận file cuối trong `src/database/migrations/` là `20260722000001-SeedZoneCreatePermission.ts` → chốt `20260722000002` cho T5. Nếu đã tồn tại file `20260722000002*` do người khác thêm → **chọn số kế tiếp chưa dùng và ghi rõ trong báo cáo**.
5. **Baseline test UC-90**: chạy đếm (hoặc đọc) số suite/test hiện có trong `src/modules/zones` để T-GATE đối chiếu không hồi quy. **Baseline kỳ vọng: 4 suite / 23 test** (`normalize-zone-code.spec`, `create-zone.dto.spec`, `zones.service.spec`, `zones.controller.spec`). Lệch con số này → ghi nhận và báo trước khi code.
6. **`ZonesModule` đã đủ wiring** ([zones.module.ts](../../../../src/modules/zones/zones.module.ts)): có `AuthModule` trong `imports`, `controllers: [ZonesController]`, `providers: [ZonesService]` → UC-91 **KHÔNG** sửa module. Nếu thiếu bất kỳ mục nào → DỪNG, báo (nghĩa là UC-90 bị regress).

- **AC**: dán xác nhận đủ **6 mục** kèm bằng chứng (path + trích dẫn ngắn); mục 4 ghi rõ timestamp chốt; mục 5 ghi rõ số suite/test baseline.

## T1 — Constant `ZONE_STATUSES` (code) — plan §3.1, OQ-2
- `src/modules/zones/constants/zone-status.constant.ts`: `export const ZONE_STATUSES = ['active', 'inactive'] as const;` + `export type ZoneStatus = (typeof ZONE_STATUSES)[number];`
- Mirror **y hệt** style `zone-type.constant.ts` (`as const` + dùng với `@IsIn`, **KHÔNG** TS `enum`) — nhất quán toàn module.
- JSDoc bắt buộc ghi: `active` = khu vực đang sử dụng, **`inactive` = khu vực ngừng sử dụng**; **FT-20/FT-21 sau này PHẢI tôn trọng** (không nhận event mới cho zone `inactive`) nhưng **UC-91 KHÔNG implement việc chặn đó**; cột `status` là `varchar(30)` **không CHECK** ⇒ mở rộng giá trị sau **không cần migration**, chỉ sửa hằng số này.
- **AC**: file tồn tại, đúng 2 giá trị lowercase, export cả hằng và type, JSDoc có đủ 3 ý trên; 0 import từ `@nestjs/*`.

## T2 — DTO `UpdateZoneDto` (code) — plan §3.2, OQ-1/2/8, SEC-03
`src/modules/zones/dto/update-zone.dto.ts` — 8 field, tất cả đều **optional theo nghĩa "không gửi thì bỏ qua"**, `@Expose` + `@MaxLength` khớp đúng DB.

**⚠ CRUX của task này — 2 nhóm decorator KHÁC NHAU, không được dùng lẫn:**

| Nhóm | Field | Decorator "optional" | Ghi chú |
| :--- | :--- | :--- | :--- |
| **KHÔNG nhận `null`** | `zone_code`, `zone_name`, `zone_type`, `status` | **`@ValidateIf((_, v) => v !== undefined)`** | **BẮT BUỘC**, KHÔNG dùng `@IsOptional()` |
| **Nhận `null`** (= xoá giá trị) | `building`, `floor`, `description`, `metadata_json` | `@IsOptional()` | Bình thường |

**Lý do BẮT BUỘC (đã kiểm chứng bằng thực nghiệm):** `@IsOptional()` bỏ qua validate khi giá trị là **`null`** lẫn `undefined`. Nếu để `@IsOptional()` trên `zone_code`, request `{"zone_code": null}` sẽ **lọt validate**; ở service `null !== undefined` là `true` nên `null` lọt vào `updates`; `normalizeZoneCode(null)` = `String(null).trim().toUpperCase()` = **`"NULL"`** ⇒ `zone_code` bị ghi thành chuỗi `"NULL"` — **hỏng dữ liệu âm thầm, không lỗi nào báo**. `@ValidateIf((_, v) => v !== undefined)` bắt được `null` (trả 400) trong khi vẫn bỏ qua `undefined`.

Chi tiết field:
- `zoneCode?` ← `zone_code`: `@Expose({name:'zone_code'})` + `@ValidateIf(...)` + `@IsString @IsNotEmpty @MaxLength(80)`;
- `zoneName?` ← `zone_name`: `@Expose` + `@ValidateIf(...)` + `@IsString @IsNotEmpty @MaxLength(150)`;
- `zoneType?` ← `zone_type`: `@Expose` + `@ValidateIf(...)` + `@IsIn([...ZONE_TYPES])`;
- `status?`: `@ValidateIf(...)` + `@IsIn([...ZONE_STATUSES])`;
- `building?`/`floor?`/`description?`: `@IsOptional @IsString @MaxLength(100|30|255)`, kiểu `string | null`;
- `metadataJson?` ← `metadata_json`: `@Expose` + `@IsOptional @IsObject`, kiểu `Record<string, unknown> | null`.
- **KHÔNG** khai `id`/`created_at`/`updated_at`/`deleted_at`. **KHÔNG** `@Transform` trim (chuẩn hoá tập trung ở service — T3). **KHÔNG** tạo `UpdateZoneStatusDto` (OQ-3).
- **AC**: đúng 8 field; 4 field không-nullable dùng `@ValidateIf`, **0 chỗ dùng `@IsOptional()` cho 4 field đó**; 4 field nullable dùng `@IsOptional()` và khai kiểu `| null`; độ dài khớp DB (80/150/100/30/255); không có field cấm.

## T2b — DTO test — OQ-2, OQ-8, SEC-03
`src/modules/zones/dto/update-zone.dto.spec.ts` — các case validate dùng `plainToInstance` + `validate`; case whitelist dùng `ValidationPipe.transform` (mirror UC-90 T2b):
- body rỗng `{}` → **0 lỗi** (mọi field optional);
- **`null` cho 4 field không-nullable** (`zone_code`, `zone_name`, `zone_type`, `status`) → **CÓ lỗi validate** — 4 assert riêng, đây là test bảo vệ crux của T2;
- **`null` cho 4 field nullable** (`building`, `floor`, `description`, `metadata_json`) → **0 lỗi**;
- `zone_type: 'garden'` → lỗi `isIn`; `status: 'disabled'` → lỗi `isIn` (chỉ `active`/`inactive`);
- `zone_code` 81 / `zone_name` 151 / `building` 101 / `floor` 31 / `description` 256 ký tự → lỗi `maxLength`;
- `zone_code: ''` / `zone_name: ''` → lỗi `isNotEmpty`;
- whitelist: `new ValidationPipe({whitelist:true, transform:true}).transform(body, {type:'body', metatype: UpdateZoneDto})` với body chứa `id`/`created_at`/`deleted_at` → 3 field lạ bị loại, field hợp lệ còn nguyên.
- **AC**: 7 nhóm case xanh; **bắt buộc** có 4 assert `null` → lỗi và 4 assert `null` → không lỗi (phân biệt rõ 2 nhóm).

## T3 — Service `loadActive` + `update` (code) — plan §2, OQ-1/4/6/8/9, DATA-01, ENG-03
Thêm vào `src/modules/zones/services/zones.service.ts` (**KHÔNG** đụng `create`, `zoneCodeConflict`, `isUniqueViolation`); bổ sung import `Not` (typeorm) + `NotFoundException` (@nestjs/common).

**`private async loadActive(id: string): Promise<ZoneEntity>`**
- `repo.findOne({ where: { id, deletedAt: IsNull() } })` → null → `throw new NotFoundException({ code: 'ZONE_NOT_FOUND', message: 'Không tìm thấy khu vực' })` (OQ-9).
- Fold existence + soft-delete vào 1 query. **KHÔNG** có phần ownership (zone là dữ liệu dùng chung).

**`async update(id: string, dto: UpdateZoneDto): Promise<ZoneEntity>`** — đúng thứ tự 6 bước:
1. `const entity = await this.loadActive(id);` — 404 trước mọi thứ khác.
2. Gom `updates` từ field `!== undefined`; **`zoneCode` phải qua `normalizeZoneCode` NGAY tại bước này** (trước mọi so sánh) — cấm trim/uppercase rời rạc. `building`/`floor`/`description`/`metadataJson` **giữ nguyên `null`** nếu client gửi `null` (OQ-8).
3. **Pre-check trùng mã (crux)** — chỉ chạy khi `updates.zoneCode !== undefined` **và** `updates.zoneCode !== entity.zoneCode`: `repo.findOne({ where: { zoneCode: updates.zoneCode, deletedAt: IsNull(), id: Not(id) } })` → có row → `throw zoneCodeConflict()`.
   - **`Not(id)` bắt buộc**: thiếu → PATCH gửi lại chính mã cũ tự đụng chính mình → **409 giả**.
   - **Điều kiện "mã thực sự đổi" bắt buộc** — mirror tiền lệ `iot-devices` ([:216-233](../../../../src/modules/iot/services/iot-devices.service.ts)).
4. **Lọc field đổi giá trị thật** (OQ-4): so `newVal !== oldVal` với `entity[key]`, mirror `changes` ([iot-devices.service.ts:235-248](../../../../src/modules/iot/services/iot-devices.service.ts)).
   - JSDoc ghi rõ: `metadataJson` là object nên so sánh tham chiếu **luôn khác** ⇒ gửi `metadata_json` luôn coi là có thay đổi (đúng ngữ nghĩa replace toàn bộ, OQ-8) — **không phải bug**.
5. Không key nào đổi → **`return entity`**: KHÔNG `save`, `updated_at` không nhảy (OQ-4).
   - JSDoc ghi rõ **lệch có chủ đích**: `iot-devices` ném `400 NO_UPDATABLE_FIELDS` khi body rỗng; UC-91 theo tiền lệ ANPR UC2 là **no-op 200** — không được "sửa cho giống iot-devices".
6. `Object.assign` các field đã đổi → `try { return await repo.save(entity) } catch (e) { if (this.isUniqueViolation(e)) throw zoneCodeConflict(); throw e; }`. Lỗi khác `23505` **ném nguyên**.
- **KHÔNG** transaction/audit/`DataSource`/`queryRunner`; **KHÔNG** method `setStatus`; JSDoc ghi ràng buộc OQ-1: báo cáo lịch sử phải khoá theo **`zone_id`**, KHÔNG theo `zone_code` (mã nay vừa đổi được vừa tái dùng được).
- **AC**: `update` đủ 6 bước đúng thứ tự; pre-check có **cả** `Not(id)` **và** điều kiện mã thực sự đổi; no-op dựa trên **so sánh giá trị thật**; 2 nhánh conflict dùng chung `zoneCodeConflict()`; 0 `DataSource`, 0 audit, 0 `setStatus`; `create()` không bị sửa.

## T3b — Service test (mock repo — KHÔNG DB) — plan §6, ENG-01
Thêm `describe('update')` vào `src/modules/zones/services/zones.service.spec.ts` (**giữ nguyên** các test UC-90). Phủ đủ **13 case** plan §6:
1. Happy path: đổi `zone_name` + `building` → `save` 1 lần, field khác giữ nguyên.
2. **404 zone không tồn tại**: `findOne` lượt load → `null` → `ZONE_NOT_FOUND`; assert **`save` KHÔNG gọi**.
3. **404 zone đã soft-delete**: assert `findOne` lượt load có `where` chứa `deletedAt: IsNull()` → 404; `save` không gọi.
4. **Đổi `zone_code` trùng zone khác → 409**: `findOne` lượt 2 trả row → `ZONE_CODE_EXISTS`; `save` không gọi; assert pre-check `where` có **`id: Not(id)`** và `deletedAt: IsNull()`.
5. **Gửi lại đúng `zone_code` của chính nó → KHÔNG 409** (bảo vệ `Not(id)` + điều kiện thực-sự-đổi): entity `GATE-01`, dto gửi `'gate-01'` → assert `findOne` **chỉ gọi 1 lần** (không chạy pre-check), không ném 409.
6. **Race `23505`**: pre-check pass nhưng `save` reject `{driverError:{code:'23505'}}` → `ZONE_CODE_EXISTS` **cùng payload** case 4; assert không rò `'23505'`/`'duplicate key'`.
7. **Lỗi DB khác** (`'23503'`) → ném **nguyên lỗi**, không thành 409.
8. **No-op body rỗng** → `save` **KHÔNG** gọi, trả entity nguyên trạng.
9. **No-op gửi đúng giá trị đang có** (`zone_name` trùng) → `save` **KHÔNG** gọi (chứng minh so-sánh-giá-trị-thật).
10. **`undefined` giữ nguyên**: chỉ gửi `zone_name` → `building`/`floor`/`description`/`metadataJson`/`zoneType`/`status` không bị đụng.
11. **`null` xoá giá trị**: entity có `building='A'`, gửi `building: null` → sau update `building === null`, `save` được gọi.
12. **Chuẩn hoá `zone_code`**: gửi `'  gate-02  '` → giá trị dùng cho **cả** pre-check **và** `save` đều là `'GATE-02'`.
13. **`metadata_json` replace**: entity `{a:1}`, gửi `{b:2}` → kết quả `{b:2}` (KHÔNG merge thành `{a:1,b:2}`).
14. **Đổi `status` (test dương cho OQ-3)**: entity `status='active'`, dto `{ status: 'inactive' }` → `save` **được gọi**; sau update `status === 'inactive'`; field khác giữ nguyên.
15. **Đổi `zone_type` (test dương cho OQ-1)**: entity `zoneType='room'`, dto `{ zone_type: 'gate' }` → `save` **được gọi**; sau update `zoneType === 'gate'`.
- **AC**: **15 case** xanh; case 5 và case 9 bắt buộc có mặt (bảo vệ 2 crux `Not(id)` + so-sánh-giá-trị-thật); **case 14 và 15 bắt buộc có mặt** (test dương cho 2 quyết định trọng tâm UC-91: cho sửa `zone_type` — OQ-1, và `status` đi chung route — OQ-3; case 10 chỉ chứng minh chúng *không bị đụng* khi không gửi, không thay thế được); test UC-90 cũ không hồi quy; coverage `ZonesService` ≥80%.

## T4 — Controller route `PATCH /zones/:id` (code) — plan §4, OQ-3/5/9, SEC-02
Thêm vào `src/modules/zones/controllers/zones.controller.ts` (**KHÔNG** đụng route `POST`); bổ sung import `Patch`, `Param`, `ParseUUIDPipe` từ `@nestjs/common`.
- `@Patch(':id')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · **`@RequirePermissions('zones.zone.update')`** · `@UsePipes(ZONE_PIPE)` (dùng lại hằng có sẵn).
- Tham số: `@Param('id', ParseUUIDPipe) id: string`, `@Body() dto: UpdateZoneDto`.
- Handler → `zonesService.update(id, dto)` → envelope inline `{ success: true, message: 'Zone updated successfully', data: toZoneResponse(entity) }`.
- **KHÔNG** `@HttpCode(...)` (PATCH mặc định 200). **KHÔNG** `@CurrentUser()`. **KHÔNG** route `/status` (OQ-3). **KHÔNG** mapper mới — dùng `toZoneResponse` có sẵn.
- ⚠ Quên `@RequirePermissions` = **endpoint hở im lặng** (`PermissionsGuard` `return true` khi không có metadata).
- **AC**: đúng 1 route mới `PATCH /api/v1/zones/:id`; có đủ 2 guard + `@RequirePermissions('zones.zone.update')` + `ZONE_PIPE` + `ParseUUIDPipe`; envelope đúng 3 khoá với message `'Zone updated successfully'`; route POST không bị sửa.

## T4b — Controller test — SEC-02, ENG-03
Thêm vào `src/modules/zones/controllers/zones.controller.spec.ts` (**giữ nguyên** test UC-90):
- route PATCH gọi `service.update(id, dto)` đúng 1 lần; envelope `{success:true, message:'Zone updated successfully', data}` qua `toZoneResponse`; **không lộ `deleted_at`**;
- **assert metadata**: `Reflect.getMetadata(PERMISSIONS_KEY, controller.update)` = `['zones.zone.update']`; guard list chứa `JwtAuthGuard` **và** `PermissionsGuard`;
- service ném `NotFoundException` → propagate nguyên trạng (controller không nuốt);
- service ném `ConflictException` → propagate nguyên trạng;
- **`:id` không phải UUID → 400**: kiểm ở mức pipe — `new ParseUUIDPipe().transform('abc', { type: 'param' })` rejects. **KHÔNG** dựng e2e/HTTP thật;
- **không hồi quy**: các test route POST của UC-90 vẫn xanh.
- **AC**: 5 nhóm case xanh; assert metadata permission bắt buộc có mặt; test POST cũ không đổi.

## T5 — Migration seed permission (code) — plan §5, OQ-5, SEC-02
- File: **`src/database/migrations/20260722000002-SeedZoneUpdatePermission.ts`** (timestamp chốt ở T0 mục 4), class `SeedZoneUpdatePermission20260722000002` + field `name` trùng tên class.
- **Đặt trong `migrations/`, TUYỆT ĐỐI KHÔNG đặt trong `src/database/seeds/`** (folder `seeds/` không có runner — AGENTS.md §5.5 rule 4) → sai chỗ thì seed không chạy và mọi request trả 403.
- Copy **nguyên pattern** [20260722000001-SeedZoneCreatePermission.ts](../../../../src/database/migrations/20260722000001-SeedZoneCreatePermission.ts):
  - `permission = { code: 'zones.zone.update', name: <ASCII không dấu>, module: 'zones', action: 'update', description: <ASCII không dấu> }`;
  - `roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (OQ-5) — **CẤM** `ADMIN`/`INTERNAL_USER` (mã lỗi thời, không khớp `role_code` → im lặng không insert);
  - `up()`: INSERT `permissions ... ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id` → `return` nếu vẫn không có → với mỗi role: INSERT `role_permissions ... SELECT r.id FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING`;
  - `down()`: xoá `role_permissions` theo `permission_id IN (SELECT id ... WHERE permission_code = $1)` **trước**, rồi `DELETE FROM permissions`.
- **CHỈ 1 permission** (OQ-5) — cấm seed thêm `zones.zone.set_status`. Chỉ tạo file, **KHÔNG chạy** `migration:run`.
- **AC**: file đúng tên/vị trí; `permission_code='zones.zone.update'`, `module_code='zones'`, `action_code='update'`; đúng 2 role; `up()` idempotent (chạy lại không lỗi/không nhân bản); `down()` đúng thứ tự xoá.

## T-GATE — (STOP, KHÔNG commit) — plan §7
- `npm run build` = **0 error**.
- eslint trên **8 file touched** (4 net-new: constant + DTO + DTO spec + migration; 4 modified: service + service spec + controller + controller spec) = **0 rule mới**, file mới 0 lỗi.
- `npx jest src/modules/zones` **xanh** — **gồm cả test UC-90 KHÔNG hồi quy**: đối chiếu với baseline ghi ở **T0 mục 5** (kỳ vọng 4 suite / 23 test cũ, cộng thêm test mới của UC-91). Số test cũ giảm hoặc fail → DỪNG, không được sửa test cũ cho qua.
- Coverage `ZonesService` **≥80%** (ENG-01).
- **DI-proof**: compile `AppModule` ở **preview mode** — 0 `UnknownDependenciesException`, 0 circular. Vẫn phải chạy dù wiring không đổi, vì service/controller có thay đổi. Throwaway (nếu có) **xoá sạch** trước khi báo cáo.
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS chung · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file đầy đủ + kết quả jest + coverage + báo cáo gate.
- **Bàn giao**: muốn gọi thử `PATCH /api/v1/zones/:id` trên local thì phải chạy seed permission **`20260722000002`** trước; thiếu → **403 `FORBIDDEN`**, đó là thiếu permission trong DB, **không phải lỗi code**. Local hiện **chưa có bảng `zones`** (ghi nhận từ UC-90 T0) nên cần chạy `20260721000001` trước nữa — **chỉ local, KHÔNG RDS**.
- **Owed (ghi, KHÔNG làm)**: UC-92 xoá zone **+ audit cho cả cụm zone** (nợ OQ-8 của UC-90, nay nặng hơn vì UC-91 cho sửa mã/loại/trạng thái mà **không lưu dấu vết ai sửa**) · UC-93 list/detail (FE vẫn chưa có cách lấy `id`) · UC-94 gán camera · FT-20/FT-21 tôn trọng `status='inactive'` · snapshot `zone_type` tại thời điểm sinh log · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.
- **AC**: bảng gate đầy đủ + báo cáo tick: `@ValidateIf` chặn `null` cho 4 field không-nullable (test assert) ✓ · `null` xoá giá trị cho 4 field nullable ✓ · pre-check có `Not(id)` + điều kiện mã thực sự đổi ✓ · gửi lại mã của chính mình KHÔNG 409 ✓ · no-op bằng so-sánh-giá-trị-thật, không `save` ✓ · 2 nhánh conflict cùng `ZONE_CODE_EXISTS` ✓ · `23505` không rò stack ✓ · `@RequirePermissions('zones.zone.update')` có mặt ✓ · migration seed đúng `migrations/` + 2 role ✓ · 0 `DataSource`/audit/`setStatus` ✓ · 0 migration schema ✓ · `zones.module.ts` không đổi ✓ · UC-90 không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-91
- **T0** → verify import thiếu (controller/service) · `ZoneEntity.status` kiểu `string` · timestamp migration · baseline test UC-90 · wiring module đủ
- **T1** → `ZONE_STATUSES = ['active','inactive']` (OQ-2)
- **T2/T2b** → `UpdateZoneDto` — **crux `@ValidateIf` cho 4 field không-nullable** (chống `zone_code = "NULL"`) + test 2 nhóm `null`
- **T3/T3b** → `loadActive` (404 `ZONE_NOT_FOUND`) + `update` (crux `Not(id)` + so-sánh-giá-trị-thật) + 13 case test
- **T4/T4b** → route `PATCH /zones/:id` gộp cả `status` (OQ-3) + gate `zones.zone.update` + test metadata
- **T5** → migration seed `zones.zone.update` → SYSTEM_ADMIN + BUSINESS_ADMIN
- **T-GATE** → gate + không hồi quy UC-90 + STOP + bàn giao (phải seed permission mới gọi được endpoint) + Owed
