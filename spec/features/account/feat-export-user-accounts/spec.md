# USR-EXP-001 — BE-04: Xuất danh sách người dùng (GET /users/export, trả file trực tiếp)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | **[Đợt sửa lại, theo `PLAN_THUC_THI_BE04_SUA_LAI_2026-07-27.md`]** Đảo ngược quyết định "background job + poll" ở dòng log dưới — đổi lại thành **200 + trả file XLSX trực tiếp** (đúng luồng `blob` mà FE (`sysAdminServices.js:338`/`businessAdminServices.js:120`) đã và vẫn đang gọi). Lý do: Nam (FE) là nút thắt để sửa `UserManagement.jsx` nhận `{jobId}` rồi poll — không cần thiết cho một export vốn nhanh (≤10.000 dòng). Cập nhật §1, §3, §4 (R1-R4), §5. FE (`request.js`) **vẫn phải** thêm nhánh `responseType: 'blob'` — đây là điểm Hải tự đính chính, không phải "FE khỏi sửa gì". | §1, §3, §4, §5 |
| 2026-07-27 | Tạo spec BE-04 (PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md §0.3, §1 quyết định #1, §5). Code + test xong cùng lượt. | Toàn bộ |

## 1. Bối cảnh — hợp đồng với FE: trả file trực tiếp (blob), KHÔNG background job

`sysAdminServices.js:338` và `businessAdminServices.js:120` gọi `GET /users/export` với `responseType: 'blob'` — mong đợi backend trả **binary file trực tiếp**. Đợt đầu (2026-07-27, dòng log dưới) đã từng chốt đi theo background job + poll (đúng ARCH-02, đồng bộ 5 report export sẵn có), nhưng **Hải đã đảo lại quyết định này cùng ngày** (`PLAN_PHAN_HOI_TAI_2026-07-27.md` mục 3): export user quay về **render đồng bộ, trả 200 + file XLSX trong body**, đúng luồng FE cũ đang gọi.

**Hệ quả cho FE:** Nam **vẫn phải** thêm nhánh `responseType: 'blob'` ở `request.js` (client HTTP dùng chung) cho route `GET /users/export` — KHÔNG phải "khỏi sửa gì" như cách hiểu ban đầu có thể gây nhầm. Không còn `{jobId}`, không còn poll `GET /background-jobs/:id` cho luồng này.

## 2. Filter — phát hiện khi code (lệch citation gốc của plan)

Plan gốc trích dẫn "tái dùng đúng field của `ListUsersQueryDto` (`users.service.ts:1669`)" — nhưng đọc code thật, `ListUsersQueryDto` (`list-users-query.dto.ts`) chỉ có `page/limit/search` (dùng cho endpoint autocomplete `GET /users`), **không khớp** filter thật FE gửi khi export.

Đọc trực tiếp `UserManagement.jsx:360-365` (hàm `handleExportExcel`) — FE gửi đúng 4 field: `search`, `roleId`, `departmentId`, `locked` (boolean tri-state, cùng field đang lọc trên màn ở `fetchUsers:99-104`). → `ExportUsersQueryDto` dựng theo 4 field THẬT này (mirror `ManageUsersQueryDto` về mặt logic filter, đổi `accountStatus` thành `locked` cho khớp FE) — không có `page`/`limit` (export lấy toàn bộ, có LIMIT trần an toàn ở data service, không phải phân trang).

## 3. Scope

### Trong scope
- `GET /api/v1/users/export?search=&departmentId=&roleId=&locked=` → **`200` + body là bytes file XLSX** (`Content-Type`/`Content-Disposition` set thủ công, không qua `media_files`/background job).
- `UserExportService.exportUsersXlsx()`: gọi `UserExportDataService.listUsersForExport()` → `renderUserExportXlsx()` → trả `{ buffer, fileName }` đồng bộ trong cùng request. Audit log best-effort (fail-soft), `entityType: 'users'`.
- `UserExportDataService.listUsersForExport()`: query theo filter, **KHÔNG** lấy `password_hash`/field nhạy cảm, LIMIT trần 10.000 dòng — **giữ nguyên, không đổi** (lý do trần vẫn còn: render đồng bộ trong request, không có worker chạy nền cho export lớn).
- `renderUserExportXlsx()`: **giữ nguyên**, không đổi chữ ký.
- Permission `accounts.user.export` (chỉ `BUSINESS_ADMIN`/`SYSTEM_ADMIN`, đối chiếu `accounts.user.import`).
- Route order: `@Get('export')` PHẢI đứng trước `@Get(':userId')` (không đổi so với đợt trước).

### Ngoài scope
- Sửa FE (`UserManagement.jsx`, `request.js`) — việc của Nam. Khác đợt trước: lần này **không chặn cứng deploy**, vì luồng mới khớp lại đúng những gì FE cũ vốn đã gọi.
- Department-scope restriction cho Business Admin (xem §5 residual — không đổi).
- PDF format — chỉ XLSX (đúng định dạng FE cũ mong đợi `.xlsx`).
- Background job/queue/`media_files` cho luồng export user — **đã bỏ hoàn toàn**, không phải thứ cần làm ở đợt này hay đợt sau trừ khi có yêu cầu mới.

## 4. Requirements (EARS)

- **R1**: **WHEN** gọi `GET /users/export` **→** hệ thống render XLSX đồng bộ trong cùng request (query → transform → workbook), trả `200` với `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` và `Content-Disposition: attachment; filename="danh-sach-nguoi-dung-<timestamp>.xlsx"`.
- **R2**: **WHEN** không có user nào khớp filter **→** vẫn trả `200` với file XLSX chỉ có header (KHÔNG lỗi) — mirror hành vi "rỗng vẫn hợp lệ" của 5 report khác.
- **R3**: **IF** lỗi xảy ra khi query hoặc render (DB lỗi, ExcelJS lỗi) **→** lỗi ném lên (throw), NestJS exception filter chuẩn xử lý (KHÔNG có khái niệm `markFailed`/background job cho luồng này nữa).
- **R4**: **WHERE** ghi audit log lỗi (best-effort) **→** KHÔNG chặn việc trả file — response vẫn `200` + file bình thường, chỉ `logger.warn` phía server.
- **R5**: **WHERE** người dùng KHÔNG có permission `accounts.user.export` **→** `403`.
- **R6**: **WHEN** route `GET /users/export` được đăng ký **→** PHẢI nằm TRƯỚC `GET /users/:userId` (path tĩnh trước path động), nếu không `:userId` sẽ nuốt `"export"` và cố parse thành UUID → `400`.

## 5. Constitution & Residuals

- **SEC-01**: `@RequirePermissions('accounts.user.export')`, `forbidNonWhitelisted: true`.
- **SEC-02 [§20.1]**: `UserExportDataService` SELECT tường minh, không bao giờ lấy `password_hash`. Không đổi.
- **Audit log**: `entityType` đổi từ `background_jobs` (đợt trước) → `users` (đợt này, không còn job). `actionType: 'export_users'` giữ nguyên, `metadataJson` gồm `filter` + `rowCount`.
- **[Residual]** KHÔNG áp dụng department-scope restriction như `listUsersForManagement` áp cho Business Admin không phải System Admin (giới hạn xem theo phòng ban quản lý). Export hiện chỉ gate ở permission — một Business Admin có `accounts.user.export` về lý thuyết export được TOÀN BỘ user, không chỉ phòng ban mình quản lý. Nếu cần siết theo scope, cần đợt riêng.
- **[Residual]** LIMIT trần 10.000 dòng — nếu tổ chức có nhiều hơn, export sẽ cắt bớt âm thầm (không báo lỗi). Chấp nhận cho quy mô capstone hiện tại; lý do trần càng rõ hơn ở đợt này vì render chạy đồng bộ ngay trong HTTP request, không có worker nền để xử lý khối lượng lớn.
- **Migration**: `20260727000005-SeedUserExportPermission.ts` (permission `accounts.user.export`) — **giữ nguyên**, không có migration nào khác cần bỏ (không có bảng/job riêng nào được tạo cho luồng cũ).

## 6. Hạ tầng job dùng chung của 5 report khác — KHÔNG bị đụng

`REPORT_EXPORT_QUEUE_NAME`, 4 job name còn lại (`export:meeting-activity`, `export:room-utilization`, `export:gate-access`, `export:vehicle`, `export:security-alert`), 4 worker processor tương ứng, `QueueService`, `BackgroundJobsService`, `MediaFileEntity`, `StorageService` — **không thay đổi gì** ở đợt sửa này. Chỉ gỡ đúng 3 chỗ liên quan `export:users` trong `MeetingActivityReportWorkerProcessor` (import, DI, nhánh dispatch `if (job.name === 'export:users')`), xoá `USER_EXPORT_JOB_NAME`, xoá `UserExportWorkerProcessor` (file + spec).
