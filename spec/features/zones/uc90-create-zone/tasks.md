# ZNC-001 — tasks.md (UC-90 Zones: tạo khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo tasks ZNC-001 sau plan DUYỆT: T0 verify (gồm **blocker `ssl` trùng → DỪNG**) → T1 constant+util → T2 DTO×2 → T3 service (crux pre-check + 23505) → T4 controller 1 route → T5 wiring module (thiếu `AuthModule` = crash boot) → T6 migration seed permission → T-GATE. Mỗi task 1 AC, code/test tách. No-migration-schema, no-audit, no-DataSource. | Toàn bộ |
| 2026-07-22 | Sửa 2 lỗi kỹ thuật theo chỉ đạo Thiếu Chủ: (1) case whitelist ở T2b đổi từ `plainToInstance` sang `new ValidationPipe({whitelist,transform}).transform(body, {type:'body', metatype: CreateZoneDto})` — `whitelist` là option của ValidationPipe nên test cũ chắc chắn fail; (2) T-GATE sửa số file touched **13 → 12** (7 code đã gồm migration + 4 test + 1 module). | T2B (case cuối + AC + dòng mở đầu), T-GATE (dòng eslint) |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** migration schema (bảng `zones` + 3 index đã có). **KHÔNG** mở lại plan §1 (OQ-1→OQ-9) và plan §8 (Kỷ luật). **KHÔNG** đụng `iot_devices.zone_id`, `gate_access_logs`, `zone_presence_events`, `vehicle_control_list`, `rooms`.

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T6 → T-GATE.

> Phụ thuộc: constant/util **trước** DTO (DTO import `ZONE_TYPES`) · DTO **trước** service (service nhận `CreateZoneDto`) · service **trước** controller · wiring **sau** khi controller/service tồn tại · migration độc lập nhưng phải **cùng commit** với controller (thiếu = 403).

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu tiên. Đọc CODE THẬT, dán xác nhận từng mục. **Thiếu mục / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **BLOCKER `ssl` trùng** — đếm số khai báo property `ssl` trong [src/database/data-source.ts](../../../../src/database/data-source.ts). Bản gốc **không có** `ssl`; working tree hiện có **2** khai báo (plan §7). **Nếu số khai báo ≠ 1 → DỪNG NGAY, báo Thiếu Chủ, KHÔNG code tiếp** — trùng property sẽ chặn `npm run build` và CLI TypeORM ở T-GATE. **KHÔNG tự sửa file này** (thay đổi dở dang của người khác).
2. `ZonesModule` ([zones.module.ts](../../../../src/modules/zones/zones.module.ts)) hiện **CHƯA có `AuthModule`** trong `imports`, chỉ có `TypeOrmModule.forFeature([ZoneEntity, GateAccessLogEntity, ZonePresenceEventEntity])` + `exports: [TypeOrmModule]`, **chưa có** `controllers`/`providers`. Xác nhận đúng hiện trạng **trước khi** sửa ở T5.
3. `ZoneEntity` ([zone.entity.ts](../../../../src/modules/zones/entities/zone.entity.ts)) còn nguyên mapping như plan §0: `zoneCode`/`zoneName`/`zoneType`/`building`/`floor`/`description`/`metadataJson`/`status` (default `'active'`) + `@CreateDateColumn`/`@UpdateDateColumn` + **`@DeleteDateColumn deletedAt`**. Xác nhận `@Entity('zones')`.
4. Migration cuối trong `src/database/migrations/` đúng là **`20260721000007-AddUniqueIndexDeviceUserMappings.ts`** → chốt timestamp file mới **`20260722000001`** (T6). Nếu đã có file `202607220000xx` khác do người khác thêm → chọn số kế tiếp chưa dùng và ghi rõ.
5. **Bảng `zones` ở DB local**: kiểm tra bảng `zones` + 3 index (`UQ_zones_code_active`, `IDX_zones_type`, `IDX_zones_building_floor`) có tồn tại chưa (plan §8: RDS đã có, local **có thể chưa**). Nếu chưa → **ghi nhận vào báo cáo, KHÔNG tự chạy `migration:run`**, báo Thiếu Chủ. Việc này **không chặn** T1→T6 (unit test mock repo, không cần DB), chỉ chặn smoke test thật.
6. **Quy ước import**: mọi import nội bộ trong `src/modules/zones/**` dùng đuôi **`.js`** (xác nhận trên `zones.module.ts:3-5`). Xác nhận vị trí import cần dùng: `@nestjs/common` (`Injectable`, `Controller`, `Post`, `Body`, `HttpCode`, `HttpStatus`, `UseGuards`, `UsePipes`, `ValidationPipe`, `ConflictException`), `@nestjs/typeorm` (`InjectRepository`, `getRepositoryToken`), `typeorm` (`Repository`, `IsNull`), `class-validator` (`IsString`, `IsNotEmpty`, `IsOptional`, `IsIn`, `IsObject`, `MaxLength`), `class-transformer` (`Expose`), guard/decorator từ `../../auth/...`.

- **AC**: dán xác nhận đủ **6 mục** kèm bằng chứng (path + trích dẫn ngắn). Mục 1 **≠ 1 khai báo `ssl` → DỪNG**. Mục 5 nếu local chưa có bảng → ghi nhận rõ, không chạy migration.

## T1 — Constant + util normalize (code) — plan §3.1/§3.3, OQ-4, OQ-5
- `src/modules/zones/constants/zone-type.constant.ts`: `ZONE_TYPES = ['room','gate','corridor','lobby','parking'] as const` + `export type ZoneType = (typeof ZONE_TYPES)[number]`. **Chốt dùng `@IsIn` (không TS `enum`)** — nhất quán cho toàn module `zones`, UC-91/93 tái dùng đúng hằng số này.
- `src/modules/zones/utils/normalize-zone-code.ts`: `normalizeZoneCode(raw: string): string` — **pure**, không phụ thuộc Nest. Phép biến đổi đúng thứ tự: `String(raw).trim().toUpperCase()`. **KHÔNG** strip ký tự (giữ `-`, `_`), **KHÔNG** bỏ dấu.
- JSDoc bắt buộc ghi: đây là **single source of truth** cho `zone_code`; UC-91 (đổi code) và UC-93 (tra cứu) PHẢI gọi cùng hàm, nếu không sẽ không khớp DB (mirror cảnh báo `normalize-plate.ts`).
- **AC**: 2 file tồn tại; `ZONE_TYPES` đúng 5 giá trị lowercase; `normalizeZoneCode` chỉ trim + uppercase, **không** biến đổi nào khác; 0 import từ `@nestjs/*` trong util.

## T1b — Util test — ENG-01
- `src/modules/zones/utils/normalize-zone-code.spec.ts`:
  - `' gate-01 '` → `'GATE-01'`; `'b1_lobby'` → `'B1_LOBBY'`;
  - **giữ nguyên `-`/`_`**: assert `normalizeZoneCode('GATE-01') !== 'GATE01'` (chống áp nhầm logic `normalizePlate`);
  - chuỗi rỗng / toàn khoảng trắng → `''`;
  - ký tự có dấu **không** bị bỏ dấu.
- **AC**: 4 nhóm case xanh; có ít nhất 1 assert chứng minh KHÔNG strip ký tự đặc biệt.

## T2 — DTO create + response mapper (code) — plan §3.2/§3.4, OQ-4, OQ-6, SEC-03
- `src/modules/zones/dto/create-zone.dto.ts` — `CreateZoneDto`:
  - `zoneCode` ← `@Expose({name:'zone_code'})` `@IsString` `@IsNotEmpty` `@MaxLength(80)`;
  - `zoneName` ← `@Expose({name:'zone_name'})` `@IsString` `@IsNotEmpty` `@MaxLength(150)`;
  - `zoneType` ← `@Expose({name:'zone_type'})` **`@IsIn([...ZONE_TYPES])` — REQUIRED, cấm `@IsOptional`, cấm dựa vào DB DEFAULT `'room'`** (OQ-4);
  - `building?` `@IsOptional @IsString @MaxLength(100)`; `floor?` `@IsOptional @IsString @MaxLength(30)`; `description?` `@IsOptional @IsString @MaxLength(255)` (nullable mọi `zone_type` — OQ-6);
  - `metadataJson?` ← `@Expose({name:'metadata_json'})` `@IsOptional @IsObject`.
  - **KHÔNG** khai `status`/`id`/`created_at`/`updated_at`/`deleted_at`. **KHÔNG** `@Transform` trim (chuẩn hoá tập trung ở service — T3).
- `src/modules/zones/dto/zone-response.dto.ts` — `toZoneResponse(entity: ZoneEntity)` trả object snake_case: `id`, `zone_code`, `zone_name`, `zone_type`, `building`, `floor`, `description`, `metadata_json`, `status`, `created_at`, `updated_at`. **KHÔNG** trả `deleted_at`.
- **AC**: `zone_type` bắt buộc + `@IsIn` 5 giá trị; độ dài khớp đúng DB (80/150/100/30/255); DTO không có field cấm; mapper không lộ `deleted_at`.

## T2b — DTO test — OQ-4, OQ-6, SEC-03
- `src/modules/zones/dto/create-zone.dto.spec.ts` — các case **validate** dùng `plainToInstance` + `validate`; riêng case whitelist dùng `ValidationPipe` (xem case cuối):
  - **thiếu `zone_type` → có lỗi validate** (case quan trọng nhất, bảo vệ OQ-4);
  - `zone_type: 'garden'` → lỗi `isIn`;
  - `zone_code` 81 ký tự → lỗi `maxLength`; `zone_name` 151 → lỗi; `floor` 31 → lỗi;
  - thiếu `zone_code` / thiếu `zone_name` → lỗi;
  - body chỉ có 3 field bắt buộc (`zone_code`,`zone_name`,`zone_type`) → **0 lỗi** (building/floor nullable — OQ-6);
  - **whitelist** — `whitelist` là option của **`ValidationPipe`**, KHÔNG phải của `plainToInstance` ⇒ case này **không** dùng `plainToInstance`, mà gọi trực tiếp `new ValidationPipe({ whitelist: true, transform: true }).transform(body, { type: 'body', metatype: CreateZoneDto })` với body chứa field lạ (`status`, `id`, `deleted_at`) + 3 field bắt buộc hợp lệ; assert kết quả trả về **không có** `status`/`id`/`deleted_at` và vẫn giữ đủ `zoneCode`/`zoneName`/`zoneType`. (Viết theo `plainToInstance` sẽ **fail** vì field lạ không bị loại.)
- **AC**: 7 nhóm case xanh; case "thiếu `zone_type` → lỗi" phải có mặt và pass; case whitelist chạy qua `ValidationPipe.transform`, KHÔNG qua `plainToInstance`.

## T3 — Service `ZonesService.create` (code) — plan §2, OQ-3/5/8, DATA-01, ENG-03
- `src/modules/zones/services/zones.service.ts`, `@Injectable`, constructor **chỉ** `@InjectRepository(ZoneEntity) private readonly repo: Repository<ZoneEntity>`. **CẤM** `DataSource`/`queryRunner`/repository audit (OQ-8).
- Helper module-level `zoneCodeConflict()` → `new ConflictException({ code: 'ZONE_CODE_EXISTS', message: 'Mã khu vực đã tồn tại' })` — dùng chung **cả** pre-check lẫn safety-net để 2 nhánh trả **cùng payload**.
- `async create(dto: CreateZoneDto): Promise<ZoneEntity>` — đúng thứ tự:
  1. `zoneCode = normalizeZoneCode(dto.zoneCode)`;
  2. **CRUX** `repo.findOne({ where: { zoneCode, deletedAt: IsNull() } })` → có row → `throw zoneCodeConflict()`. **`deletedAt: IsNull()` bắt buộc** (AGENTS.md §5.5 rule 1 + OQ-3: zone đã xoá-mềm KHÔNG được chặn tạo mới);
  3. `repo.create({ zoneCode, zoneName, zoneType, building: dto.building ?? null, floor: dto.floor ?? null, description: dto.description ?? null, metadataJson: dto.metadataJson ?? null })` — **KHÔNG** set `status`/`id`/timestamps/`deletedAt`;
  4. `try { return await repo.save(entity) } catch (e) { if (isUniqueViolation(e)) throw zoneCodeConflict(); throw e; }` với `private isUniqueViolation(e)` đọc `e.driverError?.code ?? e.code` so `'23505'` (copy logic `vehicle-registration.service.ts:212-218`).
- **KHÔNG** transaction, **KHÔNG** audit, service **KHÔNG nhận** `actorUserId`.
- **AC**: `create` đi qua đủ 4 bước theo đúng thứ tự; pre-check có `deletedAt: IsNull()`; 2 nhánh conflict trả **cùng** `ZONE_CODE_EXISTS`; lỗi DB khác `23505` được ném nguyên; 0 `DataSource`, 0 audit trong file.

## T3b — Service test (mock repo — KHÔNG DB) — plan §6, ENG-01, ENG-03
`Test.createTestingModule({ providers: [ZonesService, { provide: getRepositoryToken(ZoneEntity), useValue: repoMock }] })`, `repoMock = { findOne, create: (x)=>x, save: (x)=>Promise.resolve({id:'z1',...x}) }`. Phủ đủ **6 case** plan §6:
1. **Happy path** → `save` gọi đúng 1 lần; input `' gate-01 '` → `saved.zoneCode === 'GATE-01'`; `building/floor/description/metadataJson` = `null` khi absent; assert object truyền vào `create` **KHÔNG** chứa `status`/`id`/`deletedAt`.
2. **Trùng code đang sống** → `findOne` trả row → `rejects.toMatchObject({response:{code:'ZONE_CODE_EXISTS'}})`, assert **`save` KHÔNG được gọi**.
3. **Race `23505`** → `findOne` = `null`, `save` reject `{ driverError: { code: '23505' } }` → `ConflictException ZONE_CODE_EXISTS` **cùng payload** case 2; assert không rò `driverError`/stack ra response.
4. **Lỗi DB khác** (vd `'23503'`) → ném **nguyên lỗi**, KHÔNG nuốt thành 409.
5. **Tái dùng code đã soft-delete → tạo được** (bảo vệ OQ-3): assert `findOne` được gọi với `where` chứa `deletedAt: IsNull()`; mock trả `null` → `save` chạy bình thường.
6. **Chuẩn hoá nhất quán**: `'  gate-01  '` và `'GATE-01'` → cùng `zoneCode` truyền vào **cả** `findOne` **và** `create` (chống lệch giữa pre-check và bản ghi lưu).
- **AC**: 6 case xanh; case 2 chứng minh KHÔNG `save`; case 5 assert `deletedAt: IsNull()` xuất hiện trong `where`; coverage `ZonesService` ≥80% (ENG-01).

## T4 — Controller `ZonesController` 1 route (code) — plan §4, OQ-1/9, SEC-02, SEC-03
- `src/modules/zones/controllers/zones.controller.ts`, `@Controller('zones')` (prefix global `api/v1` từ `main.ts`).
- Hằng module-level `const ZONE_PIPE = new ValidationPipe({ whitelist: true, transform: true });` (mirror `REGISTER_PIPE`) — **bắt buộc khai tường minh**, repo không có global pipe.
- **Đúng 1 route**: `@Post()` + `@HttpCode(HttpStatus.CREATED)` + `@UseGuards(JwtAuthGuard, PermissionsGuard)` + **`@RequirePermissions('zones.zone.create')`** + `@UsePipes(ZONE_PIPE)`; handler `create(@Body() dto: CreateZoneDto)` → `this.zonesService.create(dto)` → envelope inline `{ success: true, message: 'Zone created successfully', data: toZoneResponse(entity) }`.
- **KHÔNG** `@CurrentUser()` (service không nhận actor). **KHÔNG** thêm route `GET`/`PATCH`/`DELETE` (UC-91/92/93).
- ⚠ Quên `@RequirePermissions` = **endpoint hở im lặng** (`permissions.guard.ts:25-27` không có metadata thì `return true`) — không có lỗi nào báo.
- **AC**: đúng 1 route `POST /api/v1/zones`, status `201`; có đủ `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('zones.zone.create')` + `ZONE_PIPE`; envelope đúng 3 khoá; 0 route thừa.

## T4b — Controller test (mock service + override guard) — SEC-02, ENG-03
- `src/modules/zones/controllers/zones.controller.spec.ts`:
  - gọi `service.create(dto)` đúng 1 lần với dto đã transform; trả envelope `{success:true, message:'Zone created successfully', data}`; status `201`;
  - **assert metadata**: `Reflector.get(PERMISSIONS_KEY, handler)` chứa `'zones.zone.create'` — chống hồi quy "quên decorator = endpoint hở";
  - service ném `ConflictException` → controller **không nuốt**, lỗi propagate nguyên trạng (không biến thành 500/200);
  - assert guard list gồm `JwtAuthGuard` **và** `PermissionsGuard`.
- **AC**: 4 nhóm case xanh; case assert `@RequirePermissions` bắt buộc có mặt.

## T5 — Wiring `ZonesModule` (code) — plan §0/§5, ARCH-01
Sửa `src/modules/zones/zones.module.ts` — **đúng 3 thay đổi**:
1. thêm `AuthModule` vào `imports` (import path `../auth/auth.module.js`);
2. thêm `controllers: [ZonesController]`;
3. thêm `providers: [ZonesService]`.
- **GIỮ NGUYÊN** `TypeOrmModule.forFeature([ZoneEntity, GateAccessLogEntity, ZonePresenceEventEntity])` và `exports: [TypeOrmModule]`.
- Cập nhật JSDoc đầu file: bỏ mô tả "SCHEMA-ONLY" (nay đã có nghiệp vụ UC-90), ghi rõ lý do import `AuthModule`.
- ⚠ **Thiếu `AuthModule` = CRASH lúc boot** (`UnknownDependenciesException`) chứ **không phải** lỗi 403: `PermissionsGuard` inject `AuthzReadRepository`, `JwtAuthGuard` cần `JwtService` + `CACHE_MANAGER` — cả 3 đều do `AuthModule` export. Tiền lệ: `anpr.module.ts` (`imports: [..., AuthModule]`).
- **KHÔNG** sửa `app.module.ts` (`ZonesModule` đã đăng ký sẵn).
- **AC**: module có đủ `AuthModule` + `controllers` + `providers`; `forFeature` 3 entity và `exports` **không đổi**; `app.module.ts` không bị chạm.

## T6 — Migration seed permission (code) — plan §5, OQ-1, OQ-2, SEC-02
- File: **`src/database/migrations/20260722000001-SeedZoneCreatePermission.ts`** (timestamp chốt ở T0 mục 4), class `SeedZoneCreatePermission20260722000001` + field `name` trùng tên class. **Đặt trong `migrations/`, TUYỆT ĐỐI KHÔNG đặt trong `src/database/seeds/`** — folder `seeds/` không có runner (AGENTS.md §5.5 rule 4) → seed sẽ không bao giờ chạy và mọi request trả 403.
- `up()` — idempotent hoàn toàn, mẫu duy nhất là [20260718000008-SeedRoleReadPermission.ts](../../../../src/database/migrations/20260718000008-SeedRoleReadPermission.ts):
  1. `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (permission_code) DO NOTHING RETURNING id;` với `permission_code = 'zones.zone.create'`, `module_code = 'zones'`, `action_code = 'create'`;
  2. nếu không có `RETURNING id` → fallback `SELECT id FROM permissions WHERE permission_code = $1`; vẫn không có → `return`;
  3. với mỗi role trong **`['SYSTEM_ADMIN','BUSINESS_ADMIN']`** (OQ-2): `INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true ON CONFLICT (role_id, permission_id) DO NOTHING;`
- `down()`: xoá `role_permissions` theo `permission_id IN (SELECT id FROM permissions WHERE permission_code = $1)` **trước**, rồi `DELETE FROM permissions WHERE permission_code = $1`.
- **CẤM** seed `ADMIN`/`INTERNAL_USER` (mã lỗi thời, không tồn tại → im lặng không gán). **CẤM** format 2 tầng `zones:create`.
- Chỉ tạo file. **KHÔNG chạy `migration:run`** (T-GATE cấm).
- **AC**: file đúng tên/vị trí `migrations/`; `permission_code='zones.zone.create'`, `module_code='zones'`, `action_code='create'`; gán đúng 2 role; `up()` idempotent (chạy lại nhiều lần không lỗi/không nhân bản); `down()` xoá đúng thứ tự.

## T-GATE — (STOP, KHÔNG commit) — plan §7
- `npm run build` = **0 error**. ⚠ Nếu T0 mục 1 phát hiện `ssl` trùng mà chưa được xử → build **sẽ fail vì file của người khác**, không phải lỗi UC-90 → báo Thiếu Chủ, **KHÔNG tự sửa `data-source.ts`**.
- eslint trên **12 file touched** (7 code — đã gồm migration — + 4 test + 1 module) = **0 rule mới**, file mới 0 lỗi.
- `npx jest src/modules/zones` **xanh**; coverage `ZonesService` **≥80%** (ENG-01).
- **DI-proof**: compile `AppModule` — `ZonesModule` resolve được `JwtAuthGuard`/`PermissionsGuard` sau khi thêm `AuthModule`; **0 `UnknownDependenciesException`**, **0 circular import**.
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS chung · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout · throwaway script xoá sạch.
- In: danh sách file đầy đủ + kết quả jest + coverage + báo cáo gate.
- **Bàn giao (quan trọng)**: sau khi Thiếu Chủ duyệt code, muốn gọi thử endpoint thật thì **phải chạy migration seed permission trên local trước**; nếu bỏ qua, mọi request `POST /api/v1/zones` sẽ trả **403 `FORBIDDEN`** — đó là thiếu permission trong DB, **không phải lỗi code**. Nếu T0 mục 5 báo local chưa có bảng `zones` thì phải chạy `20260721000001` ở local trước nữa (**chỉ local, KHÔNG RDS**).
- **Owed (ghi, KHÔNG làm)**: UC-91 sửa zone · UC-92 xoá zone **+ audit cho cả cụm zone (nợ OQ-8)** · UC-93 list/detail (FE cần để lấy `id`) · UC-94 gán camera vào zone · global exception filter (nợ OQ-7.2) · Swagger (nợ OQ-7.4) · 5 file `spec/global/` rỗng (nợ OQ-7.5) · quyết định kiến trúc `zones` ↔ `rooms` · live smoke khi có DB.
- **AC**: bảng gate đầy đủ + báo cáo tick: `zone_type` required chặn 400 ✓ · pre-check lọc `deletedAt IS NULL` ✓ · tái dùng code đã soft-delete tạo được ✓ · 2 nhánh conflict cùng `ZONE_CODE_EXISTS` ✓ · `23505` không rò stack ✓ · `@RequirePermissions('zones.zone.create')` có mặt (test assert) ✓ · `AuthModule` đã wiring, DI-proof sạch ✓ · migration seed đúng `migrations/` + 2 role ✓ · 0 `DataSource`/audit ✓ · 0 migration schema ✓ · coverage ✓. **STOP.**

## Map task → scope UC-90
- **T0** → verify blocker `ssl` · hiện trạng `ZonesModule`/`ZoneEntity` · timestamp migration · bảng `zones` ở local · quy ước import
- **T1/T1b** → `ZONE_TYPES` (OQ-4) + `normalizeZoneCode` (OQ-5) + test util
- **T2/T2b** → `CreateZoneDto` (`zone_type` required) + `toZoneResponse` + test DTO
- **T3/T3b** → `ZonesService.create` (CRUX pre-check `deletedAt IS NULL` + safety-net `23505`) + test 6 case
- **T4/T4b** → `ZonesController` 1 route `POST /api/v1/zones` + gate permission + test (assert metadata)
- **T5** → wiring `ZonesModule` (AuthModule + controllers + providers)
- **T6** → migration seed `zones.zone.create` → SYSTEM_ADMIN + BUSINESS_ADMIN
- **T-GATE** → gate + STOP + bàn giao (phải seed permission mới gọi được endpoint) + Owed (UC-91/92/93/94 · audit · filter · Swagger)
