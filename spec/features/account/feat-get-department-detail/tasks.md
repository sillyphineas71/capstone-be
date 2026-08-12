# ACCT-DEPT-DETAIL-001 — tasks.md (GET /departments/:id)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | **T6 (mới) hoàn thành**: bổ sung `memberCount` vào `DepartmentResponseDto`, áp dụng cho mọi endpoint department (list/detail/create/update/deactivate/reactivate) — xem spec.md §11. Thêm 7 test case mới (memberCount cho create/list×2/getById/update/deactivate/reactivate), mở rộng mock `userRepo` (thêm `count`, `createQueryBuilder`). 81/81 test xanh, tsc sạch, lint sạch (không phát sinh lỗi mới, đối chiếu baseline trước/sau bằng git stash). | T6 (mới) |
| 2026-08-12 | T5 hoàn thành sau code review: `tsc --noEmit` sạch, `jest` xanh (78/78 test của cả 2 feature), `eslint` sạch cho toàn bộ file mới/sửa (đã tự fix 1 lỗi `no-unsafe-assignment` mới phát sinh trong `departments.controller.spec.ts` — dùng `as unknown as Request` thay vì `as any`). Coverage % không đọc được do lỗi công cụ môi trường (istanbul/v8 provider đều trả 0% dù test chạy đúng) — không liên quan tới code, không chặn merge. | T5 |
| 2026-08-12 | Khởi tạo tasks. | Toàn bộ file |

## T1 — Service `getDepartmentById(id)` (code) — plan §4
- **AC**: tìm thấy → `DepartmentResponseDto`; không thấy/đã xoá mềm → `NotFoundException DEPARTMENT_NOT_FOUND`; `isActive=false` vẫn trả về.

## T2 — Controller `GET :id` (code) — plan §5
- **AC**: route đăng ký đúng, không xung đột với `GET :id/members`; guard/permission `department.read` đúng; `ParseUUIDPipe` chặn id sai định dạng.

## T3 — Unit test service (code) — plan §6
- **AC**: đủ 3 nhánh (found / not-found / soft-deleted) + case `isActive=false`.

## T4 — Controller test (code) — plan §6
- **AC**: 200 đúng shape, 404, 403 (thiếu permission), 400 (uuid sai).

## T5 — Verification (code) — ✅ HOÀN THÀNH 2026-08-12
- **AC**: `npx tsc --noEmit -p tsconfig.build.json` sạch; `npx jest departments` xanh; `npm run lint` sạch.
- **Kết quả**: tsc sạch. Jest 78/78 xanh (3 suite: `departments.service.spec.ts`, `departments.controller.spec.ts`, `update-department.dto.spec.ts` — file mới tạo thêm trong lúc review để lấp lỗ hổng test AC-010, xem feat-deactivate-department/tasks.md T6). Lint sạch cho mọi file mới/sửa của cả 2 feature.

## T6 — Bổ sung `memberCount` (code) — spec §11 — ✅ HOÀN THÀNH 2026-08-12
- **AC**: `DepartmentResponseDto.memberCount` xuất hiện đúng giá trị ở cả 6 endpoint (list/detail/create/update/deactivate/reactivate) theo đúng bảng "cách tính" ở spec §11.2; không N+1 query ở `listDepartments` (đúng 1 query GROUP BY/trang); không query thừa khi list rỗng.
- **Kết quả**: `department-response.dto.ts` +1 field; `departments.service.ts` +2 helper (`countActiveMembers`, `countActiveMembersBatch`) + sửa 6 call site; test mở rộng mock `userRepo`/`userQueryBuilder`, thêm 7 test case (2 cho list, 1 mỗi cho create/getById/update/deactivate/reactivate). 81/81 xanh.

## T-GATE — ✅ ĐẠT
- Build/lint/test xanh (81/81); KHÔNG đổi hành vi các endpoint `departments` hiện có ngoài phạm vi đã spec (chỉ CỘNG THÊM field `memberCount`, không đổi field nào khác); không cần migration (permission tái dùng, không đổi schema).

## Requirements Coverage
| FR / AC | Task |
|---|---|
| FR-001, FR-002, FR-005 | T1, T3 |
| FR-003 / AC-003, AC-004 | T1, T3, T4 |
| FR-004 / AC-005 | T2, T4 |
| FR-006 / AC-006 | T2, T4 |
| AC-001, AC-002 | T1, T3 |
| AC-007 (10 field, gồm memberCount) | T1, T3, T6 |
