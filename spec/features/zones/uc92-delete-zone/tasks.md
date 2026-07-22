# ZND-001 — tasks.md (UC-92 Zones: xoá khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo tasks ZND-001 sau plan DUYỆT: T0 verify → T1 `ZonesAuditRepository` → T2 `countByZoneId` (module `iot`) → **T3 đổi constructor + T3b cập nhật provider (LIỀN KỀ, suite đỏ chỉ tồn tại giữa 2 task này)** → T4 `remove()` → T5 retrofit `create()`/`update()` → T6 controller (3 route nhận `@CurrentUser`) → T7 wiring `ZonesModule` → T8 sửa JSDoc 2 entity → T9 migration seed → T-GATE. Đóng 2 điểm plan để ngỏ: **pre-check `create()` đặt NGOÀI transaction**; **test `countByZoneId` BẮT BUỘC**. UC-92 code TRƯỚC UC-93 ⇒ migration lấy `20260722000003`. | Toàn bộ |
| 2026-07-22 | Review phát hiện 2 lỗ hổng, bổ sung trước khi code: (1) **T5b thiếu case đối xứng `create()` race `23505`** → thêm **case 12b** (assert `rollbackTransaction` gọi / `commitTransaction` không gọi / `release` vẫn gọi / **không** ghi `logZoneCreation`) — thiếu nhánh rollback ở catch `23505` trong transaction sẽ **rò connection pool** mà không test nào bắt được; (2) quy tắc sửa test cũ thiếu loại **(c) đổi MOCK TARGET** (`repo.save` → `qr.manager.save` do T5 chuyển ghi vào transaction) — bổ sung vào T5b và T-GATE, vẫn giữ lệnh cấm đổi assert nghiệp vụ. | T5b (case 12b + quy tắc (a)(b)(c) + AC 5→6 case), T-GATE (dòng không hồi quy) |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại plan §1 (OQ-1→OQ-8 + OQ-1b) và plan §9 (Kỷ luật). **KHÔNG** sửa `zone.entity.ts`, `zone-response.dto.ts`, `create-zone.dto.ts`, `update-zone.dto.ts`, `normalize-zone-code.ts`, các constant, `app.module.ts`, `data-source.ts`, `iot.module.ts`. **KHÔNG** làm bất kỳ việc gì của UC-93 (`GET` list/detail) hay UC-94 (gán camera).

## Thứ tự
T0 → T1 → T1b → T2 → T2b → **T3 → T3b** → T4 → T4b → T5 → T5b → T6 → T6b → T7 → T8 → T9 → T-GATE.

> **Phụ thuộc bắt buộc**: `ZonesAuditRepository` (T1) và `countByZoneId` (T2) phải **có trước** T3 (constructor inject chúng) · **T3 làm suite đỏ, T3b trả về xanh — hai task này PHẢI làm liền nhau, cấm chèn task khác vào giữa** · T5 (đổi chữ ký `create`/`update`) trước T6 (controller truyền `userId`) · T7 wiring trước DI-proof ở T-GATE · T9 (migration) độc lập nhưng phải **cùng commit** với controller (thiếu = 403).

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu tiên. Đọc CODE THẬT, dán xác nhận từng mục. **Thiếu mục / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **Baseline test (2 con số, dùng đối chiếu ở T-GATE)**: đếm suite/test hiện có trong `src/modules/zones` — **kỳ vọng 5 suite / 52 test** (23 UC-90 + 29 UC-91; UC-93 chưa code) — **và** trong `src/modules/iot` (ghi lại con số thực tế, không kỳ vọng trước). Lệch → ghi nhận và báo **trước khi** code.
2. **`ZonesService` constructor hiện chỉ 1 dependency** (`@InjectRepository(ZoneEntity) repo` — [zones.service.ts:48-51](../../../../src/modules/zones/services/zones.service.ts)); **`zones.service.spec.ts` dựng module với đúng 1 provider** ([:27-34](../../../../src/modules/zones/services/zones.service.spec.ts)). Đây là gốc của rủi ro hồi quy T3/T3b.
3. **`IotDevicesService` chưa có method nào theo `zone_id`** (grep `zoneId` trong [iot-devices.service.ts](../../../../src/modules/iot/services/iot-devices.service.ts) → 0); constructor **đã có** `private readonly dataSource: DataSource` ([:81-94](../../../../src/modules/iot/services/iot-devices.service.ts)) ⇒ method mới **không cần inject thêm gì**.
4. **`IotModule` đã export `IotDevicesService`** ([iot.module.ts:41](../../../../src/modules/iot/iot.module.ts)) **và KHÔNG import `ZonesModule`** ([:20-32](../../../../src/modules/iot/iot.module.ts)) ⇒ không circular, không phải sửa `iot.module.ts`.
5. **`ZonesModule` hiện có** `AuthModule` + `controllers: [ZonesController]` + `providers: [ZonesService]`, **chưa có** `IotModule` ([zones.module.ts](../../../../src/modules/zones/zones.module.ts)).
6. **Timestamp migration**: đếm thực tế trong `src/database/migrations/` — kỳ vọng file cuối là `20260722000002-SeedZoneUpdatePermission.ts` ⇒ UC-92 lấy **`20260722000003`**. Nếu đã tồn tại `20260722000003*` do người khác thêm → **lấy số kế tiếp chưa dùng và ghi rõ trong báo cáo**.
7. **`ZonesController` chưa dùng `@CurrentUser`** ([zones.controller.ts](../../../../src/modules/zones/controllers/zones.controller.ts)) ⇒ xác nhận đường dẫn import `../../auth/decorators/current-user.decorator.js` và shape thật `{ userId: string }` (tiền lệ [vehicle-registration.controller.ts:59](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
8. **`IotAuditRepository` — chữ ký + cột `audit_logs` thật** ([iot-audit.repository.ts:7-28](../../../../src/modules/iot/repositories/iot-audit.repository.ts)): `async logX(entityManager: EntityManager, params: {...}): Promise<void>` chạy `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json) VALUES ($1..$3::jsonb)`. Xác nhận `action_type` là chuỗi tự do (không enum) ⇒ `'delete'` hợp lệ, **không cần migration**.

- **AC**: dán xác nhận đủ **8 mục** kèm bằng chứng (path + trích dẫn ngắn); mục 1 ghi rõ **2 con số baseline**; mục 6 ghi rõ timestamp chốt.

## T1 — `ZonesAuditRepository` (code) — plan §3, OQ-2, SEC-01
- File net-new: `src/modules/zones/repositories/zones-audit.repository.ts`, class `ZonesAuditRepository` (`@Injectable`).
- Mirror `IotAuditRepository`: mỗi method nhận **`entityManager: EntityManager`** (chạy trong transaction của caller) + params, trả `Promise<void>`, chạy raw SQL **parameter-bound** vào `audit_logs` với `entity_type = 'zones'`, `severity = 'info'`, `metadata_json` ép `$n::jsonb`.

| Method | `action_type` | `metadata_json` |
| :--- | :--- | :--- |
| `logZoneCreation(em, { userId, zoneId, zoneCode, zoneType })` | `'create'` | `{ zone_code, zone_type }` |
| `logZoneUpdate(em, { userId, zoneId, changes })` | `'update'` | `{ changed_fields: changes }` |
| `logZoneDeletion(em, { userId, zoneId, zoneCode, zoneType })` | `'delete'` | `{ zone_code, zone_type }` |

- **SEC-01 (bắt buộc)**: **KHÔNG** đổ `zones.metadata_json` vào audit. Trong `logZoneUpdate`, nếu `changes` chứa khoá `metadataJson` thì **thay giá trị bằng cờ** `{ metadata_json: { changed: true } }` — không ghi nội dung. JSDoc phải ghi rõ lý do (túi tự do, kích thước không giới hạn, tiền lệ `logDeviceUpdate` cũng cố ý không ghi metadata thiết bị).
- **KHÔNG** tái dùng `IotAuditRepository` (`entity_type` hard-code `'iot_devices'`). **KHÔNG** import gì từ module `iot`.
- **AC**: 3 method đúng chữ ký; mọi SQL dùng `$1..$n` (0 chỗ nối chuỗi); `entity_type='zones'` ở cả 3; `logZoneUpdate` che nội dung `metadataJson`.

## T1b — Test `ZonesAuditRepository` — plan §7 mục 13-14, SEC-01
- File net-new: `src/modules/zones/repositories/zones-audit.repository.spec.ts`; mock `entityManager = { query: jest.fn() }`.
- Case: 3 method gọi `query` đúng 1 lần với `entity_type='zones'`, `action_type` đúng (`create`/`update`/`delete`), `severity='info'`, mảng tham số đúng thứ tự.
- **Case SEC-01 (bắt buộc)**: `logZoneUpdate` với `changes` chứa `metadataJson: { secret: 'x' }` → payload JSON ghi ra **không** chứa `'secret'`/`'x'`, chỉ có cờ `changed: true`.
- **AC**: 4 nhóm case xanh; case SEC-01 có mặt và assert không rò nội dung metadata.

## T2 — `IotDevicesService.countByZoneId` (code) — plan §4, OQ-1, ARCH-01
- File **NGOÀI module `zones`**: `src/modules/iot/services/iot-devices.service.ts` (**Modified**, thêm đúng 1 method).
- `async countByZoneId(zoneId: string): Promise<number>` → `this.dataSource.manager.count(IoTDeviceEntity, { where: { zoneId } })`.
- **Đếm MỌI thiết bị bất kể `status`** (kể cả `disabled`/`offline`) — thiết bị disabled vẫn là cấu hình trỏ vào zone, xoá zone sẽ để lại dangling. **KHÔNG** lọc `deletedAt` (`IoTDeviceEntity` không có soft-delete — T0 mục 3).
- JSDoc ghi rõ: *"API đọc phục vụ UC-92 của module `zones` khi kiểm tra trước lúc xoá zone. `iot` KHÔNG biết gì về nghiệp vụ zone."*
- **CẤM** thêm bất kỳ import nào từ `zones` vào module `iot` (OQ-1b). **KHÔNG** sửa `iot.module.ts` (đã export sẵn).
- **AC**: đúng 1 method mới; đếm không lọc status/deletedAt; 0 import từ `zones`; `iot.module.ts` không đổi.

## T2b — Test `countByZoneId` (**BẮT BUỘC**, không phải tuỳ chọn) — plan §7 mục 19
- Thêm vào `src/modules/iot/services/iot-devices.service.spec.ts` (file **đã tồn tại**, mock dựng sẵn → chi phí gần như bằng 0; đây là lý do task này bắt buộc).
- Case: gọi `countByZoneId('z1')` → assert `dataSource.manager.count` được gọi với `(IoTDeviceEntity, { where: { zoneId: 'z1' } })` và trả đúng số mock.
- **Không hồi quy**: các test cũ của `iot-devices.service.spec.ts` giữ nguyên, **cấm** sửa assert nghiệp vụ.
- **AC**: 1 case mới xanh; số test cũ của module `iot` không giảm.

## T3 — Đổi constructor `ZonesService` 1 → 4 dependency (code) — plan §2.1
> ⚠ **Task này CỐ TÌNH làm suite đỏ** (`UnknownDependenciesException` ở mọi `Test.createTestingModule` cho service). **PHẢI làm T3b ngay sau**, cấm chèn task khác vào giữa.
- `src/modules/zones/services/zones.service.ts`: constructor nhận
  `@InjectRepository(ZoneEntity) repo` · `private readonly dataSource: DataSource` · `private readonly zonesAuditRepository: ZonesAuditRepository` · `private readonly iotDevicesService: IotDevicesService`.
- Thêm import: `DataSource` (typeorm), `ZonesAuditRepository` (`../repositories/zones-audit.repository.js`), `IotDevicesService` (`../../iot/services/iot-devices.service.js`).
- **Chỉ đổi constructor** ở task này — thân `create()`/`update()` giữ nguyên (retrofit ở T5), `loadActive()`/`zoneCodeConflict()`/`isUniqueViolation()` không đụng.
- **AC**: constructor đúng 4 dependency, build TS pass; ghi nhận suite `zones` đang đỏ do DI (chấp nhận tạm thời, đóng ở T3b).

## T3b — Cập nhật provider cho spec hiện có (test) — plan §7 "chuẩn bị bắt buộc", §4 prompt
> Task đóng lại suite đỏ do T3. **Không** thêm test mới ở đây.
- `src/modules/zones/services/zones.service.spec.ts`: thêm **3 provider mock** vào mọi `Test.createTestingModule`:
  - `DataSource` → mock `createQueryRunner()` trả object có `connect`, `startTransaction`, `manager` (`{ save, softDelete, query }`), `commitTransaction`, `rollbackTransaction`, `release` — tất cả `jest.fn()`;
  - `ZonesAuditRepository` → mock 3 method;
  - `IotDevicesService` → mock `countByZoneId` (default `0`).
- **CẤM đổi assert nghiệp vụ** của 23 test cũ. Chỉ được sửa: (a) phần dựng provider/mock; (b) **chưa** đụng assert tham số (chữ ký `create`/`update` đổi ở T5 — sẽ cập nhật ở T5b).
- **AC**: `npx jest src/modules/zones` **xanh trở lại** với đúng **52 test** như baseline T0; 0 assert nghiệp vụ bị sửa.

## T4 — `ZonesService.remove()` (code) — plan §2.2, OQ-1/3/4/9, DATA-01
- Thêm method `async remove(id: string, actorUserId: string): Promise<void>` — thứ tự **bắt buộc**:
  1. `const entity = await this.loadActive(id);` → 404 `ZONE_NOT_FOUND` (phủ luôn DELETE lần 2 — OQ-4).
  2. **Chặn theo thiết bị (crux OQ-1)**: `const deviceCount = await this.iotDevicesService.countByZoneId(id);` → `> 0` → `throw new ConflictException({ code: 'ZONE_HAS_DEVICES', message: 'Khu vực còn thiết bị được gán, hãy gỡ thiết bị trước khi xoá', details: { device_count: deviceCount } })`.
     - **Đặt TRƯỚC khi mở transaction** (fail nhanh, không tốn connection).
     - **CẤM** đếm `gate_access_logs`/`zone_presence_events` — không chặn theo log.
  3. **Transaction**: `qr = dataSource.createQueryRunner()` → `connect()` → `startTransaction()` → `qr.manager.softDelete(ZoneEntity, id)` → `zonesAuditRepository.logZoneDeletion(qr.manager, {...})` → `commitTransaction()`; `catch` → `rollbackTransaction()` + rethrow; **`finally` → `release()`** (thiếu là rò connection pool).
  4. Trả `void`.
- **CẤM** `repo.delete()`/`repo.remove()`/raw `DELETE FROM zones` (DATA-01). **CẤM** thêm `restore()` (OQ-5).
- **AC**: đủ 4 bước đúng thứ tự; chặn thiết bị nằm **ngoài** transaction; `softDelete` + audit nằm **trong cùng** transaction; có `finally { release() }`; 0 hard-delete.

## T4b — Test `remove()` — plan §7 mục 1-7
Thêm `describe('remove')` vào `zones.service.spec.ts`:
1. **Xoá thành công**: `countByZoneId` → `0` → assert `qr.manager.softDelete` gọi với `(ZoneEntity, id)`, `logZoneDeletion` gọi **trước** `commitTransaction`, `release` được gọi.
2. **404 zone không tồn tại**: `findOne` → `null` → `ZONE_NOT_FOUND`; assert **`countByZoneId` KHÔNG gọi** và **`createQueryRunner` KHÔNG gọi**.
3. **404 zone đã xoá mềm** (gồm DELETE lần 2): assert `findOne` có `where` chứa `deletedAt: IsNull()`.
4. **409 `ZONE_HAS_DEVICES`**: `countByZoneId` → `3` → ném 409 với `details.device_count = 3`; assert **không mở transaction**, **không** `softDelete`, **không** audit.
5. **Còn LOG nhưng không còn thiết bị → VẪN XOÁ**: `countByZoneId` → `0`; assert service **không** thực hiện truy vấn nào tới `gate_access_logs`/`zone_presence_events` → `softDelete` chạy bình thường (bảo vệ quyết định "không chặn theo log").
6. **Rollback khi audit lỗi**: `logZoneDeletion` reject → assert `rollbackTransaction` gọi, `commitTransaction` **KHÔNG** gọi, lỗi propagate, `release` **vẫn** được gọi.
7. **`countByZoneId` gọi đúng 1 lần với đúng `id`**.
- **AC**: 7 case xanh; case 4 và case 5 bắt buộc có mặt (bảo vệ 2 vế của OQ-1); case 6 chứng minh không có trạng thái "đã xoá mà không có audit".

## T5 — Retrofit `create()` + `update()` sang transaction + audit (code) — plan §2.3/§2.4, OQ-2
- **`create(dto: CreateZoneDto, actorUserId: string)`**:
  - **GIỮ NGUYÊN** thứ tự 4 bước: normalize → **pre-check trùng (`deletedAt: IsNull()`) — ĐẶT NGOÀI transaction** (quyết định đã đóng: nhất quán với `remove()` "fail nhanh, không tốn connection") → `repo.create` → save.
  - Đổi phần ghi: save qua `qr.manager.save(ZoneEntity, entity)` + `logZoneCreation(qr.manager, …)` trong cùng transaction; catch `23505` → `zoneCodeConflict()` (safety-net **bên trong** transaction vẫn phủ race) + rollback; `finally release()`.
- **`update(id, dto, actorUserId)`**:
  - **GIỮ NGUYÊN** 6 bước: `loadActive` → gom `updates` (normalize `zoneCode`) → pre-check `Not(id)` + "mã thực sự đổi" → lọc field đổi giá trị thật → **no-op return** → save.
  - **Bất biến (bắt buộc)**: no-op vẫn **KHÔNG `save` VÀ KHÔNG audit** (không có thay đổi thì không có gì để audit), `updated_at` không nhảy.
  - Đổi phần ghi: save trong transaction + `logZoneUpdate(qr.manager, { userId, zoneId, changes })` với `changes` là map field đã đổi (`{ old, new }`).
- **Bất biến chung**: cùng input → **cùng output/mã lỗi/payload**; `ZONE_CODE_EXISTS` vẫn ném từ **cả** pre-check lẫn `23505` với **cùng payload**; lỗi DB khác vẫn ném nguyên.
- **AC**: hành vi nghiệp vụ 2 method **không đổi**; pre-check `create()` nằm ngoài transaction; no-op `update()` không save và không audit; mọi nhánh có `finally { release() }`.

## T5b — Test audit cho `create()`/`update()` — plan §7 mục 8-12
Cập nhật/bổ sung trong `zones.service.spec.ts`:
8. `create()` thành công → `logZoneCreation` gọi 1 lần **trong** transaction, `commitTransaction` gọi.
9. `create()` trùng mã (pre-check) → 409 **và** `logZoneCreation` **KHÔNG** gọi, **không** mở transaction.
10. `update()` có thay đổi → `logZoneUpdate` gọi với `changes` đúng field đã đổi.
11. **`update()` no-op → KHÔNG `save` VÀ KHÔNG audit** (bảo vệ bất biến T5).
12. `update()` race `23505` → `rollbackTransaction` + 409 **cùng payload** với pre-check.
12b. **`create()` race `23505` (đối xứng với case 12)**: pre-check pass (`findOne` → `null`) nhưng `qr.manager.save` reject `{ driverError: { code: '23505' } }` → `ConflictException ZONE_CODE_EXISTS` **cùng payload** với nhánh pre-check (case 9); assert **`rollbackTransaction` được gọi**, **`commitTransaction` KHÔNG gọi**, **`release` VẪN được gọi**, và **`logZoneCreation` KHÔNG được ghi** (không audit cho thao tác thất bại).
   *Lý do bắt buộc*: sau T5, `create()` bắt `23505` **bên trong** transaction; nếu nhánh catch quên `rollbackTransaction()` thì transaction treo → **rò connection pool**, không test nào hiện có bắt được.
- **Cập nhật test cũ — chỉ 3 loại được phép**: **(a)** dựng provider/mock; **(b)** assert **tham số** do đổi chữ ký (`create(dto, actorUserId)`, `update(id, dto, actorUserId)`); **(c) đổi MOCK TARGET** — T5 thay `this.repo.save(entity)` bằng `qr.manager.save(ZoneEntity, entity)` nên test cũ assert `repo.save` sẽ fail **vì mock target đổi, không phải vì assert sai** ⇒ được phép đổi sang `qr.manager.save` (tương tự cho mock khác bị chuyển vào transaction manager).
  **VẪN CẤM tuyệt đối**: đổi assert về **mã lỗi**, **payload**, **số lần gọi**, **hành vi no-op**, hay bất kỳ khẳng định nghiệp vụ nào. Test cũ fail mà **không** thuộc (a)/(b)/(c) → **DỪNG, báo cáo, KHÔNG sửa test cho qua**.
- **AC**: **6 case mới** (8, 9, 10, 11, 12, 12b) xanh; 52 test cũ vẫn xanh sau khi cập nhật theo (a)/(b)/(c); 0 assert nghiệp vụ bị đổi.

## T6 — Controller: route `DELETE` + `@CurrentUser` cho cả 3 route (code) — plan §5, SEC-02
- `src/modules/zones/controllers/zones.controller.ts`: thêm import `Delete` (@nestjs/common) và `CurrentUser` (`../../auth/decorators/current-user.decorator.js`).
- **Route mới**: `@Delete(':id')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · **`@RequirePermissions('zones.zone.delete')`** · `@Param('id', ParseUUIDPipe)` · `@CurrentUser() user: { userId: string }` → `zonesService.remove(id, user.userId)` → `{ success: true, message: 'Zone deleted successfully', data: null }`.
  - **KHÔNG** `@UsePipes(ZONE_PIPE)` (không body/query), **KHÔNG** `@HttpCode` (DELETE mặc định 200), **KHÔNG** query `?force=`.
- **Sửa 2 route cũ**: `POST` và `PATCH` thêm `@CurrentUser() user` và truyền `user.userId` xuống service (do T5 đổi chữ ký). **KHÔNG** đổi guard/permission/message/envelope của 2 route đó.
- ⚠ Quên `@RequirePermissions` = **endpoint hở im lặng** (`PermissionsGuard` `return true` khi không có metadata).
- **AC**: đúng 1 route mới; 3 route đều lấy actor từ `@CurrentUser` (không từ body/param); message/envelope của POST/PATCH **không đổi**; `data: null` cho DELETE.

## T6b — Test controller — plan §7 mục 15-18
Cập nhật `zones.controller.spec.ts`:
15. DELETE gọi `service.remove(id, user.userId)` 1 lần; trả `{success:true, message:'Zone deleted successfully', data:null}`.
16. Assert metadata `Reflect.getMetadata(PERMISSIONS_KEY, controller.remove)` = `['zones.zone.delete']`; guard list có `JwtAuthGuard` **và** `PermissionsGuard`.
17. `NotFoundException` và `ConflictException` từ service → propagate nguyên trạng (controller không nuốt).
18. **Cập nhật 2 test cũ**: POST/PATCH nay gọi service kèm `userId` — **chỉ sửa assert tham số**, giữ nguyên assert nghiệp vụ (envelope, message, mapper, không lộ `deleted_at`).
- **AC**: 4 nhóm case xanh; test POST/PATCH cũ không đổi phần nghiệp vụ.

## T7 — Wiring `ZonesModule` (code) — plan §6, OQ-1b, ARCH-01
- `src/modules/zones/zones.module.ts`: thêm `IotModule` vào `imports` (`../iot/iot.module.js`) + thêm `ZonesAuditRepository` vào `providers`.
- **GIỮ NGUYÊN**: `TypeOrmModule.forFeature([ZoneEntity, GateAccessLogEntity, ZonePresenceEventEntity])`, `AuthModule`, `controllers: [ZonesController]`, `providers: [ZonesService]`, `exports: [TypeOrmModule]`.
- Cập nhật JSDoc: ghi rõ **`zones → iot` là phụ thuộc MỘT CHIỀU, VĨNH VIỄN — `IotModule` TUYỆT ĐỐI KHÔNG được import `ZonesModule`**, cấm `forwardRef`; UC-94 (gán camera) sẽ đặt route ở **phía `zones`** (`PATCH /api/v1/zones/:id/devices`) đúng theo OQ-1b.
- **KHÔNG** sửa `iot.module.ts`, **KHÔNG** sửa `app.module.ts`.
- **AC**: module có đủ `IotModule` + `ZonesAuditRepository`; 5 mục cũ giữ nguyên; JSDoc ghi ràng buộc một chiều; `iot.module.ts`/`app.module.ts` không bị chạm.

## T8 — Sửa JSDoc 2 entity (code — chỉ comment) — plan §6, OQ-8
- `src/modules/zones/entities/gate-access-log.entity.ts` và `src/modules/zones/entities/zone-presence-event.entity.ts`: sửa dòng JSDoc đang ghi *"`zone_id` dùng ON DELETE RESTRICT: không cho xoá zone khi còn log/event"* — câu này **mô tả một sự bảo vệ không tồn tại**.
- Nội dung đúng cần ghi (1–2 dòng mỗi file): `ON DELETE RESTRICT` **chỉ có tác dụng với hard-delete**, mà hard-delete bị **DATA-01 cấm**; hệ thống dùng soft-delete (`UPDATE deleted_at`) nên FK action **không bao giờ kích hoạt**; việc chặn/không-chặn xoá zone do **application** quyết định — UC-92 chốt **chặn theo thiết bị, KHÔNG chặn theo log**.
- **CHỈ sửa comment. CẤM** đổi cột/decorator/relation/tên bảng.
- **AC**: 2 file chỉ thay đổi trong khối comment; `git diff` không có dòng code nào đổi; nội dung mới nói đúng hành vi thực tế.

## T9 — Migration seed permission (code) — plan §6, OQ-6, SEC-02
- File: **`src/database/migrations/20260722000003-SeedZoneDeletePermission.ts`** (timestamp chốt ở T0 mục 6), class `SeedZoneDeletePermission20260722000003` + field `name` trùng tên class.
- **Đặt trong `migrations/`, TUYỆT ĐỐI KHÔNG trong `src/database/seeds/`** (folder `seeds/` không có runner — AGENTS.md §5.5 rule 4).
- Copy **nguyên pattern** [20260722000002-SeedZoneUpdatePermission.ts](../../../../src/database/migrations/20260722000002-SeedZoneUpdatePermission.ts):
  - `permission = { code: 'zones.zone.delete', name: <ASCII không dấu>, module: 'zones', action: 'delete', description: <ASCII không dấu> }`;
  - `roles = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (OQ-6) — **CẤM** `ADMIN`/`INTERNAL_USER`;
  - `up()` idempotent: INSERT `ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id` → `return` nếu vẫn không có → gán `role_permissions` `ON CONFLICT DO NOTHING`;
  - `down()`: xoá `role_permissions` **trước**, rồi `permissions`.
- Chỉ tạo file, **KHÔNG chạy** `migration:run`.
- **AC**: đúng tên/vị trí; `permission_code='zones.zone.delete'`, `module_code='zones'`, `action_code='delete'`; đúng 2 role; `up()` chạy lại không lỗi/không nhân bản; `down()` đúng thứ tự.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- `npm run build` = **0 error**.
- eslint trên **toàn bộ file touched** = **0 rule mới**, file mới 0 lỗi.
- `npx jest src/modules/zones` **và** `npx jest src/modules/iot` **đều xanh**.
- **KHÔNG HỒI QUY (đối chiếu baseline T0 mục 1)**: `src/modules/zones` phải có **≥ 52 test cũ vẫn xanh** (23 UC-90 + 29 UC-91) cộng test mới của UC-92; `src/modules/iot` giữ nguyên số pass cũ + 1 test `countByZoneId`. **Test cũ fail → DỪNG, báo cáo, KHÔNG sửa test cho qua.** Chỉ được sửa **3 loại**: **(a)** dựng provider/mock (T3b); **(b)** assert **tham số** do đổi chữ ký (T5b/T6b); **(c)** đổi **mock target** `repo.save` → `qr.manager.save` do T5 chuyển ghi vào transaction. **CẤM** đổi assert nghiệp vụ (mã lỗi, payload, số lần gọi, hành vi no-op).
- Coverage `ZonesService` **≥80%**.
- **DI-proof**: `AppModule` compile ở **preview mode** — 0 `UnknownDependenciesException`, **0 circular**, **đặc biệt kiểm cạnh mới `ZonesModule → IotModule`**. Throwaway xoá sạch trước khi báo cáo.
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS chung · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file đầy đủ + kết quả jest (**tách rõ test cũ vs mới**) + coverage + DI-proof.
- **Bàn giao**: gọi thử `DELETE /api/v1/zones/:id` trên local cần chạy seed permission **`20260722000003`** trước; thiếu → **403 `FORBIDDEN`**, không phải lỗi code. Local vẫn **chưa có bảng `zones`** nên cần `20260721000001` trước nữa — **chỉ local, KHÔNG RDS**.
- **Owed (ghi, KHÔNG làm)**: **UC-93** list/detail (migration sẽ lấy `20260722000004`) · **UC-94** gán camera — **route PHẢI ở phía `zones`** (`PATCH /api/v1/zones/:id/devices`, OQ-1b) · restore zone (OQ-5) · FT-20/FT-21 bỏ qua zone đã xoá mềm và tôn trọng `status='inactive'` · snapshot `zone_type` tại thời điểm sinh log · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.
- **AC**: bảng gate đầy đủ + báo cáo tick: chặn theo thiết bị → 409 `ZONE_HAS_DEVICES` ✓ · **không** chặn theo log ✓ · kiểm thiết bị nằm ngoài transaction ✓ · `softDelete` + audit trong cùng transaction, audit lỗi → rollback ✓ · `finally release()` ✓ · 0 hard-delete ✓ · audit đủ 3 action `create`/`update`/`delete`, `entity_type='zones'` ✓ · `update()` no-op không save + không audit ✓ · SEC-01 không ghi `metadata_json` vào audit ✓ · `@RequirePermissions('zones.zone.delete')` có mặt ✓ · migration seed đúng `migrations/` + 2 role ✓ · `IotModule` KHÔNG import `ZonesModule`, DI-proof 0 circular ✓ · 2 entity chỉ đổi comment ✓ · 0 migration schema ✓ · 52 test cũ không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-92
- **T0** → baseline 2 module · constructor/provider hiện trạng · `IotDevicesService` chưa có method zone · `IotModule` export + không circular · `ZonesModule` chưa có `IotModule` · timestamp migration · `@CurrentUser` · chữ ký `IotAuditRepository`
- **T1/T1b** → `ZonesAuditRepository` 3 method + SEC-01 che `metadata_json`
- **T2/T2b** → `countByZoneId` (file NGOÀI `zones`) + test **bắt buộc**
- **T3/T3b** → đổi constructor 1→4 **và** cập nhật provider (liền kề, đóng suite đỏ ngay)
- **T4/T4b** → `remove()`: 404 → 409 chặn thiết bị (ngoài transaction) → transaction softDelete + audit
- **T5/T5b** → retrofit `create()`/`update()` (pre-check ngoài transaction; no-op không audit)
- **T6/T6b** → route `DELETE` + `@CurrentUser` cho cả 3 route
- **T7** → wiring `ZonesModule` + ghi luật `zones → iot` một chiều (OQ-1b)
- **T8** → sửa JSDoc 2 entity (OQ-8), chỉ comment
- **T9** → migration seed `zones.zone.delete` → SYSTEM_ADMIN + BUSINESS_ADMIN
- **T-GATE** → gate 2 module + không hồi quy 52 test + DI-proof 0 circular + STOP + bàn giao + Owed
