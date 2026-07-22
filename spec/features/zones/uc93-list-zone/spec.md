# ZNL-001 — UC-93 (Zones): Xem & tra cứu khu vực

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo spec ZNL-001 (UC-93): list + chi tiết + lọc theo loại/toà/tầng — UC gỡ chặn FE (residual chung của UC-90/UC-91: chưa có cách lấy `id`/danh sách zone). RECON code thật (mẫu list ANPR + IoT, `PaginationMeta` shape, tiền lệ `ILIKE` bound-param, 3 index partial có sẵn của bảng `zones`, quy ước route static phải khai TRƯỚC route động). Crux = filter nào dùng được index và filter nào gây full scan. 9 OPEN QUESTIONS chờ Thiếu Chủ. | Toàn bộ |
| 2026-07-22 | Thiếu Chủ CHỐT OQ-1→OQ-9. OQ-1=2 route (list + detail) · OQ-2=filter `zone_type`/`building`/`floor`/`status`, chấp nhận scan cho `floor` đơn lẻ và `status`, **giữ `metadata_json` trong list** (dùng chung 1 mapper) · OQ-3=CÓ `search` `ILIKE` bound param trên `zone_code`+`zone_name`, **KHÔNG normalize** input · **OQ-4=hard-code `zone_code ASC` (KHÁC đề xuất agent là `created_at DESC`)** — `zones` là danh mục cấu hình, tra theo mã · OQ-5=`page`/`limit` 1/20 max 100, `meta {page,limit,total,totalPages}`, KHÔNG `hasNext`/`hasPrev` · OQ-6=1 permission `zones.zone.read` cho **cả 4 role** · OQ-7=KHÔNG `include_deleted` · OQ-8=**luật module**: route static PHẢI khai TRƯỚC route động `:id` · OQ-9=§8.4 là khuyến nghị, hard-code sort hợp lệ. | §7 (đổi tiêu đề + kết luận từng OQ); §2/§3/§4 bỏ nhánh chưa chốt |

> **SPEC-ONLY.** Chưa plan/tasks/code. Kế thừa toàn bộ convention đã chốt ở [ZNC-001 / UC-90](../uc90-create-zone/spec.md) và [ZNU-001 / UC-91](../uc91-update-zone/spec.md) — permission 3 tầng `module_code='zones'`, `normalizeZoneCode`, `ZONE_TYPES`/`ZONE_STATUSES`, lọc `deletedAt IS NULL`, envelope inline (+`meta` cho list), `ZONE_PIPE`, `toZoneResponse`, `ParseUUIDPipe`, base path `/api/v1/zones`, KHÔNG sửa `ZonesModule` — **KHÔNG mở lại**. UC-93 **read-only**: thêm method vào `ZonesService` + route vào `ZonesController` đã có. KHÔNG migration schema, KHÔNG audit (read-only nên không phát sinh).

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZonesService` hiện tại ([zones.service.ts](../../../../src/modules/zones/services/zones.service.ts))
- Constructor chỉ `@InjectRepository(ZoneEntity) repo` ([:48-51](../../../../src/modules/zones/services/zones.service.ts)) — đủ cho read-only, UC-93 **không** cần đổi.
- **`private async loadActive(id)`** ([:96-107](../../../../src/modules/zones/services/zones.service.ts)) đã trả 404 `ZONE_NOT_FOUND` khi không tồn tại/đã xoá mềm ⇒ **route detail tái dùng nguyên** (như ANPR UC3 `getDetail` chỉ gọi lại `loadOwned` — [vehicle-registration.service.ts:150-156](../../../../src/modules/anpr/services/vehicle-registration.service.ts)). Đang `private`, cùng class nên method mới gọi được; nếu muốn expose thì thêm `getDetail(id)` public gọi vào nó.
- `create()`/`update()` **không được đụng** (UC-90/91 đã khoá).

### 0.2. `ZonesController` ([zones.controller.ts](../../../../src/modules/zones/controllers/zones.controller.ts))
- 2 route: `@Post()` ([:34](../../../../src/modules/zones/controllers/zones.controller.ts)) và `@Patch(':id')`; `ZONE_PIPE = new ValidationPipe({whitelist:true, transform:true})` ([:19](../../../../src/modules/zones/controllers/zones.controller.ts)) — UC-93 dùng lại, **cấm tạo pipe thứ hai**.
- Đã import sẵn `Param`, `ParseUUIDPipe` (từ UC-91) ⇒ route detail chỉ cần thêm `Get`, `Query`.
- **`ZONE_PIPE` bắt buộc cho route list**: `transform: true` là điều kiện để `@Type(() => Number)` ép `page`/`limit` từ query string sang number — thiếu nó thì `@IsInt` sẽ fail toàn bộ.

### 0.3. ⚠ Thứ tự khai route — static PHẢI trước động
- Tiền lệ ghi rõ trong repo: ANPR khai `@Get('vehicle-history')` **trước** `@Get('vehicle-registrations/:id')` với comment *"path tách (KHÔNG dưới :id), đặt TRƯỚC route :id"* ([vehicle-registration.controller.ts:52-53](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)); `iot-devices` cũng khai `@Get('status-summary')` trước `@Get(':id')` với comment *"Route STATIC — khai trước @Get(':id') để không bị route động nuốt"* ([iot-devices.controller.ts:51-53](../../../../src/modules/iot/controllers/iot-devices.controller.ts)).
- UC-93 là UC **đầu tiên** của module `zones` có route động `GET /zones/:id`. Hiện chưa có route static `GET` nào khác nên chưa xung đột, nhưng quy ước phải chốt ngay (OQ-8) vì UC sau (vd `GET /zones/statistics`) sẽ vấp.

### 0.4. Index thật của bảng `zones` — quyết định filter nào rẻ ([20260721000001-CreateZonesTable.ts:32-45](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts))

| Index | Cột | Loại | Filter được hưởng |
| :--- | :--- | :--- | :--- |
| `UQ_zones_code_active` | `zone_code` | UNIQUE, partial `WHERE deleted_at IS NULL` | tra cứu **chính xác** theo `zone_code` |
| `IDX_zones_type` | `zone_type` | partial | filter `zone_type` |
| `IDX_zones_building_floor` | `building`, `floor` | partial, composite | filter `building`, hoặc `building` + `floor` |

- **KHÔNG có index** cho: `status`, `zone_name`, và **mọi tìm kiếm dạng `ILIKE '%...%'`** (leading wildcard không dùng được B-tree).
- Composite `(building, floor)`: lọc **chỉ `floor`** (không kèm `building`) **không** dùng được index — đây là điểm dễ bị hiểu nhầm khi làm filter "theo tầng".
- Cả 3 index đều partial `WHERE deleted_at IS NULL` ⇒ **chỉ có tác dụng khi query có mệnh đề `deleted_at IS NULL`** — thêm một lý do kỹ thuật (ngoài lý do nghiệp vụ) để mọi truy vấn phải lọc soft-delete.

### 0.5. Mẫu list + phân trang (2 tiền lệ)
- **ANPR** ([vehicle-registration.service.ts:117-148](../../../../src/modules/anpr/services/vehicle-registration.service.ts)): `repo.findAndCount({ where, order: { createdAt: 'DESC' }, skip: (page-1)*limit, take: limit })` → trả `{ items, meta }`. Xây `where` cẩn thận: **chỉ thêm filter khi có giá trị**, không để `status: undefined` lọt vào ([:128-135](../../../../src/modules/anpr/services/vehicle-registration.service.ts)).
- **Shape `meta` THẬT** — `interface PaginationMeta { page: number; limit: number; total: number; totalPages: number }` ([vehicle-registration.service.ts:17-22](../../../../src/modules/anpr/services/vehicle-registration.service.ts)), `totalPages = Math.ceil(total / limit)` ([:146](../../../../src/modules/anpr/services/vehicle-registration.service.ts)). Khớp CLAUDE.md §8.4.
- **IoT** ([iot-devices.service.ts:295-317](../../../../src/modules/iot/services/iot-devices.service.ts)) dùng QueryBuilder khi có `search`: `qb.andWhere('(d.deviceName ILIKE :s OR d.deviceCode ILIKE :s)', { s: '%'+search+'%' })` với comment *"Bound param chống injection (NFR-002). ILIKE = không phân biệt hoa thường"* ([:306-311](../../../../src/modules/iot/services/iot-devices.service.ts)), rồi `orderBy('d.createdAt','DESC').skip().take()`.
- ⇒ Hai lối viết cùng tồn tại: `findAndCount` (đơn giản, không search) và QueryBuilder (khi cần `ILIKE`/OR). Chọn lối nào phụ thuộc OQ-3.

### 0.6. Mẫu query DTO ([list-vehicle-registrations-query.dto.ts](../../../../src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts), [list-iot-devices-query.dto.ts](../../../../src/modules/iot/dto/list-iot-devices-query.dto.ts))
- Cả hai: `page: number = 1` với `@Type(() => Number) @IsOptional @IsInt @Min(1)`; `limit: number = 20` thêm `@Max(100)`. Khớp CLAUDE.md §8.4 (default 1/20, max 100).
- Filter optional: ANPR dùng `@IsIn(VEHICLE_STATUSES)`; IoT dùng `@IsEnum(...)`, `@IsUUID('4')`, và `search?: string` với `@MaxLength(200)` ([list-iot-devices-query.dto.ts:51-53](../../../../src/modules/iot/dto/list-iot-devices-query.dto.ts)).
- Field snake_case ở API map sang camelCase bằng `@Expose({ name: 'device_type' })` ([:41-44](../../../../src/modules/iot/dto/list-iot-devices-query.dto.ts)).
- **KHÔNG tiền lệ nào** cho `sortBy`/`sortOrder` do client truyền — cả hai đều hard-code `createdAt DESC`. CLAUDE.md §8.4 có nhắc `sortBy`/`sortOrder` kèm yêu cầu **allowlist**, nhưng repo chưa từng làm ⇒ OQ-4.

### 0.7. Envelope list ([vehicle-registration.controller.ts:107-124](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts))
`{ success: true, message: '...', data: items.map(mapper), meta }` — `meta` nằm **ngang hàng** `data`, không lồng trong `data`. Detail thì `{ success, message, data: mapper(entity) }`, **không** có `meta`.

### 0.8. Mapper `toZoneResponse` ([zone-response.dto.ts](../../../../src/modules/zones/dto/zone-response.dto.ts))
Trả 11 khoá snake_case (`id`, `zone_code`, `zone_name`, `zone_type`, `building`, `floor`, `description`, `metadata_json`, `status`, `created_at`, `updated_at`), **không** có `deleted_at` ⇒ dùng lại nguyên cho cả list lẫn detail, **không** viết mapper mới.
⚠ Lưu ý hiệu năng/kích thước: `metadata_json` là túi tự do, list 100 bản ghi sẽ kéo theo toàn bộ jsonb — liên quan OQ-2 (có nên trả `metadata_json` trong list không).

---

## 1. Scope (UC-93)

### TRONG scope
1. **`GET /api/v1/zones`** — danh sách zone đang sống, phân trang + filter (`zone_type`/`building`/`floor`/`status`/`search`), sort **`zone_code ASC`**, trả `data` + `meta`.
2. **`GET /api/v1/zones/:id`** — chi tiết 1 zone đang sống; không tồn tại/đã xoá mềm → `404 ZONE_NOT_FOUND`.
3. **Query DTO** cho list (`page`, `limit`, 5 filter đã chốt).
4. **Method mới trong `ZonesService`** (`list`, và `getDetail` nếu cần expose `loadActive`) — read-only, **không** đụng `create`/`update`/`loadActive` hiện có.
5. **Route mới trong `ZonesController`**, tái dùng `ZONE_PIPE` + `toZoneResponse`.
6. **1 migration seed permission** `zones.zone.read` → gán **cả 4 role** `SYSTEM_ADMIN`/`BUSINESS_ADMIN`/`MANAGER`/`EMPLOYEE` (CHỐT OQ-6).
7. Unit test cho method mới + DTO (mock repo, không DB).

### NGOÀI scope (UC sau — KHÔNG làm)
- **UC-92 (xoá zone)**: `DELETE /zones/:id`, audit cụm zone.
- **UC-94 (gán camera vào zone)**: `iot_devices.zone_id`.
- **Trả kèm dữ liệu module khác**: danh sách camera thuộc zone, số lượng thiết bị, occupancy hiện tại, thống kê log — đều xuyên module (`iot`) hoặc thuộc FT-20/FT-21.
- **Xem zone đã xoá mềm** / tham số `include_deleted` — **NGOÀI scope** (CHỐT OQ-7); nếu cần thì là task riêng.
- **Export** danh sách zone (CSV/Excel), **báo cáo/thống kê** theo zone.
- **KHÔNG** migration schema: không thêm index mới kể cả khi filter gây full scan (xem OQ-2, ghi nợ ở §8).
- **KHÔNG** audit (read-only); **KHÔNG** WebSocket.
- **KHÔNG** sửa `ZonesModule`, `zone.entity.ts`, `zone-response.dto.ts`, `create-zone.dto.ts`, `update-zone.dto.ts`.

## 2. DTO (đề xuất — mô tả, KHÔNG code)

**`ListZonesQueryDto`** (`src/modules/zones/dto/list-zones-query.dto.ts`), mirror §0.6:

| Field API | Property | Ràng buộc đề xuất | Index? |
| :--- | :--- | :--- | :--- |
| `page` | `page` | `@Type(() => Number) @IsOptional @IsInt @Min(1)`, default `1` | — |
| `limit` | `limit` | `@Type(() => Number) @IsOptional @IsInt @Min(1) @Max(100)`, default `20` | — |
| `zone_type` | `zoneType` | `@Expose({name:'zone_type'}) @IsOptional @IsIn([...ZONE_TYPES])` | ✅ `IDX_zones_type` |
| `building` | `building` | `@IsOptional @IsString @MaxLength(100)` | ✅ `IDX_zones_building_floor` |
| `floor` | `floor` | `@IsOptional @IsString @MaxLength(30)` | ⚠ chỉ khi **kèm** `building` (§0.4) — chấp nhận scan (CHỐT OQ-2) |
| `status` | `status` | `@IsOptional @IsIn([...ZONE_STATUSES])` | ❌ không index — chấp nhận scan (CHỐT OQ-2) |
| `search` | `search` | `@IsOptional @IsString @MaxLength(200)` | ❌ full scan (CHỐT OQ-3: vẫn hỗ trợ) |

- **KHÔNG** có `sort_by`/`sort_order` (CHỐT OQ-4: hard-code `zone_code ASC`, client không điều khiển được sort).
- **KHÔNG** có `include_deleted` (CHỐT OQ-7).
- Không khai field nào ngoài danh sách → `whitelist: true` loại sạch (chặn client bơm `sortBy=<sql>` hay `deleted_at`).
- Response dùng lại `toZoneResponse` **cho cả list lẫn detail** — **giữ `metadata_json` trong list**, KHÔNG tách mapper riêng, KHÔNG field-selection (CHỐT OQ-2).

## 3. Service (đề xuất — thêm method vào `ZonesService`)

**`async list(query: ListZonesQueryDto): Promise<{ items: ZoneEntity[]; meta: PaginationMeta }>`**
1. `page = query.page ?? 1`, `limit = query.limit ?? 20`.
2. Dựng điều kiện: **luôn** có `deletedAt: IsNull()` (nghiệp vụ + để dùng được 3 partial index — §0.4); chỉ thêm filter khi có giá trị (mirror ANPR §0.5, tránh `undefined` lọt vào `where`).
3. Nếu **không** có `search` → `repo.findAndCount({ where, order: { zoneCode: 'ASC' }, skip, take })`.
   Nếu **có** `search` (CHỐT OQ-3) → QueryBuilder + `ILIKE` **bound param** trên `zone_code` **và** `zone_name` — cấm nội suy chuỗi (SEC-03), **KHÔNG** normalize input qua `normalizeZoneCode`. Cả 2 nhánh đều `ORDER BY zone_code ASC` (CHỐT OQ-4).
4. Trả `{ items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } }` — đúng shape `PaginationMeta` đang dùng trong repo (§0.5).
5. **Không** N+1, **không** join sang bảng module khác.

**`async getDetail(id: string): Promise<ZoneEntity>`** — chỉ `return this.loadActive(id)` (mirror ANPR `getDetail`), 404 `ZONE_NOT_FOUND` khi không tồn tại/đã xoá mềm. Không viết lại logic lookup.

- Read-only: **không** transaction, **không** audit, **không** đổi constructor.

## 4. Controller (đề xuất — thêm route vào `ZonesController`)

Thêm import `Get`, `Query`; tái dùng `ZONE_PIPE`, `toZoneResponse`, `ParseUUIDPipe`.

```text
GET /api/v1/zones        → list (phân trang + filter)
GET /api/v1/zones/:id    → detail
```
- Cả 2: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('zones.zone.read')` — **1 permission dùng chung**, gán **cả 4 role** (CHỐT OQ-6).
- List: `@UsePipes(ZONE_PIPE)` + `@Query() query: ListZonesQueryDto` → `{ success, message: 'Zones retrieved successfully', data: items.map(toZoneResponse), meta }` (200).
- Detail: `@Param('id', ParseUUIDPipe)` → `{ success, message: 'Zone retrieved successfully', data: toZoneResponse(entity) }` (200), **không** có `meta`.
- **Thứ tự khai**: `GET /zones` (không path) và `GET /zones/:id` không xung đột nhau, nhưng **mọi route static tương lai** (`/zones/statistics`…) PHẢI khai **trước** `:id` (§0.3, OQ-8).

**HTTP status dự kiến**

| Tình huống | Status | `code` |
| :--- | ---: | :--- |
| List/detail thành công | `200` | — |
| Query sai (`limit>100`, `zone_type` ngoài danh sách, `page=0`) | `400` | (Nest validation) |
| `:id` không phải UUID | `400` | (`ParseUUIDPipe`) |
| Chưa đăng nhập | `401` | — |
| Thiếu permission | `403` | `FORBIDDEN` (guard) |
| Zone không tồn tại / đã xoá mềm (detail) | `404` | `ZONE_NOT_FOUND` |

## 5. Requirements (EARS)

- **R1**: **WHEN** người dùng có permission gọi `GET /api/v1/zones` **→** hệ thống trả `200` + mảng zone **đang sống** (qua `toZoneResponse`) kèm `meta` `{page, limit, total, totalPages}`.
- **R2 (crux)**: **WHILE** thực hiện mọi truy vấn của UC-93, điều kiện `deleted_at IS NULL` PHẢI có mặt — zone đã xoá mềm **KHÔNG BAO GIỜ** xuất hiện trong list, và detail của nó trả `404` (AGENTS.md §5.5 rule 1; đồng thời là điều kiện để dùng được 3 partial index — §0.4).
- **R3**: **WHEN** client truyền filter (`zone_type`/`building`/`floor`/`status`) **→** kết quả chỉ chứa zone khớp **tất cả** filter được gửi (AND, không OR).
- **R4**: **IF** filter không được gửi **→** filter đó **không** được đưa vào mệnh đề `WHERE` (không để `undefined` biến thành `IS NULL`).
- **R5**: **IF** `limit > 100` hoặc `page < 1` hoặc `limit < 1` **→** trả `400`, **KHÔNG** truy vấn DB (chặn ở DTO — chống quét toàn bảng).
- **R6**: **IF** `zone_type` ngoài `ZONE_TYPES` hoặc `status` ngoài `ZONE_STATUSES` **→** trả `400`.
- **R7 (SEC-03)**: **WHERE** client gửi `search`, truy vấn PHẢI dùng **bound parameter** (`ILIKE :s`), **CẤM** nối chuỗi input vào SQL. Client **KHÔNG** điều khiển được `ORDER BY` (CHỐT OQ-4: hard-code `zone_code ASC`) ⇒ không có bề mặt tấn công qua tên cột.
- **R8**: **WHEN** gọi `GET /api/v1/zones/:id` với zone đang sống **→** trả `200` + zone; **IF** không tồn tại hoặc đã xoá mềm **→** `404 ZONE_NOT_FOUND`.
- **R9 (SEC-02)**: **WHILE** xử lý cả 2 route, request PHẢI qua `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions`; thiếu token → `401`, thiếu quyền → `403`. **Không** có route zone công khai.
- **R10**: **WHILE** trả dữ liệu, response **KHÔNG** chứa `deleted_at` (mapper hiện có đã đảm bảo) và **KHÔNG** chứa field ngoài 11 khoá của `toZoneResponse`.
- **R11**: **WHERE** danh sách rỗng **→** trả `200` với `data: []` và `meta.total = 0` (**không** trả 404).

## 6. Constitution

| Rule | Áp dụng trong UC-93 |
| :--- | :--- |
| **SEC-01** | `metadata_json` là túi tự do và có thể chứa cấu hình nhạy cảm nếu ai đó nhét vào — cân nhắc có trả trong **list** không (OQ-2). Không log nội dung query. |
| **SEC-02** | Đây là endpoint **đọc** nhưng vẫn phải auth: zone lộ sơ đồ toà nhà/cổng ra vào. Guard đầy đủ (R9), không public. |
| **SEC-03** | DTO validate + `ZONE_PIPE` whitelist; `ILIKE` bound param; `sort_by` (nếu có) qua allowlist; `:id` `ParseUUIDPipe`. |
| **DATA-01** | Không xoá gì; tôn trọng soft-delete bằng cách **luôn** lọc `deleted_at IS NULL` (R2). |
| **ARCH-01** | Chỉ đọc bảng `zones`; **không** join sang `iot_devices`/`gate_access_logs`/`zone_presence_events` (thuộc UC/FT khác). |
| **ARCH-02** | Truy vấn phải rẻ (<2s): chặn `limit>100`, dùng index sẵn có; **không** trả toàn bộ bảng. |
| **ARCH-03** | Read-only, tự nhiên idempotent. |
| **ENG-01** | Test ≥80%: filter đơn/kết hợp, phân trang, `meta` đúng, soft-delete không lọt, 404 detail, whitelist loại field lạ. |
| **ENG-02** | Chưa có Swagger → miễn như UC trước; EARS tag trong JSDoc. |
| **ENG-03** | Lỗi `{code, message}`; không lộ stack/SQL. |
| **ENG-04** | Không thêm dependency. |

## 7. OPEN QUESTIONS — ĐÃ CHỐT

> Thiếu Chủ đã chốt OQ-1 → OQ-9 ngày 2026-07-22. Phần *Đề xuất/Phân tích* giữ nguyên để lưu vết; dòng **KẾT LUẬN** là quyết định cuối. **Plan/tasks/code KHÔNG được mở lại.** Một điểm **khác** đề xuất ban đầu của agent: **OQ-4** (sort `zone_code ASC` thay vì `created_at DESC`).

- **OQ-1 — Phạm vi endpoint: 2 route hay 1?** *Đề xuất*: **2 route** (`GET /zones` + `GET /zones/:id`).
  *Lý do*: FE cần cả hai — dropdown/màn danh sách dùng list, còn màn sửa zone (UC-91) cần detail để đổ form theo `id`. Detail gần như miễn phí vì chỉ gọi lại `loadActive` đã có (§0.1). Nếu chỉ làm list, FE phải lọc client-side từ trang hiện tại — sai khi zone nằm ở trang khác.
  **KẾT LUẬN — CHỐT: 2 route** — `GET /api/v1/zones` (list) + `GET /api/v1/zones/:id` (detail).

- **OQ-2 (crux) — Bộ lọc nào được hỗ trợ?** *Đề xuất*: `zone_type`, `building`, `floor`, `status` (+ `search` tuỳ OQ-3).
  *Phân tích chi phí (§0.4)*:
  - `zone_type` → dùng `IDX_zones_type` ✅
  - `building` (một mình) hoặc `building`+`floor` → dùng `IDX_zones_building_floor` ✅
  - **`floor` một mình → KHÔNG dùng được index** (cột thứ 2 của composite) ⚠ — vẫn nên hỗ trợ vì UI hay lọc theo tầng, nhưng phải biết là scan.
  - `status` → **không có index** ⚠ — bảng `zones` dự kiến nhỏ (vài chục–vài trăm bản ghi) nên chấp nhận được.
  *Câu hỏi cần chốt*: có chấp nhận 2 filter không-index (`floor` đơn lẻ, `status`) không? Có trả `metadata_json` trong list không (§0.8)?
  **KẾT LUẬN — CHỐT: hỗ trợ đủ `zone_type`, `building`, `floor`, `status`.** Chấp nhận `floor` đơn lẻ và `status` gây sequential scan (bảng `zones` là danh mục cấu hình, số bản ghi nhỏ) — ghi vào residual, **KHÔNG** thêm index (cấm migration schema). **`metadata_json` GIỮ NGUYÊN trong list** — dùng chung 1 mapper `toZoneResponse`, **không** tách mapper riêng cho list, **không** làm field-selection.

- **OQ-3 — Tìm kiếm text (`search`).** *Đề xuất*: **CÓ**, `ILIKE '%kw%'` trên `zone_code` **và** `zone_name`, bound param (mirror IoT §0.5), `@MaxLength(200)`.
  *Lý do*: người vận hành nhớ tên/mã gần đúng, không nhớ UUID; đây là cách dùng thực tế nhất của màn hình danh sách.
  *Chi phí*: leading wildcard ⇒ **full scan**, không index nào đỡ; phải dùng QueryBuilder thay `findAndCount`.
  *Câu hỏi phụ (quan trọng)*: có **normalize `search` qua `normalizeZoneCode`** không?
  **KẾT LUẬN — CHỐT: CÓ `search`** — `ILIKE '%kw%'` trên `zone_code` **và** `zone_name`, **bound param** (mirror `iot-devices.service.ts`), `@MaxLength(200)`. **KHÔNG normalize** input qua `normalizeZoneCode` — `ILIKE` đã không phân biệt hoa thường, normalize sẽ phá tìm kiếm theo tên có dấu. Có `search` → QueryBuilder; không có → `findAndCount`.

- **OQ-4 — Sắp xếp.** *Đề xuất*: **hard-code `created_at DESC`**, **KHÔNG** cho client chọn.
  *Lý do*: cả 2 tiền lệ trong repo đều hard-code `createdAt DESC` (§0.5, §0.6) — chưa từng có `sortBy` do client truyền; mở `sort_by` là mở thêm bề mặt tấn công (`ORDER BY` không bind được tên cột, phải allowlist) cho một nhu cầu chưa ai đòi.
  *Phương án thay thế*: nếu FE muốn "sắp theo mã cho dễ nhìn" thì chốt **`zone_code ASC`** làm mặc định (vẫn hard-code, không cho client chọn) — hợp lý hơn cho danh mục cấu hình.
  **KẾT LUẬN — CHỐT (KHÁC đề xuất agent): hard-code `zone_code ASC`.** Lý do Thiếu Chủ: `zones` là **danh mục cấu hình**, người vận hành tra theo mã chứ không theo thời điểm tạo. **KHÔNG** cho client truyền `sort_by`/`sort_order` — không mở bề mặt `ORDER BY`.

- **OQ-5 — Xác nhận phân trang + shape `meta`.** *Đề xuất*: `page` default 1, `limit` default 20, max 100; `meta = { page, limit, total, totalPages }` với `totalPages = Math.ceil(total/limit)`.
  *Căn cứ*: đây là shape **đọc được từ code thật** (`PaginationMeta`, §0.5), khớp CLAUDE.md §8.4. `meta` đặt **ngang hàng** `data` (§0.7).
  *Chờ xác nhận*: có cần thêm `hasNext`/`hasPrev` cho FE không (hiện **không** tiền lệ nào có)?
  **KẾT LUẬN — CHỐT: `page` default 1 (`@Min(1)`), `limit` default 20 (`@Min(1) @Max(100)`), `meta = { page, limit, total, totalPages }`** với `totalPages = Math.ceil(total/limit)`. **KHÔNG** thêm `hasNext`/`hasPrev` (lệch shape chung repo). `meta` đặt **ngang hàng** `data`.

- **OQ-6 — Permission và role đọc.** *Đề xuất*: **1 permission `zones.zone.read`** cho **cả list lẫn detail**, gán **`SYSTEM_ADMIN` + `BUSINESS_ADMIN` + `MANAGER` + `EMPLOYEE`** (cả 4 role thật).
  *Lý do mở rộng hơn UC-90/91*: zone là **dữ liệu nền** — nhiều màn hình tương lai (chọn zone khi xem báo cáo, lọc dashboard, dropdown cấu hình) cần đọc; giới hạn 2 role admin sẽ chặn oan các màn hình đó. Ghi/sửa/xoá vẫn chỉ 2 role admin, nên rủi ro thấp.
  *Rủi ro cần cân*: danh sách zone lộ **sơ đồ cổng/hành lang/bãi xe** của toàn khuôn viên.
  **KẾT LUẬN — CHỐT: 1 permission `zones.zone.read`** cho **cả list lẫn detail**, gán **cả 4 role** (`SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE`). Ghi/sửa/xoá vẫn chỉ 2 role admin nên rủi ro thấp.

- **OQ-7 — Zone đã soft-delete và tham số `include_deleted`.** *Đề xuất*: **KHÔNG** hỗ trợ `include_deleted`; zone đã xoá mềm **không bao giờ** xuất hiện ở list, detail trả `404`.
  *Lý do*: giữ 1 quy tắc duy nhất cho toàn module (`deleted_at IS NULL` ở mọi lookup), tránh nhánh code đặc biệt; và 3 index đều partial nên query "bao gồm đã xoá" **không có index nào đỡ** (§0.4).
  *Rủi ro*: admin không có cách nào xem/đối soát zone đã xoá qua API (kết hợp với UC-92 chốt "không restore" thì càng kín).
  **KẾT LUẬN — CHỐT: KHÔNG hỗ trợ `include_deleted`.** Zone đã xoá mềm không bao giờ xuất hiện ở list; detail trả `404 ZONE_NOT_FOUND`. Nhu cầu xem zone đã lưu trữ (nếu có) là **task riêng**, không nhét vào UC-93.

- **OQ-8 — Quy ước thứ tự khai route (chốt sớm cho cả module).** *Đề xuất*: ghi thành luật của module `zones` — **mọi route static PHẢI khai TRƯỚC route động `:id`** trong `ZonesController`, kèm comment cảnh báo tại chỗ (mirror `iot-devices.controller.ts:51-53`).
  *Lý do*: UC-93 chưa vấp (chỉ có `GET /zones` và `GET /zones/:id`), nhưng UC sau thêm bất kỳ path static nào dưới `/zones/...` sẽ bị `:id` nuốt và lỗi sẽ hiện ra dưới dạng **400 `ParseUUIDPipe`** rất khó đoán.
  **KẾT LUẬN — CHỐT: thành LUẬT của module `zones`** — mọi route static PHẢI khai **TRƯỚC** route động `:id` trong `ZonesController`, kèm comment cảnh báo tại chỗ (mirror `iot-devices.controller.ts:51-52`). Ghi vào plan §8 Kỷ luật để UC sau bám theo.

- **OQ-9 — Mâu thuẫn giữa prompt và file luật.** Rà soát: **không phát hiện mâu thuẫn mới**. Một điểm cần xác nhận cách hiểu: CLAUDE.md §8.4 mô tả query chuẩn có `sortBy`/`sortOrder`, nhưng **không tiền lệ nào trong repo implement** (§0.6) — nếu OQ-4 chốt hard-code sort thì UC-93 **lệch nhẹ với §8.4**. Đề xuất coi §8.4 là "khuyến nghị khi có nhu cầu sort", không phải bắt buộc mọi endpoint list.
  **KẾT LUẬN — XÁC NHẬN:** §8.4 là **khuyến nghị** khi có nhu cầu sort do client điều khiển, **không** bắt buộc mọi endpoint list ⇒ UC-93 hard-code sort là **hợp lệ**. Các lệch đã biết khác (4 role thật, error envelope thiếu `timestamp`/`path`, chưa Swagger, 5 file `spec/global/` rỗng) giữ nguyên như UC-90/91, **không mở lại**.

## 8. Residuals / known-gaps

- **Filter không có index**: `status` và `floor`-đơn-lẻ gây sequential scan; `search` `ILIKE '%kw%'` cũng vậy. Chấp nhận được ở quy mô hiện tại (zone là danh mục cấu hình, số bản ghi nhỏ), nhưng nếu sau này khuôn viên lớn thì cần index bổ sung (`IDX_zones_status`, hoặc `pg_trgm` cho search) — **task migration riêng**, ngoài UC-93.
- **Không có cách xem zone đã xoá mềm** (nếu OQ-7 chốt như đề xuất): kết hợp với UC-92 (nếu không có restore) thì zone xoá nhầm vừa không xem được vừa không khôi phục được qua API.
- **`metadata_json` trong list**: nếu chốt trả, payload list 100 bản ghi có thể lớn bất thường vì jsonb không giới hạn kích thước; chưa có cơ chế field-selection (`?fields=`).
- **Chưa có endpoint tổng hợp cho FE**: màn hình quản lý zone thường muốn kèm "số camera đang gán" — nhưng đó là dữ liệu module `iot` (ARCH-01), phải chờ UC-94 hoặc một endpoint tổng hợp riêng.
- **Quan hệ `zones` ↔ `rooms` vẫn chưa định nghĩa**: list zone `zone_type='room'` và list `rooms` là hai nguồn dữ liệu song song, FE có thể hiển thị trùng lặp/gây nhầm. Nợ kiến trúc từ UC-90.
- **Không có global exception filter / Swagger / 5 file `spec/global/` rỗng**: nợ toàn hệ thống, giữ nguyên.
- **Kiểm thử phân trang bằng mock repo**: `findAndCount` được mock nên test chỉ chứng minh **tham số** `skip`/`take`/`where` đúng, không chứng minh SQL chạy đúng trên Postgres — cần smoke test khi có DB (ghi nợ, không làm trong UC-93).

---

> **Spec ĐÃ DUYỆT**, OQ-1 → OQ-9 đã chốt (2026-07-22). Bước kế tiếp: [plan.md](./plan.md) (plan-only, chưa code, chưa `tasks.md`).
