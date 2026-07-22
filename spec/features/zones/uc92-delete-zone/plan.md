# ZND-001 — plan.md (UC-92 Zones: xoá khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo plan ZND-001 sau spec DUYỆT + chốt OQ-1→OQ-8 (+OQ-1b). 1 route `DELETE /zones/:id`; `ZonesService` **đổi constructor** (thêm `DataSource` + `ZonesAuditRepository`) và **sửa lại `create()`/`update()`** để bọc transaction + audit (OQ-2 mức 2); `ZonesAuditRepository` net-new; thêm `countByZoneId` vào `IotDevicesService` (**file ngoài module `zones`**); sửa JSDoc 2 entity (OQ-8); 1 migration seed permission. **Rủi ro chính: 52 test cũ phải cập nhật provider do đổi constructor.** | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **Mẫu transaction chuẩn** ([iot-devices.service.ts:100-175](../../../../src/modules/iot/services/iot-devices.service.ts)): `const qr = this.dataSource.createQueryRunner()` → `await qr.connect()` → `await qr.startTransaction()` → `try { …qr.manager.save(…); await audit(qr.manager, …); await qr.commitTransaction(); return saved } catch (e) { await qr.rollbackTransaction(); throw e } finally { await qr.release() }`. **Copy đúng cấu trúc này**, đặc biệt `finally { release() }` — thiếu là rò connection pool.
- **`IotAuditRepository` — chữ ký thật** ([iot-audit.repository.ts:7-28](../../../../src/modules/iot/repositories/iot-audit.repository.ts)): `@Injectable()`, mỗi method `async logX(entityManager: EntityManager, params: {…}): Promise<void>` chạy `entityManager.query('INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json) VALUES ($1, …, $3::jsonb)', [...])`.
  - **Cột `audit_logs` dùng thật**: `user_id`, `action_type`, `entity_type`, `entity_id`, `severity` (dùng `'info'`), `metadata_json` (jsonb, ép `$n::jsonb`).
  - `action_type` là **chuỗi tự do** (`'create'`, `'update'`, `'assign_room'`, `'disable'`, `'configure_rtsp'`…) — không enum ⇒ `'delete'` hợp lệ, không cần migration.
  - `entity_type` **hard-code trong từng method** (`'iot_devices'`) ⇒ **KHÔNG tái dùng được** cho zones, phải viết repository riêng (OQ-2).
  - **SEC-01 trong repo này**: `maskSensitiveMetadata(params.metadataJson)` ([:15](../../../../src/modules/iot/repositories/iot-audit.repository.ts)) và chủ động `delete safeMetadata.rtsp_password` ([:177-181](../../../../src/modules/iot/repositories/iot-audit.repository.ts)) — tiền lệ: **không đổ nguyên metadata thiết bị vào audit**.
- **`IotDevicesService` — nơi thêm method** ([iot-devices.service.ts:81-94](../../../../src/modules/iot/services/iot-devices.service.ts)): constructor có `private readonly dataSource: DataSource` ⇒ method đếm mới dùng `this.dataSource.manager.count(IoTDeviceEntity, { where: { zoneId } })`, không cần inject thêm gì.
- **`IoTDeviceEntity` KHÔNG có soft-delete** (grep `deletedAt`/`DeleteDateColumn` trong [iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts) → 0 kết quả) ⇒ đếm thiết bị **không** cần lọc `deletedAt`; `zoneId` khai `string | null` ([:60-61](../../../../src/modules/iot/entities/iot-device.entity.ts)).
- **`IotModule` export sẵn `IotDevicesService`** ([iot.module.ts:41](../../../../src/modules/iot/iot.module.ts)) ⇒ `ZonesModule` chỉ cần `imports: [IotModule]`, **không** phải sửa `exports` của `iot`.
- **Test hiện tại của `ZonesService`** ([zones.service.spec.ts:27-34](../../../../src/modules/zones/services/zones.service.spec.ts)): `Test.createTestingModule({ providers: [ZonesService, { provide: getRepositoryToken(ZoneEntity), useValue: repo }] })` — **chỉ 1 provider**. Đổi constructor ⇒ **mọi test dựng module này fail `UnknownDependenciesException`** cho tới khi thêm provider mock `DataSource` + `ZonesAuditRepository` + `IotDevicesService`. Đây là rủi ro hồi quy lớn nhất của UC-92.
- **`ZonesController` hiện chưa dùng `@CurrentUser`** ([zones.controller.ts](../../../../src/modules/zones/controllers/zones.controller.ts)) ⇒ UC-92 là route đầu tiên cần import `CurrentUser` từ `../../auth/decorators/current-user.decorator.js`; shape đã dùng ở ANPR là `{ userId: string }` ([vehicle-registration.controller.ts:59](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
- **Timestamp migration kế tiếp**: file cuối hiện tại `20260722000002-SeedZoneUpdatePermission.ts` ⇒ UC-92 dùng **`20260722000003-SeedZoneDeletePermission.ts`** (xác nhận lại ở T0 của tasks).
- **`ZonesModule` sẽ bị sửa** (khác UC-91): thêm `imports: [IotModule]` + `providers: [ZonesAuditRepository]`. Đây là ngoại lệ bắt buộc của UC-92.

## 1. Quyết định đã chốt (OQ + Constitution)

OQ-1 **chặn theo THIẾT BỊ (409 `ZONE_HAS_DEVICES`), KHÔNG chặn theo LOG**; kiểm tra qua `IotDevicesService` (DI) · **OQ-1b hướng phụ thuộc `zones → iot` MỘT CHIỀU vĩnh viễn; `IotModule` CẤM import `ZonesModule`; UC-94 đặt route ở phía zones (`PATCH /api/v1/zones/:id/devices`)** · OQ-2 **audit MỨC 2** (create/update/delete) qua `ZonesAuditRepository` mới + `DataSource` + transaction · OQ-3 `200` + `data: null` · OQ-4 DELETE lần 2 → `404` · OQ-5 restore NGOÀI scope · OQ-6 1 permission `zones.zone.delete` → `SYSTEM_ADMIN` + `BUSINESS_ADMIN` · OQ-7 `ZONE_HAS_DEVICES` · OQ-8 sửa JSDoc 2 entity.

- **DATA-01 (crux)**: chỉ soft-delete. **CẤM** `repo.delete()`/`repo.remove()`/`DELETE FROM zones` dưới mọi hình thức.
- **ARCH-01**: `zones` **không** query bảng `iot_devices`; gọi `IotDevicesService`. Chiều ngược lại bị cấm vĩnh viễn (OQ-1b).
- **SEC-01**: audit **không** ghi secret. `zones.metadata_json` là túi tự do → xem §3 để quyết cách xử.
- **SEC-02**: `@RequirePermissions('zones.zone.delete')` bắt buộc; `actorUserId` từ `@CurrentUser()`, không từ body/param.
- **SEC-03**: `:id` `ParseUUIDPipe`; audit dùng parameter binding (`$1..$n`), không nối chuỗi.
- **ARCH-03**: DELETE lần 2 → 404, không tác dụng phụ ⇒ natural idempotency đạt.
- **ENG-01**: coverage `ZonesService` ≥80%; **52 test cũ phải xanh**.
- **DATA-03**: **no-migration-schema** — migration duy nhất là seed permission.

## 2. Service — method thêm/sửa trong `ZonesService`

**File**: `src/modules/zones/services/zones.service.ts` (**Modified**).

### 2.1. Constructor — thay đổi phá vỡ (breaking cho test)
Từ 1 dependency thành 4:
`@InjectRepository(ZoneEntity) repo` · `private readonly dataSource: DataSource` · `private readonly zonesAuditRepository: ZonesAuditRepository` · `private readonly iotDevicesService: IotDevicesService`.
⇒ Mọi `Test.createTestingModule` cho service phải thêm 3 provider mock (§6).

### 2.2. `async remove(id: string, actorUserId: string): Promise<void>` (net-new)
1. `const entity = await this.loadActive(id);` — 404 `ZONE_NOT_FOUND` **trước** mọi thứ (kể cả lần gọi thứ 2 — OQ-4).
2. **Chặn theo thiết bị (crux OQ-1)**: `const deviceCount = await this.iotDevicesService.countByZoneId(id);`
   `if (deviceCount > 0) throw new ConflictException({ code: 'ZONE_HAS_DEVICES', message: 'Khu vực còn thiết bị được gán, hãy gỡ thiết bị trước khi xoá', details: { device_count: deviceCount } })`.
   - Kiểm tra **trước** khi mở transaction (fail nhanh, không tốn connection).
   - **KHÔNG** đếm `gate_access_logs`/`zone_presence_events`.
3. **Transaction** (mirror §0): `qr.connect()` → `qr.startTransaction()` →
   a. `await qr.manager.softDelete(ZoneEntity, id)` (hoặc `qr.manager.softRemove`) — **KHÔNG** `delete`;
   b. `await this.zonesAuditRepository.logZoneDeletion(qr.manager, { userId: actorUserId, zoneId: id, zoneCode: entity.zoneCode, zoneType: entity.zoneType })`;
   c. `commitTransaction()`; catch → `rollbackTransaction()` + rethrow; finally → `release()`.
4. Trả `void` (controller dựng `data: null`).

### 2.3. `create()` — SỬA (giữ nguyên hành vi nghiệp vụ)
- Giữ **nguyên** thứ tự 4 bước hiện có: normalize → pre-check trùng (`deletedAt: IsNull()`) → `repo.create` → save + safety-net `23505`.
- **Chỉ đổi phần ghi**: thay `this.repo.save(entity)` bằng save trong transaction (`qr.manager.save(ZoneEntity, entity)`) + `logZoneCreation(qr.manager, …)`, commit/rollback/release.
- Chữ ký đổi: `create(dto: CreateZoneDto, actorUserId: string)` — controller truyền thêm actor.
- **Bất biến phải giữ**: cùng input → cùng output/mã lỗi. `ZONE_CODE_EXISTS` vẫn ném từ **cả** pre-check và `23505` với **cùng payload**; lỗi DB khác vẫn ném nguyên. Pre-check giữ **ngoài** transaction hay trong đều được, nhưng **không được đổi thứ tự** để tránh lệch hành vi.

### 2.4. `update()` — SỬA (giữ nguyên hành vi nghiệp vụ)
- Giữ **nguyên** 6 bước: `loadActive` → gom `updates` (normalize `zoneCode`) → pre-check `Not(id)` + "mã thực sự đổi" → lọc field đổi giá trị thật → **no-op return (không save, không audit)** → save + safety-net.
- **Chỉ đổi phần ghi**: save trong transaction + `logZoneUpdate(qr.manager, { userId, zoneId, changes })`.
- Chữ ký đổi: `update(id, dto, actorUserId)`.
- **Bất biến phải giữ**: no-op vẫn **KHÔNG** `save` **và KHÔNG** ghi audit (không có thay đổi thì không có gì để audit); `updated_at` không nhảy; 404/409 giữ nguyên mã và payload.

### 2.5. Không đổi
`loadActive()`, `zoneCodeConflict()`, `isUniqueViolation()` giữ nguyên. **KHÔNG** thêm method `restore` (OQ-5).

## 3. Audit repository (net-new)

**File**: `src/modules/zones/repositories/zones-audit.repository.ts` · **Class**: `ZonesAuditRepository` (`@Injectable`).
Mirror `IotAuditRepository`: mỗi method nhận `entityManager: EntityManager` (để chạy trong transaction của caller) + params, trả `Promise<void>`, chạy raw SQL parameter-bound vào `audit_logs` với `entity_type = 'zones'`, `severity = 'info'`.

| Method | `action_type` | `metadata_json` đề xuất |
| :--- | :--- | :--- |
| `logZoneCreation(em, { userId, zoneId, zoneCode, zoneType })` | `'create'` | `{ zone_code, zone_type }` |
| `logZoneUpdate(em, { userId, zoneId, changes })` | `'update'` | `{ changed_fields: changes }` |
| `logZoneDeletion(em, { userId, zoneId, zoneCode, zoneType })` | `'delete'` | `{ zone_code, zone_type }` |

**SEC-01 — quyết định về `metadata_json` của zone**: **KHÔNG** đổ `zones.metadata_json` vào audit.
*Lý do*: đây là túi tự do (spec UC-90 đã cảnh báo có thể bị nhét cấu hình/thông tin nhạy cảm), kích thước không giới hạn, và audit chỉ cần trả lời "ai làm gì với zone nào". Tiền lệ `IotAuditRepository` cũng **cố ý không ghi** `metadata_json` của thiết bị trong `logDeviceUpdate` với comment SEC-01 ([:61-62](../../../../src/modules/iot/repositories/iot-audit.repository.ts)).
⇒ Với `logZoneUpdate`, nếu `changes` chứa key `metadataJson` thì **thay giá trị bằng cờ boolean** (`{ metadata_json: { changed: true } }`) thay vì ghi nội dung. Ghi rõ trong JSDoc.

## 4. Cross-module — method thêm vào `IotDevicesService`

**File**: `src/modules/iot/services/iot-devices.service.ts` (**Modified — NGOÀI module `zones`**).

- **`async countByZoneId(zoneId: string): Promise<number>`**
  - Thân: `return this.dataSource.manager.count(IoTDeviceEntity, { where: { zoneId } })`.
  - `IoTDeviceEntity` không có soft-delete (§0) ⇒ không cần lọc thêm.
  - **Đếm mọi thiết bị** bất kể `status` (kể cả `disabled`/`offline`): thiết bị disabled vẫn là cấu hình đang trỏ vào zone, xoá zone sẽ để lại dangling — đúng tinh thần OQ-1.
  - JSDoc ghi rõ: *"Phục vụ UC-92 (`zones`) kiểm tra trước khi xoá zone. Đây là API đọc dành cho module khác — `iot` KHÔNG biết gì về nghiệp vụ zone."*
- **`iot.module.ts` KHÔNG cần sửa** — `IotDevicesService` đã nằm trong `exports` ([:41](../../../../src/modules/iot/iot.module.ts)).
- **CẤM** thêm bất kỳ import nào từ `zones` vào module `iot` (OQ-1b).

## 5. Controller — route thêm vào `ZonesController`

**File**: `src/modules/zones/controllers/zones.controller.ts` (**Modified**). Thêm import `Delete` + `CurrentUser`.

```text
DELETE /api/v1/zones/:id
```
- `@Delete(':id')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('zones.zone.delete')` · `@Param('id', ParseUUIDPipe)` · `@CurrentUser() user: { userId: string }`.
- **KHÔNG** `@UsePipes(ZONE_PIPE)` (không body/query), **KHÔNG** `@HttpCode` (DELETE mặc định 200 trong Nest).
- Handler → `zonesService.remove(id, user.userId)` → `{ success: true, message: 'Zone deleted successfully', data: null }`.
- **Route `POST` và `PATCH` cũng phải sửa**: truyền thêm `user.userId` xuống service (do §2.3/§2.4 đổi chữ ký) ⇒ 2 route cũ thêm `@CurrentUser()`.

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| Xoá mềm thành công | `200` + `data: null` | — |
| `:id` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission | `403` | `FORBIDDEN` (guard) |
| Zone không tồn tại / đã xoá mềm (gồm DELETE lần 2) | `404` | `ZONE_NOT_FOUND` |
| Zone còn thiết bị được gán | `409` | `ZONE_HAS_DEVICES` |

## 6. File list

### Net-new (4)
- `src/modules/zones/repositories/zones-audit.repository.ts`
- `src/modules/zones/repositories/zones-audit.repository.spec.ts`
- `src/database/migrations/20260722000003-SeedZoneDeletePermission.ts` — seed `zones.zone.delete` (`module_code='zones'`, `action_code='delete'`) → `SYSTEM_ADMIN` + `BUSINESS_ADMIN`; `up()` idempotent, `down()` xoá `role_permissions` trước rồi `permissions`; copy pattern `20260722000002`. Đặt trong `migrations/`, **KHÔNG** trong `seeds/`.
- *(tuỳ chọn)* `src/modules/zones/constants/zone-audit.constant.ts` nếu muốn gom `ZONE_ENTITY_TYPE = 'zones'` + action types — **không bắt buộc**, có thể để hằng trong repository.

### Modified — trong module `zones` (5)
- `src/modules/zones/services/zones.service.ts` — constructor 4 dependency; `remove()` net-new; `create()`/`update()` bọc transaction + audit + đổi chữ ký.
- `src/modules/zones/services/zones.service.spec.ts` — **cập nhật provider** (3 mock mới) + thêm test `remove` + test audit cho create/update.
- `src/modules/zones/controllers/zones.controller.ts` — route `DELETE` + `@CurrentUser` cho cả 3 route.
- `src/modules/zones/controllers/zones.controller.spec.ts` — test route DELETE + cập nhật 2 test cũ (POST/PATCH nay truyền thêm `userId`).
- `src/modules/zones/zones.module.ts` — thêm `imports: [IotModule]` + `providers: [ZonesAuditRepository]`. **Giữ nguyên** `forFeature`, `AuthModule`, `controllers`, `exports`.

### Modified — NGOÀI module `zones` (3)
- `src/modules/iot/services/iot-devices.service.ts` — thêm `countByZoneId()`.
- `src/modules/iot/services/iot-devices.service.spec.ts` — test cho `countByZoneId` (nếu file này dựng được service với mock hiện có; nếu chi phí cao thì ghi nợ và nêu rõ).
- `src/modules/zones/entities/gate-access-log.entity.ts` + `src/modules/zones/entities/zone-presence-event.entity.ts` — **chỉ sửa JSDoc** (OQ-8), 1–2 dòng mỗi file. *(Hai file này thuộc module `zones`; liệt kê ở đây để nhấn mạnh là sửa comment, không đổi logic.)*

> Tổng ước lượng **4 net-new + 7 modified** (2 trong đó chỉ sửa comment). **0 migration schema.** `app.module.ts`, `data-source.ts`, `zone.entity.ts`, `zone-response.dto.ts`, `create-zone.dto.ts`, `update-zone.dto.ts`, `iot.module.ts` **KHÔNG đổi**.

## 7. Test (mock repo — KHÔNG DB)

**Chuẩn bị bắt buộc**: mọi `Test.createTestingModule` cho `ZonesService` phải cung cấp 4 provider — `getRepositoryToken(ZoneEntity)`, `DataSource` (mock `createQueryRunner()` trả object có `connect`/`startTransaction`/`manager`/`commitTransaction`/`rollbackTransaction`/`release` đều là `jest.fn()`), `ZonesAuditRepository` (mock 3 method), `IotDevicesService` (mock `countByZoneId`).

**`zones.service.spec.ts` — `describe('remove')`**
1. **Xoá thành công**: `loadActive` ok, `countByZoneId` → `0` → assert `qr.manager.softDelete` được gọi với `(ZoneEntity, id)`, `logZoneDeletion` được gọi **trước** `commitTransaction`, `release` được gọi.
2. **404 zone không tồn tại**: `findOne` → `null` → `ZONE_NOT_FOUND`; assert **`countByZoneId` KHÔNG gọi**, `createQueryRunner` **KHÔNG** gọi.
3. **404 zone đã xoá mềm**: assert `findOne` có `where` chứa `deletedAt: IsNull()` → 404.
4. **409 `ZONE_HAS_DEVICES`**: `countByZoneId` → `3` → ném 409 với `details.device_count = 3`; assert **không mở transaction**, **không** `softDelete`, **không** audit.
5. **Còn LOG nhưng không còn thiết bị → VẪN XOÁ** (chứng minh không chặn theo log): `countByZoneId` → `0`, service **không** gọi bất kỳ truy vấn nào tới `gate_access_logs`/`zone_presence_events` (assert không có repo/manager call ngoài dự kiến) → `softDelete` chạy.
6. **Rollback khi audit lỗi**: `logZoneDeletion` reject → assert `rollbackTransaction` được gọi, `commitTransaction` **KHÔNG** gọi, lỗi propagate; `release` vẫn được gọi (finally).
7. **`countByZoneId` được gọi đúng 1 lần với đúng `id`**.

**`zones.service.spec.ts` — audit cho create/update**
8. `create()` thành công → `logZoneCreation` gọi 1 lần trong transaction, `commitTransaction` gọi.
9. `create()` trùng mã (pre-check) → 409 **và** `logZoneCreation` **KHÔNG** gọi.
10. `update()` có thay đổi → `logZoneUpdate` gọi với `changes` đúng field đã đổi.
11. **`update()` no-op → KHÔNG `save` VÀ KHÔNG audit** (bảo vệ bất biến §2.4).
12. `update()` race `23505` → rollback + 409 cùng payload.

**`zones-audit.repository.spec.ts`**
13. 3 method chạy `entityManager.query` với `entity_type='zones'`, `action_type` đúng, `severity='info'`, tham số bind đúng thứ tự.
14. **SEC-01**: `logZoneUpdate` với `changes` chứa `metadataJson` → payload ghi ra **không** chứa nội dung metadata (chỉ cờ `changed: true`).

**`zones.controller.spec.ts`**
15. DELETE gọi `service.remove(id, user.userId)`; trả `{success:true, message:'Zone deleted successfully', data:null}`.
16. Assert metadata `PERMISSIONS_KEY` = `['zones.zone.delete']` + 2 guard.
17. `NotFoundException`/`ConflictException` propagate nguyên trạng.
18. **Cập nhật 2 test cũ**: POST/PATCH nay gọi service với tham số `userId` — **chỉ sửa phần assert tham số, KHÔNG đổi assert nghiệp vụ**.

**`iot-devices.service.spec.ts`**
19. `countByZoneId` gọi `manager.count(IoTDeviceEntity, { where: { zoneId } })` và trả đúng số.

**Nguyên tắc**: 100% mock; **KHÔNG** DB, **KHÔNG** migration, **KHÔNG** gọi service thật của `iot`.

## 8. Gate (STOP, KHÔNG commit)

- `npm run build` = 0 error; eslint trên toàn bộ file touched = 0 rule mới.
- `npx jest src/modules/zones` **và** `npx jest src/modules/iot` xanh.
- **Không hồi quy**: baseline **5 suite / 52 test** của `src/modules/zones` (23 UC-90 + 29 UC-91) phải **vẫn xanh**. **CẤM sửa test cũ cho qua** — chỉ được sửa phần **dựng provider/mock** và phần **assert tham số** do đổi chữ ký; **KHÔNG** được đổi assert nghiệp vụ. Test `src/modules/iot` cũng phải giữ nguyên số lượng pass.
- Coverage `ZonesService` ≥80%.
- **DI-proof**: `AppModule` compile preview mode — 0 `UnknownDependenciesException`, **0 circular** (đặc biệt kiểm cạnh `ZonesModule → IotModule`).
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS · **KHÔNG** live smoke · **KHÔNG** commit.
- **Bàn giao**: gọi thử `DELETE /api/v1/zones/:id` trên local cần chạy `20260722000003` (seed permission) trước; thiếu → 403, không phải lỗi code.
- **Owed**: UC-93 list/detail · UC-94 gán camera (**route phải ở phía `zones`** — OQ-1b) · restore zone (OQ-5) · FT-20/FT-21 tôn trọng `status='inactive'` và bỏ qua zone đã xoá mềm · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.

## 9. Kỷ luật

- **`zones → iot` MỘT CHIỀU VĨNH VIỄN** (OQ-1b): `IotModule` **CẤM** import `ZonesModule`; cấm `forwardRef`. UC-94 đặt route ở phía `zones` (`PATCH /api/v1/zones/:id/devices`).
- **CẤM hard-delete** (DATA-01): chỉ `softDelete`; không `repo.delete`/`remove`/raw `DELETE FROM zones`.
- **CẤM query thẳng bảng `iot_devices`** từ module `zones` (ARCH-01) — chỉ qua `IotDevicesService`.
- **Chặn theo thiết bị, KHÔNG theo log** (OQ-1): cấm thêm điều kiện đếm `gate_access_logs`/`zone_presence_events`.
- **Audit không được thiếu**: xoá/tạo/sửa thành công mà không có bản ghi audit là lỗi; audit lỗi → **rollback**.
- **SEC-01**: không đổ `zones.metadata_json` vào `audit_logs` (§3).
- **Hành vi nghiệp vụ của `create()`/`update()` KHÔNG được đổi** — chỉ thêm transaction + audit; no-op của `update()` vẫn không save và không audit.
- **Không migration schema**: cấm thêm `deleted_by`, cấm đổi FK/`ON DELETE`.
- **OQ-8 chỉ sửa JSDoc** của 2 entity — cấm đổi cột/decorator/relation.
- Không đụng `loadActive()`, `zoneCodeConflict()`, `isUniqueViolation()`, `toZoneResponse()`, các DTO/constant đã có; không đụng UC-93/UC-94.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
