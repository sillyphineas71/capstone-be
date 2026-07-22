# ZNL-001 — plan.md (UC-93 Zones: xem & tra cứu khu vực)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo plan ZNL-001 sau spec DUYỆT + chốt OQ-1→OQ-9. 2 route `GET /zones` + `GET /zones/:id`; 2 method thêm vào `ZonesService` (`list` 2 nhánh truy vấn + `getDetail`); 1 query DTO; 1 migration seed permission `zones.zone.read` cho **cả 4 role**. Sort hard-code **`zone_code ASC`**. Read-only: KHÔNG `DataSource`/transaction/audit, KHÔNG sửa module. Ghi rõ **cảnh báo xung đột thứ tự với UC-92** (UC-92 đổi constructor `ZonesService`). | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **`ZonesController` cần thêm import**: hiện có `Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards, UsePipes, ValidationPipe` ([zones.controller.ts:1-13](../../../../src/modules/zones/controllers/zones.controller.ts)) ⇒ UC-93 thêm **`Get`** và **`Query`**. `Param`/`ParseUUIDPipe` đã có (từ UC-91) — không thêm lại. `ZONE_PIPE` ([:19](../../../../src/modules/zones/controllers/zones.controller.ts)) dùng lại, **cấm** tạo pipe thứ hai.
- **`loadActive` đang `private`** ([zones.service.ts:96-107](../../../../src/modules/zones/services/zones.service.ts)) ⇒ **KHÔNG** đổi visibility. Cách expose đúng: thêm method **public `getDetail(id)`** chỉ `return this.loadActive(id)` — đúng tiền lệ ANPR ([vehicle-registration.service.ts:150-156](../../../../src/modules/anpr/services/vehicle-registration.service.ts) `getDetail` gọi lại `loadOwned`). Giữ nguyên `loadActive` để UC-91/UC-92 không bị ảnh hưởng.
- **`PaginationMeta` chưa tồn tại trong module `zones`**: interface này khai **cục bộ** trong ANPR ([vehicle-registration.service.ts:17-22](../../../../src/modules/anpr/services/vehicle-registration.service.ts)), **không** export dùng chung. ⇒ UC-93 **khai lại** interface cùng shape trong `zones.service.ts` (hoặc file types nhỏ) — **KHÔNG** import xuyên module `anpr` (ARCH-01). Shape bắt buộc giống hệt: `{ page, limit, total, totalPages }`.
- **Timestamp migration kế tiếp**: file cuối hiện tại là `20260722000002-SeedZoneUpdatePermission.ts` ⇒ UC-93 dùng **`20260722000003-SeedZoneReadPermission.ts`**.
  ⚠ **Xung đột số thứ tự với UC-92**: plan UC-92 cũng đang chốt `20260722000003` (seed `zones.zone.delete`). **UC nào code trước lấy `...0003`, UC sau lấy `...0004`** — T0 của tasks PHẢI kiểm tra lại thực tế thư mục `migrations/`, không tin con số ghi ở đây.
- **`ZoneEntity.zoneCode`** map cột `zone_code` ([zone.entity.ts:26-27](../../../../src/modules/zones/entities/zone.entity.ts)) ⇒ `order: { zoneCode: 'ASC' }` (TypeORM dùng tên property, không phải tên cột).
- **Seed permission cho 4 role**: pattern `roles = [...]` lặp `INSERT ... SELECT r.id FROM roles WHERE r.role_code = $1 AND r.is_active = true` ([20260722000002-SeedZoneUpdatePermission.ts](../../../../src/database/migrations/20260722000002-SeedZoneUpdatePermission.ts)) ⇒ chỉ cần đổi mảng thành 4 phần tử, **không** đổi cấu trúc.
- ⚠ **Cảnh báo phối hợp với UC-92 (KHÔNG phải mở lại OQ, chỉ là thứ tự thực thi)**: UC-92 chốt đổi **constructor `ZonesService`** (thêm `DataSource`, `ZonesAuditRepository`, `IotDevicesService`) và đổi **chữ ký** `create()`/`update()`. UC-93 read-only nên **không** đụng những thứ đó, nhưng:
  - nếu **UC-92 code trước** → khi làm UC-93, file `zones.service.spec.ts` đã có 4 provider; test mới của UC-93 phải theo bộ provider đó;
  - nếu **UC-93 code trước** → UC-92 sau đó phải cập nhật cả test của UC-93.
  Plan này viết theo trạng thái **hiện tại** (1 provider). Tasks phải verify lại ở T0.

## 1. Quyết định đã chốt (OQ + Constitution)

OQ-1 **2 route** (list + detail) · OQ-2 filter `zone_type`/`building`/`floor`/`status`, chấp nhận scan cho `floor` đơn lẻ và `status`, **giữ `metadata_json` trong list** (1 mapper dùng chung) · OQ-3 **có `search`** `ILIKE` bound param trên `zone_code`+`zone_name`, **KHÔNG normalize** · OQ-4 **hard-code `zone_code ASC`**, client không chọn sort · OQ-5 `page`/`limit` 1/20 max 100, `meta {page,limit,total,totalPages}`, không `hasNext`/`hasPrev` · OQ-6 **1 permission `zones.zone.read` → cả 4 role** · OQ-7 **không** `include_deleted` · OQ-8 **luật module**: route static khai TRƯỚC route động · OQ-9 §8.4 là khuyến nghị.

- **SEC-02**: cả 2 route đều gate `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('zones.zone.read')` — endpoint đọc nhưng lộ sơ đồ khuôn viên, **không** public.
- **SEC-03**: DTO + `ZONE_PIPE` whitelist; `ILIKE` **bound param**; `:id` `ParseUUIDPipe`; client không điều khiển `ORDER BY`.
- **DATA-01**: mọi truy vấn lọc `deletedAt: IsNull()` — vừa đúng nghiệp vụ vừa là điều kiện để 3 partial index có tác dụng.
- **ARCH-01**: chỉ đọc bảng `zones`; **không** join `iot_devices`/`gate_access_logs`/`zone_presence_events`; **không** import type từ module `anpr`.
- **ARCH-02**: `limit` max 100 chặn quét toàn bảng.
- **ARCH-03**: read-only ⇒ idempotent tự nhiên.
- **ENG-01**: coverage `ZonesService` ≥80%; test cũ không hồi quy.
- **DATA-03**: **no-migration-schema** — cấm thêm index dù `status`/`floor`/`search` gây scan; migration duy nhất = seed permission.

## 2. Service — method thêm vào `ZonesService`

**File**: `src/modules/zones/services/zones.service.ts` (**Modified** — chỉ THÊM, không sửa `create`/`update`/`loadActive`).

### 2.1. `PaginationMeta` (khai trong module `zones`)
`export interface PaginationMeta { page: number; limit: number; total: number; totalPages: number }` — cùng shape ANPR, **không** import xuyên module (§0).

### 2.2. `async list(query: ListZonesQueryDto): Promise<{ items: ZoneEntity[]; meta: PaginationMeta }>`
Thứ tự bước:
1. `const page = query.page ?? 1; const limit = query.limit ?? 20;`
2. Dựng `where: FindOptionsWhere<ZoneEntity>` = `{ deletedAt: IsNull() }` **luôn có**; chỉ thêm khoá khi filter **có giá trị** (`if (query.zoneType) where.zoneType = query.zoneType` …) — **cấm** để `undefined` lọt vào `where` (mirror ANPR).
3. **2 nhánh truy vấn** (CHỐT OQ-3):
   - **Không có `search`** → `this.repo.findAndCount({ where, order: { zoneCode: 'ASC' }, skip: (page-1)*limit, take: limit })`.
   - **Có `search`** → QueryBuilder: `this.repo.createQueryBuilder('z').where({ ...where })` (hoặc `andWhere` từng filter) rồi
     `andWhere('(z.zoneCode ILIKE :s OR z.zoneName ILIKE :s)', { s: '%' + query.search + '%' })`
     → `.orderBy('z.zoneCode', 'ASC').skip(...).take(...).getManyAndCount()`.
   - **Cả 2 nhánh BẮT BUỘC**: có `deletedAt IS NULL` **và** `ORDER BY zone_code ASC`. Nhánh QueryBuilder phải khai `deletedAt IS NULL` **tường minh** (`andWhere('z.deletedAt IS NULL')`) — không dựa vào TypeORM tự thêm.
   - `%` bọc **ngoài** giá trị bind (`{ s: '%kw%' }`), **KHÔNG** nội suy chuỗi vào câu SQL (SEC-03).
   - **KHÔNG** normalize `query.search` (CHỐT OQ-3).
4. Trả `{ items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }`.
5. **Không** N+1, **không** join bảng module khác, **không** `select` thủ công (giữ đủ field cho `toZoneResponse`).

### 2.3. `async getDetail(id: string): Promise<ZoneEntity>`
- Thân: `return this.loadActive(id);` — 404 `ZONE_NOT_FOUND` khi không tồn tại/đã xoá mềm. **Không** viết lại logic lookup, **không** đổi `loadActive` sang public.

### 2.4. Không đổi
`create()`, `update()`, `loadActive()`, `zoneCodeConflict()`, `isUniqueViolation()`, constructor. Read-only ⇒ **không** `DataSource`, **không** transaction, **không** audit.

## 3. DTO

### 3.1. `src/modules/zones/dto/list-zones-query.dto.ts` (net-new) — `ListZonesQueryDto`

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `page: number = 1` | `page` | `@Type(() => Number) @IsOptional @IsInt @Min(1)` |
| `limit: number = 20` | `limit` | `@Type(() => Number) @IsOptional @IsInt @Min(1) @Max(100)` |
| `zoneType?: ZoneType` | `zone_type` | `@Expose({name:'zone_type'}) @IsOptional @IsIn([...ZONE_TYPES])` |
| `building?: string` | `building` | `@IsOptional @IsString @MaxLength(100)` |
| `floor?: string` | `floor` | `@IsOptional @IsString @MaxLength(30)` |
| `status?: ZoneStatus` | `status` | `@IsOptional @IsIn([...ZONE_STATUSES])` |
| `search?: string` | `search` | `@IsOptional @IsString @MaxLength(200)` |

- `@Type(() => Number)` là **bắt buộc** cho `page`/`limit`: query string luôn là string, thiếu nó thì `@IsInt` fail — và chỉ chạy khi pipe có `transform: true` (`ZONE_PIPE` đã có).
- **KHÔNG** khai `sort_by`/`sort_order`/`include_deleted`/`fields` — `whitelist: true` loại sạch nếu client gửi (CHỐT OQ-4, OQ-7).
- Tái dùng `ZONE_TYPES` (`constants/zone-type.constant.ts`) và `ZONE_STATUSES` (`constants/zone-status.constant.ts`) — **cấm** khai lại danh sách rời rạc.
- **Response**: dùng lại `toZoneResponse` cho **cả list lẫn detail**, **giữ `metadata_json`** (CHỐT OQ-2) — **không** DTO/mapper mới.

## 4. Controller — route thêm vào `ZonesController`

**File**: `src/modules/zones/controllers/zones.controller.ts` (**Modified**). Thêm import `Get`, `Query`.

```text
GET /api/v1/zones        → list
GET /api/v1/zones/:id    → detail
```
- **Thứ tự khai (LUẬT — CHỐT OQ-8)**: `@Get()` (list, không path) khai **TRƯỚC** `@Get(':id')`, và **mọi route static tương lai** dưới `/zones/...` cũng phải khai trước `@Get(':id')`. Kèm comment cảnh báo tại chỗ (mirror `iot-devices.controller.ts:51-52`) — thiếu sẽ bị `:id` nuốt và lỗi hiện ra dưới dạng **400 `ParseUUIDPipe`** rất khó đoán.
- **List**: `@Get()` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('zones.zone.read')` · `@UsePipes(ZONE_PIPE)` · `@Query() query: ListZonesQueryDto`
  → `{ success: true, message: 'Zones retrieved successfully', data: items.map(toZoneResponse), meta }` (200). `meta` **ngang hàng** `data`.
- **Detail**: `@Get(':id')` · cùng guard/permission · `@Param('id', ParseUUIDPipe) id: string`
  → `{ success: true, message: 'Zone retrieved successfully', data: toZoneResponse(entity) }` (200), **không** có `meta`.
- **KHÔNG** `@HttpCode` (GET mặc định 200); **KHÔNG** `@CurrentUser` (không cần actor); **KHÔNG** đụng route `POST`/`PATCH`.

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| List/detail thành công | `200` | — |
| List rỗng | `200` + `data: []`, `meta.total = 0` | — |
| Query sai (`limit>100`, `page<1`, `zone_type`/`status` ngoài danh sách, `search`>200) | `400` | (Nest validation) |
| `:id` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission `zones.zone.read` | `403` | `FORBIDDEN` (guard) |
| Zone không tồn tại / đã xoá mềm (detail) | `404` | `ZONE_NOT_FOUND` |

## 5. File list

### Net-new
**Code (2)**
- `src/modules/zones/dto/list-zones-query.dto.ts`
- `src/database/migrations/20260722000003-SeedZoneReadPermission.ts` — seed `zones.zone.read` (`module_code='zones'`, `action_code='read'`), gán **4 role** `SYSTEM_ADMIN`/`BUSINESS_ADMIN`/`MANAGER`/`EMPLOYEE`; `up()` idempotent (`ON CONFLICT DO NOTHING` + fallback `SELECT`), `down()` xoá `role_permissions` trước rồi `permissions`. Đặt trong `migrations/`, **KHÔNG** trong `seeds/`. ⚠ Số thứ tự phải verify lại ở T0 (có thể thành `...0004` nếu UC-92 code trước — §0).

**Test (1)**
- `src/modules/zones/dto/list-zones-query.dto.spec.ts`

### Modified
- `src/modules/zones/services/zones.service.ts` — thêm `PaginationMeta`, `list()`, `getDetail()`; thêm import `FindOptionsWhere` (typeorm) nếu dùng. **KHÔNG** đụng `create`/`update`/`loadActive`/constructor.
- `src/modules/zones/services/zones.service.spec.ts` — thêm `describe('list')` + `describe('getDetail')`; mock repo cần thêm `findAndCount` và `createQueryBuilder`.
- `src/modules/zones/controllers/zones.controller.ts` — thêm 2 route `@Get` + import `Get`, `Query`. **KHÔNG** đụng `POST`/`PATCH`.
- `src/modules/zones/controllers/zones.controller.spec.ts` — thêm test 2 route mới.

> Tổng **3 net-new (2 code + 1 test) + 4 modified (2 code + 2 test)** = **7 file**. **0 migration schema** · `zones.module.ts`, `zone.entity.ts`, `zone-response.dto.ts`, `create-zone.dto.ts`, `update-zone.dto.ts`, `normalize-zone-code.ts`, `zone-type.constant.ts`, `zone-status.constant.ts`, `app.module.ts`, `data-source.ts` **KHÔNG đổi**.

## 6. Test (mock repo — KHÔNG DB)

**`zones.service.spec.ts` — `describe('list')`** (mock `findAndCount` trả `[[...], n]`; mock `createQueryBuilder` trả object chainable với `andWhere`/`orderBy`/`skip`/`take`/`getManyAndCount` đều `jest.fn().mockReturnThis()`):
1. **List rỗng** → `findAndCount` trả `[[], 0]` → kết quả `items: []`, `meta.total = 0`, `meta.totalPages = 0`; **KHÔNG** ném 404.
2. **Phân trang đúng**: `page=3, limit=10` → assert `skip = 20`, `take = 10`.
3. **`meta.totalPages` đúng**: `total=25, limit=10` → `totalPages = 3` (`Math.ceil`).
4. **Default**: không truyền `page`/`limit` → `skip = 0`, `take = 20`, `meta.page = 1`, `meta.limit = 20`.
5. **Filter đơn**: chỉ `zone_type='gate'` → `where` chứa `zoneType: 'gate'` **và** `deletedAt: IsNull()`.
6. **Filter kết hợp (AND)**: `building='A'` + `floor='B1'` + `status='active'` → `where` chứa đủ 3 khoá + `deletedAt`.
7. **Filter không gửi KHÔNG lọt vào `where`**: chỉ gửi `zone_type` → assert `where` **không** có khoá `building`/`floor`/`status` (kể cả `undefined`).
8. **Soft-delete không lọt**: mọi case trên đều assert `where.deletedAt` là `IsNull()`.
9. **Sort `zone_code ASC`**: nhánh `findAndCount` → assert `order: { zoneCode: 'ASC' }`; nhánh QueryBuilder → assert `orderBy('z.zoneCode', 'ASC')`.
10. **`search` dùng bound param**: gửi `search='gate'` → assert `andWhere` được gọi với **2 tham số**: chuỗi SQL chứa `ILIKE :s` và object `{ s: '%gate%' }`. **Assert tham số, KHÔNG assert chuỗi SQL nối** — chứng minh không nội suy input.
11. **`search` KHÔNG normalize**: gửi `search='gate'` (chữ thường) → giá trị bind vẫn là `'%gate%'`, **không** thành `'%GATE%'`.
12. **Nhánh QueryBuilder vẫn lọc soft-delete**: assert có `andWhere` chứa `deletedAt IS NULL` (hoặc `where` object mang `deletedAt`).
13. **Không có `search` → dùng `findAndCount`, KHÔNG gọi `createQueryBuilder`** (và ngược lại).

**`zones.service.spec.ts` — `describe('getDetail')`**
14. **200**: `findOne` trả entity → trả đúng entity; assert `where` = `{ id, deletedAt: IsNull() }`.
15. **404**: `findOne` trả `null` → `NotFoundException` `{code:'ZONE_NOT_FOUND'}`.

**`list-zones-query.dto.spec.ts`** (`plainToInstance` + `validate`; case whitelist qua `ValidationPipe.transform`)
16. Query rỗng `{}` → 0 lỗi, `page`/`limit` nhận default 1/20.
17. `limit=101` → lỗi `max`; `limit=0` → lỗi `min`; `page=0` → lỗi `min`.
18. `page='2'`/`limit='50'` (string từ query) → sau transform là **number** (chứng minh `@Type(() => Number)` hoạt động).
19. `zone_type='garden'` → lỗi `isIn`; `status='disabled'` → lỗi `isIn`.
20. `search` 201 ký tự → lỗi `maxLength`.
21. **Whitelist**: gửi `sort_by`, `include_deleted`, `deleted_at` → bị loại khỏi instance (`ValidationPipe({whitelist:true, transform:true}).transform(...)`).

**`zones.controller.spec.ts`**
22. List: gọi `service.list(query)` 1 lần; envelope `{success, message:'Zones retrieved successfully', data: [...], meta}`; `data` đi qua `toZoneResponse` (assert có `zone_code`, **không** có `deleted_at`); `meta` **ngang hàng** `data`.
23. Detail: gọi `service.getDetail(id)`; envelope `{success, message:'Zone retrieved successfully', data}`; **không** có `meta`.
24. Assert metadata `PERMISSIONS_KEY` = `['zones.zone.read']` cho **cả 2** handler + guard list có `JwtAuthGuard` và `PermissionsGuard`.
25. `NotFoundException` từ service → propagate nguyên trạng.
26. **Không hồi quy**: test route `POST`/`PATCH` cũ vẫn xanh.

**Nguyên tắc**: 100% mock repository/service; **KHÔNG** DB, **KHÔNG** migration, **KHÔNG** e2e/HTTP thật.

## 7. Gate (STOP, KHÔNG commit)

- `npm run build` = 0 error; eslint trên **7 file touched** = 0 rule mới.
- `npx jest src/modules/zones` xanh — **gồm toàn bộ test cũ không hồi quy** (baseline hiện tại **5 suite / 52 test**; T0 của tasks phải đếm lại vì UC-92 có thể đã chạy trước và làm số này đổi).
- Coverage `ZonesService` ≥80%.
- **DI-proof**: `AppModule` compile preview mode — 0 `UnknownDependenciesException`, 0 circular (kỳ vọng không đổi vì module không sửa, nhưng service/controller có thay đổi nên vẫn phải chạy).
- **KHÔNG** chạy `migration:run` (kể cả local) · **KHÔNG** chạm RDS · **KHÔNG** live smoke · **KHÔNG** commit.
- **Bàn giao**: gọi thử `GET /api/v1/zones` trên local cần chạy migration seed `zones.zone.read` trước; thiếu → **403 `FORBIDDEN`**, không phải lỗi code. Local vẫn **chưa có bảng `zones`** (ghi nhận từ UC-90 T0) nên cần `20260721000001` trước nữa — **chỉ local, KHÔNG RDS**.
- **Owed**: UC-92 xoá zone + audit · UC-94 gán camera (route ở phía `zones` theo UC-92 OQ-1b) · index cho `status`/`search` nếu dữ liệu lớn · endpoint xem zone đã lưu trữ · số camera theo zone (cần `iot`) · global exception filter · Swagger · 5 file `spec/global/` rỗng · kiến trúc `zones` ↔ `rooms`.

## 8. Kỷ luật

- **LUẬT MODULE (CHỐT OQ-8)**: mọi route **static** PHẢI khai **TRƯỚC** route động `:id` trong `ZonesController`, kèm comment cảnh báo. Áp dụng cho mọi UC sau.
- **Sort hard-code `zone_code ASC`** (OQ-4): cấm nhận `sort_by`/`sort_order` từ client; cấm nội suy tên cột vào `ORDER BY`.
- **`deletedAt: IsNull()` ở CẢ HAI nhánh truy vấn** — nhánh QueryBuilder phải khai tường minh.
- **`search` bound param** (`{ s: '%kw%' }`), **cấm** nối chuỗi; **cấm** normalize input search.
- **1 mapper duy nhất** `toZoneResponse` cho cả list lẫn detail; **giữ** `metadata_json` trong list; cấm tách mapper/field-selection.
- **1 permission `zones.zone.read`** cho cả 2 route, seed đúng **4 role**; cấm tạo permission thứ hai.
- **Read-only tuyệt đối**: cấm `DataSource`/transaction/audit/ghi DB.
- **Không migration schema**: cấm thêm index dù `status`/`floor`/`search` gây scan.
- **Không đụng** `create()`/`update()`/`loadActive()` (giữ `private`), `zones.module.ts`, entity, các DTO/mapper/constant đã có, `app.module.ts`, `data-source.ts`.
- **Không đụng** UC-92 (`DELETE`) và UC-94 (gán camera).
- ⚠ **Phối hợp với UC-92**: nếu UC-92 code trước thì constructor `ZonesService` đã có 4 dependency — tasks phải verify ở T0 và cập nhật provider trong test cho khớp thực tế, **không** tự ý đổi constructor ở UC-93.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
