# Research: List Meeting Minutes (UC-MKM-02)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo research cho feat-list-meeting-minutes | Toàn bộ file |

## 1. Câu hỏi cần giải quyết trước khi plan

### 1.1 Có cần bảng/cột mới không?
**Không.** Toàn bộ dữ liệu cần thiết đã có trong `meeting_minutes` (status, visibility_level, prepared_by, meeting_id, title, version_no, created_at), `meetings` (host_id, room_id, title, actual_start_time, actual_end_time, meeting_mode), `meeting_participants` (meeting_id, user_id), `rooms` (room_name), `users` (full_name, email).

### 1.2 Module `minutes` hiện có gì?
Đã có `MinutesModule` (import AccountsModule, MeetingsModule, RecordingModule, TranscriptionModule, AuthModule), `MinutesController` (chỉ có `POST /meetings/:meetingId/minutes` — tạo draft), `MinutesService` (chỉ có `createDraft()`). Feature này thêm method mới `findMinutesList()` vào `MinutesService` và một controller mới `MeetingMinutesListController` (`GET /api/v1/meeting-minutes`), không sửa code hiện có của `createDraft`.

### 1.3 Mô hình quyền hiển thị dựa trên gì?
Kết luận sau khi đọc `feat-create-draft-meeting-minutes/spec.md` (FR-003) và entity `MeetingMinutesEntity`:
- `status=draft` luôn đi kèm `visibility_level=private` (ghi đè cứng lúc tạo, xem `minutes.service.ts` dòng 153). Không có feature nào khác từng set `visibility_level` khác `private`.
- Do đó, quyết định (đã thảo luận và chốt với người dùng): scope filtering dựa chính vào `status` + quan hệ host/participant của `meetings`/`meeting_participants`, KHÔNG dựa vào so sánh trực tiếp giá trị `visibility_level` (vì hiện tại chỉ có 1 giá trị thực tế: `private`). Field `visibility_level` vẫn được đọc và giữ lại cho tương lai (khi feature publish ra đời), nhưng logic scope hiện tại là fail-closed dựa trên `status`.

### 1.4 Làm sao xác định participant có quyền thấy biên bản published/archived?
`EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = meeting.id AND mp.user_id = :userId)` hoặc `meeting.host_id = :userId`. Pattern tương tự cách `feat-create-draft-meeting-minutes` đọc `meeting_participants` để snapshot attendees.

### 1.5 Pattern permission/guard nào đang dùng?
`JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('<code>')`, decorator `@CurrentUser()`. Đã xác nhận trong `minutes.controller.ts` (feature UC-MKM-01) và `meeting-requests.controller.ts` (feature tương tự — list).

### 1.6 Permission mới `meeting.minutes.read` seed ở đâu?
**Quan trọng**: Đã xác nhận qua research của `feat-create-draft-meeting-minutes` (mục 1.6) và qua đọc trực tiếp `src/database/migrations/20260629020000-SeedTranscriptionPermissions.ts` (dòng comment: *"Dùng migration (không dùng src/database/seeds/) vì seed-runner cho thư mục seeds/ chưa được wire vào đâu — migration là cơ chế seed duy nhất thực sự chạy được."*).

Do đó feature này seed permission bằng **TypeORM migration** (`src/database/migrations/`), theo đúng pattern `SeedTranscriptionPermissions20260629020000` (class implements `MigrationInterface`, có `up()`/`down()`), KHÔNG dùng `src/database/seeds/` như file `20260702000001-SeedMeetingMinutesCreatePermission.ts` đã làm (file đó tồn tại nhưng KHÔNG được chạy tự động — đã xác nhận, không có seed-runner).

Roles được gán quyền `meeting.minutes.read`: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đồng nhất với permission `meeting.minutes.create` đã seed cho UC-MKM-01).

### 1.7 Pagination: dùng max 100 (convention chung) hay max 20 (BR2 riêng)?
UC-MKM-02 có Business Rule riêng (BR2): "tối đa 20 bản ghi trên một trang" — cụ thể hơn convention chung của dự án (max 100, xem CLAUDE.md mục 8.4). Theo thứ tự ưu tiên tài liệu của AGENTS.md/CLAUDE.md (yêu cầu use case cụ thể được ưu tiên hơn convention chung), feature này dùng `max limit = 20`, default `limit = 20`, khác với các feature list khác trong dự án. Ghi rõ trong spec.md FR-006 để không gây nhầm lẫn khi review.

### 1.8 Response format chuẩn?
`{ success, message, data, meta }` cho thành công (list có pagination). Lỗi theo global exception filter hiện có (`NotFoundException`/`ForbiddenException`/`BadRequestException`/`UnprocessableEntityException` với payload `{ success: false, message, error: { code, details } }`).

### 1.9 Có cần audit log cho hành động đọc không?
Không — theo đúng quyết định đã áp dụng ở `feat-pending-meeting-requests` (NFR/FR riêng: "không ghi audit_log cho hành động đọc dữ liệu").

## 2. Rủi ro & quyết định thiết kế

| Rủi ro | Quyết định |
| :--- | :--- |
| Scope logic phức tạp (draft riêng tư + published/archived theo participant + admin bypass) dễ viết sai, rò rỉ dữ liệu | Viết scope thành 1 khối `Brackets` rõ ràng trong QueryBuilder, có unit test riêng cho từng nhánh role (AC-001 → AC-005) |
| `visibility_level = department`/`public_internal` chưa có producer nhưng field đã tồn tại trong entity | Fail-closed: coi như `participants` (chỉ host/participant thấy) cho đến khi có feature publish định nghĩa rõ, ghi rõ trong spec.md mục 1.5 |
| Giới hạn pagination khác với convention chung (20 vs 100) | Tuân theo BR2 của UC-MKM-02 vì đây là yêu cầu cụ thể hơn, ghi rõ lý do trong spec/plan để tránh bị coi là bug khi review |
| N+1 query khi load meeting + room + host + participant check | Dùng 1 QueryBuilder với LEFT JOIN + EXISTS subquery cho participant check, không query riêng lẻ trong loop |
| Seed permission mới trùng lặp cách làm (seeds/ vs migrations/) | Dùng migrations/ (cách duy nhất thực sự chạy), không tạo thêm file trong seeds/ để tránh gây hiểu lầm có 2 cơ chế song song |

## 3. Kết luận
Không có unknown nào chặn việc viết plan.md. Tiến hành Phase 1.
