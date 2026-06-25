# VPL-001 — plan.md (UC3 ANPR: xem danh sách/chi tiết biển)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan VPL-001 sau spec DUYỆT + chốt OQ-1…5. 2 GET route (list phân trang + detail), 2 method thêm vào service (list + getDetail=loadOwned), 1 query DTO. Mirror pagination repo. No-migration, read-only. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON (đọc CODE THẬT, xác nhận đủ để code)
- **Pagination pattern** (mirror): query DTO `page`/`limit` `@Type(()=>Number) @IsInt @Min/@Max` ([list-iot-devices-query.dto.ts](../../../../src/modules/iot/dto/list-iot-devices-query.dto.ts)); service `.skip((page-1)*limit).take(limit)` + count → `meta:{page,limit,total,totalPages:Math.ceil(total/limit)}` ([iot-devices.service.ts:274-320](../../../../src/modules/iot/services/iot-devices.service.ts)); controller `{success,message,data:items,meta}` + `@UsePipes(ValidationPipe{whitelist,transform})` ([iot-devices.controller.ts:46-55](../../../../src/modules/iot/controllers/iot-devices.controller.ts)).
- **`@Type(()=>Number)`** ép query string→number (cần `transform:true`).
- **`loadOwned` private** đã có (UC2) trong [vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts) → detail tái dùng. `toVehicleRegistrationResponse` (UC1) trả shape công khai.
- **Cách count**: repo dùng QueryBuilder `getManyAndCount` (iot); với filter cố định, `repo.findAndCount({where, order, skip, take})` (trả `[items,total]`) là idiom gọn hơn — chọn `findAndCount` (where đơn giản, KHÔNG cần QueryBuilder). Entity sort field = `createdAt` (col `created_at`).
- **UC1/UC2 đã wiring** controller+service → UC3 thêm method/route vào file CÓ SẴN → **`anpr.module` KHÔNG đổi**.

## 1. Quyết định đã chốt (OQ + Constitution)
OQ-1 mirror pagination (page/limit, meta{page,limit,total,totalPages}) · OQ-2 filter `status` optional `@IsIn` (chỉ status) · OQ-3 detail 404 tái dùng `loadOwned` · OQ-4 list rỗng `[]`+200+meta.total=0 · OQ-5 sort `created_at DESC`.
- **SEC-01 (crux)** list lọc cứng `userId=current`; detail qua `loadOwned`. KHÔNG lộ biển user khác; `userId` từ JWT. **SEC-02** detail-fail 404 (không 403). **ARCH-01** controller→service→repo, mirror UC1/2; detail tái dùng `loadOwned` (single-source). **DATA-01** lọc `userId + deletedAt IS NULL` + status optional, **read-only**. **DATA-02** no-migration. **VAL-01** query DTO validate + `ParseUUIDPipe`.

## 2. Service — 2 method thêm vào `VehicleRegistrationService`
- **`list(userId, query: ListVehicleRegistrationsQueryDto): Promise<{items: VehicleRegistrationEntity[], meta}>`**:
  - `where = { userId, deletedAt: IsNull(), ...(query.status ? { status: query.status } : {}) }`.
  - `const [items, total] = await repo.findAndCount({ where, order: { createdAt: 'DESC' }, skip: (page-1)*limit, take: limit })`.
  - `meta = { page, limit, total, totalPages: Math.ceil(total/limit) }`. List rỗng → `items:[]`, `total:0`, `totalPages:0` (OQ-4).
- **`getDetail(id, userId): Promise<VehicleRegistrationEntity>`**: `return this.loadOwned(id, userId)` (tái dùng — ownership + 404) (OQ-3).
- SEC-03 dùng repo (bind tham số). KHÔNG đụng `register`/UC2 mutate method.

## 3. DTO (1 mới)
- `dto/list-vehicle-registrations-query.dto.ts`: `page` (`@Type(()=>Number) @IsOptional @IsInt @Min(1)` default 1), `limit` (`@Type(()=>Number) @IsOptional @IsInt @Min(1) @Max(100)` default 20), `status?` (`@IsOptional @IsIn(['active','disabled'])`). KHÔNG `user_id`. (Có thể tái dùng type `VehicleStatus` từ UC2 status DTO.)

## 4. Controller — 2 GET route thêm vào `VehicleRegistrationController`
Khai báo **list trước detail** (rõ ràng; tuy khác segment nên không nuốt). Cả 2 `@UseGuards(JwtAuthGuard)`, `userId` từ `@CurrentUser()`.
- `@Get('vehicle-registrations')` `@UsePipes(ValidationPipe{whitelist:true,transform:true})` `@Query() query` → `list(user.userId, query)` → `{ success:true, message:'Vehicle registrations retrieved', data: items.map(toVehicleRegistrationResponse), meta }` (200).
- `@Get('vehicle-registrations/:id')` `@Param('id', ParseUUIDPipe)` → `getDetail(id, user.userId)` → `{ success:true, message:'Vehicle registration retrieved', data: toVehicleRegistrationResponse(entity) }` (200).

## 5. File list
### Net-new
- `src/modules/anpr/dto/list-vehicle-registrations-query.dto.ts`
### Modified
- `src/modules/anpr/services/vehicle-registration.service.ts` (+ `list`/`getDetail`) (+ `.spec.ts` thêm test)
- `src/modules/anpr/controllers/vehicle-registration.controller.ts` (+ 2 GET route) (+ `.spec.ts` thêm test)
> Tổng **1 net-new + 4 modified** (2 code + 2 spec). 0 migration. `anpr.module.ts` KHÔNG đổi.

## 6. Test (mock repo — KHÔNG DB)
- **list ok**: `findAndCount` mock trả `[items, total]` → assert `data` map qua mapper (đúng số phần tử) + `meta` đúng (`page/limit/total/totalPages` tính đúng, vd total=25 limit=20 → totalPages=2).
- **SEC (BẮT BUỘC)**: assert `findAndCount` được gọi với `where.userId = currentUser` + `where.deletedAt = IsNull()` → list KHÔNG BAO GIỜ trả biển user khác.
- **filter status**: `query.status='disabled'` → `where.status='disabled'`; không truyền → KHÔNG có khóa `status` trong where.
- **list rỗng**: `findAndCount` trả `[[], 0]` → `data:[]` + `meta.total=0` + `totalPages=0` (KHÔNG 404).
- **pagination**: page=2 limit=20 → `skip=20, take=20`.
- **detail**: tái dùng `loadOwned` → biển của mình → trả entity; biển người khác/không tồn tại (mock findOne null) → **404 VEHICLE_NOT_FOUND**.
- **controller**: userId từ `@CurrentUser` (KHÔNG query/body); envelope shape + meta; guard = JwtAuthGuard.
- **validate** (DTO): `limit>100` / `status` sai / `page` không phải số → 400 (qua ValidationPipe — test DTO hoặc controller-level).
- **UC1+UC2 KHÔNG hồi quy**: `jest src/modules/anpr` xanh cả cũ + mới.
- Coverage **≥80%** method mới (`list`/`getDetail`).

## 7. Gate (STOP, KHÔNG commit)
- build=0; eslint touched (1 dto + service + controller + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (cũ + mới); coverage ≥80% method mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies). **KHÔNG live, KHÔNG DB.**
- **Owed (ghi, KHÔNG chạy)**: admin list-all (PermissionsGuard, bỏ lọc userId) · search/sort-by-field + filter vehicle_type · xem biển đã xóa-mềm (history) · cursor pagination · live smoke 2 route khi có DB.

## 8. Kỷ luật
- **No-migration** (read-only, không cột mới). **SEC-01/02** lọc cứng `userId=current` (list) + `loadOwned` (detail) → KHÔNG lộ biển user khác; detail-fail 404. **ARCH-01** mirror UC1/2; tái dùng `loadOwned` (KHÔNG lặp ownership). **DATA-01** read-only, lọc `deletedAt IS NULL`. **VAL-01** query DTO + `ParseUUIDPipe`.
- Mirror pagination repo (page/limit/meta) — KHÔNG tự dựng lệch. KHÔNG đụng `register`/UC2 mutate · KHÔNG đổi `anpr.module` · KHÔNG admin route (owed).

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang tasks. KHÔNG code.
