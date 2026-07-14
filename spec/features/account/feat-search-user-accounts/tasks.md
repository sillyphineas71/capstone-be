# Tasks: Tìm kiếm tài khoản (Search user accounts)

**Feature**: UC-13
**Module**: accounts
**Priority**: P2
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-13 (mở rộng search `employeeCode` + output). Thuần additive trên endpoint dùng chung. | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. **G1**: thêm nhánh `{ ...baseWhere, employeeCode: ILike('%search%') }` vào mảng `where` OR của `listUsers`. **BẮT BUỘC spread `...baseWhere`** (giữ `ACTIVE` + `deletedAt IS NULL` cho nhánh mới — chống lộ INACTIVE/deleted). Dùng `ILike()` (parameter binding).
2. **G2**: thêm field `employeeCode?: string | null` vào `UserListItemDto` (+ `@ApiProperty`); thêm `employeeCode: true` vào `select`; map `employeeCode: u.employeeCode`. **Giữ nguyên** `id/fullName/email`.
3. **G3**: KHÔNG áp department scope.
4. **G4**: KHÔNG nới trạng thái (giữ `ACTIVE`-only).
5. KHÔNG audit / mutation / migration / index.
6. Permission `accounts.user.list` sẵn có — KHÔNG tạo/đổi.

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG commit, KHÔNG migration/seed/index.
- KHÔNG sửa `users.controller.ts` (endpoint/permission/contract giữ nguyên), `list-users-query.dto.ts` (search param đã có), method khác của `UsersService`.
- KHÔNG thêm department scope (G3), KHÔNG đổi `baseWhere`/sort/pagination (G4), KHÔNG audit.
- KHÔNG làm filter UC-14; KHÔNG đụng module meetings.
- Thay đổi phải **THUẦN ADDITIVE** (endpoint `GET /users` dùng chung cho autocomplete người tham dự họp).

### Format
- `[Txxx]` Task ID tuần tự · `[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 1 — DTO output (G2)

| Dependency | Task |
|---|---|
| — | T001 |

- [ ] **T001** `[MODIFY]` `src/modules/accounts/dto/user-list-item.dto.ts` — thêm field `employeeCode`.
  - Thêm `@ApiProperty({ description: 'Mã nhân viên', required: false, nullable: true }) employeeCode?: string | null;` (hoặc tương đương). **Giữ nguyên** `id`, `fullName`, `email`.
  - **DoD**: file compile; DTO có 4 field (id, fullName, email, employeeCode); không bỏ/đổi field cũ.

---

## Phase 2 — Service (G1 + G2)

| Dependency | Task |
|---|---|
| T001 → | T002 |

- [ ] **T002** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — mở rộng `listUsers` (chỉ bên trong method này).
  - **(A) G1 — search branch**: trong nhánh `search ? [...]`, **thêm 1 phần tử**:
    `{ ...baseWhere, employeeCode: ILike(\`%${search}%\`) }`.
    ⚠️ **BẮT BUỘC** spread `...baseWhere` (giữ `deletedAt: IsNull()` + `accountStatus: ACTIVE`) — không được để nhánh employeeCode thiếu baseWhere.
  - **(B) G2 — select**: thêm `employeeCode: true` vào object `select`.
  - **(C) G2 — map**: thêm `employeeCode: u.employeeCode` vào object map `data[]`.
  - **KHÔNG** đổi `baseWhere`, `order` (`fullName ASC`), `skip`/`take`/pagination, return shape `{ data, total }`. **KHÔNG** sửa method khác.
  - `ILike` đã import sẵn (dùng cho fullName/email); không thêm import thừa.
  - **DoD**: `listUsers` search khớp thêm `employeeCode`; mọi nhánh OR đều kèm `baseWhere`; output `data[]` có `employeeCode`; phân trang/sort/permission không đổi; tsc pass.

---

## Phase 3 — Unit test (T1–T8)

| Dependency | Task |
|---|---|
| T002 → | T003 |

- [ ] **T003** `[MODIFY]` `src/modules/accounts/services/users.service.spec.ts` — bổ sung test cho `listUsers` (thêm, KHÔNG phá test cũ). Mock repository `findAndCount` (kiểm `where` truyền vào + trả entities có `employeeCode`).
  - T1 search khớp `employeeCode` (mới): `where` chứa nhánh `employeeCode: ILike('%kw%')`; trả user có mã NV khớp.
  - T2 search khớp `fullName` (regression): nhánh fullName giữ nguyên.
  - T3 search khớp `email` (regression): nhánh email giữ nguyên.
  - T4 **chỉ trả ACTIVE** (không lộ INACTIVE/deleted): mọi phần tử mảng `where` đều chứa `deletedAt: IsNull()` + `accountStatus: ACTIVE` (assert từng nhánh có baseWhere).
  - T5 output có `employeeCode`: `data[].employeeCode` = giá trị entity; `select` chứa `employeeCode: true`.
  - T6 user `employee_code=null` không khớp nhánh employeeCode: chỉ khớp nếu trùng fullName/email.
  - T7 phân trang giữ nguyên: `skip=(page-1)*limit`, `take=limit`, `total` từ findAndCount; sort `fullName ASC`.
  - T8 search rỗng/không truyền: `where = baseWhere` (không mảng OR) — hành vi cũ giữ nguyên.
  - **DoD**: T1–T8 pass; test cũ của `listUsers` vẫn pass; assert rõ nhánh employeeCode kèm baseWhere (T4) và map output (T5).

---

## Phase 4 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T003 → | T004 |

- [ ] **T004** Chạy cổng chất lượng trên file đã đụng (KHÔNG commit).
  1. **tsc**: `npx tsc --noEmit`. Kỳ vọng: 0 lỗi **mới** ở file production (service/dto).
  2. **eslint** file đã đụng (chạy `--fix` cho prettier): `user-list-item.dto.ts`, `users.service.ts`, `users.service.spec.ts`.
  3. **jest**: `npx jest src/modules/accounts`.
  4. **Baseline vs mới**: nếu nghi lỗi có sẵn → `git stash` chạy lại lấy baseline, `git stash pop`; chỉ xử lý lỗi **mới** do UC-13. Ghi rõ lỗi baseline vs mới kèm bằng chứng `git stash`.
  - **DoD**: production files (service/dto) **tsc & eslint sạch** (hoặc chỉ lỗi trùng pattern mock baseline đã chứng minh); jest `src/modules/accounts` **pass** (test `listUsers` cũ + T1–T8); lỗi còn lại chứng minh baseline; **KHÔNG commit**, **KHÔNG migration/seed/index**.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | MODIFY | `dto/user-list-item.dto.ts` | G2 field employeeCode (giữ field cũ) |
| T002 | MODIFY | `services/users.service.ts` | G1 nhánh employeeCode + `...baseWhere`; G2 select+map; không đổi baseWhere/sort/pagination |
| T003 | MODIFY | `services/users.service.spec.ts` | T1–T8 (đặc biệt T4 ACTIVE-only, T6 null) |
| T004 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Thực thi tuần tự T001 → T004, tuân thủ "⛔ KHÔNG được làm" (đặc biệt: additive, spread `...baseWhere` ở nhánh employeeCode, không sửa controller/permission/query DTO, không scope/filter/migration/index/audit).
