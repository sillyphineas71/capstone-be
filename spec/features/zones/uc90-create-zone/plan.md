# ZNC-001 — plan.md (UC-90 Zones: tạo khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo plan ZNC-001 sau spec DUYỆT + chốt OQ-1→OQ-9. 1 route `POST /api/v1/zones`, 1 service method `create`, 1 DTO + 1 mapper + 1 constant + 1 util normalize, **1 migration seed permission** (`zones.zone.create` → SYSTEM_ADMIN + BUSINESS_ADMIN). Crux = trùng `zone_code` đang sống (pre-check + safety-net 23505). RECON bổ sung: `ZonesModule` **thiếu `AuthModule`** → phải thêm, nếu không `PermissionsGuard`/`JwtAuthGuard` không resolve được dependency. No-migration-schema, no-audit, no-DataSource. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **`ZonesModule` hiện KHÔNG import `AuthModule`** ([zones.module.ts:18-28](../../../../src/modules/zones/zones.module.ts)) — chỉ có `TypeOrmModule.forFeature([...])` + `exports: [TypeOrmModule]`. Trong khi:
  - `PermissionsGuard` inject `Reflector` + **`AuthzReadRepository`** ([permissions.guard.ts:14-17](../../../../src/modules/auth/guards/permissions.guard.ts));
  - `JwtAuthGuard` cần `JwtService` + `CACHE_MANAGER`;
  - `AuthModule` export sẵn cả `JwtModule`, `CacheModule`, `AuthzReadRepository`, `JwtAuthGuard`, `PermissionsGuard` ([auth.module.ts:61-90](../../../../src/modules/auth/auth.module.ts)).
  ⇒ **Bắt buộc thêm `AuthModule` vào `imports` của `ZonesModule`**, đúng tiền lệ [anpr.module.ts:36](../../../../src/modules/anpr/anpr.module.ts) (*"Import AuthModule để dùng PermissionsGuard thật"*). Thiếu bước này → `UnknownDependenciesException` lúc boot, **không** phải lỗi 403.
- **`PermissionsGuard` đọc metadata** qua `reflector.getAllAndOverride(PERMISSIONS_KEY, [handler, class])`, `PERMISSIONS_KEY = 'permissions'` ([require-permissions.decorator.ts:3-5](../../../../src/modules/auth/decorators/require-permissions.decorator.ts)). Không có metadata → **pass** ([permissions.guard.ts:25-27](../../../../src/modules/auth/guards/permissions.guard.ts)) ⇒ quên `@RequirePermissions` = endpoint hở, không báo lỗi. Thiếu quyền → `ForbiddenException` với body **đã đúng envelope** `{success:false, message, error:{code:'FORBIDDEN', details:{}}}` ([:33-58](../../../../src/modules/auth/guards/permissions.guard.ts)) — không cần xử thêm ở controller.
- **Migration mới tự nhận, không cần đăng ký**: `migrations: [path.join(__dirname, './migrations/*.{ts,js}')]`, `migrationsTableName: 'typeorm_migrations'` ([data-source.ts:32-33](../../../../src/database/data-source.ts)). Migration cuối hiện có là `20260721000007-AddUniqueIndexDeviceUserMappings.ts` ⇒ file mới đặt **`20260722000001-SeedZoneCreatePermission.ts`**, class `SeedZoneCreatePermission20260722000001` + field `name` trùng tên class (mẫu [20260718000008:7-8](../../../../src/database/migrations/20260718000008-SeedRoleReadPermission.ts)).
- **`ParseUUIDPipe` KHÔNG cần cho UC-90**: route `POST /zones` không có param `:id`. (Tiền lệ [iot-devices.controller.ts:70](../../../../src/modules/iot/controllers/iot-devices.controller.ts) để dành cho UC-91/92/93.)
- **Quy ước import trong module `zones`**: mọi import nội bộ dùng đuôi **`.js`** (`./entities/zone.entity.js` — [zones.module.ts:3-5](../../../../src/modules/zones/zones.module.ts)), giống `anpr`. File mới phải theo đúng quy ước này.
- **Mẫu unit test mock repo** ([vehicle-registration.service.spec.ts:16-34](../../../../src/modules/anpr/services/vehicle-registration.service.spec.ts)): `Test.createTestingModule({ providers: [Service, { provide: getRepositoryToken(Entity), useValue: repoMock }] })` với `repoMock = { findOne, create: (x)=>x, save: (x)=>Promise.resolve({id:'...', ...x}) }`; assert lỗi bằng `rejects.toMatchObject({ response: { code: '...' } })`. **Không chạm DB.**
- **`ZoneEntity` đã có `default: 'active'` cho `status`** ([zone.entity.ts:47-48](../../../../src/modules/zones/entities/zone.entity.ts)) và DB cũng có DEFAULT ⇒ **không set `status` trong `repo.create`**; giá trị `'active'` đến từ default (app hoặc DB đều cho cùng kết quả).
- **`app.module.ts` KHÔNG cần sửa**: `ZonesModule` đã nằm trong `imports` ([app.module.ts:41,112](../../../../src/app.module.ts)).

## 1. Quyết định đã chốt (OQ + Constitution)

OQ-1 `zones.zone.create` (`module_code='zones'`, format 3 tầng) · OQ-2 `SYSTEM_ADMIN`+`BUSINESS_ADMIN` · OQ-3 cho phép tái dùng `zone_code` sau soft-delete (lịch sử khoá theo `zone_id`) · **OQ-4 `zone_type` BẮT BUỘC**, danh sách cứng 5 giá trị trong `constants/zone-type.constant.ts` · OQ-5 normalize **trim + toUpperCase**, hàm pure `utils/normalize-zone-code.ts` · OQ-6 `building`/`floor` nullable mọi zone_type · OQ-7.1 bám 4 role code thật · OQ-7.2 giữ error shape hiện trạng · OQ-7.4/7.5 ghi nợ · **OQ-8 KHÔNG audit, KHÔNG `DataSource`/`queryRunner`** · OQ-9 `POST /api/v1/zones`, mã `ZNC-001`.

- **SEC-02** endpoint mutating → `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('zones.zone.create')`; thiếu decorator = hở (§0).
- **SEC-03** DTO `class-validator` + `ValidationPipe({whitelist:true, transform:true})` khai **tường minh** ở controller (repo không có global pipe); chỉ dùng repository API (bind tham số), 0 raw SQL trong service.
- **DATA-01** UC-90 không xoá gì, nhưng **mọi lookup phải lọc `deletedAt: IsNull()`** — đúng ngữ nghĩa `UQ_zones_code_active` + AGENTS.md §5.5 rule 1.
- **ARCH-01** controller → service → repository, mirror ANPR; `@InjectRepository(ZoneEntity)` thuần.
- **ARCH-03 ĐẠT** — [`constitution.md:45-46`](../../../global/constitution.md) cho phép *natural idempotency design*; `UQ_zones_code_active` chính là cơ chế đó. **Không** cần `Idempotency-Key`.
- **ENG-03** lỗi nghiệp vụ ném `{code, message}`; `23505` dịch thành 409 sạch, 0 stack trace ra client.
- **DATA-03** **no-migration-schema** — bảng `zones` + 3 index đã tồn tại; migration duy nhất của UC-90 là **seed permission**.

## 2. Service — method chi tiết

**File**: `src/modules/zones/services/zones.service.ts` · **Class**: `ZonesService` (`@Injectable`)
**Constructor**: `@InjectRepository(ZoneEntity) private readonly repo: Repository<ZoneEntity>` — **chỉ repository**, KHÔNG `DataSource`, KHÔNG `queryRunner`, KHÔNG repository audit (OQ-8).

**Helper module-level** (mirror `plateConflict()` [vehicle-registration.service.ts:30-34](../../../../src/modules/anpr/services/vehicle-registration.service.ts)):
- `zoneCodeConflict(): ConflictException` → `new ConflictException({ code: 'ZONE_CODE_EXISTS', message: 'Mã khu vực đã tồn tại' })`. Dùng chung cho **cả pre-check lẫn safety-net** để 2 nhánh trả **cùng một** payload.

**`async create(dto: CreateZoneDto): Promise<ZoneEntity>`** — thứ tự bước bắt buộc:
1. `const zoneCode = normalizeZoneCode(dto.zoneCode);` (trim + toUpperCase).
2. **Pre-check (crux)**: `await this.repo.findOne({ where: { zoneCode, deletedAt: IsNull() } })` → nếu có row → `throw zoneCodeConflict()`.
   - `deletedAt: IsNull()` là **bắt buộc**, đúng ngữ nghĩa partial unique; bỏ đi sẽ chặn nhầm zone đã xoá-mềm (vi phạm OQ-3).
3. `const entity = this.repo.create({ zoneCode, zoneName: dto.zoneName, zoneType: dto.zoneType, building: dto.building ?? null, floor: dto.floor ?? null, description: dto.description ?? null, metadataJson: dto.metadataJson ?? null })`.
   - **KHÔNG** set `status` (default `'active'`), **KHÔNG** set `id`/timestamps/`deletedAt`.
4. `try { return await this.repo.save(entity); } catch (e) { if (isUniqueViolation(e)) throw zoneCodeConflict(); throw e; }`
   - `private isUniqueViolation(e: unknown): boolean` — đọc `e.driverError?.code ?? e.code`, so `'23505'`, **copy nguyên logic** [vehicle-registration.service.ts:212-218](../../../../src/modules/anpr/services/vehicle-registration.service.ts).
5. **Không** ghi audit, **không** transaction (1 bảng, 1 lệnh ghi).

**Service KHÔNG nhận `actorUserId`** — bảng không có `created_by` và UC-90 không audit ⇒ không có nơi tiêu thụ. Ai gọi được kiểm ở tầng guard.

## 3. DTO

### 3.1. `src/modules/zones/constants/zone-type.constant.ts` (net-new)
- `export const ZONE_TYPES = ['room', 'gate', 'corridor', 'lobby', 'parking'] as const;`
- `export type ZoneType = (typeof ZONE_TYPES)[number];`
- **Chọn `@IsIn` (không dùng TS `enum`)**: DB lưu chuỗi lowercase không enum (§0.1 spec) → `as const` phản ánh đúng dữ liệu và tránh sai lệch tên/giá trị của `enum`. Đây là chuẩn **nhất quán cho toàn module `zones`** (UC-91/93 dùng lại đúng hằng số này).

### 3.2. `src/modules/zones/dto/create-zone.dto.ts` (net-new) — `CreateZoneDto`
| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `zoneCode: string` | `zone_code` | `@Expose({name:'zone_code'})` `@IsString` `@IsNotEmpty` `@MaxLength(80)` |
| `zoneName: string` | `zone_name` | `@Expose({name:'zone_name'})` `@IsString` `@IsNotEmpty` `@MaxLength(150)` |
| `zoneType: ZoneType` | `zone_type` | `@Expose({name:'zone_type'})` **`@IsIn([...ZONE_TYPES])`** — **required, KHÔNG `@IsOptional`** (OQ-4) |
| `building?: string` | `building` | `@IsOptional` `@IsString` `@MaxLength(100)` |
| `floor?: string` | `floor` | `@IsOptional` `@IsString` `@MaxLength(30)` |
| `description?: string` | `description` | `@IsOptional` `@IsString` `@MaxLength(255)` |
| `metadataJson?: Record<string, unknown>` | `metadata_json` | `@Expose({name:'metadata_json'})` `@IsOptional` `@IsObject` |

- **KHÔNG** khai `status`, `id`, `created_at`, `updated_at`, `deleted_at` → `whitelist:true` loại sạch nếu client lén gửi.
- **KHÔNG** `@Transform` trim trong DTO: chuẩn hoá tập trung ở `normalizeZoneCode` (1 nguồn duy nhất, UC-91/93 tái dùng).

### 3.3. `src/modules/zones/utils/normalize-zone-code.ts` (net-new)
- `export function normalizeZoneCode(raw: string): string` — pure, **không** phụ thuộc Nest. Phép biến đổi đúng thứ tự: `String(raw).trim().toUpperCase()`. **KHÔNG** strip ký tự (giữ `-`, `_`), **KHÔNG** bỏ dấu.
- JSDoc phải ghi rõ: đây là **single source of truth**, UC-91 (đổi code) và UC-93 (tra cứu) PHẢI gọi cùng hàm này, nếu không `zone_code` sẽ không khớp DB (mirror cảnh báo trong `normalize-plate.ts`).

### 3.4. `src/modules/zones/dto/zone-response.dto.ts` (net-new)
- `export function toZoneResponse(entity: ZoneEntity)` → object snake_case: `id`, `zone_code`, `zone_name`, `zone_type`, `building`, `floor`, `description`, `metadata_json`, `status`, `created_at`, `updated_at`.
- **KHÔNG** trả `deleted_at`. Mirror `toVehicleRegistrationResponse`.

## 4. Controller — route

**File**: `src/modules/zones/controllers/zones.controller.ts` · **Class**: `ZonesController` · `@Controller('zones')` (prefix global `api/v1` do [main.ts:11](../../../../src/main.ts)).

- Hằng module-level: `const ZONE_PIPE = new ValidationPipe({ whitelist: true, transform: true });` (mirror `REGISTER_PIPE` [vehicle-registration.controller.ts:33](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)).
- **1 route duy nhất**:

```text
POST /api/v1/zones
```
- `@Post()` · `@HttpCode(HttpStatus.CREATED)` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('zones.zone.create')` · `@UsePipes(ZONE_PIPE)`.
- Handler: `async create(@Body() dto: CreateZoneDto)` → gọi `this.zonesService.create(dto)` → trả **envelope inline**:
  `{ success: true, message: 'Zone created successfully', data: toZoneResponse(entity) }`.
- **KHÔNG** `@CurrentUser()` (service không nhận actor — §2). **KHÔNG** route `GET`/`PATCH`/`DELETE` (UC-91/92/93).

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| Tạo thành công | `201` | — |
| Thiếu/sai `zone_code`,`zone_name`,`zone_type`; vượt `MaxLength`; `zone_type` ngoài danh sách | `400` | (Nest validation) |
| Không có/không hợp lệ JWT | `401` | — |
| Thiếu permission `zones.zone.create` | `403` | `FORBIDDEN` (do guard) |
| Trùng `zone_code` đang sống (pre-check **hoặc** race 23505) | `409` | `ZONE_CODE_EXISTS` |

## 5. File list

### Net-new
**Code (7)**
- `src/modules/zones/constants/zone-type.constant.ts`
- `src/modules/zones/utils/normalize-zone-code.ts`
- `src/modules/zones/dto/create-zone.dto.ts`
- `src/modules/zones/dto/zone-response.dto.ts`
- `src/modules/zones/services/zones.service.ts`
- `src/modules/zones/controllers/zones.controller.ts`
- `src/database/migrations/20260722000001-SeedZoneCreatePermission.ts` — seed `zones.zone.create` (`module_code='zones'`, `action_code='create'`), gán `SYSTEM_ADMIN` + `BUSINESS_ADMIN`; `up()` idempotent (`ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id`; `role_permissions` `ON CONFLICT (role_id, permission_id) DO NOTHING`), `down()` xoá `role_permissions` trước rồi `permissions`. **Mẫu duy nhất**: [20260718000008-SeedRoleReadPermission.ts](../../../../src/database/migrations/20260718000008-SeedRoleReadPermission.ts). **Đặt trong `migrations/`, KHÔNG đặt trong `seeds/`** (folder `seeds/` không có runner — AGENTS.md §5.5 rule 4).

**Test (4)**
- `src/modules/zones/utils/normalize-zone-code.spec.ts`
- `src/modules/zones/dto/create-zone.dto.spec.ts`
- `src/modules/zones/services/zones.service.spec.ts`
- `src/modules/zones/controllers/zones.controller.spec.ts`

### Modified
- `src/modules/zones/zones.module.ts` — **3 thay đổi**: (1) thêm `AuthModule` vào `imports` (bắt buộc, §0); (2) thêm `controllers: [ZonesController]`; (3) thêm `providers: [ZonesService]`. **Giữ nguyên** `TypeOrmModule.forFeature([ZoneEntity, GateAccessLogEntity, ZonePresenceEventEntity])` và `exports: [TypeOrmModule]`. Cập nhật JSDoc đầu file (không còn "SCHEMA-ONLY" — nay có nghiệp vụ UC-90).

> Tổng **11 net-new (7 code + 4 test) + 1 modified**. **0 migration schema.** `app.module.ts` KHÔNG đổi · `zone.entity.ts` KHÔNG đổi · `data-source.ts` KHÔNG đổi (glob tự nhận migration) · 0 file ngoài `modules/zones` + 1 migration.

## 6. Test (mock repo — KHÔNG DB)

**`zones.service.spec.ts`** (`getRepositoryToken(ZoneEntity)` + mock `{findOne, create, save}`):
1. **Happy path** → `repo.save` gọi đúng 1 lần; assert `saved.zoneCode === 'GATE-01'` khi input `' gate-01 '`; `zoneType` giữ nguyên giá trị gửi; `building/floor/description/metadataJson` = `null` khi absent; **assert KHÔNG set `status`/`id`/`deletedAt`** trong object truyền vào `create`.
2. **Trùng code đang sống** → `findOne` trả row → `ConflictException` `{response:{code:'ZONE_CODE_EXISTS'}}`, assert **`save` KHÔNG được gọi**.
3. **Race `23505`** → `findOne` trả `null` nhưng `save` reject với `{ driverError: { code: '23505' } }` → nhận `ConflictException` `ZONE_CODE_EXISTS` (**cùng payload** với case 2), KHÔNG rò `driverError`/stack ra ngoài.
4. **Lỗi DB khác** (vd `code: '23503'`) → **ném nguyên lỗi**, KHÔNG nuốt thành 409.
5. **Tái dùng code đã soft-delete → 201**: assert `findOne` được gọi với `where` chứa `deletedAt: IsNull()` (mock trả `null` vì bản ghi cũ đã xoá) → `save` chạy bình thường. Đây là test bảo vệ OQ-3.
6. **Chuẩn hoá**: input `'  gate-01  '` và `'GATE-01'` → cùng `zoneCode` truyền vào `findOne` **và** `create` (chống lệch giữa pre-check và bản ghi lưu).

**`normalize-zone-code.spec.ts`**: `' gate-01 '`→`'GATE-01'` · `'b1_lobby'`→`'B1_LOBBY'` · **giữ nguyên `-`/`_`** (assert `'GATE-01' !== 'GATE01'`) · chuỗi rỗng/khoảng trắng → `''` · không đổi ký tự có dấu (không bỏ dấu).

**`create-zone.dto.spec.ts`** (`plainToInstance` + `validate`, mirror `list-iot-devices-query.dto.spec.ts`):
- thiếu `zone_type` → **400 / có lỗi validate** (test bảo vệ OQ-4, quan trọng nhất);
- `zone_type: 'garden'` (ngoài danh sách) → lỗi `isIn`;
- `zone_code` 81 ký tự → lỗi `maxLength`; `zone_name` 151 → lỗi; `floor` 31 → lỗi;
- thiếu `zone_code` / `zone_name` → lỗi;
- body hợp lệ chỉ với 3 field bắt buộc → **0 lỗi** (`building`/`floor` nullable — OQ-6);
- field lạ (`status`, `id`, `deleted_at`) → bị `whitelist` loại, không lọt vào instance.

**`zones.controller.spec.ts`** (mock `ZonesService`, override guard):
- gọi service đúng 1 lần với dto đã transform; envelope trả đúng `{success:true, message:'Zone created successfully', data}`; status `201`;
- metadata guard: assert route có `@RequirePermissions('zones.zone.create')` (đọc qua `Reflector.get(PERMISSIONS_KEY, handler)`) — chống hồi quy "quên decorator = endpoint hở" (§0);
- service ném `ConflictException` → controller **không** nuốt, lỗi propagate nguyên trạng.

**Nguyên tắc**: 100% mock repository/service, **KHÔNG** kết nối DB, **KHÔNG** chạy migration, **KHÔNG** gọi Face Server/IVSS. Coverage ≥80% cho `ZonesService` (ENG-01).

## 7. Gate (STOP, KHÔNG commit)

Điều kiện đóng plan → chỉ được sang `tasks.md` **sau khi Thiếu Chủ duyệt plan này**.

Gate dự kiến khi code (ghi để tasks bám theo, **chưa chạy gì ở bước này**):
- `npm run build` = 0 error; eslint trên file touched: **0 rule mới**;
- `npx jest src/modules/zones` xanh; coverage `ZonesService` ≥80%;
- **DI-proof**: compile `AppModule` xác nhận `ZonesModule` resolve được `JwtAuthGuard`/`PermissionsGuard` sau khi thêm `AuthModule` — 0 `UnknownDependenciesException`, 0 circular;
- **KHÔNG** chạy `migration:run` (kể cả local) trong bước code; **KHÔNG** chạm RDS chung; **KHÔNG** live smoke.
- ⚠ **Blocker tiền đề (không thuộc UC-90, KHÔNG tự sửa)**: [data-source.ts:27,29](../../../../src/database/data-source.ts) hiện có **`ssl` khai 2 lần** trong working tree (chưa commit) → TS báo trùng property, có thể chặn `build`/CLI TypeORM. Phải báo chủ sở hữu thay đổi đó xử trước khi gate build.

**Owed (ghi, KHÔNG làm)**: UC-91 sửa zone · UC-92 xoá zone **+ audit cho cả cụm zone (nợ OQ-8)** · UC-93 list/detail (FE cần để lấy `id`) · UC-94 gán camera vào zone · global exception filter (nợ OQ-7.2) · Swagger (nợ OQ-7.4) · 5 file `spec/global/` rỗng (nợ OQ-7.5) · quyết định kiến trúc `zones` ↔ `rooms`.

## 8. Kỷ luật

- **No-migration-schema**: bảng `zones` + 3 index đã tồn tại → **cấm** `CREATE/ALTER` bảng `zones`. Migration duy nhất = seed permission.
- **No-audit / No-DataSource** (OQ-8): service chỉ `@InjectRepository`; ai thêm `queryRunner` là lệch quyết định.
- **`deletedAt: IsNull()` trong mọi lookup** (AGENTS.md §5.5 rule 1) — FK `zone_id` không tự NULL khi zone bị xoá mềm.
- **`zone_type` bắt buộc** (OQ-4): cấm `@IsOptional`, cấm dựa vào DB DEFAULT `'room'`.
- **1 nguồn chuẩn hoá** (OQ-5): mọi nơi đụng `zone_code` gọi `normalizeZoneCode`; cấm trim/uppercase rải rác.
- **Permission format 3 tầng** (OQ-1): `zones.zone.create`; cấm dùng lại kiểu cũ `zones:create`.
- **Role**: chỉ `SYSTEM_ADMIN` + `BUSINESS_ADMIN`; cấm seed `ADMIN`/`INTERNAL_USER` (không tồn tại → im lặng không gán).
- KHÔNG đụng `iot_devices.zone_id`, `gate_access_logs`, `zone_presence_events`, `vehicle_control_list`, `rooms` · KHÔNG WebSocket/notification · KHÔNG bulk import.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
