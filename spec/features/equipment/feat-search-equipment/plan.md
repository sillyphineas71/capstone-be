# PLAN — UC-64: Tìm kiếm kho thiết bị (Search / filter equipment inventory)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-64 (list + filter + search + phân trang, read-only). | Toàn bộ file |

> Dựa trên `spec.md` (UC-64) đã duyệt. **CHỈ kế hoạch** — KHÔNG code, KHÔNG task breakdown.
> Phạm vi: chỉ đọc/list/filter/search (read-only). KHÔNG create/báo lỗi/xóa/phân bổ.
> KHÔNG migration, KHÔNG execute seed. Mirror UC-14 `listUsersForManagement` (KHÔNG department scope).

---

## 0. Ràng buộc & quyết định đã chốt (C1–C8, không mở lại)

### 0.1. Bối cảnh
- Module `equipment` có nền UC-61 (`create`) + UC-62 (`reportFault`) + UC-63 (`deleteEquipment`): `EquipmentService` (có `dataSource` + `equipmentRepo`), `EquipmentController`, `EquipmentResponseDto`, wiring đủ.
- Bảng `equipments` đã tồn tại ⇒ **KHÔNG migration**.
- UC-64 = [Missing] → **THÊM** `listEquipments` (read-only) vào service + handler vào controller. Mirror UC-14.

### 0.2. 8 ràng buộc chốt
| # | Chốt |
| :--- | :--- |
| C1 | Permission `equipment.read` → `[SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, INTERNAL_USER]`. |
| C2 | Output **tái dùng `EquipmentResponseDto`** (KHÔNG item DTO mới). |
| C3 | Sort mặc định `createdAt desc`. |
| C4 | KHÔNG `includeDeleted` — mặc định chỉ `deletedAt IS NULL`. |
| C5 | Filter optional AND: `equipmentType` (enum), `assetStatus` (enum), `healthStatus` (enum), `currentRoomId` (uuid). |
| C6 | `search` ILIKE `%kw%` trên `equipmentCode`/`equipmentName`/`serialNumber` (`Brackets` nhóm OR). |
| C7 | Permission code `equipment.read` (`module_code='equipment'`, `action_code='read'`); seed KHÔNG execute. |
| C8 | `page/limit` (default 1/20, max 100), trả `total` + `totalPages`. |

### 0.3. ⚠️ SORT_MAP allowlist (chống SQL injection field)
- `sortBy` validate **2 lớp**: (1) DTO `@IsIn(keys)`, (2) service `SORT_MAP[sortBy] ?? default`. **KHÔNG** đưa `sortBy` trực tiếp vào `orderBy`.
- `sortOrder`: `('asc'|'desc').toUpperCase()` → `'ASC'|'DESC'`.

### 0.4. Xác nhận KHÔNG cần sửa
`equipment.module.ts` (wiring đủ), `equipment.entity.ts`, `EquipmentResponseDto` (chỉ **tái dùng**). ⇒ KHÔNG sửa.

---

## 1. Kiến trúc & luồng

```
GET /api/v1/equipments?equipmentType=&assetStatus=&healthStatus=&currentRoomId=&search=&sortBy=&sortOrder=&page=&limit=
  → EquipmentController.listEquipments (THÊM)
      JwtAuthGuard(class) → PermissionsGuard('equipment.read') → ValidationPipe(ListEquipmentsQueryDto)
      @Query() query
  → EquipmentService.listEquipments(query) (THÊM, READ-ONLY, KHÔNG transaction)
      1. qb = equipmentRepo.createQueryBuilder('e').where('e.deletedAt IS NULL')
      2. andWhere từng filter có giá trị (bind param)
      3. search → Brackets (equipmentCode/equipmentName/serialNumber ILIKE :s)
      4. SORT_MAP allowlist → orderBy(cột thật, ASC|DESC)
      5. skip((page-1)*limit).take(limit).getManyAndCount() → [rows, total]
      6. map rows → EquipmentResponseDto[]
      → { data, total }
  → 200 { success, message, data, meta{ page, limit, total, totalPages } }
```

### 1.1. Mirror UC-14 (trỏ dòng thật)
| Thành phần UC-64 | Mirror |
| :--- | :--- |
| `EquipmentService.listEquipments` | `listUsersForManagement` — `accounts/services/users.service.ts:1681-1775`. |
| Base `where('deletedAt IS NULL')` + `andWhere` filter | `:1716-1740`. |
| `search` qua `Brackets` + `ILIKE :s` | `:1741-1749`. |
| **SORT_MAP allowlist** + `sortOrder.toUpperCase()` | `:1752-1762`. |
| `skip/take` + count | `:1772-1774` (+ `getManyAndCount`). |
| DTO query (`@IsIn` sort, `@Type(Number)`, `@Max(100)`) | `ManageUsersQueryDto` — `accounts/dto/manage-users-query.dto.ts`. |
| Controller handler + `@RequirePermissions` + `@Query` | mirror handler `reportFault`/`create` (UC-61/62) + `@Query()` (UC-14 controller). |
| Seed permission | `src/database/seeds/20260713000003-SeedEquipmentCreatePermission.ts`. |

**Khác biệt có chủ đích với UC-14**: UC-14 có **department scope** (`:1690-1713`, `resolveDepartmentScope`); UC-64 **KHÔNG** scope (thiết bị tài sản toàn tổ chức) ⇒ bỏ toàn bộ block scope. Đơn giản hơn.

> `listEquipments` **read-only** — KHÔNG `dataSource.transaction`, KHÔNG audit (READ). Dùng `equipmentRepo.createQueryBuilder` (repo đã có ở constructor).

---

## 2. Danh sách file TẠO / SỬA

### 2.1. TẠO mới
| File | Vai trò |
| :--- | :--- |
| `src/modules/equipment/dto/list-equipments-query.dto.ts` | `ListEquipmentsQueryDto` — filter + sort allowlist + page/limit. |
| `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentReadPermission.ts` | Seed `equipment.read` (KHÔNG execute). |
| `src/modules/equipment/tests/equipment-list.service.spec.ts` | Unit test service `listEquipments`. |
| `src/modules/equipment/tests/equipment-list.controller.spec.ts` | Unit test controller (RBAC + response meta). |

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/equipment/services/equipment.service.ts` | THÊM `listEquipments` (+ import `Brackets` vào dòng `from 'typeorm'` — hiện `{ DataSource, Repository, IsNull }`). KHÔNG đụng `create`/`reportFault`/`deleteEquipment`/`checkDuplicate*`. |
| `src/modules/equipment/controllers/equipment.controller.ts` | THÊM handler `listEquipments` (+ import `Get`, `Query` vào `@nestjs/common`). KHÔNG đụng handler cũ. |

> KHÔNG tạo response DTO (tái dùng `EquipmentResponseDto` — C2). KHÔNG sửa module/entity/DTO reuse.

---

## 3. Thiết kế `EquipmentService.listEquipments()`

### 3.1. Chữ ký
```
listEquipments(query: ListEquipmentsQueryDto): Promise<{ data: EquipmentResponseDto[]; total: number }>
```
(Controller tự bọc `meta`. Trả `{ data, total }` — mirror `listUsersForManagement` `:1684`.)

### 3.2. Các bước
```
const page  = query.page  || 1;
const limit = query.limit || 20;
const search = query.search?.trim();

const qb = this.equipmentRepo
  .createQueryBuilder('e')
  .where('e.deletedAt IS NULL');           // C4

if (query.equipmentType) qb.andWhere('e.equipmentType = :equipmentType', { equipmentType: query.equipmentType });
if (query.assetStatus)   qb.andWhere('e.assetStatus = :assetStatus',   { assetStatus: query.assetStatus });
if (query.healthStatus)  qb.andWhere('e.healthStatus = :healthStatus', { healthStatus: query.healthStatus });
if (query.currentRoomId) qb.andWhere('e.currentRoomId = :currentRoomId', { currentRoomId: query.currentRoomId });

if (search) {
  qb.andWhere(new Brackets((w) => {
    w.where('e.equipmentCode ILIKE :s', { s: `%${search}%` })
     .orWhere('e.equipmentName ILIKE :s', { s: `%${search}%` })
     .orWhere('e.serialNumber ILIKE :s', { s: `%${search}%` });
  }));
}

// SORT_MAP allowlist — KHÔNG đưa sortBy trực tiếp vào orderBy
const SORT_MAP: Record<string, string> = {
  equipmentCode: 'e.equipmentCode',
  equipmentName: 'e.equipmentName',
  equipmentType: 'e.equipmentType',
  assetStatus:   'e.assetStatus',
  healthStatus:  'e.healthStatus',
  createdAt:     'e.createdAt',
};
const sortColumn = SORT_MAP[query.sortBy ?? 'createdAt'] ?? 'e.createdAt';   // C3
const sortDirection = (query.sortOrder ?? 'desc').toUpperCase() as 'ASC' | 'DESC';

qb.orderBy(sortColumn, sortDirection)
  .skip((page - 1) * limit)
  .take(limit);

const [rows, total] = await qb.getManyAndCount();
const data = rows.map((e) => new EquipmentResponseDto({ ...12 field... }));
return { data, total };
```

### 3.3. Ghi chú
- **C3 mặc định**: `sortBy` default `'createdAt'`, `sortOrder` default `'desc'` (DTO có thể default `sortBy='createdAt'` + `sortOrder='desc'`; service fallback trùng để chắc).
- **Map row → DTO**: dùng đúng 12 field của `EquipmentResponseDto` (id, equipmentCode, equipmentName, equipmentType, serialNumber, brand, model, purchaseDate, assetStatus, healthStatus, currentRoomId, createdAt).
- KHÔNG `select` cắt cột (khác UC-14 có `select`) để map đủ 12 field DTO; nếu tối ưu sau có thể `select`. (Chấp nhận — đơn giản, đúng shape.)

---

## 4. DTO — `ListEquipmentsQueryDto`
Mirror `ManageUsersQueryDto`.

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

> `@IsIn` keys của `sortBy` phải **khớp SORT_MAP** — validate 2 lớp (0.3). ValidationPipe `whitelist+forbidNonWhitelisted+transform` reject param lạ.

---

## 5. Controller `listEquipments`

- `@Get()`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('equipment.read')`, `@UsePipes(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }))`.
- Tham số: `@Query() query: ListEquipmentsQueryDto`.
- Gọi `const { data, total } = await this.equipmentService.listEquipments(query);`.
- Trả:
  ```
  const page = query.page ?? 1; const limit = query.limit ?? 20;
  return {
    success: true,
    message: 'Danh sach thiet bi',
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
  ```
- `@ApiResponse` 200/400/401/403.

---

## 6. Route order (ghi chú)
- `@Get()` (collection, **không param**) khác method/path với `POST /` (UC-61), `PATCH :id/fault` (UC-62), `DELETE :id` (UC-63) ⇒ **không collision**.
- `GET` collection không có route param nên không nuốt param của handler khác. An toàn.
- Lưu ý UC sau: nếu thêm `GET :equipmentId` (detail), route tĩnh `GET` (nếu có) phải khai trước; hiện chỉ `GET` collection ⇒ chưa cần.

---

## 7. Error handling map

| Tình huống | Nguồn | HTTP |
| :--- | :--- | :--- |
| `equipmentType`/`assetStatus`/`healthStatus` sai enum | ValidationPipe | 400 |
| `currentRoomId` sai UUID | ValidationPipe | 400 |
| `sortBy` ngoài allowlist | ValidationPipe (`@IsIn`) | 400 |
| `limit > 100` | ValidationPipe (`@Max`) | 400 |
| Param lạ | ValidationPipe (`forbidNonWhitelisted`) | 400 |
| Chưa đăng nhập | `JwtAuthGuard` | 401 |
| Thiếu quyền | `PermissionsGuard` | 403 |
| Không có kết quả | — | 200 `data:[]`, `total:0` |

---

## 8. RBAC + Seed

### 8.1. Permission
| Thuộc tính | Giá trị |
| :--- | :--- |
| `permission_code` | `equipment.read` |
| `permission_name` | `Xem / tìm kiếm kho thiết bị` |
| `module_code` | `equipment` |
| `action_code` | `read` |
| roles | `['SYSTEM_ADMIN','BUSINESS_ADMIN','MANAGER','INTERNAL_USER']` (C1) |

### 8.2. Seed
- Mirror `SeedEquipmentCreatePermission` (queryRunner + `ON CONFLICT DO NOTHING`, loop 4 role → `role_permissions`).
- Idempotent; **KHÔNG execute/wire runner** (NC seed-runner team-wide).

---

## 9. Business rules mapping (FR)

| FR | Xử lý |
| :--- | :--- |
| FR-01 endpoint GET list | Controller `listEquipments` (§5). |
| FR-02 permission | `@RequirePermissions('equipment.read')`. |
| FR-03 filter AND | §3.2 `andWhere`. |
| FR-04 search ILIKE 3 cột | §3.2 `Brackets`. |
| FR-05 chỉ deletedAt IS NULL | §3.2 base `where`. |
| FR-06 SORT_MAP allowlist | §3.2 + DTO `@IsIn`. |
| FR-07 page/limit + meta | §5. |
| FR-08 item EquipmentResponseDto | §3.2 map. |
| FR-09 READ không audit | §3 (không audit). |
| FR-10 read-only | Không mutation/transaction. |

---

## 10. Test plan (liệt kê — implement ở bước sau; FILE RIÊNG)

### 10.1. Service (`equipment-list.service.spec.ts`)
- **S1**: không filter → `getManyAndCount` gọi, `where('e.deletedAt IS NULL')`; trả `{data,total}` map DTO.
- **S2**: `equipmentType` → `andWhere('e.equipmentType = :equipmentType', ...)`.
- **S3**: `assetStatus` → `andWhere` đúng.
- **S4**: `healthStatus` → `andWhere` đúng.
- **S5**: `currentRoomId` → `andWhere` đúng.
- **S6**: `search` → `andWhere(Brackets)` áp ILIKE 3 cột (`equipmentCode/equipmentName/serialNumber`).
- **S7**: **SORT_MAP** — `sortBy='equipmentName'` → `orderBy('e.equipmentName','ASC/DESC')`; `sortBy` lạ (nếu lọt) → fallback `'e.createdAt'` (KHÔNG dùng input thô).
- **S8**: sort mặc định `createdAt desc` khi không truyền (C3).
- **S9**: phân trang — `skip((page-1)*limit).take(limit)`; `total` từ count; (controller tính totalPages).
- **S10**: kết hợp nhiều filter → nhiều `andWhere` (AND).

> Mock: `equipmentRepo.createQueryBuilder` trả qb giả (`where/andWhere/orderBy/skip/take` chainable, `getManyAndCount` → `[rows,total]`).

### 10.2. Controller (`equipment-list.controller.spec.ts`)
- **C1**: gọi service đúng `(query)`, trả `{success,message,data,meta}`; `meta.totalPages = Math.ceil(total/limit)`.
- **C2**: handler guard metadata = `[PermissionsGuard]`; class = `[JwtAuthGuard]`.
- **C3**: `@RequirePermissions` = `['equipment.read']`.
- **C4**: (DTO) `sortBy` lạ → `@IsIn` reject (validate errors); `limit=200` → `@Max` reject. (class-validator `validate`, KHÔNG assert HTTP.)

---

## 11. Rủi ro & xác minh

| Rủi ro | Xác minh / xử lý |
| :--- | :--- |
| **SQL injection qua `sortBy`** (chỗ dễ hở nhất) | SORT_MAP 2 lớp (DTO `@IsIn` + service map); test S7 assert map đúng cột + fallback. |
| N+1 / count sai | `getManyAndCount` (1 count + 1 page query); không join nhân dòng. |
| Sửa nhầm service/route cũ | Chỉ THÊM method/handler; diff insertions thuần. |
| `Brackets`/`Get`/`Query` chưa import | THÊM `Brackets` (typeorm), `Get`/`Query` (`@nestjs/common`) — additive. |
| Map thiếu field DTO | Map đủ 12 field `EquipmentResponseDto`. |
| Test đụng UC-61/62/63 | File test riêng (§2.1). |
| Department scope lẫn vào | KHÔNG scope (§1.1) — bỏ hẳn block scope của UC-14. |

---

## 12. Tác động code người khác

- **KHÔNG sửa** `create`/`reportFault`/`deleteEquipment`/`checkDuplicate*`/`POST /`/`PATCH :id/fault`/`DELETE :id`.
- **KHÔNG sửa** `equipment.module.ts`, `equipment.entity.ts`, `EquipmentResponseDto` (chỉ **tái dùng**), `rooms/accounts/iot/auth/administration` (chỉ ĐỌC).
- **SỬA additive**: `equipment.service.ts` (+`listEquipments`, +import `Brackets`), `equipment.controller.ts` (+handler, +import `Get`/`Query`) — chỉ THÊM.
- Còn lại là file mới: 1 DTO, 1 seed, 2 test.
- KHÔNG migration, KHÔNG execute seed, KHÔNG mutation/audit (read-only).

---

## 13. Checklist file cần tạo/sửa

**TẠO**
- [ ] `src/modules/equipment/dto/list-equipments-query.dto.ts`
- [ ] `src/database/seeds/2026XXXXXXXXXX-SeedEquipmentReadPermission.ts` (KHÔNG execute)
- [ ] `src/modules/equipment/tests/equipment-list.service.spec.ts`
- [ ] `src/modules/equipment/tests/equipment-list.controller.spec.ts`

**SỬA (additive)**
- [ ] `src/modules/equipment/services/equipment.service.ts` (+`listEquipments`, +import `Brackets`; không đụng method cũ)
- [ ] `src/modules/equipment/controllers/equipment.controller.ts` (+handler `listEquipments`, +import `Get`/`Query`)

**KHÔNG làm**: migration; execute/wire seed-runner; sửa method/route cũ/`equipment.module.ts`/`equipment.entity.ts`/`EquipmentResponseDto`/module khác; tạo response DTO mới; đụng test UC-61/62/63; department scope; mutation/audit; UC-61/62/63/65.
