# VCL-001 — plan.md (UC8 ANPR/SAVP: CRUD vehicle_control_list)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo plan VCL-001 cùng lượt với spec (OQ đã chốt trước). Service+Controller mới hoàn toàn, không đụng UC1-UC7. 1 migration permission mới. No schema migration (bảng/entity/index đã có). | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở mục 1 spec.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)
- `VehicleControlListEntity` đã `TypeOrmModule.forFeature([...])` trong [anpr.module.ts:32-35](../../../../src/modules/anpr/anpr.module.ts) — **repo đã sẵn sàng inject**, KHÔNG cần đổi phần `imports`.
- `AuthModule` đã import ở `anpr.module.ts:36` → `JwtAuthGuard`/`PermissionsGuard` dùng được ngay, KHÔNG cần thêm import module.
- Permission format thật trong DB: `permission_code` dot-notation (`module.action`), bảng `permissions` có cột `module_code`, `action_code` (tách từ code bằng `.split('.').pop()` trong migration mẫu). `vehicle_control.create` → `module_code='anpr'`, `action_code='create'` (parse theo đúng convention migration mẫu `20260720000005`).
- 4 role lõi xác nhận tồn tại: `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` (migration `20260720000002-SeedCoreRoles.ts`). Migration mới KHÔNG cần tạo role.
- Migration mới nhất trong repo: `20260721000007` → chọn timestamp **`20260722000001`** cho migration permission (không đụng namespace SAVP `20260721*` của Hải).
- `isUniqueViolation` (đọc `driverError.code === '23505'`) là helper **private** trong `VehicleRegistrationService`, KHÔNG export — UC8 viết bản copy riêng trong `VehicleControlListService` (đã ghi rõ residual ở spec §8, chủ đích KHÔNG refactor chung để tránh động code UC1 đang chạy).

## 1. Quyết định đã chốt (từ trao đổi trước khi viết spec)
Xem spec §1 (role mapping, `list_type` bất biến, trùng-inactive vẫn 409, "tra biển" = filter GET). Constitution đầy đủ ở spec §7. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi
`VehicleControlListEntity` giữ nguyên 100% (đã có đủ field: `plateNumber`, `plateRaw`, `listType`, `reason`, `active`, `createdBy`, `createdAt`, `updatedAt`, `deletedAt`). KHÔNG thêm cột, KHÔNG migration schema.

## 3. DTO (4 file mới)
- `dto/create-vehicle-control-list.dto.ts`: `plate_raw` (`@Expose('plate_raw') @IsString @IsNotEmpty @MaxLength(20)`), `list_type` (`@Expose('list_type') @IsIn(['blocklist','watchlist'])`), `reason?` (`@IsOptional @IsString @MaxLength(255)`). Export `const CONTROL_LIST_TYPES = ['blocklist','watchlist'] as const` + `type ControlListType` dùng chung cho create/query DTO.
- `dto/update-vehicle-control-list.dto.ts`: `reason?` (`@IsOptional @IsString @MaxLength(255)`), `active?` (`@IsOptional @IsBoolean`). KHÔNG field khác (whitelist loại phần thừa).
- `dto/list-vehicle-control-list-query.dto.ts`: `page`/`limit` (mirror UC3 y hệt: `@Type(()=>Number) @IsOptional @IsInt @Min(1)` / thêm `@Max(100)` cho limit), `plate?` (`@IsOptional @IsString @MaxLength(20)`), `list_type?` (`@Expose('list_type') @IsOptional @IsIn(CONTROL_LIST_TYPES)`), `active?` (`@Expose('active') @IsOptional @Transform(({value}) => value === undefined ? undefined : value === 'true') @IsBoolean`).
- `dto/vehicle-control-list-response.dto.ts`: class `VehicleControlListResponseDto` + hàm `toVehicleControlListResponse(entity)` — field `id/plate_number/plate_raw/list_type/reason/active/created_by/created_at/updated_at`, mirror y hệt `toVehicleRegistrationResponse`.

## 4. Service — `VehicleControlListService` (file mới)
```
src/modules/anpr/services/vehicle-control-list.service.ts
```
- Constructor: `@InjectRepository(VehicleControlListEntity) private readonly repo: Repository<VehicleControlListEntity>`.
- `create(currentUserId: string, dto: CreateVehicleControlListDto)`:
  1. `plateNumber = normalizePlate(dto.plateRaw)`.
  2. Pre-check: `repo.findOne({where: {plateNumber, listType: dto.listType, deletedAt: IsNull()}})` → tồn tại → throw `conflictErr()` (helper local, mirror `plateConflict()` UC1 nhưng code `PLATE_ALREADY_IN_CONTROL_LIST`).
  3. `repo.create({plateNumber, plateRaw: dto.plateRaw, listType: dto.listType, reason: dto.reason ?? null, active: true, createdBy: currentUserId})`.
  4. `try { return await repo.save(entity) } catch(e) { if (isUniqueViolation(e)) throw conflictErr(); throw e; }`.
- `list(query: ListVehicleControlListQueryDto)`: build `where: FindOptionsWhere<VehicleControlListEntity>` — luôn `deletedAt: IsNull()`; `if (query.plate) where.plateNumber = normalizePlate(query.plate)`; `if (query.list_type) where.listType = query.list_type`; `if (query.active !== undefined) where.active = query.active` (**PHẢI check `!== undefined`, KHÔNG if-truthy**, vì `active=false` là giá trị filter hợp lệ). `findAndCount`, `order: {createdAt:'DESC'}`, `skip/take` chuẩn.
- `getDetail(id: string)`: `repo.findOne({where:{id, deletedAt: IsNull()}})` → null → `NotFoundException({code:'CONTROL_LIST_ENTRY_NOT_FOUND', message:'Không tìm thấy bản ghi kiểm soát phương tiện'})`.
- `update(id: string, dto: UpdateVehicleControlListDto)`: `getDetail(id)` → `changed=false`; `if (dto.reason !== undefined) {entity.reason = dto.reason; changed=true}`; `if (dto.active !== undefined) {entity.active = dto.active; changed=true}`; `!changed` → return entity nguyên trạng (no-op); else `repo.save`.
- `softDelete(id: string)`: `getDetail(id)` → `repo.softDelete(id)`.
- Private `isUniqueViolation(e)` — copy y hệt UC1 (đọc `driverError.code`/`code === '23505'`).

## 5. Controller — `VehicleControlListController` (file mới)
```
src/modules/anpr/controllers/vehicle-control-list.controller.ts
```
- `@Controller('anpr/admin/control-list')`.
- Constructor inject `VehicleControlListService`.
- `@Post()` `@HttpCode(201)` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('vehicle_control.create')` `@UsePipes(ValidationPipe{whitelist:true,transform:true})` → `create(@CurrentUser() user, @Body() dto)` → `{success:true, message:'Control list entry created successfully', data: toVehicleControlListResponse(entity)}`.
- `@Get()` cùng guard, permission `vehicle_control.read` → `list(@Query() query)` → `{success:true, message:'Control list retrieved successfully', data: items.map(toVehicleControlListResponse), meta}`.
- `@Get(':id')` cùng guard, permission `vehicle_control.read`, `@Param('id', ParseUUIDPipe)` → `getDetail(id)` → envelope + entity.
- `@Patch(':id')` cùng guard, permission `vehicle_control.update`, `ParseUUIDPipe` → `update(id, dto)` → envelope + entity.
- `@Delete(':id')` cùng guard, permission `vehicle_control.delete`, `ParseUUIDPipe` → `softDelete(id)` → `{success:true, message:'Control list entry deleted successfully', data:null}`.
- Route GET list đặt **trước** `GET :id` để tránh Nest match nhầm (dù ở đây không xung đột vì path khác nhau rõ, vẫn giữ thứ tự khai báo chuẩn mirror UC7).

## 6. Migration permission (mới, cùng commit)
```
src/database/migrations/20260722000001-SeedVehicleControlListPermissions.ts
```
- Idempotent insert 4 `permissions` (`vehicle_control.create/read/update/delete`, `module_code='anpr'`, `action_code` = suffix sau dấu chấm) qua `WHERE NOT EXISTS`.
- Insert `role_permissions`: `create/update/delete` → `['BUSINESS_ADMIN','SYSTEM_ADMIN']`; `read` → `['MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN']`. Qua `WHERE NOT EXISTS` (idempotent), mirror `20260720000005-BackfillRolePermissions.ts`.
- `down()`: xóa `role_permissions` theo permission_id rồi xóa 4 `permissions` — an toàn vì đây là permission MỚI HOÀN TOÀN do chính migration này tạo (không như migration backfill phải cẩn thận không xóa permission thuộc sở hữu migration khác).

## 7. File list
### Net-new (9 file)
- `src/modules/anpr/dto/create-vehicle-control-list.dto.ts`
- `src/modules/anpr/dto/update-vehicle-control-list.dto.ts`
- `src/modules/anpr/dto/list-vehicle-control-list-query.dto.ts`
- `src/modules/anpr/dto/vehicle-control-list-response.dto.ts`
- `src/modules/anpr/services/vehicle-control-list.service.ts` (+ `.spec.ts`)
- `src/modules/anpr/controllers/vehicle-control-list.controller.ts` (+ `.spec.ts`)
- `src/database/migrations/20260722000001-SeedVehicleControlListPermissions.ts`
### Modified (1 file)
- `src/modules/anpr/anpr.module.ts`: thêm `VehicleControlListService` vào `providers`, thêm `VehicleControlListController` vào `controllers`. **KHÔNG đổi `imports`** (entity đã `forFeature` sẵn).
> Tổng **9 net-new + 1 modified**. 0 thay đổi entity/schema. 1 migration (permission-only, không đổi DDL bảng nghiệp vụ).

## 8. Test (mock repo — KHÔNG DB)
- `create`: normalize plate trước khi so sánh trùng; trùng `(plate, listType)` còn sống (kể cả bản ghi cũ `active=false`) → 409 `PLATE_ALREADY_IN_CONTROL_LIST`, KHÔNG gọi `save`; race-condition an toàn-net (`repo.save` throw `23505`) → cũng 409, KHÔNG để lỗi thô lọt ra; `createdBy` lấy từ tham số truyền vào (đại diện JWT), KHÔNG có field nào trong DTO ghi đè.
- `list`: filter `active=false` PHẢI được áp dụng (assert where có `active:false`, không bị bỏ qua do falsy check sai); filter `plate` phải qua `normalizePlate()` trước khi đưa vào where; không filter nào → trả tất cả (còn sống); phân trang đúng `skip/take`.
- `getDetail`: không tồn tại/đã xóa mềm → 404 `CONTROL_LIST_ENTRY_NOT_FOUND`.
- `update`: chỉ đổi `reason`/`active` theo field gửi; cả 2 absent → no-op, KHÔNG `save`; đảm bảo KHÔNG có method nào cho phép đổi `listType`/`plateNumber` (kiểm tra DTO không có field, KHÔNG cần test riêng vì whitelist chặn ở tầng pipe — test ở controller level).
- `softDelete`: gọi `repo.softDelete(id)` sau khi xác nhận tồn tại.
- Controller: guard list đúng (`JwtAuthGuard`, `PermissionsGuard`) + đúng permission string cho từng route; `createdBy` lấy từ `@CurrentUser()` (không phải body); DELETE trả `data:null`; whitelist loại `list_type`/`plate_number` nếu client lén gửi trong PATCH body.
- Migration: chạy `up()` rồi query lại `permissions`/`role_permissions` xác nhận đúng 4 permission + đúng role gán (nếu có test migration riêng theo convention repo; nếu repo không có tiền lệ test migration, bỏ qua và chỉ review thủ công theo mẫu `20260720000005`).
- Coverage **≥80%** file mới.

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint file mới 0 warning mới; `npx jest src/modules/anpr` xanh (UC1-UC7 KHÔNG hồi quy + UC8 mới xanh); coverage ≥80% file mới; DI-proof compile `AppModule` (0 circular/UnknownDependencies sau khi thêm service/controller mới vào `anpr.module.ts`). **KHÔNG live, KHÔNG DB thật.**
- **Owed (ghi, KHÔNG chạy)**: gate-check hot-path endpoint · alert center đối chiếu `gate_access_logs` · restore/un-delete · bulk import Excel · factor `isUniqueViolation` dùng chung (nếu team muốn).

## 10. Kỷ luật
- **No schema migration** — chỉ 1 migration permission-only.
- **SEC-01**: toàn bộ route admin-gated, KHÔNG route self-service.
- **DATA-01/02/03**: normalize bắt buộc; `list_type` bất biến; trùng-inactive vẫn 409 — đã chốt, KHÔNG đổi khi code.
- **ARCH-01**: file service/controller **MỚI HOÀN TOÀN**, KHÔNG đụng `VehicleRegistrationService`/`VehicleRegistrationController`/`anpr.module.ts.imports`.
- KHÔNG tự làm gate-check/alert center (CLAUDE.md §5.5 quy tắc 7 — bảng an ninh chưa có schema, cần thiết kế + review riêng nếu làm).

> **STOP.** Plan-only (viết cùng lượt với spec do OQ đã chốt trước). Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
