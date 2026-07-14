# TASKS — UC-64: Tìm kiếm kho thiết bị (Search / filter equipment inventory)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-64 (T001–T006). | Toàn bộ file |

> Dựa trên `spec.md` + `plan.md` (UC-64) đã duyệt. **CHỈ danh sách task** — KHÔNG code.
> Phạm vi: chỉ đọc/list/filter/search (read-only). KHÔNG create/báo lỗi/xóa/phân bổ.
> KHÔNG migration, KHÔNG execute seed, KHÔNG commit. Mirror UC-14 (KHÔNG department scope).

---

## 0. Ràng buộc thực thi (áp cho mọi task)

### 0.1. Bối cảnh
- Nền UC-61/62/63: `EquipmentService` (có `dataSource` + `equipmentRepo`), `EquipmentController`, `EquipmentResponseDto`, wiring đủ.
- UC-64 = THÊM `listEquipments` (read-only) + handler. Mirror `listUsersForManagement` `accounts/services/users.service.ts:1681-1775` (base+filter `:1716-1740`, Brackets `:1741-1749`, SORT_MAP `:1752-1762`, skip/take `:1772-1774`) — **bỏ** department scope (`:1690-1713`).

### 0.2. 8 ràng buộc chốt (C1–C8)
| # | Chốt |
| :--- | :--- |
| C1 | Permission `equipment.read` → `[SYSTEM_ADMIN,BUSINESS_ADMIN,MANAGER,INTERNAL_USER]`. |
| C2 | Output **tái dùng `EquipmentResponseDto`** (map đủ 12 field), KHÔNG DTO mới. |
| C3 | Sort mặc định `createdAt desc`. |
| C4 | Mặc định chỉ `deletedAt IS NULL`. |
| C5 | Filter optional AND: `equipmentType`/`assetStatus`/`healthStatus` (enum) + `currentRoomId` (uuid). |
| C6 | `search` ILIKE `%kw%` trên `equipmentCode`/`equipmentName`/`serialNumber` (`Brackets` nhóm OR). |
| C7 | Permission code `equipment.read` (`module_code='equipment'`, `action_code='read'`); seed KHÔNG execute. |
| C8 | `page/limit` (1/20, max 100), trả `total` + `totalPages`. |

### 0.3. ⚠️ 2 điểm dễ hở (bám khi code)
1. **SORT_MAP allowlist 2 lớp**: DTO `@IsIn(keys khớp SORT_MAP)` + service `SORT_MAP[sortBy] ?? 'e.createdAt'`. **KHÔNG** đưa `sortBy` thô vào `orderBy`. `sortOrder` → `('asc'|'desc').toUpperCase()`.
2. **`Brackets` bọc search OR**: nhóm 3 `orWhere` trong `Brackets` để KHÔNG phá AND với filter khác. Param `:s` dùng chung — nếu TypeORM báo duplicate param trong Brackets thì tách `:s1/:s2/:s3` (cùng giá trị `%kw%`).

### 0.4. Bảo vệ code người khác
- KHÔNG sửa `create`/`reportFault`/`deleteEquipment`/`checkDuplicate*`/`POST /`/`PATCH :id/fault`/`DELETE :id`.
- KHÔNG sửa `equipment.module.ts`/`equipment.entity.ts`/`EquipmentResponseDto` (chỉ **tái dùng**)/`rooms/accounts/iot/auth/administration` (chỉ ĐỌC).
- Test đặt **file riêng**, KHÔNG đụng test UC-61/62/63.
- **KHÔNG** tạo response DTO. **KHÔNG** department scope. **KHÔNG** transaction/audit (read-only).

---

## T001 — [CREATE] `ListEquipmentsQueryDto`
**File**: `src/modules/equipment/dto/list-equipments-query.dto.ts`
**Mirror**: `ManageUsersQueryDto` (`accounts/dto/manage-users-query.dto.ts`).

| Field | Decorators |
| :--- | :--- |
| `equipmentType?` | `@IsOptional`, `@IsEnum(EquipmentType)` |
| `assetStatus?` | `@IsOptional`, `@IsEnum(AssetStatus)` |
| `healthStatus?` | `@IsOptional`, `@IsEnum(HealthStatus)` |
| `currentRoomId?` | `@IsOptional`, `@IsUUID('4')` |
| `search?` | `@IsOptional`, `@IsString` |
| `sortBy?` | `@IsOptional`, `@IsIn(['equipmentCode','equipmentName','equipmentType','assetStatus','healthStatus','createdAt'])`, default `'createdAt'` |
| `sortOrder?` | `@IsOptional`, `@IsIn(['asc','desc'])`, default `'desc'` |
| `page?` | `@Type(() => Number)`, `@IsOptional`, `@Min(1)`, default 1 |
| `limit?` | `@Type(() => Number)`, `@IsOptional`, `@Min(1)`, `@Max(100)`, default 20 |

**DoD**: `@IsIn` keys `sortBy` **khớp SORT_MAP** (T002); `@Max(100)` limit; `@Type(Number)` page/limit; import enum từ `../entities/equipment.entity.js`; tsc sạch.

---

## T002 — [MODIFY additive] `EquipmentService.listEquipments`
**File**: `src/modules/equipment/services/equipment.service.ts`
**Mirror**: `listUsersForManagement:1716-1774`. **KHÔNG đụng** method cũ.

Thêm import (additive): `Brackets` (`typeorm` — dòng hiện `{ DataSource, Repository, IsNull }`).

`listEquipments(query: ListEquipmentsQueryDto): Promise<{ data: EquipmentResponseDto[]; total: number }>`:
1. `page = query.page || 1`, `limit = query.limit || 20`, `search = query.search?.trim()`.
2. `qb = this.equipmentRepo.createQueryBuilder('e').where('e.deletedAt IS NULL')` (C4).
3. `andWhere` từng filter có giá trị — bind param (C5): `equipmentType`, `assetStatus`, `healthStatus`, `currentRoomId`.
4. `search` → `qb.andWhere(new Brackets((w) => { w.where('e.equipmentCode ILIKE :s',{s:`%${search}%`}).orWhere('e.equipmentName ILIKE :s',...).orWhere('e.serialNumber ILIKE :s',...); }))` (C6, 0.3.2).
5. **SORT_MAP allowlist** (0.3.1): `SORT_MAP = { equipmentCode:'e.equipmentCode', equipmentName:'e.equipmentName', equipmentType:'e.equipmentType', assetStatus:'e.assetStatus', healthStatus:'e.healthStatus', createdAt:'e.createdAt' }`; `sortColumn = SORT_MAP[query.sortBy ?? 'createdAt'] ?? 'e.createdAt'`; `sortDirection = (query.sortOrder ?? 'desc').toUpperCase()` (C3).
6. `qb.orderBy(sortColumn, sortDirection).skip((page-1)*limit).take(limit)`; `const [rows, total] = await qb.getManyAndCount()`.
7. `data = rows.map((e) => new EquipmentResponseDto({ ...12 field... }))` (C2 — id, equipmentCode, equipmentName, equipmentType, serialNumber, brand, model, purchaseDate, assetStatus, healthStatus, currentRoomId, createdAt).
8. `return { data, total }`.

**DoD**: read-only (KHÔNG `dataSource.transaction`/audit); base `deletedAt IS NULL`; SORT_MAP 2 lớp (không sortBy thô); Brackets bọc search; `getManyAndCount` (không N+1); KHÔNG department scope; map đủ 12 field; method cũ không đổi; tsc sạch.

---

## T003 — [MODIFY additive] `EquipmentController.listEquipments`
**File**: `src/modules/equipment/controllers/equipment.controller.ts`
**Mirror**: handler `create`/`reportFault` (UC-61/62) + `@Query` (UC-14). **KHÔNG đụng** handler cũ.

Thêm import (additive): `Get`, `Query` (`@nestjs/common`).

Handler `listEquipments`:
- `@Get()`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.read')`, `@UsePipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }))`.
- Tham số: `@Query() query: ListEquipmentsQueryDto`.
- `const { data, total } = await this.equipmentService.listEquipments(query);`.
- `const page = query.page ?? 1; const limit = query.limit ?? 20;`.
- Trả `{ success:true, message:'Danh sach thiet bi', data, meta:{ page, limit, total, totalPages: Math.ceil(total/limit) } }` (C8).
- `@ApiResponse` 200/400/401/403.

**DoD**: `GET /equipments` + guard + `@RequirePermissions('equipment.read')` + ValidationPipe; `meta.totalPages = Math.ceil(total/limit)`; handler cũ không đổi; tsc sạch.

---

## T004 — [CREATE] Seed permission `equipment.read` (KHÔNG execute)
**File**: `src/database/seeds/20260713000006-SeedEquipmentReadPermission.ts`
**Mirror**: `20260713000003-SeedEquipmentCreatePermission.ts`.

- Hàm `seedEquipmentReadPermission(dataSource)`: queryRunner + `startTransaction`.
- `INSERT INTO permissions (...) VALUES ('equipment.read','Xem / tìm kiếm kho thiết bị','equipment','read','Cho phép xem và tìm kiếm danh sách thiết bị (read-only).',true) ON CONFLICT (permission_code) DO NOTHING RETURNING id`.
- Loop `roleCodes = ['SYSTEM_ADMIN','BUSINESS_ADMIN','MANAGER','INTERNAL_USER']` → `SELECT id FROM roles WHERE role_code=$1 AND is_active=true` → `INSERT role_permissions ... ON CONFLICT DO NOTHING`.
- Ghi chú NC seed-runner (team-wide). **KHÔNG execute**.

**DoD**: idempotent; 4 role đúng C1; KHÔNG chạy.

---

## T005 — [CREATE] Unit test service (file riêng)
**File**: `src/modules/equipment/tests/equipment-list.service.spec.ts`

Instantiate `new EquipmentService(mockRepo, mockDataSource)`; mock `equipmentRepo.createQueryBuilder` → qb giả (`where/andWhere/orderBy/skip/take` chainable trả `this`; `getManyAndCount` → `[rows, total]`). Cases:
- **S1**: không filter → `where('e.deletedAt IS NULL')` gọi; `getManyAndCount` gọi; trả `{data,total}` map đủ 12 field DTO.
- **S2**: `equipmentType` → `andWhere('e.equipmentType = :equipmentType', {...})`.
- **S3**: `assetStatus` → `andWhere` đúng.
- **S4**: `healthStatus` → `andWhere` đúng.
- **S5**: `currentRoomId` → `andWhere` đúng.
- **S6**: `search` → `andWhere(Brackets)`; kiểm callback áp ILIKE 3 cột (`equipmentCode/equipmentName/serialNumber`).
- **S7**: SORT_MAP — `sortBy='equipmentName'` → `orderBy('e.equipmentName', ...)`; `sortBy` lạ (nếu lọt qua) → fallback `orderBy('e.createdAt', ...)` (KHÔNG dùng input thô).
- **S8**: sort mặc định — không truyền `sortBy/sortOrder` → `orderBy('e.createdAt', 'DESC')` (C3).
- **S9**: phân trang — `skip((page-1)*limit)`, `take(limit)`; `total` từ `getManyAndCount`.
- **S10**: kết hợp nhiều filter → nhiều `andWhere` (AND).

**DoD**: 10 cases pass; mock createQueryBuilder chainable; static import; KHÔNG đụng test UC-61/62/63.

---

## T006 — [CREATE] Unit test controller/DTO (file riêng)
**File**: `src/modules/equipment/tests/equipment-list.controller.spec.ts`

`Test.createTestingModule` + mock `EquipmentService` + `.overrideGuard(JwtAuthGuard/PermissionsGuard)`. Cases:
- **C1**: gọi service đúng `(query)`, trả `{success,message,data,meta}`; `meta.totalPages = Math.ceil(total/limit)` (vd total=12, limit=5 → 3).
- **C2**: handler guard metadata = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.read']`.
- **C4**: (DTO) `plainToInstance(ListEquipmentsQueryDto,{sortBy:'id; DROP'})` → `validate()` có lỗi `sortBy`; `{limit:200}` → có lỗi `limit`. (class-validator `validate`, **KHÔNG** assert HTTP 400.)

**DoD**: cases pass; overrideGuard tránh DI thật; C4 chứng minh `@IsIn`/`@Max` chặn sort/limit; static import.

---

## T007 — Cổng chất lượng (KHÔNG commit)
Chạy và ghi kết quả, **phân biệt baseline vs mới** bằng `git stash`:
1. `npx tsc --noEmit` — net +0 với file production.
2. `npx eslint` trên file đã tạo/sửa (DTO, service, controller, seed, 2 test).
3. `npx jest src/modules/equipment` — suite mới pass (S1–S10, C1–C4) + suite UC-61/62/63 **vẫn pass** (0 regression).
4. `npx jest src/modules/auth/guards` — 0 regression.
5. `git stash` lấy baseline `src/modules/equipment` + `src/modules/auth/guards`, so trước/sau.

**DoD**: tsc net +0; eslint file đã đụng sạch (seed = baseline pattern `no-unsafe`); jest equipment pass (UC-61/62/63 + UC-64); auth/guards 0 regression; bằng chứng git-stash. **KHÔNG commit.**

---

## Ma trận phủ ràng buộc

| Ràng buộc | Task |
| :--- | :--- |
| C1 permission 4 role | T004, T006 (C3) |
| C2 tái dùng EquipmentResponseDto | T002, T005 (S1) |
| C3 sort mặc định createdAt desc | T002, T005 (S8) |
| C4 chỉ deletedAt IS NULL | T002, T005 (S1) |
| C5 filter AND | T001, T002, T005 (S2–S5, S10) |
| C6 search Brackets 3 cột | T002, T005 (S6) |
| C7 permission code + seed | T004 |
| C8 page/limit + totalPages | T001, T003, T006 (C1) |
| SORT_MAP 2 lớp (anti-inject) | T001 (@IsIn), T002 (SORT_MAP), T005 (S7), T006 (C4) |

---

## KHÔNG được làm
- KHÔNG migration; KHÔNG execute/wire seed-runner; KHÔNG commit.
- KHÔNG sửa `create`/`reportFault`/`deleteEquipment`/`checkDuplicate*`/`POST /`/`PATCH :id/fault`/`DELETE :id`.
- KHÔNG sửa `equipment.module.ts`/`equipment.entity.ts`/`EquipmentResponseDto`/module khác.
- KHÔNG tạo response DTO mới; KHÔNG department scope; KHÔNG transaction/audit (read-only).
- KHÔNG đụng test UC-61/62/63; KHÔNG UC-61/62/63/65.

---

## Thứ tự thực thi
`T001 → T002 → T003 → T004 → T005 → T006 → T007`

> Chưa code — chờ duyệt tasks.
