# DEPT-UPD-001 — tasks.md (BE-08: PATCH /departments/:id)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | Tạo tasks, code xong cùng lượt. | Toàn bộ |

## T1 — DTO `UpdateDepartmentDto` (code) — plan §2
- **AC**: 5 field optional, không có `departmentCode`, `NoEmojiOrControlConstraint` áp cho `departmentName`.

## T2 — Service `updateDepartment` + `wouldCreateCycle` (code) — plan §3
- **AC**: đủ 9 nhánh lỗi/thành công liệt kê ở spec §4 (R1→R9).

## T3 — Controller `PATCH :id` (code) — plan §4
- **AC**: route đăng ký đúng, guard/permission đúng, `forbidNonWhitelisted` chặn `departmentCode` lạ.

## T4 — Migration seed permission (code) — plan §5
- **AC**: idempotent, role đúng `department.create` (`MANAGER`, `SYSTEM_ADMIN`).

## T5 — Test (code) — plan §6
- **AC**: `npx jest departments` 34/34 xanh; coverage ≥80% (đạt 87.14%/86.77%).

## T-GATE
- `tsc --noEmit` sạch; test xanh; coverage đạt; KHÔNG chạy migration lên RDS chung (chờ review, đúng tiền lệ P0).
