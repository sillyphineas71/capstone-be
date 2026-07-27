# USR-EXP-001 — tasks.md (BE-04: GET /users/export, trả file trực tiếp)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | **[Đợt sửa lại]** Viết lại T2, T4, T6→bỏ, T7→bỏ, T8→bỏ, T9, T11, T-GATE theo `PLAN_THUC_THI_BE04_SUA_LAI_2026-07-27.md` (24 task, 6 pha). | T2, T4, T6, T7, T8, T9, T11, T-GATE |
| 2026-07-27 | Tạo tasks, code xong cùng lượt. | Toàn bộ |

## T1 — Xác minh không vòng lặp import (không code) — spec §6
- **AC**: `grep` xác nhận `AuthModule`/`AnalyticsModule`/`StorageModule`/`GateAccessModule` không import `AccountsModule`; `tsc --noEmit` sạch. (Không đổi — vẫn đúng ở luồng mới vì `ReportsModule` vẫn được `AccountsModule` import để lấy `UserExportService`.)

## T2 — ~~Job name constant~~ — đã XOÁ (code) — plan §1
- **AC**: `USER_EXPORT_JOB_NAME` không còn tồn tại trong `report-export-job.constants.ts`. `grep -r USER_EXPORT_JOB_NAME src/` → 0 kết quả.

## T3 — DTO `ExportUsersQueryDto` (code) — plan §2
- **AC**: 4 field đúng field FE thật gửi (`UserManagement.jsx:360-365`), `locked` transform string→boolean đúng. Không đổi so với đợt trước.

## T4 — `UserExportService.exportUsersXlsx()` (viết lại) — plan §3
- **AC**: gọi `UserExportDataService.listUsersForExport(filter)` đúng filter; trả `{buffer, fileName}`; `fileName` đúng định dạng `danh-sach-nguoi-dung-YYYYMMDD-HHmmss.xlsx`; audit log `entityType='users'` best-effort (lỗi audit không chặn response).

## T5 — `UserExportDataService` (không đổi) — plan §4
- **AC**: filter đúng, không lấy `passwordHash`, batch roles không N+1, LIMIT trần. Giữ nguyên 9 test cũ.

## T6 — Renderer XLSX (không đổi) — plan §5
- **AC**: render đúng field, mirror style renderer khác. Giữ nguyên chữ ký, dùng lại y nguyên trong luồng đồng bộ.

## T7 — ~~`UserExportWorkerProcessor`~~ — đã XOÁ (code) — plan §6
- **AC**: file `processors/user-export-worker.processor.ts` và `tests/user-export-worker.processor.spec.ts` không còn tồn tại. `grep -r UserExportWorkerProcessor src/` → 0 kết quả.

## T8 — ~~Dispatch nhánh `export:users`~~ — đã GỠ (code) — plan §7
- **AC**: `meeting-activity-report-worker.processor.ts` không còn nhánh `if (job.name === 'export:users')`, không còn import/DI `UserExportWorkerProcessor`. 4 nhánh dispatch còn lại (`room-utilization`/`gate-access`/`vehicle`/`security-alert`) không bị ảnh hưởng — xác nhận bằng cách chạy riêng `npx jest src/modules/reports` (168 test qua, không suite nào regress).

## T9 — Module + Controller wiring (sửa) — plan §8
- **AC**: `reports.module.ts` không còn đăng ký `UserExportWorkerProcessor` (vẫn export `UserExportService`); `users.controller.ts` route `GET /users/export` trả `200` + set `Content-Type`/`Content-Disposition` + `res.send(buffer)`, không còn `@HttpCode(HttpStatus.ACCEPTED)`; route order `export` vẫn đứng trước `:userId`.

## T10 — Migration (không đổi) — plan §9
- **AC**: `20260727000005-SeedUserExportPermission.ts` giữ nguyên, idempotent, role đối chiếu đúng `accounts.user.import`. Không tạo/xoá migration nào khác.

## T11 — Test (viết lại + bù test) — plan §10
- **AC**: `user-export.service.spec.ts` viết lại 10 test (5 rewrite + 5 bù cho `user-export-worker.processor.spec.ts` đã xoá); `users.controller.spec.ts` assert response mới; `meeting-activity-report-worker.processor.spec.ts` 1-đổi-1 test dispatch → test "không còn dispatch"; `npx jest src/modules/accounts src/modules/reports` xanh (168 test); `npm test` toàn repo: fail vẫn 114, tổng test không giảm so với baseline trước đợt sửa.

## T-GATE
- `tsc --noEmit -p tsconfig.build.json` sạch; `eslint --no-fix` các file đã sửa 0 lỗi mới; `npm test` fail vẫn 114/tổng không giảm; KHÔNG chạy migration lên RDS chung; **KHÔNG commit** — gửi Hải review cả lô trước khi merge (khác đợt trước: KHÔNG còn phụ thuộc Nam sửa FE trước khi deploy, vì luồng mới khớp lại đúng FE cũ).
