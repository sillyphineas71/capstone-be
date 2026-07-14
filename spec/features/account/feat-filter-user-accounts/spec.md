# Feature Specification: Lọc danh sách tài khoản (Filter user accounts)

- **Feature ID**: UC-14
- **Feature Name**: Lọc danh sách tài khoản
- **Module / Domain**: accounts
- **Created Date**: 2026-07-13
- **Status**: Draft
- **Related UC**: UC-13 (Tìm kiếm tài khoản)
- **Source Documents**:
  - Use Case: UC-14 Lọc danh sách tài khoản
  - Database v3.2 Compact (39 tables) — bảng `users`, `user_roles`, `roles`, `departments`
  - CLAUDE.md / AGENTS.md (§8.4 pagination/sort convention)
  - spec/global/constitution.md (LOCKED v1.0.0)
  - Khảo sát code hiện trạng `src/modules/accounts`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec cho UC-14. Xác định **Missing** (chưa có filter). Nêu mâu thuẫn endpoint dùng chung + 2 phương án kiến trúc chờ chốt. | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Missing]** — chức năng **lọc** theo phòng ban/role/trạng thái chưa tồn tại. Chỉ có search keyword (UC-13) + phân trang trên endpoint dùng chung.

| Thành phần | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| Endpoint list | ✅ `GET /api/v1/users` (permission `accounts.user.list`) | [users.controller.ts:545-547](../../../../src/modules/accounts/controllers/users.controller.ts#L545) |
| Query DTO | ✅ chỉ `page`, `limit`, `search` — **KHÔNG có filter** | [list-users-query.dto.ts](../../../../src/modules/accounts/dto/list-users-query.dto.ts) |
| Bộ lọc mặc định (cứng) | ✅ `accountStatus = ACTIVE` AND `deletedAt IS NULL` | [users.service.ts:1621-1624](../../../../src/modules/accounts/services/users.service.ts#L1621) |
| Search keyword (UC-13) | ✅ ILIKE `fullName`/`email`/`employeeCode` (OR) | [users.service.ts:1626-1634](../../../../src/modules/accounts/services/users.service.ts#L1626) |
| Sort | ✅ **cố định** `fullName ASC` (không cho chọn) | [users.service.ts:1641](../../../../src/modules/accounts/services/users.service.ts#L1641) |
| Filter phòng ban/role/trạng thái | ❌ **Missing** | — |
| Query shape | `findAndCount` với `where` object/array (**không join** user_roles/roles) | [users.service.ts:1636-1644](../../../../src/modules/accounts/services/users.service.ts#L1636) |

### 0.1. Ranh giới với UC-13
- **UC-13 (đã làm)**: search keyword tự do (email/tên/mã NV). 
- **UC-14 (spec này)**: **lọc theo tiêu chí cố định** (phòng ban / role / trạng thái) + **sắp xếp** + phân trang. UC-14 **có thể kết hợp** với search keyword của UC-13 (AND) nhưng **không đặc tả lại** phần search.

---

## 1. VẤN ĐỀ KIẾN TRÚC THEN CHỐT — endpoint dùng chung (CHỜ CHỐT)

`GET /api/v1/users` là **endpoint DÙNG CHUNG**: consumer chính là **autocomplete chọn người tham dự họp** (module meetings), dựa vào contract hiện tại (`ACTIVE`-only, no-scope, output tối giản, sort cố định) — UC-13 đã cố ý **giữ nguyên** để không phá.

UC-14 filter theo **trạng thái** (`INACTIVE`/`LOCKED`/`PENDING_RESET`) **mâu thuẫn trực tiếp** với `baseWhere = ACTIVE`-only; filter theo **role** cần **JOIN** (đổi query shape); nhu cầu quản trị cần **department scope** + output giàu hơn. Đây là **quyết định kiến trúc**, không tự quyết:

### Phương án A — Mở rộng `GET /api/v1/users` (opt-in filters)
- Thêm param optional: `departmentId`, `roleId`/`roleCode`, `accountStatus`, `sortBy`, `sortOrder`.
- **Filter là OPT-IN**: chỉ áp khi client truyền; **mặc định giữ `ACTIVE`-only + `deletedAt IS NULL`** (bảo vệ autocomplete).
- ⚠️ Rủi ro/nhược:
  - Filter `role` cần **JOIN user_roles+roles** → đổi query shape của method dùng chung (từ `findAndCount` where-object sang query builder) — rủi ro hồi quy cho autocomplete.
  - Trộn 2 mục đích (picker autocomplete vs quản trị) vào 1 endpoint → khó bảo trì, dễ vô tình đổi hành vi mặc định.
  - Không tự nhiên khi cần department scope (autocomplete không scope, quản trị có scope) trên cùng endpoint.

### Phương án B — Tách endpoint quản trị riêng (KHUYẾN NGHỊ)
- Endpoint mới, ví dụ `GET /api/v1/users/manage` (hoặc `GET /api/v1/admin/users`), DTO riêng, service method riêng.
- Full filter (departmentId, role, accountStatus) + sort chọn field + phân trang; **department scope** cho Business Admin (nhất quán UC-09/11/12); output giàu hơn (department, status, roles nếu cần); **mặc định trả mọi trạng thái** (quản trị cần thấy INACTIVE/LOCKED).
- **KHÔNG đụng** `GET /users` autocomplete → **không rủi ro** cho meetings.
- Nhược: thêm 1 endpoint + có thể thêm 1 permission.

> **Đề xuất: Phương án B** — tách endpoint quản trị. Lý do: (1) filter trạng thái xung đột bản chất với contract autocomplete; (2) role filter cần join (query shape khác); (3) quản trị cần scope + output khác. Tách endpoint là ranh giới sạch, an toàn cho consumer liên module.
>
> ⚠️ **CHỜ CHỐT**: chọn A hay B. Phần còn lại của spec mô tả theo **Phương án B** (khuyến nghị) và ghi chú khác biệt nếu chọn A.

---

## 2. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-14 |
| **Use Case Name** | Lọc danh sách tài khoản |
| **Module** | `accounts` |
| **Primary Actor** | Business Admin (department scope — theo phương án B) / System Admin (không scope) |
| **Trigger** | Admin chọn bộ lọc phòng ban / role / trạng thái |
| **Expected Output** | Danh sách tài khoản được **lọc, sắp xếp, phân trang** |
| **Pre-condition** | Admin có quyền xem dữ liệu tài khoản |
| **Related** | UC-13 |

---

## 3. Endpoint (theo Phương án B — chờ chốt)

```text
GET /api/v1/users/manage
    ?departmentId=<uuid>
    &roleId=<uuid>              (hoặc roleCode=<string> — chờ chốt §4.2)
    &accountStatus=active|inactive|locked|pending_reset
    &search=<keyword>          (tùy chọn, kết hợp UC-13)
    &sortBy=<field>&sortOrder=asc|desc
    &page=<n>&limit=<m>
```

- Response chuẩn module (CLAUDE.md §8) với `meta` phân trang `{ page, limit, total, totalPages }`.
- *(Phương án A: giữ `GET /api/v1/users` + thêm các param filter/sort trên, opt-in.)*

---

## 4. Bộ lọc cần hỗ trợ (dựa schema THẬT)

Kết hợp các filter bằng **AND**; filter nào không truyền thì bỏ qua.

### 4.1. `departmentId` — lọc theo phòng ban
- Field thật: `users.department_id` (uuid, nullable) ([user.entity.ts:64-65](../../../../src/modules/accounts/entities/user.entity.ts#L64)).
- Điều kiện: `department_id = :departmentId`. Đơn giản, thêm vào `where`.
- *(Nếu cần lọc cả phòng ban con — đệ quy — xem §6 scope; mặc định lọc đúng 1 department. Chờ chốt.)*

### 4.2. `role` — lọc theo vai trò
- Qua bảng nối: `user_roles` (`user_id`, `role_id`, `is_active`, `expired_at`) + `roles` (`role_code`, `role_id`) ([user-role.entity.ts](../../../../src/modules/accounts/entities/user-role.entity.ts), [role.entity.ts]).
- Điều kiện: user có `user_roles` **active** (`is_active=true` AND (`expired_at IS NULL` OR `> now()`)) trỏ tới role mục tiêu.
- **Cần chốt**: lọc theo `roleId` (UUID — chính xác, ổn định) hay `roleCode` (string — thân thiện UI). Đề xuất: `roleId` (khớp cách hệ thống lưu), hoặc hỗ trợ cả hai.
- ⚠️ **Kỹ thuật**: filter này **bắt buộc JOIN** `user_roles`+`roles` → phải dùng **query builder** (hoặc subquery `user_id IN (...)`), khác query `findAndCount` where-object hiện tại. Đây là điểm khiến Phương án A rủi ro (đổi query shape method dùng chung).

### 4.3. `accountStatus` — lọc theo trạng thái
- Enum thật `AccountStatus`: `active`, `inactive`, `locked`, `pending_reset` ([user.entity.ts:21-26](../../../../src/modules/accounts/entities/user.entity.ts#L21)).
- Điều kiện: `account_status = :accountStatus`.
- **Giải quyết mâu thuẫn baseWhere** (§1):
  - **Phương án B**: endpoint quản trị **mặc định trả mọi trạng thái** (chỉ `deletedAt IS NULL`); nếu truyền `accountStatus` thì lọc đúng trạng thái đó. Không có mâu thuẫn với autocomplete (endpoint khác).
  - **Phương án A** (nếu chọn): `accountStatus` là **opt-in** — chỉ khi client truyền mới ghi đè; **không truyền → giữ `ACTIVE`-only** (bảo vệ autocomplete). Không được đổi default.
- Luôn giữ `deletedAt IS NULL` (không trả tài khoản đã xóa mềm — UC-10).

### 4.4. Kết hợp với search (UC-13)
- `search` (nếu truyền) áp ILIKE `fullName`/`email`/`employeeCode` (đã có UC-13) **AND** với các filter trên. UC-14 không làm lại phần search, chỉ tổ hợp.

---

## 5. Sắp xếp & Phân trang

### 5.1. Sắp xếp (Expected Output nêu "sắp xếp")
- Đề xuất cho chọn `sortBy` + `sortOrder` (CLAUDE.md §8.4): `?sortBy=created_at&sortOrder=desc`.
- **Allowlist `sortBy`** (chống SQL injection field — CLAUDE.md §8.4): ví dụ `fullName`, `email`, `employeeCode`, `accountStatus`, `createdAt`. `sortOrder ∈ {asc, desc}`. Mặc định `fullName ASC` (giữ như hiện tại).
- **Cần chốt**: tập field sort được phép.

### 5.2. Phân trang (tái dùng)
- `page` (default 1, min 1), `limit` (default 20, min 1, **max 100**), `skip=(page-1)*limit`, `take=limit`, trả `total` + `totalPages`. Tái dùng cơ chế hiện có.

---

## 6. Department scope (theo phương án)

- **Phương án B (khuyến nghị)**: Business Admin **bị giới hạn department scope** (nhất quán UC-09/11/12 — tái dùng `resolveDepartmentScope`); System Admin không giới hạn. Nếu client truyền `departmentId` ngoài scope của Business Admin → `403` hoặc trả rỗng (chờ chốt). *(Nếu áp scope: kết quả = users thuộc scope AND các filter.)*
- **Phương án A**: **KHÔNG** áp scope (giữ hành vi endpoint dùng chung). 
- ⚠️ **Cần chốt** cùng với lựa chọn endpoint.

---

## 7. Permission & RBAC

- **Phương án B**: có thể (a) **tái dùng `accounts.user.list`** (đơn giản), hoặc (b) **permission mới** `accounts.user.list.manage`/`accounts.user.manage` (vì list quản trị lộ trạng thái/role/mọi status — nhạy cảm hơn autocomplete). **Cần chốt.** Nếu tạo permission mới → seed (không thuộc bước spec).
- **Phương án A**: dùng `accounts.user.list` sẵn có.
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions(...)`.

---

## 8. Main Flow (happy path — Phương án B)

1. Admin gọi `GET /api/v1/users/manage?departmentId=&roleId=&accountStatus=&search=&sortBy=&sortOrder=&page=&limit=`.
2. `JwtAuthGuard` xác thực. `PermissionsGuard` kiểm permission.
3. Validate query (filter enum/UUID hợp lệ; `sortBy` trong allowlist; `sortOrder ∈ {asc,desc}`; pagination).
4. Nếu Business Admin (không System Admin): resolve department scope; áp scope vào truy vấn (và kiểm `departmentId` filter ∈ scope nếu có).
5. Dựng truy vấn (query builder): base `deletedAt IS NULL` + các filter AND (department_id, join role, account_status) + search ILIKE (nếu có).
6. Áp `orderBy(sortBy, sortOrder)`, `skip`, `take`; đếm `total`.
7. Trả `{ success, message, data[], meta{page,limit,total,totalPages} }`.

---

## 9. Exception / Alternative Flows

| Tình huống | HTTP | Ghi chú |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | `UNAUTHORIZED` |
| Thiếu permission | 403 | `FORBIDDEN` |
| Ngoài department scope (Business Admin, phương án B) | 403 | `FORBIDDEN` (hoặc trả rỗng — chờ chốt) |
| `accountStatus`/`roleId`/`departmentId` sai định dạng/enum | 400 | ValidationPipe |
| `sortBy` ngoài allowlist | 400 | `INVALID_SORT_FIELD` (chống inject field) |
| `page`/`limit` sai (âm, >100) | 400 | ValidationPipe |
| Không có kết quả khớp | 200 | `data: []`, `meta.total: 0` |
| Lỗi server | 500 | không lộ stack trace (ENG-03) |

---

## 10. Expected Output

- Danh sách tài khoản đã **lọc** (theo department/role/status + search), **sắp xếp** (sortBy/sortOrder), **phân trang** (`meta`).
- Output item (phương án B — đề xuất giàu hơn để quản trị): tối thiểu `{ id, fullName, email, employeeCode, accountStatus, department, roles? }` — **cần chốt** tập field.

---

## 11. Audit

- UC-14 là thao tác **READ** (lọc/liệt kê). Theo CLAUDE.md §17, chỉ **mutation** bắt buộc audit → UC-14 **KHÔNG ghi audit** (nhất quán `listUsers`/UC-13).

---

## 12. Rủi ro & bảo vệ code liên module

- ⚠️ **Nếu chọn Phương án A** (mở rộng `GET /users`): TUYỆT ĐỐI **không đổi `baseWhere`/default**; filter `accountStatus` phải **opt-in** (không truyền → giữ `ACTIVE`-only); cẩn trọng khi đổi query shape để hỗ trợ role join (dễ hồi quy autocomplete meetings). Test regression consumer bắt buộc.
- **Phương án B** loại bỏ rủi ro này (endpoint tách).
- **KHÔNG** mutation, **KHÔNG** migration/index (filter dùng where/join; nếu dữ liệu lớn cân nhắc index cho `department_id`/`account_status` là đề xuất tương lai — không làm ở UC-14).
- Không dùng raw SQL nối chuỗi (SEC-03); `sortBy` allowlist bắt buộc.

---

## 13. Giả định & điểm cần chốt

1. **[Kiến trúc endpoint — quan trọng nhất]** Phương án **A** (mở rộng `GET /users`, opt-in) hay **B** (tách `GET /users/manage`). Đề xuất **B**.
2. **[Filter role]** Lọc theo `roleId` (đề xuất) hay `roleCode`, hay cả hai.
3. **[Filter trạng thái mặc định]** B: mặc định mọi trạng thái. A: mặc định `ACTIVE`-only (opt-in ghi đè). Chốt theo phương án.
4. **[Department scope]** B: Business Admin scoped (đề xuất). A: no-scope. + Xử lý khi `departmentId` filter ngoài scope (403 vs rỗng).
5. **[departmentId đệ quy]** Lọc đúng 1 phòng ban hay gồm phòng ban con (theo scope tree).
6. **[Sort allowlist]** Tập field cho phép `sortBy`.
7. **[Permission]** Tái dùng `accounts.user.list` hay tạo `accounts.user.list.manage` (B).
8. **[Output fields]** Tập field trả về cho list quản trị (thêm accountStatus/department/roles?).

---

## 14. Trạng thái kết luận

**[Missing]** — chức năng lọc chưa tồn tại.

- **Đã có (tái dùng)**: endpoint list + phân trang + search (UC-13); enum `AccountStatus`; `resolveDepartmentScope`; convention sort §8.4.
- **Cần làm (sau khi chốt phương án)**:
  1. **Chốt Phương án A/B** (§1, §13.1) — quyết định kiến trúc, không tự quyết.
  2. DTO query filter mới (departmentId?, roleId?/roleCode?, accountStatus?, sortBy?, sortOrder?) + validate enum/UUID + `sortBy` allowlist.
  3. Endpoint (B: `GET /users/manage` mới; A: mở rộng `GET /users` opt-in) + guard/permission.
  4. Service: query builder tổ hợp filter AND (department, **join role**, status) + search + sort + pagination; (B) department scope cho Business Admin.
  5. (Nếu B + permission mới) seed permission — không thuộc bước spec.
  6. Unit test: từng filter, tổ hợp AND, sort allowlist (reject field lạ), scope (B), (A) regression autocomplete không đổi.
- **Không đụng UC khác**: không làm lại search (UC-13), không mutation, không migration/index, không audit (READ).
- **Bảo vệ liên module**: nếu chọn A, filter trạng thái OPT-IN, không đổi default/baseWhere — bảo vệ autocomplete meetings.
