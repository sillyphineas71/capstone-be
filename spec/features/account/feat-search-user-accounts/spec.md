# Feature Specification: Tìm kiếm tài khoản (Search user accounts)

- **Feature ID**: UC-13
- **Feature Name**: Tìm kiếm tài khoản
- **Module / Domain**: accounts
- **Created Date**: 2026-07-13
- **Status**: Draft
- **Related UC**: UC-14 (Lọc danh sách tài khoản)
- **Source Documents**:
  - Use Case: UC-13 Tìm kiếm tài khoản
  - Database v3.2 Compact (39 tables) — bảng `users`
  - CLAUDE.md / AGENTS.md
  - spec/global/constitution.md (LOCKED v1.0.0)
  - Khảo sát code hiện trạng `src/modules/accounts`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec cho UC-13. Xác định **Partial** (đã có list+search fullName/email+pagination; thiếu employeeCode). Phân định với UC-14. | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Partial]** — chức năng list + search + phân trang **đã tồn tại**; chỉ **thiếu search theo `employee_code` (mã NV)** so với Expected Output.

### 0.1. Đã có sẵn (KHÔNG đặc tả lại như làm mới)

| Thành phần | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| Endpoint list/search | ✅ `GET /api/v1/users` | [users.controller.ts:545-547](../../../../src/modules/accounts/controllers/users.controller.ts#L545) — permission `accounts.user.list` |
| DTO query | ✅ `page`, `limit` (max 100), `search` | [list-users-query.dto.ts](../../../../src/modules/accounts/dto/list-users-query.dto.ts) |
| Phân trang | ✅ `skip=(page-1)*limit`, `take=limit`, trả `total`; controller tính `totalPages` | [users.service.ts:1633-1641](../../../../src/modules/accounts/services/users.service.ts#L1633) |
| Search keyword | ✅ **ILIKE partial, case-insensitive** trên `fullName` + `email` (OR) | [users.service.ts:1626-1631](../../../../src/modules/accounts/services/users.service.ts#L1626) |
| Bộ lọc mặc định | ✅ `accountStatus = ACTIVE` AND `deletedAt IS NULL` | [users.service.ts:1621-1624](../../../../src/modules/accounts/services/users.service.ts#L1621) |
| Sắp xếp | ✅ `fullName ASC` | [users.service.ts:1638](../../../../src/modules/accounts/services/users.service.ts#L1638) |
| Output | ✅ Tối giản `{ id, fullName, email }` | [user-list-item.dto.ts](../../../../src/modules/accounts/dto/user-list-item.dto.ts) |

### 0.2. Gap so với Expected Output UC-13

Expected Output: "Hiển thị danh sách tài khoản khớp **email/tên/mã NV**, có phân trang".

| Gap | Mức độ | Ghi chú |
| :--- | :--- | :--- |
| **G1 — Search thiếu `employee_code` (mã NV)** | ❌ Bắt buộc (theo Expected Output) | Hiện chỉ ILIKE `fullName`+`email`; cần thêm nhánh ILIKE `employeeCode` |
| **G2 — Output không chứa `employeeCode`** | ⚠️ Khả năng cần | Nếu cho search theo mã NV, kết quả nên hiển thị mã NV để admin nhận diện (hiện `UserListItemDto` chỉ có id/fullName/email). **Cần chốt** |
| **G3 — Không có department scope** | ⚠️ Quyết định chính sách | Endpoint hiện **không** giới hạn scope (trả mọi user active toàn hệ thống). **Cần chốt** — xem §5 & §11 rủi ro |
| **G4 — Chỉ trả tài khoản `ACTIVE`** | ⚠️ Quyết định chính sách | Nếu admin cần tìm cả tài khoản `INACTIVE`/`LOCKED` để quản lý, bộ lọc cứng `ACTIVE` phải nới. **Cần chốt** — nhưng nới ở đây có thể lấn UC-14 (lọc theo trạng thái) |

### 0.3. Phân định UC-13 vs UC-14 (chống lấn)

- **UC-13 (spec này)**: **tìm kiếm theo từ khóa tự do** khớp `email` / `fullName` / `employee_code` (partial, case-insensitive). Một ô search duy nhất.
- **UC-14 (KHÔNG thuộc spec này)**: **lọc theo tiêu chí cố định** (phòng ban, vai trò, trạng thái tài khoản...). UC-13 **KHÔNG** làm phần filter; cũng **KHÔNG** tự nới bộ lọc trạng thái (G4) sang địa hạt UC-14 nếu chưa chốt.

---

## 1. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-13 |
| **Use Case Name** | Tìm kiếm tài khoản |
| **Module** | `accounts` |
| **Primary Actor** | Admin có quyền xem dữ liệu tài khoản (Business Admin / System Admin) *— hiện gate bằng `accounts.user.list`; xác nhận §6* |
| **Trigger** | Admin nhập từ khóa tìm kiếm |
| **Expected Output** | Danh sách tài khoản khớp `email`/`fullName`/`employee_code`, có phân trang |
| **Pre-condition** | Admin có quyền xem dữ liệu tài khoản (permission `accounts.user.list`) |
| **Related** | UC-14 |

---

## 2. Actor & Trigger

- **Primary Actor**: Admin có permission `accounts.user.list` (theo RBAC thật — xem §6). UC list ghi Business Admin / System Admin.
- **Trigger**: Admin nhập từ khóa vào ô tìm kiếm (query param `search`).
- **Secondary Actor**: Không có (thao tác READ đồng bộ).

---

## 3. Endpoint (MỞ RỘNG endpoint hiện có — KHÔNG tạo mới)

```text
GET /api/v1/users?search=<keyword>&page=<n>&limit=<m>
```

- **Tái dùng** endpoint `GET /api/v1/users` hiện có; **KHÔNG** tạo endpoint mới.
- UC-13 chỉ **mở rộng hành vi search** (thêm `employee_code` vào tập field khớp — G1). Không đổi contract query/pagination.
- Response giữ format chuẩn module (CLAUDE.md §8) với `meta` phân trang:

```json
{
  "success": true,
  "message": "Lấy danh sách người dùng thành công",
  "data": [ { "id": "...", "fullName": "...", "email": "..." } ],
  "meta": { "page": 1, "limit": 20, "total": 125, "totalPages": 7 }
}
```

> Nếu chốt G2 (thêm `employeeCode` vào output), `data[]` bổ sung field `employeeCode` — **đề xuất, chờ duyệt**.

---

## 4. Search behavior

| Thuộc tính | Giá trị |
| :--- | :--- |
| Field khớp | `fullName`, `email` (đã có) **+ `employeeCode`** (G1 — cần thêm) |
| Kiểu match | **Chứa** (substring) — `ILIKE '%keyword%'`, case-insensitive (đã dùng cho fullName/email) |
| Toán tử giữa các field | **OR** (khớp bất kỳ field nào) |
| Chuẩn hóa input | `search.trim()` (đã có); rỗng/không truyền → trả danh sách không lọc keyword |
| Sắp xếp | `fullName ASC` (giữ nguyên) |

- `employee_code` là `varchar(50) nullable` ([user.entity.ts:33-39](../../../../src/modules/accounts/entities/user.entity.ts#L33)) — ILIKE áp dụng bình thường; user không có mã NV (`null`) không khớp nhánh này.
- **An toàn SQL**: dùng `ILike()` của TypeORM (parameter binding), không nối chuỗi (SEC-03) — mirror cách hiện tại.

### 4.1. Ghi chú hiệu năng & index (KHÔNG tự thêm index)

- Search dùng `ILIKE '%keyword%'` (wildcard hai đầu) → **không tận dụng được btree index** thông thường; PostgreSQL sẽ **seq scan** trên `users`.
- **Cần xác minh**: hiện **chưa khảo sát** thấy index hỗ trợ full-text/trigram cho `fullName`/`email`/`employee_code`. Với bảng `users` nhỏ (nội bộ tổ chức) chi phí chấp nhận được; nếu dữ liệu lớn, cân nhắc `pg_trgm` GIN index — **đề xuất tương lai, KHÔNG tự thêm ở UC-13** (đúng ràng buộc không tạo migration/index).

---

## 5. Phân trang & Department scope

### 5.1. Phân trang (tái dùng, KHÔNG chế lại)
- `page` (default 1, min 1), `limit` (default 20, min 1, **max 100**), `skip=(page-1)*limit`, `take=limit`, trả `total`; controller tính `totalPages=ceil(total/limit)`. Giữ nguyên.

### 5.2. Department scope (điểm cần chốt — G3)
- Endpoint `GET /users` hiện tại **KHÔNG áp department scope** (trả mọi user `ACTIVE` toàn hệ thống). Mục đích khai báo trong code là **autocomplete chọn người tham dự họp** ([users.controller.ts:550-552](../../../../src/modules/accounts/controllers/users.controller.ts#L550)).
- UC list Pre-condition chỉ nói "Admin có quyền xem dữ liệu tài khoản" — **không** khẳng định phải giới hạn scope.
- ⚠️ **Mâu thuẫn/rủi ro cần chốt**: nếu UC-13 (tìm kiếm phục vụ quản trị tài khoản) yêu cầu Business Admin **chỉ** thấy user trong department scope (nhất quán UC-09/UC-11/UC-12), thì việc thêm scope vào **chính endpoint dùng chung này** sẽ **thay đổi hành vi** của consumer hiện tại (autocomplete người tham dự họp ở module meetings) → có thể **phá** luồng chọn participant. Xem §11.
  - **Đề xuất (khuyến nghị, chờ duyệt)**: UC-13 tối thiểu chỉ **thêm `employee_code` vào search** (G1) trên endpoint hiện có, **giữ nguyên** hành vi no-scope/active-only để **không phá** consumer meetings. Nếu team muốn "admin account search" có scope + trạng thái + field mở rộng, đó là một biến thể quản trị riêng → **cân nhắc tham số/endpoint tách** để không ảnh hưởng autocomplete. Quyết định thuộc team.

---

## 6. Permission & RBAC

- Permission: **tái dùng `accounts.user.list`** đã có ([users.controller.ts:547](../../../../src/modules/accounts/controllers/users.controller.ts#L547)). **KHÔNG tạo permission mới.**
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.list')` (giữ nguyên).
- ⚠️ **Xác nhận với RBAC thật**: permission `accounts.user.list` hiện được cấp cho role nào (khảo sát seed — [SeedUserListPermission.ts](../../../../src/database/seeds/20260624000001-SeedUserListPermission.ts))? UC-13 dùng đúng tập role đó. Nếu Expected Actor (Business Admin/System Admin) chưa khớp tập role được cấp `accounts.user.list`, nêu rõ — **KHÔNG tự đổi cấp phát**.

---

## 7. Main Flow (happy path)

1. Admin gọi `GET /api/v1/users?search=<keyword>&page=&limit=`.
2. `JwtAuthGuard` xác thực. `PermissionsGuard` kiểm `accounts.user.list`.
3. Validate query (`page`≥1, `limit`≤100, `search` là string) — DTO đã có.
4. Chuẩn hóa `search = search.trim()`.
5. Dựng `where`:
   - `baseWhere = { deletedAt: IsNull(), accountStatus: ACTIVE }` (giữ nguyên — trừ khi chốt G4).
   - Nếu có `search`: OR các nhánh `ILIKE '%search%'` trên `fullName`, `email`, **`employeeCode`** (G1).
6. `findAndCount` với `select`, `order fullName ASC`, `skip`, `take`.
7. Map `data[]`, trả `{ success, message, data, meta{page,limit,total,totalPages} }`.

---

## 8. Exception / Alternative Flows

| Tình huống | HTTP | Ghi chú |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | `UNAUTHORIZED` |
| Thiếu permission `accounts.user.list` | 403 | `FORBIDDEN` |
| `page`/`limit` sai (âm, `limit`>100) | 400 | ValidationPipe (`Min`/`Max` trong DTO) |
| `search` không phải string | 400 | ValidationPipe |
| Không có kết quả khớp | 200 | `data: []`, `meta.total: 0` (không phải lỗi) |
| Lỗi server | 500 | không lộ stack trace (ENG-03) |

- Search rỗng/không truyền → trả danh sách (không lọc keyword) — hành vi hiện tại, giữ nguyên.

---

## 9. Expected Output

- Danh sách tài khoản (phân trang) khớp keyword trên `email` / `fullName` / `employee_code`.
- Mỗi item tối thiểu `{ id, fullName, email }` (hiện tại) — **cân nhắc thêm `employeeCode`** (G2, chờ chốt).
- `meta` phân trang: `page, limit, total, totalPages`.

---

## 10. Audit

- UC-13 là thao tác **READ** (tìm kiếm/liệt kê). Theo CLAUDE.md §17, danh mục **bắt buộc audit** là các **mutation** (create/update/delete/khóa/role...) — **không** liệt kê search/list.
- Endpoint `listUsers` hiện tại **không** ghi audit. UC-13 **giữ nguyên: KHÔNG ghi audit cho search** (READ).
- *(Ghi chú)*: `data-governance.md` hiện trống (0 byte) → không có chính sách audit truy vấn nhạy cảm bắt buộc. Nếu tương lai có chính sách audit truy vấn dữ liệu nhân sự, sẽ bổ sung riêng — **không thuộc UC-13**.

---

## 11. Rủi ro & lưu ý (bảo vệ code người khác)

- ⚠️ **Endpoint dùng chung**: `GET /users` đang phục vụ **autocomplete người tham dự họp** (module meetings/frontend). Mọi thay đổi hành vi (thêm scope G3, nới trạng thái G4, đổi output G2) **có thể phá** consumer đó. UC-13 nên **chỉ mở rộng search field** (G1) — thay đổi cộng thêm, không phá; các gap còn lại phải **chốt trước** vì ảnh hưởng liên module.
- **KHÔNG** đụng mutation, **KHÔNG** làm filter của UC-14, **KHÔNG** tạo migration/index.
- Giữ `ILike` parameter binding (không nối chuỗi) — SEC-03.

---

## 12. Giả định & điểm cần chốt

1. **[G1 — bắt buộc]** Thêm `employee_code` vào tập field search ILIKE (để khớp Expected Output). *(Thay đổi tối thiểu, an toàn.)*
2. **[G2]** Có thêm `employeeCode` vào output `UserListItemDto` không (để admin nhận diện khi search theo mã NV). Đề xuất: có.
3. **[G3 — quan trọng]** UC-13 có áp department scope cho Business Admin không? Nếu có → **không** áp lên endpoint dùng chung (phá autocomplete meetings); cân nhắc tham số/endpoint tách. Đề xuất mặc định: **giữ no-scope** cho lần mở rộng này.
4. **[G4]** Có nới bộ lọc `ACTIVE` để search cả `INACTIVE`/`LOCKED` không? Cẩn thận lấn UC-14 (lọc theo trạng thái). Đề xuất: **giữ ACTIVE-only** ở UC-13; trạng thái thuộc UC-14.
5. **[Actor/permission]** Tập role được cấp `accounts.user.list` có khớp Business Admin/System Admin không (khảo sát seed). Không tự đổi cấp phát.
6. **[Hiệu năng/index]** ILIKE `%...%` seq scan; index trigram là đề xuất tương lai, không làm ở UC-13.

---

## 13. Trạng thái kết luận

**[Partial]** — phần lớn đã có; cần bổ sung nhỏ.

- **Đã có (KHÔNG làm lại)**: endpoint `GET /api/v1/users` + `accounts.user.list` + phân trang (page/limit/total/totalPages) + search ILIKE trên `fullName`+`email`.
- **Cần làm (tối thiểu để đạt Expected Output)**:
  1. **G1 (bắt buộc)**: thêm nhánh `ILIKE '%search%'` cho `employeeCode` vào `where` OR của `listUsers` — mở rộng, không tạo endpoint/permission mới.
- **Cần chốt trước khi mở rộng thêm** (đừng tự quyết vì ảnh hưởng liên module):
  - G2 (output thêm `employeeCode`), G3 (department scope — rủi ro phá autocomplete meetings), G4 (nới trạng thái — lấn UC-14), permission role-set.
- **Không đụng UC khác**: KHÔNG làm filter UC-14 (phòng ban/role/trạng thái); KHÔNG mutation; KHÔNG migration/index; KHÔNG audit (READ).
