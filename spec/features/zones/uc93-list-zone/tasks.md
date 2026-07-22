# ZNL-001 — tasks.md (UC-93 Zones: xem & tra cứu khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo tasks ZNL-001 sau plan DUYỆT: T0 verify → T1 `ListZonesQueryDto` → T2 `PaginationMeta` + `list()` + `getDetail()` → T3 controller 2 route `GET` (static TRƯỚC `:id`) → T4 migration seed `zones.zone.read` (**4 ROLE**) → T-GATE. **Tasks bám TRẠNG THÁI SAU UC-92**, không bám giả định trong plan §0 (plan viết khi UC-92 chưa landing): `ZonesService` nay có **4 dependency**, `create`/`update` nhận `actorUserId`, controller có sẵn 3 route + `@CurrentUser`, baseline **6 suite / 74 test**, migration kế tiếp **`20260722000004`**. UC-93 vẫn **READ-ONLY tuyệt đối**. | Toàn bộ |

| 2026-07-22 | Review phát hiện 1 lỗ hổng + 1 chỗ dễ hiểu ngược, bổ sung trước khi code: (1) **T2b thiếu case `search` KẾT HỢP filter** → thêm **case 10b** (assert QueryBuilder nhận CẢ filter LẪN `ILIKE`) — nhánh QueryBuilder tự gắn từng điều kiện nên rất dễ quên filter, gây **kết quả sai âm thầm**; tổng service test 15 → **16 case**. (2) Làm rõ: thêm `findAndCount`/`createQueryBuilder` vào mock `repo` dùng chung thuộc loại **(a) dựng mock → ĐƯỢC PHÉP**, vẫn CẤM đổi assert của 74 test cũ. (3) Chốt tên handler detail của controller là **`detail`** cho T3 và T3b khớp nhau. | T2b (case 10b + ghi chú ranh giới + AC 15→16 case) |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại plan §1 (OQ-1→OQ-9) và plan §8 (Kỷ luật). **KHÔNG** sửa `zones.module.ts`, `zone.entity.ts`, `zone-response.dto.ts`, `create-zone.dto.ts`, `update-zone.dto.ts`, `normalize-zone-code.ts`, `zones-audit.repository.ts`, các constant, `app.module.ts`, `data-source.ts`, `iot.module.ts`, hay **bất kỳ file nào của module `iot`**. **KHÔNG** làm gì thuộc UC-94 (gán camera). **KHÔNG** migration schema.

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T-GATE.

> **Phụ thuộc**: `ListZonesQueryDto` (T1) trước service (T2 nhận DTO này) · service trước controller (T3 gọi `list`/`getDetail`) · migration (T4) độc lập nhưng phải **cùng commit** với controller (thiếu seed = 403).
>
> **KHÔNG có task wiring module** — `zones.module.ts` đã đủ từ UC-90/UC-92 (`AuthModule`, `IotModule`, `controllers`, `providers`). **KHÔNG có task audit** — UC-93 read-only.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu tiên. **Plan UC-93 được viết TRƯỚC khi UC-92 landing**, nên T0 phải xác nhận lại trạng thái MỚI. Dán xác nhận từng mục. **Thiếu / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **Baseline test**: đếm suite/test thực tế trong `src/modules/zones` — **kỳ vọng 6 suite / 74 test** (52 của UC-90+91 + 22 của UC-92). Lệch → ghi nhận và báo **trước khi** code. Con số này dùng đối chiếu không hồi quy ở T-GATE.
2. **`ZonesService` constructor có ĐÚNG 4 dependency** ([zones.service.ts](../../../../src/modules/zones/services/zones.service.ts)): `@InjectRepository(ZoneEntity) repo`, `DataSource`, `ZonesAuditRepository`, `IotDevicesService`. Xác nhận `zones.service.spec.ts` dựng module với **4 provider** (mock `DataSource.createQueryRunner`, `ZonesAuditRepository`, `IotDevicesService`) — **ghi lại cách dựng** để test mới của T2b **tái dùng bộ mock có sẵn**, KHÔNG dựng lại kiểu 1 provider như plan mô tả.
3. **Chữ ký thực tế** (đã đổi ở UC-92): `create(dto: CreateZoneDto, actorUserId: string)`, `update(id, dto, actorUserId)`, `remove(id, actorUserId)`; **`loadActive(id)` vẫn `private`**. UC-93 **KHÔNG** đụng 4 method này.
4. **`ZonesController` hiện có 3 route** (`@Post()`, `@Patch(':id')`, `@Delete(':id')`), **cả 3 đều nhận `@CurrentUser()`**. Xác nhận import nào **đã có** (`Body`, `Controller`, `Delete`, `HttpCode`, `HttpStatus`, `Param`, `ParseUUIDPipe`, `Patch`, `Post`, `UseGuards`, `UsePipes`, `ValidationPipe`, `CurrentUser`, guards, `ZONE_PIPE`) và **thiếu `Get`, `Query`** → T3 phải bổ sung đúng 2 import này.
5. **Timestamp migration**: đếm thực tế trong `src/database/migrations/` — **kỳ vọng file cuối là `20260722000003-SeedZoneDeletePermission.ts`** (UC-92 đã lấy `...0003`) ⇒ UC-93 lấy **`20260722000004`**. Nếu đã tồn tại `20260722000004*` → lấy số kế tiếp chưa dùng và **ghi rõ**.
6. **Constant tái dùng**: `ZONE_TYPES` ([constants/zone-type.constant.ts](../../../../src/modules/zones/constants/zone-type.constant.ts), 5 giá trị) và `ZONE_STATUSES` ([constants/zone-status.constant.ts](../../../../src/modules/zones/constants/zone-status.constant.ts), `['active','inactive']`) đều tồn tại ⇒ DTO import dùng lại, **CẤM** khai lại danh sách rời rạc.
7. **Mapper tái dùng**: `toZoneResponse` ([dto/zone-response.dto.ts](../../../../src/modules/zones/dto/zone-response.dto.ts)) trả **11 khoá** snake_case và **KHÔNG** có `deleted_at` ⇒ dùng lại cho **cả list lẫn detail**, **KHÔNG** viết mapper mới, **KHÔNG** tách mapper riêng cho list (CHỐT OQ-2: giữ `metadata_json` trong list).

- **AC**: dán xác nhận đủ **7 mục** kèm bằng chứng (path + trích dẫn ngắn); mục 1 ghi rõ con số baseline; mục 5 ghi rõ timestamp chốt; mục 2 ghi lại tên biến mock của bộ 4 provider.

## T1 — `ListZonesQueryDto` (code) — plan §3.1, OQ-2/3/4/5/7, SEC-03
File net-new: `src/modules/zones/dto/list-zones-query.dto.ts` — **7 field**, mirror style [list-vehicle-registrations-query.dto.ts](../../../../src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts) + [list-iot-devices-query.dto.ts](../../../../src/modules/iot/dto/list-iot-devices-query.dto.ts):

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `page: number = 1` | `page` | `@Type(() => Number) @IsOptional @IsInt @Min(1)` |
| `limit: number = 20` | `limit` | `@Type(() => Number) @IsOptional @IsInt @Min(1) @Max(100)` |
| `zoneType?: ZoneType` | `zone_type` | `@Expose({name:'zone_type'}) @IsOptional @IsIn([...ZONE_TYPES])` |
| `building?: string` | `building` | `@IsOptional @IsString @MaxLength(100)` |
| `floor?: string` | `floor` | `@IsOptional @IsString @MaxLength(30)` |
| `status?: ZoneStatus` | `status` | `@IsOptional @IsIn([...ZONE_STATUSES])` |
| `search?: string` | `search` | `@IsOptional @IsString @MaxLength(200)` |

- `@Type(() => Number)` **bắt buộc** cho `page`/`limit`: query string luôn là string, thiếu nó `@IsInt` fail toàn bộ; chỉ hoạt động khi pipe có `transform: true` (`ZONE_PIPE` đã có).
- **CẤM khai** `sort_by`/`sort_order` (CHỐT OQ-4: hard-code `zone_code ASC`), `include_deleted` (CHỐT OQ-7), `fields`. `whitelist: true` sẽ loại nếu client gửi.
- Import `ZONE_TYPES`/`ZONE_STATUSES` từ constant có sẵn — **cấm** hard-code danh sách.
- **AC**: đúng 7 field; `page`/`limit` có `@Type(() => Number)` + `@Min(1)` (+ `@Max(100)` cho `limit`); `zone_type`/`status` dùng constant qua `@IsIn`; **0 field cấm**; độ dài khớp DB (100/30/200).

## T1b — Test `ListZonesQueryDto` — plan §6 mục 16-21
File net-new: `src/modules/zones/dto/list-zones-query.dto.spec.ts` — case validate dùng `plainToInstance` + `validate`; case whitelist dùng `ValidationPipe.transform` (mirror UC-90/UC-91):
16. Query rỗng `{}` → 0 lỗi; `page`/`limit` nhận default **1/20**.
17. `limit=101` → lỗi `max`; `limit=0` → lỗi `min`; `page=0` → lỗi `min`.
18. `page='2'` / `limit='50'` (string từ query) → sau transform là **number** (chứng minh `@Type(() => Number)` hoạt động).
19. `zone_type='garden'` → lỗi `isIn`; `status='disabled'` → lỗi `isIn` (chỉ `active`/`inactive`).
20. `search` 201 ký tự → lỗi `maxLength`; `building` 101 / `floor` 31 → lỗi `maxLength`.
21. **Whitelist**: `new ValidationPipe({whitelist:true, transform:true}).transform(body, {type:'body', metatype: ListZonesQueryDto})` với body chứa `sort_by`, `include_deleted`, `deleted_at` → cả 3 bị loại khỏi instance; field hợp lệ còn nguyên.
- **AC**: 6 nhóm case xanh; case 18 và case 21 bắt buộc có mặt.

## T2 — `PaginationMeta` + `list()` + `getDetail()` (code) — plan §2, OQ-1/2/3/4/5/7
Thêm vào `src/modules/zones/services/zones.service.ts` (**Modified — chỉ THÊM**).

> ⚠ **READ-ONLY TUYỆT ĐỐI**: constructor đã có `DataSource` (từ UC-92) nhưng UC-93 **CẤM** gọi `createQueryRunner`, **CẤM** transaction, **CẤM** ghi audit. **KHÔNG** đụng constructor, `create()`, `update()`, `remove()`, `loadActive()`, `zoneCodeConflict()`, `isUniqueViolation()`.

### 2.1. `PaginationMeta`
`export interface PaginationMeta { page: number; limit: number; total: number; totalPages: number }` — **khai lại trong module `zones`**; interface cùng tên trong ANPR là **cục bộ, không export** ⇒ **CẤM import xuyên module `anpr`** (ARCH-01). Shape phải giống hệt.

### 2.2. `async list(query: ListZonesQueryDto): Promise<{ items: ZoneEntity[]; meta: PaginationMeta }>`
1. `const page = query.page ?? 1; const limit = query.limit ?? 20;`
2. Dựng `where: FindOptionsWhere<ZoneEntity>` = `{ deletedAt: IsNull() }` **luôn có**; chỉ thêm khoá khi filter **có giá trị** (`if (query.zoneType) where.zoneType = query.zoneType` …) — **CẤM** để `undefined` lọt vào `where`.
3. **2 nhánh truy vấn**:
   - **Không có `search`** → `this.repo.findAndCount({ where, order: { zoneCode: 'ASC' }, skip: (page-1)*limit, take: limit })`.
   - **Có `search`** → QueryBuilder: `createQueryBuilder('z')` + các filter + `andWhere('(z.zoneCode ILIKE :s OR z.zoneName ILIKE :s)', { s: '%' + query.search + '%' })` → `.orderBy('z.zoneCode', 'ASC').skip(...).take(...).getManyAndCount()`.
   - **CẢ HAI nhánh BẮT BUỘC**: có `deletedAt IS NULL` **và** `ORDER BY zone_code ASC`. Nhánh QueryBuilder phải khai `deletedAt IS NULL` **TƯỜNG MINH** (`andWhere('z.deletedAt IS NULL')` hoặc đưa `where` object vào) — **không** dựa vào TypeORM tự thêm.
   - `%` bọc **ngoài** giá trị bind (`{ s: '%kw%' }`), **CẤM** nội suy chuỗi vào câu SQL (SEC-03).
   - **CẤM normalize** `query.search` qua `normalizeZoneCode` (CHỐT OQ-3: `ILIKE` đã case-insensitive; normalize sẽ phá tìm theo tên có dấu).
4. Trả `{ items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }`.
5. **Không** N+1, **không** join sang bảng module khác, **không** `select` thủ công (giữ đủ field cho `toZoneResponse`).

### 2.3. `async getDetail(id: string): Promise<ZoneEntity>`
- Thân: `return this.loadActive(id);` — 404 `ZONE_NOT_FOUND` khi không tồn tại/đã xoá mềm.
- **KHÔNG** đổi `loadActive` sang public, **KHÔNG** viết lại logic lookup.

- **AC**: `PaginationMeta` khai trong `zones` (0 import từ `anpr`); `list()` đủ 5 bước, 2 nhánh đều có `deletedAt IS NULL` + `ORDER BY zone_code ASC`; `search` dùng bound param, không normalize; filter vắng mặt không lọt vào `where`; `getDetail` chỉ gọi `loadActive`; **0 `createQueryRunner`, 0 transaction, 0 audit** trong code mới; `create`/`update`/`remove`/`loadActive`/constructor không bị sửa.

## T2b — Test `list()` + `getDetail()` — plan §6 mục 1-15, ENG-01
Thêm `describe('list')` và `describe('getDetail')` vào `zones.service.spec.ts`, **tái dùng bộ 4 provider có sẵn** (T0 mục 2); bổ sung vào mock `repo`: `findAndCount` và `createQueryBuilder` (chainable: `andWhere`/`orderBy`/`skip`/`take` → `mockReturnThis()`, `getManyAndCount` → `[[...], n]`).

**`describe('list')`**
1. **List rỗng** → `findAndCount` trả `[[], 0]` → `items: []`, `meta.total = 0`, `meta.totalPages = 0`; **KHÔNG** ném 404.
2. **Phân trang**: `page=3, limit=10` → assert `skip = 20`, `take = 10`.
3. **`meta.totalPages`**: `total=25, limit=10` → `3` (`Math.ceil`).
4. **Default**: không truyền `page`/`limit` → `skip = 0`, `take = 20`, `meta.page = 1`, `meta.limit = 20`.
5. **Filter đơn**: chỉ `zoneType='gate'` → `where` có `zoneType: 'gate'` **và** `deletedAt: IsNull()`.
6. **Filter kết hợp (AND)**: `building='A'` + `floor='B1'` + `status='active'` → `where` đủ 3 khoá + `deletedAt`.
7. **Filter không gửi KHÔNG lọt vào `where`**: chỉ gửi `zoneType` → assert `where` **không có khoá** `building`/`floor`/`status` (kể cả `undefined`).
8. **Soft-delete không lọt**: mọi case đều assert `where.deletedAt` là `IsNull()`.
9. **Sort `zone_code ASC`**: nhánh `findAndCount` → assert `order: { zoneCode: 'ASC' }`; nhánh QueryBuilder → assert `orderBy('z.zoneCode', 'ASC')`.
10. **`search` bound param**: gửi `search='gate'` → assert `andWhere` được gọi với **2 tham số**: chuỗi SQL chứa `ILIKE :s` và object `{ s: '%gate%' }`. **Assert tham số, KHÔNG assert chuỗi SQL nối** — chứng minh không nội suy input.
10b. **`search` KẾT HỢP filter (bảo vệ nhánh QueryBuilder)**: gửi `search='hall'` **+** `zone_type='corridor'` **+** `building='A'` → assert QueryBuilder nhận **CẢ** điều kiện filter (`zoneType='corridor'`, `building='A'`) **LẪN** điều kiện `ILIKE :s` với `{ s: '%hall%' }` — **không** chỉ một trong hai; đồng thời vẫn có `deletedAt IS NULL` và `ORDER BY z.zoneCode ASC`.
    *Lý do bắt buộc*: hai nhánh dựng điều kiện theo **hai cách khác nhau** (`findAndCount` nhận `where` object; QueryBuilder phải tự gắn từng điều kiện) ⇒ rất dễ viết nhánh QueryBuilder chỉ gắn `ILIKE` mà **quên gắn filter**. Khi đó `search='hall'` + `zone_type='corridor'` sẽ trả về cả zone `room`/`gate`/`parking` khớp chữ "hall" — **kết quả sai âm thầm**, không case nào khác bắt được.
11. **`search` KHÔNG normalize**: `search='gate'` (chữ thường) → giá trị bind vẫn `'%gate%'`, **không** thành `'%GATE%'`.
12. **Nhánh QueryBuilder vẫn lọc soft-delete**: assert có điều kiện `deletedAt IS NULL` (qua `andWhere` hoặc `where` object).
13. **Chọn đúng nhánh**: không `search` → dùng `findAndCount`, **KHÔNG** gọi `createQueryBuilder`; có `search` → ngược lại.

**`describe('getDetail')`**
14. **200**: `findOne` trả entity → trả đúng entity; assert `where` = `{ id, deletedAt: IsNull() }`.
15. **404**: `findOne` trả `null` → `NotFoundException` `{code:'ZONE_NOT_FOUND'}`.

**Ràng buộc test**: assert **`dataSource.createQueryRunner` KHÔNG được gọi** và **`auditRepo.*` KHÔNG được gọi** trong mọi case của `list`/`getDetail` (bảo vệ tính read-only).

**Làm rõ ranh giới "sửa test cũ"**: thêm method (`findAndCount`, `createQueryBuilder`) vào **mock `repo` dùng chung** thuộc loại **(a) dựng provider/mock** → **ĐƯỢC PHÉP** và là việc bắt buộc để test mới chạy. **VẪN CẤM** đổi bất kỳ **assert** nào của 74 test cũ (mã lỗi, payload, số lần gọi, hành vi no-op, thứ tự gọi) — UC-93 read-only nên không có lý do nào phải chạm. Test cũ fail → **DỪNG, báo cáo**.
- **AC**: **16 case** xanh (15 + 10b); case 7, **10b**, 12, 13 bắt buộc có mặt; có assert read-only (không transaction, không audit); **74 test cũ không hồi quy**; coverage `ZonesService` ≥80%.

## T3 — Controller: 2 route `GET` (code) — plan §4, OQ-1/6/8, SEC-02
Thêm vào `src/modules/zones/controllers/zones.controller.ts` (**Modified**); bổ sung **đúng 2 import**: `Get`, `Query` từ `@nestjs/common`.

> ⚠ **LUẬT MODULE (CHỐT OQ-8)**: **route static PHẢI khai TRƯỚC route động `:id`**. Khai `@Get()` (list) trước `@Get(':id')`, kèm **comment cảnh báo tại chỗ** (mirror `iot-devices.controller.ts:51-52`): mọi route static tương lai dưới `/zones/...` cũng phải đặt trước `:id`, nếu không sẽ bị `:id` nuốt và lỗi hiện ra dưới dạng **400 `ParseUUIDPipe`** rất khó đoán.

- **List**: `@Get()` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('zones.zone.read')` · `@UsePipes(ZONE_PIPE)` · `@Query() query: ListZonesQueryDto`
  → `{ success: true, message: 'Zones retrieved successfully', data: items.map(toZoneResponse), meta }` (200). **`meta` ngang hàng `data`**, không lồng trong `data`.
- **Detail**: `@Get(':id')` · cùng guard + `@RequirePermissions('zones.zone.read')` · `@Param('id', ParseUUIDPipe) id: string`
  → `{ success: true, message: 'Zone retrieved successfully', data: toZoneResponse(entity) }` (200), **KHÔNG** có `meta`.
- **KHÔNG** `@HttpCode` (GET mặc định 200); **KHÔNG** `@CurrentUser` (read-only, không cần actor); **KHÔNG** mapper mới.
- **KHÔNG đụng** 3 route `POST`/`PATCH`/`DELETE` đã có.
- ⚠ Quên `@RequirePermissions` = **endpoint hở im lặng** (`PermissionsGuard` `return true` khi không có metadata).
- **AC**: đúng 2 route mới; `@Get()` khai **trước** `@Get(':id')` + có comment cảnh báo; cả 2 có 2 guard + `zones.zone.read`; list có `ZONE_PIPE` + `meta`, detail không có `meta`; 3 route cũ **không đổi**.

## T3b — Test controller — plan §6 mục 22-26
Thêm vào `zones.controller.spec.ts`:
22. **List**: gọi `service.list(query)` 1 lần; envelope `{success, message:'Zones retrieved successfully', data:[...], meta}`; `data` đi qua `toZoneResponse` (assert có `zone_code`, **không** có `deleted_at`); `meta` **ngang hàng** `data`.
23. **Detail**: gọi `service.getDetail(id)`; envelope `{success, message:'Zone retrieved successfully', data}`; **không** có `meta`.
24. **Assert metadata**: `Reflect.getMetadata(PERMISSIONS_KEY, controller.list)` và `...(controller.detail)` đều `= ['zones.zone.read']`; guard list của cả 2 chứa `JwtAuthGuard` **và** `PermissionsGuard`.
25. `NotFoundException` từ `service.getDetail` → propagate nguyên trạng (controller không nuốt).
26. **Không hồi quy**: test của 3 route `POST`/`PATCH`/`DELETE` vẫn xanh, **không** bị sửa.
- **AC**: 5 nhóm case xanh; case 24 bắt buộc (assert cả 2 handler); 0 test cũ bị sửa.

## T4 — Migration seed permission (code) — plan §5, OQ-6, SEC-02
- File: **`src/database/migrations/20260722000004-SeedZoneReadPermission.ts`** (timestamp chốt ở T0 mục 5), class `SeedZoneReadPermission20260722000004` + field `name` trùng tên class.
- **Đặt trong `migrations/`, TUYỆT ĐỐI KHÔNG trong `src/database/seeds/`** (folder `seeds/` không có runner — AGENTS.md §5.5 rule 4).
- Copy pattern [20260722000003-SeedZoneDeletePermission.ts](../../../../src/database/migrations/20260722000003-SeedZoneDeletePermission.ts):
  - `permission = { code: 'zones.zone.read', name: <ASCII không dấu>, module: 'zones', action: 'read', description: <ASCII không dấu> }`;
  - ⚠ **`roles` có ĐÚNG 4 PHẦN TỬ**: `['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER', 'EMPLOYEE']` (CHỐT OQ-6). **KHÁC 3 UC trước** (`create`/`update`/`delete` chỉ 2 role) — **CẤM copy nhầm mảng 2 phần tử**. Lý do: zone là dữ liệu nền, nhiều màn FE cần dropdown chọn zone; ghi/sửa/xoá vẫn chỉ 2 role admin nên rủi ro thấp.
  - **CẤM** `ADMIN`/`INTERNAL_USER` (mã lỗi thời, `WHERE role_code` không khớp → im lặng không insert);
  - `up()` idempotent: INSERT `ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id` → `return` nếu vẫn không có → vòng lặp gán `role_permissions` `ON CONFLICT DO NOTHING`;
  - `down()`: xoá `role_permissions` **trước**, rồi `permissions`.
- Chỉ tạo file, **KHÔNG chạy** `migration:run`.
- **AC**: đúng tên/vị trí; `permission_code='zones.zone.read'`, `module_code='zones'`, `action_code='read'`; **đúng 4 role**; `up()` chạy lại không lỗi/không nhân bản; `down()` đúng thứ tự.

## T-GATE — (STOP, KHÔNG commit) — plan §7
- `npm run build` = **0 error**.
- eslint trên **7 file touched** (3 net-new: DTO + DTO spec + migration; 4 modified: service + service spec + controller + controller spec) = **0 rule mới**.
- `npx jest src/modules/zones` **xanh** — **gồm toàn bộ test cũ không hồi quy**, đối chiếu baseline T0 mục 1 (**6 suite / 74 test**). Test cũ fail → **DỪNG, báo cáo, KHÔNG sửa test cho qua**. UC-93 là read-only nên **không có lý do chính đáng nào** để sửa test cũ.
- Coverage `ZonesService` **≥80%**.
- **DI-proof**: `AppModule` compile ở **preview mode** — 0 `UnknownDependenciesException`, 0 circular. Kỳ vọng không đổi (module không sửa) nhưng service/controller có thay đổi nên vẫn phải chạy. Throwaway xoá sạch.
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS chung · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file + kết quả jest (**tách rõ test cũ vs mới**) + coverage + DI-proof.
- **Bàn giao**: gọi thử `GET /api/v1/zones` trên local cần chạy seed permission **`20260722000004`** trước; thiếu → **403 `FORBIDDEN`**, **không phải lỗi code**. Local vẫn **chưa có bảng `zones`** nên cần `20260721000001` trước nữa — **chỉ local, KHÔNG RDS**.
- **Owed (ghi, KHÔNG làm)**: **UC-94** gán camera — **route PHẢI ở phía `zones`** (`PATCH /api/v1/zones/:id/devices`, OQ-1b của UC-92) · index cho `status`/`search` nếu dữ liệu lớn (`IDX_zones_status`, `pg_trgm`) · endpoint xem zone đã lưu trữ (`include_deleted` bị loại ở OQ-7) · số camera theo zone (cần `iot`) · restore zone (OQ-5 của UC-92) · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.
- **AC**: bảng gate đầy đủ + báo cáo tick: 2 nhánh truy vấn đều có `deletedAt IS NULL` ✓ · cả 2 nhánh sort `zone_code ASC` ✓ · `search` bound param, không normalize ✓ · filter vắng mặt không lọt `where` ✓ · list rỗng trả 200 + `data: []` (không 404) ✓ · `meta` ngang hàng `data`, detail không có `meta` ✓ · `@Get()` khai trước `@Get(':id')` + comment ✓ · `@RequirePermissions('zones.zone.read')` trên **cả 2** handler ✓ · **0 `createQueryRunner` / 0 transaction / 0 audit** trong code UC-93 ✓ · migration seed **4 role** ✓ · 0 migration schema ✓ · `zones.module.ts` không đổi ✓ · 74 test cũ không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-93
- **T0** → baseline 74 test · constructor 4 dependency + bộ 4 provider · chữ ký `create`/`update`/`remove` sau UC-92 · controller 3 route + import thiếu `Get`/`Query` · timestamp `...0004` · constant + mapper tái dùng
- **T1/T1b** → `ListZonesQueryDto` 7 field (không `sort_by`/`include_deleted`) + test 2 nhóm default/whitelist
- **T2/T2b** → `PaginationMeta` (khai trong `zones`) + `list()` 2 nhánh + `getDetail()`; 15 case test + assert read-only
- **T3/T3b** → 2 route `GET`, static trước động (luật OQ-8), permission `zones.zone.read` trên cả 2
- **T4** → migration seed `zones.zone.read` → **4 role** (khác 2 role của UC-90/91/92)
- **T-GATE** → gate + không hồi quy 74 test + DI-proof + STOP + bàn giao + Owed
