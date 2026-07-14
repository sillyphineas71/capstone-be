# SPEC — UC-64: Tìm kiếm kho thiết bị (Search / filter equipment inventory)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec.md cho UC-64 (list + filter + search + phân trang thiết bị). Trạng thái [Missing]. | Toàn bộ file |

> Phạm vi: **CHỈ UC-64** — đọc/list/filter/search kho thiết bị có phân trang.
> KHÔNG bao gồm create (UC-61), báo lỗi (UC-62), xóa (UC-63), phân bổ phòng (UC-65).
> Tài liệu này chỉ là đặc tả (spec). KHÔNG kèm code, plan, tasks.

---

## 0. Khảo sát hiện trạng (bắt buộc đọc trước)

### 0.1. Nền module `equipment` (sau UC-61/62/63)
| Thành phần | Hiện trạng |
| :--- | :--- |
| `entities/equipment.entity.ts` | ✅ Field: `equipmentCode`, `equipmentName`, `equipmentType` (enum), `serialNumber`, `brand`, `model`, `assetStatus` (enum), `healthStatus` (enum), `currentRoomId`, `purchaseDate`, `createdAt`, `@DeleteDateColumn deletedAt`. |
| `services/equipment.service.ts` | ✅ `create` (UC-61), `reportFault` (UC-62), `deleteEquipment` (UC-63). **Chưa có** list/search. |
| `controllers/equipment.controller.ts` | ✅ `POST /equipments`, `PATCH :id/fault`, `DELETE :id`. **Chưa có** `GET /equipments`. |
| `dto/equipment-response.dto.ts` | ✅ `EquipmentResponseDto` (id, equipmentCode, equipmentName, equipmentType, serialNumber, brand, model, purchaseDate, assetStatus, healthStatus, currentRoomId, createdAt). |
| `equipment.module.ts` | ✅ Wiring đủ. |
| Permission | `equipment.create`, `equipment.report_fault`, `equipment.delete`. |

→ **UC-64 = [Missing]**. Sẽ **THÊM method + endpoint GET** vào `EquipmentService`/`EquipmentController` sẵn có. Read-only. **KHÔNG tạo service/controller mới**, **KHÔNG migration**.

### 0.2. Mirror pattern: UC-14 `listUsersForManagement`
`accounts/services/users.service.ts:1681-1775` — chuẩn list quản trị:
- Query builder base `where('deletedAt IS NULL')` + filter `andWhere` (bind param).
- `search` qua `Brackets` + `ILIKE :s` (`%kw%`) trên nhiều cột.
- **Sort qua `SORT_MAP` allowlist** (`:1752-1762`) — KHÔNG đưa `sortBy` input trực tiếp vào `orderBy` (chống inject field).
- `skip((page-1)*limit).take(limit)` + `getManyAndCount` → `{ data, total }`.
- DTO query: `ManageUsersQueryDto` (`accounts/dto/manage-users-query.dto.ts`) — filter optional, `sortBy` `@IsIn` allowlist, `page/limit` `@Type(Number)` + `@Min/@Max(100)`.

**Khác biệt có chủ đích với UC-14**: UC-14 có **department scope** (Manager chỉ thấy phòng ban mình). Thiết bị là **tài sản toàn tổ chức**, KHÔNG scope theo phòng ban ⇒ UC-64 **không** áp department scope (đơn giản hơn UC-14). Nêu rõ §5.

---

## 1. Tổng quan Use Case

| Thuộc tính | Giá trị |
| :--- | :--- |
| **Use Case ID** | UC-64 |
| **Use Case Name** | Tìm kiếm kho thiết bị (Search / filter equipment inventory) |
| **Module** | Equipment Management (`src/modules/equipment`) |
| **Primary Actor** | Business Admin (xác nhận RBAC — §8) |
| **Trigger** | Admin lọc thiết bị theo loại / trạng thái / phòng / từ khóa. |
| **Expected Output** | Danh sách thiết bị có **phân trang** (kèm `meta{page,limit,total,totalPages}`). |
| **Pre-condition** | Actor có quyền xem kho thiết bị (`equipment.read`). |
| **Related** | UC-62 (cùng nhóm Equipment Management); UC-61/63/65 — KHÔNG thuộc UC-64. |

---

## 2. Actor & Pre-condition

### 2.1. Actor (§8 chốt RBAC)
- **Business Admin** — actor chính.
- **System Admin** — superset quản trị (đề xuất có).
- **Manager / Internal User** — có xem kho không? Phân tích §8.

### 2.2. Pre-condition
- PRE-01: Actor đã xác thực (JWT) — `JwtAuthGuard`.
- PRE-02: Actor có permission `equipment.read` — `PermissionsGuard`.

---

## 3. Endpoint

```
GET /api/v1/equipments
```

| Thuộc tính | Giá trị |
| :--- | :--- |
| Method | `GET` |
| Path | `/api/v1/equipments` |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `equipment.read` |
| Success status | `200` |
| Handler | `EquipmentController.listEquipments` (THÊM) |
| Service | `EquipmentService.listEquipments` (THÊM) |

Response (envelope CLAUDE.md §8.1 list + pagination):
```json
{
  "success": true,
  "message": "Danh sach thiet bi",
  "data": [ /* EquipmentResponseDto[] */ ],
  "meta": { "page": 1, "limit": 20, "total": 125, "totalPages": 7 }
}
```

> Route order: `GET /equipments` (collection) tách với các route đã có (`POST /`, `PATCH :id/fault`, `DELETE :id`) — khác method / path ⇒ không collision. `GET` collection không có param nuốt.

---

## 4. Input — `ListEquipmentsQueryDto` (query params, optional, kết hợp AND)

Bám entity thật + mirror `ManageUsersQueryDto`.

| Query param | Kiểu | Validate | Ý nghĩa |
| :--- | :--- | :--- | :--- |
| `equipmentType` | enum `EquipmentType` | `@IsOptional`, `@IsEnum` | Lọc theo loại (`camera/microphone/display/speaker/capture_agent/sensor/other`). |
| `assetStatus` | enum `AssetStatus` | `@IsOptional`, `@IsEnum` | Lọc theo trạng thái tài sản (`available/assigned/retired/lost/maintenance`). |
| `healthStatus` | enum `HealthStatus` | `@IsOptional`, `@IsEnum` | Lọc theo sức khỏe (`healthy/warning/faulty/offline/unknown`). |
| `currentRoomId` | uuid | `@IsOptional`, `@IsUUID('4')` | Lọc theo phòng đang lắp. |
| `search` | string | `@IsOptional`, `@IsString` | ILIKE `%kw%` trên `equipmentCode` / `equipmentName` / `serialNumber` (partial, case-insensitive). |
| `sortBy` | string | `@IsOptional`, `@IsIn(allowlist)` default | Cột sắp xếp (allowlist — §6). |
| `sortOrder` | `asc`\|`desc` | `@IsOptional`, `@IsIn(['asc','desc'])` default `asc` | Chiều sắp xếp. |
| `page` | number | `@Type(Number)`, `@IsOptional`, `@Min(1)` default 1 | Trang. |
| `limit` | number | `@Type(Number)`, `@IsOptional`, `@Min(1)`, `@Max(100)` default 20 | Số mục/trang. |

- ValidationPipe (`whitelist+forbidNonWhitelisted+transform`) reject param lạ.
- Tất cả filter optional; kết hợp **AND** (mirror UC-14).

---

## 5. Main Flow

1. Actor gửi `GET /api/v1/equipments?...`.
2. `JwtAuthGuard` xác thực; `PermissionsGuard` kiểm `equipment.read` (thiếu → 403).
3. `ValidationPipe` validate query (enum, uuid, sort allowlist, page/limit).
4. `EquipmentService.listEquipments(query)`:
   1. Query builder base: `qb.where('e.deletedAt IS NULL')` (loại soft-deleted — §7).
   2. `andWhere` cho từng filter có giá trị (`equipmentType`, `assetStatus`, `healthStatus`, `currentRoomId`) — bind param.
   3. `search` → `Brackets` + `ILIKE :s` trên `equipmentCode`/`equipmentName`/`serialNumber`.
   4. **Sort qua `SORT_MAP` allowlist** (§6) — KHÔNG nối chuỗi `sortBy`.
   5. `skip((page-1)*limit).take(limit)` + `getManyAndCount()` → `[rows, total]`.
   6. Map `rows` → `EquipmentResponseDto[]` (§9).
5. Controller trả `200` + `{ success, message, data, meta{page,limit,total,totalPages} }` (`totalPages = Math.ceil(total/limit)`).

> KHÔNG department scope (§0.2) — thiết bị là tài sản toàn tổ chức.

---

## 6. Sort — SORT_MAP allowlist (⚠️ chống SQL injection field)

⚠️ **BẮT BUỘC**: `sortBy` từ client **KHÔNG** được đưa trực tiếp vào `orderBy` của query builder (nếu nối chuỗi ⇒ hở SQL injection qua tên cột). Phải map qua **allowlist `SORT_MAP`** (mirror UC-14 `:1752-1762`):

```
SORT_MAP = {
  equipmentCode: 'e.equipmentCode',
  equipmentName: 'e.equipmentName',
  equipmentType: 'e.equipmentType',
  assetStatus:   'e.assetStatus',
  healthStatus:  'e.healthStatus',
  createdAt:     'e.createdAt',
}
```

- `sortBy` validate 2 lớp: (1) DTO `@IsIn(keys)`, (2) service `SORT_MAP[sortBy] ?? default`.
- `sortOrder`: `('asc'|'desc').toUpperCase()` → `'ASC'|'DESC'` (không nhận input khác).
- **Mặc định (cần chốt §11)**: đề xuất `sortBy='createdAt'`, `sortOrder='desc'` (thiết bị mới nhập lên đầu — duyệt kho). Thay thế: `equipmentCode asc` (ổn định theo mã).

---

## 7. Phạm vi dữ liệu (soft-delete / retired)

- **Mặc định chỉ thiết bị chưa soft-delete**: `e.deletedAt IS NULL` (khai explicit trong query builder; `@DeleteDateColumn` cũng tự lọc với `find`, nhưng query builder cần explicit — mirror UC-14 `:1719`).
- **`retired` vẫn hiển thị** nếu bản ghi **chưa** soft-delete: `retired` là giá trị `assetStatus`, không phải soft-delete. Admin có thể lọc `assetStatus=retired` để xem.
  - Lưu ý: UC-63 khi xóa vừa set `retired` **vừa** `softDelete` ⇒ thiết bị đã xóa qua UC-63 sẽ **ẩn** (do `deletedAt`). Chỉ thiết bị `retired` mà chưa soft-delete (nếu có, qua luồng khác) mới hiện.
- **Không** hỗ trợ `includeDeleted` trong UC-64 (xem thiết bị đã xóa là nghiệp vụ audit/restore riêng — ngoài scope). ⇒ Điểm cần chốt §11 (đề xuất KHÔNG).

---

## 8. Permission / RBAC

### 8.1. Phân tích role xem kho
- **Business Admin / System Admin**: chắc chắn có (quản trị tài sản).
- **Manager**: hợp lý — cần xem thiết bị để lập kế hoạch phòng/họp.
- **Internal User**: đã được cấp `equipment.report_fault` (UC-62); để **báo hỏng** thường cần **tra cứu** thiết bị trước ⇒ nên cho xem kho để nhất quán.

### 8.2. Đề xuất
| Phương án | Role-set |
| :--- | :--- |
| **P1 (khuyến nghị)** | `equipment.read` → `[SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, INTERNAL_USER]` — nhất quán với `equipment.report_fault` (ai báo hỏng được thì tra cứu được). |
| P2 (hẹp) | `[SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER]` — không cho Internal User. |

- Đề xuất **P1**. Permission mới (mirror `equipment.create`): `permission_code='equipment.read'`, `module_code='equipment'`, `action_code='read'`.
- ⇒ Điểm cần chốt C-actor (§11).

---

## 9. Output item DTO (cần chốt §11)

| Phương án | Mô tả |
| :--- | :--- |
| **A (khuyến nghị)** | **Tái dùng `EquipmentResponseDto`** (UC-61) — 12 field. Nhất quán với create/reportFault, ít code, đủ thông tin duyệt kho. |
| B | DTO list gọn riêng `EquipmentListItemDto` (id, equipmentCode, equipmentName, equipmentType, assetStatus, healthStatus, currentRoomId) — payload nhỏ hơn nhưng thêm DTO, lệch shape với các UC khác. |

- Đề xuất **A (tái dùng `EquipmentResponseDto`)**. Nếu cần tối ưu payload lớn, chuyển B sau. ⇒ Điểm cần chốt §11.

---

## 10. Audit
- UC-64 là **READ** → **KHÔNG ghi audit_logs** (nhất quán CLAUDE.md §17 — audit cho hành động quan trọng/mutation, không cho read thường).

---

## 11. Điểm cần chốt

| # | Vấn đề | Đề xuất |
| :--- | :--- | :--- |
| C1 | Role xem kho | **`[SYSTEM_ADMIN,BUSINESS_ADMIN,MANAGER,INTERNAL_USER]`** (P1, khớp report_fault) |
| C2 | Output DTO | **Tái dùng `EquipmentResponseDto`** |
| C3 | Sort mặc định | `createdAt desc` (mới nhất trước) |
| C4 | Có `includeDeleted` không | **KHÔNG** (chỉ chưa soft-delete; retired chưa xóa vẫn hiện) |
| C5 | Filter set | `equipmentType, assetStatus, healthStatus, currentRoomId, search` |
| C6 | `search` cột | `equipmentCode`, `equipmentName`, `serialNumber` (ILIKE) |
| C7 | Permission code | `equipment.read` (vs `equipment.list` — đề xuất `read`) |
| C8 | page/limit default/max | 1 / 20 / max 100 (mirror UC-14) |

---

## 12. Functional Requirements

- **FR-01**: Cung cấp `GET /api/v1/equipments` list + filter + search + phân trang.
- **FR-02**: Chỉ user có permission `equipment.read` được gọi (thiếu → 403).
- **FR-03**: Filter optional AND: `equipmentType`, `assetStatus`, `healthStatus`, `currentRoomId`.
- **FR-04**: `search` ILIKE partial case-insensitive trên `equipmentCode`/`equipmentName`/`serialNumber`.
- **FR-05**: Mặc định chỉ trả thiết bị `deletedAt IS NULL`.
- **FR-06**: `sortBy` qua **SORT_MAP allowlist** (chống inject); `sortOrder` asc/desc.
- **FR-07**: Phân trang `page/limit` (default 1/20, max 100); trả `meta{page,limit,total,totalPages}`.
- **FR-08**: Item = `EquipmentResponseDto` (C2).
- **FR-09**: READ — KHÔNG audit.
- **FR-10**: KHÔNG mutation (read-only); KHÔNG create/báo lỗi/xóa/phân bổ.

## 13. Non-Functional Requirements

- **NFR-01**: TypeORM query builder, bind param — KHÔNG nối chuỗi input vào SQL.
- **NFR-02**: **SORT_MAP allowlist** cho `sortBy` (chống SQL injection qua tên cột) — bắt buộc.
- **NFR-03**: DTO validate ở boundary (whitelist/forbidNonWhitelisted/transform).
- **NFR-04**: `getManyAndCount` (1 truy vấn đếm + lấy trang) — không N+1.
- **NFR-05**: `limit` chặn `@Max(100)` — chống truy vấn quá lớn.
- **NFR-06**: Chỉ THÊM vào service/controller (không sửa `create`/`reportFault`/`deleteEquipment`).

## 14. Acceptance Criteria

- **AC-01**: `GET /equipments` không filter → 200, `data` là mảng, `meta.total` = tổng thiết bị chưa xóa, `meta.totalPages` đúng.
- **AC-02**: `?equipmentType=display` → chỉ trả thiết bị `display`.
- **AC-03**: `?assetStatus=maintenance` → chỉ trả thiết bị `maintenance`.
- **AC-04**: `?healthStatus=faulty` → chỉ thiết bị `faulty`.
- **AC-05**: `?currentRoomId=<uuid>` → chỉ thiết bị ở phòng đó.
- **AC-06**: `?search=EQP` → khớp `equipmentCode`/`equipmentName`/`serialNumber` chứa "EQP" (case-insensitive).
- **AC-07**: Kết hợp nhiều filter → AND.
- **AC-08**: `?sortBy=<không hợp lệ>` → 400 (DTO `@IsIn`); `sortBy` hợp lệ → sắp đúng cột (qua SORT_MAP).
- **AC-09**: `?limit=200` → 400 (`@Max(100)`).
- **AC-10**: Thiết bị đã soft-delete KHÔNG xuất hiện.
- **AC-11**: Thiếu permission → 403; chưa đăng nhập → 401.

## 15. Exception / Alternative Flows

- **EC-01**: Query param sai enum/uuid/sort → 400 (ValidationPipe).
- **EC-02**: Không có thiết bị khớp → 200, `data: []`, `meta.total: 0`.
- **EC-03**: `page` vượt tổng số trang → 200, `data: []` (total vẫn đúng).

---

## 16. [Missing] — Tóm tắt cần làm

**Trạng thái: [Missing]** — module `equipment` có create/reportFault/delete; chưa có list/search.

Danh mục triển khai (ở plan/tasks sau, KHÔNG làm trong spec này):
1. TẠO `ListEquipmentsQueryDto` (mirror `ManageUsersQueryDto`) — filter + sort allowlist + page/limit.
2. THÊM `EquipmentService.listEquipments(query)` — query builder (`deletedAt IS NULL` + filter + `Brackets` search + **SORT_MAP** + `getManyAndCount`) → `{ data, total }`. KHÔNG sửa `create`/`reportFault`/`deleteEquipment`.
3. THÊM `EquipmentController.listEquipments` — `GET /equipments`, guard + `@RequirePermissions('equipment.read')` + ValidationPipe; trả `{success,message,data,meta}`.
4. TẠO seed `equipment.read` (KHÔNG execute) — role theo C1.
5. Tái dùng `EquipmentResponseDto` (C2).
6. Test service (filter từng loại, search ILIKE, SORT_MAP chống inject, phân trang total/totalPages, loại soft-deleted) + controller (RBAC, response meta, `@Max(100)`, `@IsIn` sort).

**Điểm cần chốt trước khi code**: C1–C8 (§11) — đặc biệt: role xem kho (C1), output DTO reuse (C2), sort mặc định (C3), includeDeleted (C4), permission code (C7).

**Ranh giới**: UC-64 CHỈ đọc/list/filter/search (read-only). KHÔNG create (UC-61)/báo lỗi (UC-62)/xóa (UC-63)/phân bổ (UC-65). KHÔNG mutation, KHÔNG audit, KHÔNG migration, KHÔNG execute seed.
