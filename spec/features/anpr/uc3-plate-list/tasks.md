# VPL-001 — tasks.md (UC3 ANPR: xem danh sách/chi tiết biển)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks VPL-001: T0 verify → T1 query DTO → T2 service list+getDetail → T3 controller 2 GET → T-GATE. Mỗi task 1 AC, code/test tách. SEC lọc userId = test bắt buộc. No-migration, read-only. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration, read-only. KHÔNG đụng `register`/UC2 mutate · KHÔNG đổi `anpr.module`. UC1+UC2 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `repo.findAndCount({where,order,skip,take})` trả `[items, total]`; `@Type(()=>Number)` (class-transformer) + `@IsInt`/`@Min`/`@Max`/`@IsIn`/`@IsOptional` (class-validator); `IsNull` từ `typeorm`; **`loadOwned` private CÒN NGUYÊN** trong `VehicleRegistrationService` (UC2) để `getDetail` tái dùng; `toVehicleRegistrationResponse` + UC1/UC2 controller/service còn nguyên.
- **AC**: dán xác nhận 5 mục; thiếu/path sai/`loadOwned` mất → **DỪNG báo Thiếu Chủ** (không bịa).

## T1 — Query DTO (code) — plan §3, OQ-1/2, VAL-01
- `dto/list-vehicle-registrations-query.dto.ts`: `page` (`@Type(()=>Number) @IsOptional @IsInt @Min(1)` default 1), `limit` (`@Type(()=>Number) @IsOptional @IsInt @Min(1) @Max(100)` default 20), `status?` (`@IsOptional @IsIn(['active','disabled'])`). KHÔNG `user_id`/field khác.
- **AC**: DTO đúng 3 field; page/limit ép Number + biên @Min/@Max; status `@IsIn` 2 giá trị.

## T2 — Service `list` + `getDetail` (code) — plan §2, SEC-01, OQ-1/3/4/5
- `list(userId, query)`: `where = {userId, deletedAt: IsNull(), ...(query.status ? {status: query.status} : {})}`; `const [items, total] = await repo.findAndCount({where, order:{createdAt:'DESC'}, skip:(page-1)*limit, take:limit})`; `meta = {page, limit, total, totalPages: Math.ceil(total/limit)}`. Rỗng → `items:[]`, `total:0`, `totalPages:0`.
- `getDetail(id, userId)`: `return this.loadOwned(id, userId)` (TÁI DÙNG — KHÔNG viết lại ownership).
- KHÔNG đụng `register`/UC2 mutate. Read-only.
- **AC**: `list` where lọc cứng `userId`+`deletedAt:IsNull` (+status nếu có), sort `createdAt DESC`, meta đúng; `getDetail` chỉ gọi `loadOwned`.

## T2b — Service test (mock repo) — SEC-01 (BẮT BUỘC), OQ-1/3/4
- **SEC**: assert `findAndCount` gọi với `where.userId = currentUser` + `where.deletedAt = IsNull()` → list KHÔNG trả biển user khác.
- meta: mock `[items, 25]` limit=20 → `totalPages=2`, `total=25`.
- pagination: page=2 limit=20 → `skip=20, take=20` (assert đối số findAndCount).
- filter: `status='disabled'` → `where.status='disabled'`; không truyền → where KHÔNG có khóa `status`.
- sort: `order={createdAt:'DESC'}`.
- list rỗng: `findAndCount` trả `[[], 0]` → `items:[]`, `meta.total=0`, `totalPages=0` (KHÔNG throw).
- detail: `loadOwned` ok → trả entity; mock `findOne` null (biển người khác/không tồn tại/đã xóa) → **404 VEHICLE_NOT_FOUND**.
- **AC**: các nhánh xanh; SEC where.userId chứng minh.

## T3 — Controller 2 GET route (code) — plan §4, OQ-1, SEC-01
- Khai báo **list trước detail**. Cả 2 `@UseGuards(JwtAuthGuard)`, `userId` từ `@CurrentUser()`.
  - `@Get('vehicle-registrations')` `@UsePipes(ValidationPipe{whitelist:true,transform:true})` `@Query() query` → `list(user.userId, query)` → `{success:true, message:'Vehicle registrations retrieved', data: items.map(toVehicleRegistrationResponse), meta}` (200).
  - `@Get('vehicle-registrations/:id')` `@Param('id', ParseUUIDPipe)` → `getDetail(id, user.userId)` → `{success:true, message:'Vehicle registration retrieved', data: toVehicleRegistrationResponse(entity)}` (200).
- **AC**: list trả `data` (map mapper) + `meta`; detail trả entity qua mapper; userId từ `@CurrentUser` (KHÔNG query/body); guard JwtAuthGuard.

## T3b — Controller test (mock service + mock guard) — SEC-01, VAL-01
- list route → gọi `service.list(currentUserId, query)`; map mapper đúng số phần tử; trả `meta` từ service.
- detail route → `service.getDetail(id, currentUserId)`; envelope + mapper.
- userId LẤY TỪ `@CurrentUser` (KHÔNG query/body); guard list = JwtAuthGuard.
- (validate — nếu test ở controller-level/DTO) `limit>100` / `status` sai / `page` không phải số → 400.
- **AC**: assert userId nguồn JWT; list trả meta; detail qua mapper.

## T-GATE — (STOP, KHÔNG commit) — plan §7
- build=0; eslint touched (1 dto + service + controller + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (**UC1+UC2 KHÔNG hồi quy + UC3 mới**); coverage **≥80%** method mới (`list`/`getDetail`); DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies); throwaway xóa. **KHÔNG live, KHÔNG DB, KHÔNG commit.**
- Nếu sửa eslint: **đọc lại file sau khi sửa**, KHÔNG sed/regex hàng loạt làm rỗng assertion.
- In: code đầy đủ file + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: admin list-all (PermissionsGuard, bỏ lọc userId) · search/sort-by-field + filter `vehicle_type` · xem biển đã xóa-mềm (history) · cursor pagination · live smoke 2 route khi có DB.
- **AC**: bảng gate đầy đủ + báo cáo: SEC list lọc userId (không lộ biển user khác) ✓ · getDetail tái dùng loadOwned→404 ✓ · meta đúng (totalPages) ✓ · pagination skip/take ✓ · filter status ✓ · sort created_at DESC ✓ · list rỗng []+200 ✓ · validate query 400 ✓ · read-only/no-migration/module không đổi ✓ · UC1+UC2 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC3
- T0 → verify findAndCount/loadOwned/UC1-2 còn nguyên
- T1 → query DTO (page/limit/status)
- T2/T2b → service `list` (SEC lọc userId + meta + sort) + `getDetail` (tái dùng loadOwned)
- T3/T3b → controller 2 GET route (list + detail)
- T-GATE → gate + STOP + Owed (admin list-all · search/sort · history · cursor · live smoke)
