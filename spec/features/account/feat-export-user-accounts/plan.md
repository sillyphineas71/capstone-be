# USR-EXP-001 — plan.md (BE-04: GET /users/export, trả file trực tiếp)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | **[Đợt sửa lại]** Đảo ngược khỏi background job — viết lại toàn bộ §1, §3, §6 (bỏ), §7 (bỏ), §8, §10, §11 theo `PLAN_THUC_THI_BE04_SUA_LAI_2026-07-27.md`. Xem [spec.md](./spec.md) CHANGELOG cùng ngày. | §1, §3, §6, §7, §8, §10, §11 |
| 2026-07-27 | Tạo plan cùng lượt với spec + code. | Toàn bộ |

> Spec: [spec.md](./spec.md). Luồng mới: controller gọi thẳng `UserExportService.exportUsersXlsx()` (render đồng bộ trong request) — KHÔNG còn tạo job/enqueue/worker/`media_files` cho export user. 5 report khác (`meeting-activity`/`room-utilization`/`gate-access`/`vehicle`/`security-alert`) vẫn đi theo job + poll như cũ, không đổi.

## 1. File

```
src/modules/reports/constants/report-export-job.constants.ts       (sửa — XOÁ USER_EXPORT_JOB_NAME)
src/modules/accounts/dto/export-users-query.dto.ts                 (giữ nguyên)
src/modules/reports/services/user-export.service.ts                (viết lại — bỏ createExportJob, thêm exportUsersXlsx, + .spec.ts viết lại)
src/modules/reports/services/user-export-data.service.ts           (giữ nguyên, + .spec.ts giữ nguyên)
src/modules/reports/renderers/user-export-xlsx-renderer.ts         (giữ nguyên)
src/modules/reports/processors/user-export-worker.processor.ts     (XOÁ FILE)
src/modules/reports/tests/user-export-worker.processor.spec.ts     (XOÁ FILE)
src/modules/reports/processors/meeting-activity-report-worker.processor.ts (sửa — xoá đúng 3 chỗ 'export:users': import, DI, nhánh dispatch)
src/modules/reports/tests/meeting-activity-report-worker.processor.spec.ts (sửa — xoá mock/DI UserExportWorkerProcessor, thay test dispatch bằng test "không còn dispatch")
src/modules/reports/reports.module.ts                              (sửa — xoá đăng ký UserExportWorkerProcessor, giữ UserExportService/UserExportDataService)
src/modules/accounts/accounts.module.ts                            (giữ nguyên — vẫn cần import ReportsModule)
src/modules/accounts/controllers/users.controller.ts               (sửa — bỏ 202/HttpCode ACCEPTED, thêm @Res, res.send(buffer))
src/modules/accounts/controllers/users.controller.spec.ts          (sửa — mock exportUsersXlsx, assert 2 header + res.send)
src/database/migrations/20260727000005-SeedUserExportPermission.ts (giữ nguyên — không có migration nào khác cần bỏ)
```

## 2. DTO — `ExportUsersQueryDto`

Không đổi so với đợt trước: `search?`, `departmentId?` (UUID), `roleId?` (UUID), `locked?` (boolean, `@Transform` string→boolean). Xem spec §2.

## 3. Service — `UserExportService.exportUsersXlsx(currentUser, dto)`

`userExportDataService.listUsersForExport(filter)` → `renderUserExportXlsx(rows, {generatedAt, extractedByEmail})` → tên file `danh-sach-nguoi-dung-YYYYMMDD-HHmmss.xlsx` (timestamp tránh cache trình duyệt đè) → audit log best-effort (`.catch` log warn, không throw, không chặn response) → trả `{ buffer, fileName }`. KHÔNG còn DI `BackgroundJobsService`/`QueueService`.

## 4. Data Service — `UserExportDataService.listUsersForExport(filter)`

Không đổi. QueryBuilder trên `UserEntity`: `deletedAt IS NULL` + `departmentId`/`accountStatus` (map từ `locked`)/`roleId` (subquery `user_roles`)/`search` (ILIKE fullName/email/employeeCode). SELECT tường minh (không `passwordHash`). `ORDER BY fullName ASC`, `LIMIT 10000`. Batch roles 1 query duy nhất.

## 5. Renderer — `renderUserExportXlsx`

Không đổi. Mirror `renderGateAccessXlsx`: 1 sheet, header tổng hợp, 1 dòng/user.

## 6. ~~Worker~~ — đã xoá

`UserExportWorkerProcessor` không còn tồn tại. Không có worker nào xử lý export user nữa — toàn bộ chạy trong `UserExportService.exportUsersXlsx()` ngay tại request.

## 7. ~~Dispatch~~ — đã gỡ khỏi `meeting-activity-report-worker.processor.ts`

Nhánh `if (job.name === 'export:users')` đã bị xoá. `MeetingActivityReportWorkerProcessor` vẫn là `@Processor(REPORT_EXPORT_QUEUE_NAME)` duy nhất, dispatch cho 4 report còn lại (`room-utilization`/`gate-access`/`vehicle`/`security-alert`) — 4 nhánh này **không bị đụng**.

## 8. Module wiring

- `reports.module.ts`: xoá import + đăng ký `UserExportWorkerProcessor` khỏi `providers`. Giữ `UserExportService`, `UserExportDataService`, `exports: [UserExportService]`. `UserRoleEntity` trong `TypeOrmModule.forFeature` vẫn cần (dùng bởi `UserExportDataService`).
- `accounts.module.ts`: không đổi — vẫn import `ReportsModule` để lấy `UserExportService`.
- `users.controller.ts`: bỏ `@HttpCode(HttpStatus.ACCEPTED)`, thêm tham số `@Res() res: Response`, kiểu trả `Promise<void>`, set `Content-Type`/`Content-Disposition` rồi `res.send(buffer)` — mirror pattern `downloadImportTemplate` (`users.controller.ts:138`) đã có sẵn trong cùng file.

## 9. Migration — seed permission

Không đổi. `20260727000005-SeedUserExportPermission.ts` — `accounts.user.export`, role đối chiếu `accounts.user.import`: `BUSINESS_ADMIN`, `SYSTEM_ADMIN`. Không có migration nào khác (bảng/job riêng) cần bỏ — luồng job cũ dùng lại hạ tầng `background_jobs`/`media_files` chung, không có bảng riêng.

## 10. Test (mock — KHÔNG DB, KHÔNG Redis/BullMQ thật)

- `user-export.service.spec.ts` (viết lại, 10 test — bù đủ số test mất do xoá `user-export-worker.processor.spec.ts`): gọi đúng filter, buffer khác rỗng, fileName đúng định dạng, audit log đúng entityType='users'+metadata, audit lỗi không chặn response, filter rỗng vẫn ra file, 0 user vẫn ra file, rowCount đúng, buffer là XLSX thật (magic bytes `PK`), lỗi data service bị ném lên không nuốt.
- `user-export-data.service.spec.ts`: không đổi (9 test, giữ nguyên 100% đúng).
- ~~`user-export-worker.processor.spec.ts`~~: đã xoá cùng file nguồn.
- `meeting-activity-report-worker.processor.spec.ts`: xoá mock/DI `UserExportWorkerProcessor`, thay test "dispatches export:users" bằng test xác nhận job.name='export:users' giờ rơi qua im lặng (không dispatch đi đâu, không markRunning) — 1-đổi-1, không đổi tổng số test của file.
- `users.controller.spec.ts`: assert `res.setHeader` gọi đúng 2 header (`Content-Type`, `Content-Disposition`) + `res.send(buffer)`, không còn assert `{jobId}`.

Tổng số test toàn repo: không đổi so với trước đợt sửa (114 fail baseline, 3779 tổng — đối chiếu `npm test` trước/sau khớp chính xác).

## 11. Gate

`npx tsc --noEmit -p tsconfig.build.json` sạch; `npx eslint --no-fix` các file đã sửa — 0 lỗi mới (lỗi lint đã tồn tại từ trước ở các dòng không liên quan không tính); `npm test` toàn repo — fail vẫn 114, tổng test không giảm; KHÔNG commit, KHÔNG chạy migration lên RDS — gửi Hải review cả lô trước.
