# VCL-001 — tasks.md (UC8 ANPR/SAVP: CRUD vehicle_control_list)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo tasks VCL-001: T0 verify → T1 DTO×4 → T2 service (create/list/detail/update/softDelete) → T2b test → T3 controller 5 route → T3b test → T4 migration permission → T-GATE. Viết cùng lượt với spec/plan do OQ đã chốt trước. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. KHÔNG đụng UC1-UC7 (`vehicle-registration.*`). UC1-UC7 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T5 (module wiring) → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `VehicleControlListEntity` field đầy đủ (`plateNumber/plateRaw/listType/reason/active/createdBy/createdAt/updatedAt/deletedAt`); entity đã `TypeOrmModule.forFeature` trong `anpr.module.ts`; `AuthModule` đã import (dùng được `JwtAuthGuard`/`PermissionsGuard`/`RequirePermissions`/`CurrentUser` ngay); `normalizePlate` import path đúng; 4 role `SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER/EMPLOYEE` tồn tại trong seed; migration mới nhất là `20260721000007` (không trùng timestamp `20260722000001`).
- **AC**: dán xác nhận đủ 6 mục; thiếu/path sai → **DỪNG báo Thiếu Chủ**, không bịa.

## T1 — DTO ×4 (code) — plan §3
- `dto/create-vehicle-control-list.dto.ts`: `plate_raw` (required, string, maxlength 20), `list_type` (required, `@IsIn(['blocklist','watchlist'])`), `reason?` (string, maxlength 255). Export `CONTROL_LIST_TYPES` const + `ControlListType` type.
- `dto/update-vehicle-control-list.dto.ts`: `reason?`, `active?` (`@IsBoolean`). KHÔNG field khác.
- `dto/list-vehicle-control-list-query.dto.ts`: `page`/`limit` (mirror UC3), `plate?`, `list_type?` (`@IsIn(CONTROL_LIST_TYPES)`), `active?` (transform string→boolean tay).
- `dto/vehicle-control-list-response.dto.ts`: class + `toVehicleControlListResponse(entity)`.
- **AC**: 4 DTO đúng field theo spec §3; create/update KHÔNG có field cấm (list_type ở update, active/created_by ở create); query `active` transform đúng `'false'` → `false` (không phải truthy-string-bug).

## T2 — Service `VehicleControlListService` (code) — plan §4
- `create(currentUserId, dto)`: normalize → pre-check `(plateNumber, listType, deletedAt IsNull)` → 409 nếu trùng → `repo.create/save` với `createdBy: currentUserId`, `active: true` → safety-net `23505` → 409.
- `list(query)`: where fold `deletedAt IsNull` + optional `plateNumber` (normalized)/`listType`/`active` (check `!== undefined`, KHÔNG if-truthy) → `findAndCount` + phân trang.
- `getDetail(id)`: `findOne({id, deletedAt IsNull})` → null → 404 `CONTROL_LIST_ENTRY_NOT_FOUND`.
- `update(id, dto)`: `getDetail` → set field gửi (`reason`/`active`) → không field nào → no-op trả nguyên trạng → có field → `save`.
- `softDelete(id)`: `getDetail` → `repo.softDelete(id)`.
- Private `isUniqueViolation(e)` (copy pattern UC1, KHÔNG import từ `VehicleRegistrationService`).
- **AC**: 5 method public + 1 helper private; KHÔNG đụng file `vehicle-registration.service.ts`; `active=false` filter hoạt động đúng trong `list`.

## T2b — Service test (mock repo) — plan §8
- `create`: trùng `(plate, listType)` còn sống (kể cả `active=false`) → 409, KHÔNG `save`; race `23505` → 409 (KHÔNG lộ lỗi thô); `createdBy` = tham số truyền, DTO không ghi đè được.
- `list`: filter `active:false` áp dụng đúng (assert where có key `active` giá trị `false`, KHÔNG bị bỏ qua); filter `plate` qua `normalizePlate()`; không filter → trả full (còn sống); phân trang `skip/take` đúng.
- `getDetail`: không tồn tại/đã xóa mềm → 404.
- `update`: đổi đúng field gửi; cả 2 absent → no-op KHÔNG `save`, trả nguyên trạng; `undefined` giữ nguyên, gửi `reason: null` → set null.
- `softDelete`: gọi `repo.softDelete(id)` sau `getDetail` ok.
- **AC**: toàn bộ nhánh xanh; assert rõ ràng KHÔNG gọi `save`/`softDelete` ở các case lỗi (409/404).

## T3 — Controller `VehicleControlListController` (code) — plan §5
- `@Controller('anpr/admin/control-list')`. 5 route: `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`. Tất cả `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('vehicle_control.<action>')` đúng theo action; `:id` qua `ParseUUIDPipe`; `@UsePipes(ValidationPipe{whitelist:true, transform:true})`.
- `POST` lấy `createdBy` từ `@CurrentUser()`, KHÔNG body.
- `DELETE` trả `{success, message, data: null}`.
- **AC**: 5 route đúng method/path/permission string; envelope đúng shape mirror UC1; DELETE `data:null`.

## T3b — Controller test (mock service + mock guard) — plan §8
- Mỗi route gọi đúng service method với tham số đúng (đặc biệt `create` truyền `user.userId` KHÔNG phải từ body).
- Guard list đúng cho cả 5 route (`JwtAuthGuard`, `PermissionsGuard`) + đúng chuỗi permission (`vehicle_control.create/read/update/delete` — 2 route GET đều dùng `vehicle_control.read`).
- Whitelist: body PATCH gửi `list_type`/`plate_number` → bị loại, service nhận DTO KHÔNG chứa field đó.
- Query `active=false` (string) → DTO transform đúng thành `boolean false` trước khi vào service.
- **AC**: assert guard + permission string từng route; whitelist loại field cấm; transform boolean đúng; DELETE `data:null`.

## T4 — Migration permission (code) — plan §6, CLAUDE.md §5.5 quy tắc 4
- `src/database/migrations/20260722000001-SeedVehicleControlListPermissions.ts`: insert 4 `permissions` (idempotent `WHERE NOT EXISTS`) + insert `role_permissions` theo role mapping đã chốt (`create/update/delete`→`BUSINESS_ADMIN,SYSTEM_ADMIN`; `read`→`MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN`), idempotent tương tự. `down()` xóa `role_permissions` rồi xóa 4 `permissions` (an toàn vì permission mới hoàn toàn do migration này tạo).
- **AC**: `up()` idempotent (chạy 2 lần không lỗi/không trùng dòng); `down()` dọn sạch đúng những gì `up()` tạo, KHÔNG đụng permission/role khác.

## T5 — Wiring `anpr.module.ts` (code) — plan §7
- Thêm `VehicleControlListService` vào `providers`, `VehicleControlListController` vào `controllers`. KHÔNG đổi `imports` (entity đã `forFeature` sẵn từ trước).
- **AC**: `AppModule` compile được (DI-proof), KHÔNG circular dependency, KHÔNG đụng `VEHICLE_EVENT_HANDLER` binding hiện có.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint file mới/touched 0 warning mới; `npx jest src/modules/anpr` xanh (UC1-UC7 KHÔNG hồi quy + UC8 mới xanh); coverage **≥80%** file mới; DI-proof compile `AppModule` (Redis infra-OK, 0 circular/UnknownDependencies). **KHÔNG live, KHÔNG DB thật, KHÔNG commit.**
- In: code đầy đủ 9 file mới + 2 file modified + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: gate-check hot-path endpoint (internal-token, dùng `IDX_vehicle_control_lookup`) · alert center đối chiếu `gate_access_logs` · restore/un-delete · bulk import Excel · factor `isUniqueViolation` dùng chung.
- **AC**: bảng gate đầy đủ + báo cáo: normalize bắt buộc trước lưu/tra ✓ · trùng `(plate,list_type)` còn sống → 409 kể cả active=false ✓ · `list_type` bất biến (DTO update không có field) ✓ · filter `active=false` hoạt động đúng (không bị bỏ sót do truthy-check sai) ✓ · toàn bộ route admin-gated đúng permission ✓ · `created_by` từ JWT ✓ · soft-delete (không hard) ✓ · migration permission idempotent ✓ · UC1-UC7 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC8
- T0 → verify RECON đủ để code
- T1 → 4 DTO (create/update/query/response)
- T2/T2b → service (create pre-check+safety-net, list filter đúng active=false, getDetail 404, update no-op, softDelete)
- T3/T3b → controller 5 route admin-gated
- T4 → migration seed 4 permission + role mapping
- T5 → wiring module (providers/controllers, KHÔNG đổi imports)
- T-GATE → gate + STOP + Owed (gate-check · alert center · restore · bulk import · refactor helper)
