# Implementation Plan: Tìm kiếm tài khoản (Search user accounts)

> Feature ID: UC-13
> Module: accounts
> Created: 2026-07-13
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt, áp 6 quyết định chốt)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-13 (mở rộng search `employeeCode` + output). Thuần additive trên endpoint dùng chung. | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | **G1**: thêm `employeeCode` vào tập field search ILIKE (OR với fullName/email); `ILike()` TypeORM; null không khớp | Thêm 1 nhánh vào mảng `where` |
| 2 | **G2**: thêm field `employeeCode` (optional) vào `UserListItemDto` + map; không bỏ field cũ | Sửa DTO output + select/map service |
| 3 | **G3**: KHÔNG áp department scope (giữ nguyên hành vi endpoint dùng chung) | Không đụng scope |
| 4 | **G4**: KHÔNG nới trạng thái (giữ `ACTIVE`-only + `deletedAt IS NULL`) | Giữ `baseWhere` |
| 5 | KHÔNG audit / mutation / migration / index | Chỉ READ |
| 6 | Permission: dùng `accounts.user.list` sẵn có | Không sửa controller/permission |

---

## 1. Feature Summary

Mở rộng chức năng tìm kiếm của endpoint list users hiện có (`GET /api/v1/users`) để keyword khớp thêm `employee_code` (ngoài `fullName`, `email` đã có), và bổ sung `employeeCode` vào output. Thay đổi **thuần cộng thêm (additive)**: giữ nguyên phân trang, sort, bộ lọc mặc định (`ACTIVE` + `deletedAt IS NULL`), permission, contract — để **không phá** consumer autocomplete người tham dự họp (module meetings).

---

## 2. Technical Context (đã xác minh)

### 2.1 Cấu trúc `where` hiện tại (điểm then chốt)

[users.service.ts:1621-1631](../../../../src/modules/accounts/services/users.service.ts#L1621):
```ts
const baseWhere = { deletedAt: IsNull(), accountStatus: AccountStatus.ACTIVE };
const where = search
  ? [
      { ...baseWhere, fullName: ILike(`%${search}%`) },
      { ...baseWhere, email: ILike(`%${search}%`) },
    ]
  : baseWhere;
```
- **TypeORM: mảng `where` = OR** giữa các phần tử; **mỗi phần tử object = AND** các field.
- ⇒ Hiện tại = `(base AND fullName ILIKE) OR (base AND email ILIKE)`. `baseWhere` (ACTIVE + deletedAt) đã được **spread vào TỪNG nhánh** → mỗi nhánh OR đều bị ràng buộc `ACTIVE`+`deletedAt`. **Đây là chỗ dễ sai nhất** (§6): thêm nhánh mới **PHẢI** spread `...baseWhere` để không lộ user INACTIVE/deleted.

### 2.2 Select + map hiện tại
[users.service.ts:1633-1647](../../../../src/modules/accounts/services/users.service.ts#L1633): `select: { id, fullName, email }`, `order: { fullName: 'asc' }`, map `{ id, fullName, email }`. `employeeCode` **chưa** nằm trong select/map.

### 2.3 Field thật
`users.employee_code` = `varchar(50) nullable` ([user.entity.ts:33-39](../../../../src/modules/accounts/entities/user.entity.ts#L33)), entity prop `employeeCode`.

### 2.4 Không đổi
- Controller `@Get()` + `@RequirePermissions('accounts.user.list')` ([users.controller.ts:545-547](../../../../src/modules/accounts/controllers/users.controller.ts#L545)) — **giữ nguyên**.
- `ListUsersQueryDto` (`page/limit/search`) — **giữ nguyên** (search param đã có).

---

## 3. Kiến trúc & luồng (điểm chèn thay đổi)

```
GET /api/v1/users?search=&page=&limit=   [KHÔNG đổi controller/DTO query/permission]
  ▼
UsersService.listUsers(query)
  │  (A) where: thêm nhánh { ...baseWhere, employeeCode: ILike('%search%') } vào mảng OR   ← G1
  │  (B) select: thêm employeeCode: true                                                  ← G2
  │  (C) map: thêm employeeCode: u.employeeCode                                            ← G2
  ▼
{ data:[{ id, fullName, email, employeeCode }], total }  → controller giữ nguyên meta phân trang
```

Chỉ sửa **bên trong** `listUsers` (service) + `UserListItemDto` (output). Không đụng controller.

---

## 4. Chi tiết thay đổi

### 4.1 G1 — Search thêm `employeeCode` (AN TOÀN với baseWhere)
Trong `listUsers`, khi có `search`, mảng `where` thêm **1 phần tử** kèm `...baseWhere`:
```ts
const where = search
  ? [
      { ...baseWhere, fullName: ILike(`%${search}%`) },
      { ...baseWhere, email: ILike(`%${search}%`) },
      { ...baseWhere, employeeCode: ILike(`%${search}%`) },   // ← thêm; spread baseWhere BẮT BUỘC
    ]
  : baseWhere;
```
- **Bắt buộc** `...baseWhere` trong nhánh mới → giữ `ACTIVE` + `deletedAt IS NULL` cho nhánh employeeCode (không lộ INACTIVE/deleted).
- `ILike()` parameter binding (SEC-03). `employee_code` null → không khớp `ILIKE` (đúng mong đợi).

### 4.2 G2 — Output thêm `employeeCode`
- `UserListItemDto`: thêm field optional `employeeCode?: string | null` (giữ nguyên `id/fullName/email`).
- `listUsers` select: thêm `employeeCode: true`.
- `listUsers` map: thêm `employeeCode: u.employeeCode`.

> Additive: consumer cũ (autocomplete meetings) chỉ đọc `id/fullName/email` → thêm field mới không phá.

---

## 5. Test Plan (liệt kê — không code)

Bổ sung vào test `listUsers` hiện có ([users.service.spec.ts]) — **thêm, không phá test cũ**:

| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| T1 | search khớp `employeeCode` (mới) | trả user có `employee_code` chứa keyword |
| T2 | search vẫn khớp `fullName` (regression) | giữ hành vi cũ |
| T3 | search vẫn khớp `email` (regression) | giữ hành vi cũ |
| T4 | search chỉ trả `ACTIVE` (không lộ INACTIVE/deleted) | mọi nhánh OR kèm baseWhere → không có user INACTIVE/deleted |
| T5 | output có `employeeCode` | `data[].employeeCode` xuất hiện (map đúng) |
| T6 | user không có mã NV (`employee_code=null`) | không khớp nhánh employeeCode (chỉ khớp nếu trùng fullName/email) |
| T7 | phân trang giữ nguyên | `page/limit/total`/skip/take không đổi |
| T8 | search rỗng/không truyền | trả danh sách không lọc keyword (giữ nguyên) |

---

## 6. Rủi ro & điểm cần xác minh

| # | Rủi ro | Hành động |
| :--- | :--- | :--- |
| R1 | **Where OR array**: quên spread `...baseWhere` ở nhánh employeeCode → lộ user INACTIVE/deleted | BẮT BUỘC `{ ...baseWhere, employeeCode: ILike(...) }`; test T4 verify |
| R2 | Phá consumer autocomplete meetings | Thay đổi additive (thêm field output + thêm nhánh search); không đổi scope/filter/sort/pagination/contract |
| R3 | `select` không lấy `employeeCode` → map ra `undefined` | Thêm `employeeCode: true` vào select |
| R4 | Hiệu năng ILIKE seq scan | Chấp nhận (bảng users nội bộ); KHÔNG thêm index (quyết định #5) |

---

## 7. Tác động lên code người khác (bảo vệ)

- **CHỈ ĐỌC (không sửa)**: controller `@Get()` listUsers + guard/permission `accounts.user.list`; `ListUsersQueryDto`; các method khác của `UsersService`.
- **Thay đổi THUẦN ADDITIVE** trên endpoint dùng chung: chỉ **thêm** nhánh search + **thêm** field output; **KHÔNG** đổi department scope (không thêm — G3), bộ lọc mặc định (giữ ACTIVE+deletedAt — G4), sort, contract phân trang, permission.
- **KHÔNG** tạo endpoint/permission mới; **KHÔNG** làm filter UC-14; **KHÔNG** mutation/migration/index/audit.

---

## 8. Checklist file cần SỬA

### ✏️ SỬA (additive)
- [ ] `src/modules/accounts/services/users.service.ts` — trong `listUsers`: (A) thêm nhánh `{ ...baseWhere, employeeCode: ILike(...) }` vào mảng `where`; (B) thêm `employeeCode: true` vào `select`; (C) map `employeeCode: u.employeeCode`. **KHÔNG** đổi baseWhere/sort/pagination; **KHÔNG** sửa method khác.
- [ ] `src/modules/accounts/dto/user-list-item.dto.ts` — thêm field optional `employeeCode?: string | null` (+ `@ApiProperty`). Giữ nguyên id/fullName/email.
- [ ] `src/modules/accounts/services/users.service.spec.ts` — bổ sung test T1–T8 cho `listUsers`. **KHÔNG** phá test cũ.

### ⛔ KHÔNG đổi
- `src/modules/accounts/controllers/users.controller.ts` (endpoint/permission/contract giữ nguyên).
- `src/modules/accounts/dto/list-users-query.dto.ts` (search param đã có).
- Không thêm scope/filter/audit/migration/index; không đụng module meetings.

---

> Kết thúc plan. Bước tiếp theo (khi duyệt): tách `tasks.md` theo checklist §8. Chưa code.
