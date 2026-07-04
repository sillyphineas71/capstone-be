# Feature Specification: Xem thống kê tỷ lệ cuộc họp bị hủy

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-07 / UC-154 Xem thống kê tỷ lệ cuộc họp bị hủy. Đã phân tích, liệt kê điểm mơ hồ, đề xuất phương án và được người dùng duyệt 4 quyết định chính (endpoint gộp vào UC-154, ranking theo organizer, 2 danh sách Top-10 riêng, bucket theo `start_time`) trước khi viết spec (xem §0 RECON). Các điểm mơ hồ nhỏ còn lại chốt theo phương án khuyến nghị (người dùng không phản đối). | Toàn bộ file |

---

- **Feature ID**: AA-MEETING-CANCEL-RATE-001
- **Feature Name**: Xem thống kê tỷ lệ cuộc họp bị hủy (View Meeting Cancel Rate)
- **Use Case**: UC-AA-07 Xem thống kê tỷ lệ cuộc họp bị hủy (= UC-154 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-07 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-154 (endpoint/response mẫu, **thiếu phần Top-10 ranking**)
  - `database_v3_2_compact_39_tables.md` — `meetings`, `users`, `departments`, `meeting_requests`
  - `src/modules/meetings/entities/meeting.entity.ts` — xác nhận field thật (`organizerId`, `status`, `cancellationReason`, không có `cancelledBy`)
  - `src/modules/meetings/services/meetings.service.ts:1971-2358` — xác nhận luồng cancel có 2 permission tách biệt `meeting.cancel.own`/`meeting.cancel.any`, actor hủy ghi vào `updated_by`/`meeting_events.actor_user_id`, không nhất thiết là organizer
  - `src/modules/accounts/entities/user.entity.ts` — xác nhận field `email`, `fullName`, `departmentId`
  - `spec/features/analytics/feat-view-meeting-status-breakdown/` (UC-AA-05) — tái dùng kết luận "Cancelled = status='cancelled' thuần túy, không UNION `meeting_requests`" (§0.4), pattern `departmentIds` multi-select
  - `spec/features/analytics/feat-view-meeting-count-by-period/` (UC-AA-04) — tái dùng pattern time-series bucket đủ (không rút gọn khi rỗng), `roomId` filter, scope Manager tĩnh
  - `spec/features/analytics/feat-view-meeting-average-duration/` (UC-AA-06) — tái dùng pattern tách `granularity` khỏi `preset`/`from`/`to`, `departmentIds` multi-select
  - `spec/features/analytics/feat-view-dashboard-overview/` (UC-AA-01) — tái dùng định nghĩa `meetingCount` (`status <> 'draft'`), config `analytics.dashboard_max_range_days`
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Khoảng trống lớn nhất: `API_CONTRACT` UC-154 không có Top-10 ranking

Response mẫu UC-154 gốc chỉ có `cancelledCount/totalMeetingCount/cancelRate/series[]`. Normal Flow bước 5 của UC-AA-07 (yêu cầu trực tiếp người dùng, ưu tiên cao nhất theo `CLAUDE.md` mục 1) yêu cầu thêm "Bảng xếp hạng cảnh báo — Top 10 nhân sự/phòng ban có số lượng và tỷ lệ hủy lịch cao nhất". **Quyết định đã duyệt**: không tách endpoint mới, mở rộng thẳng response UC-154 hiện có bằng 2 field mới `topOrganizers[]`, `topDepartments[]` — nhất quán cách đã xử lý bổ sung field ở UC-AA-01 (`activeUserCount`) và UC-AA-05 (nhóm `no_show`). Đề xuất đồng bộ lại `API_CONTRACT` ở task tài liệu riêng (§8.2).

### 0.2. Ranking theo organizer, không theo actor thực hiện hủy — đã duyệt

Đã xác nhận qua code ([meetings.service.ts:2000-2009](../../../../src/modules/meetings/services/meetings.service.ts)): việc hủy meeting dùng 1 trong 2 permission `meeting.cancel.own` (organizer tự hủy) hoặc `meeting.cancel.any` (approver/admin hủy hộ) — người bấm hủy **không nhất thiết** là organizer. `MeetingEntity` không có cột `cancelled_by` riêng, chỉ có `updated_by` (bị ghi đè bởi bất kỳ hành động update nào khác, không đáng tin cậy làm nguồn ranking) và `meeting_events.actor_user_id` (đúng nhưng phải JOIN thêm bảng event). **Quyết định đã duyệt**: bảng xếp hạng tính theo **organizer** (`meetings.organizer_id`) — tức "ai tạo nhiều lịch bị hủy nhất", không phải "ai bấm hủy nhiều nhất". Điều này khớp với chính bộ lọc "Email người tổ chức" đã có trong Normal Flow bước 3, và đúng mục tiêu nghiệp vụ BR1/Trigger: giám sát người tạo lịch kém hiệu quả.

### 0.3. Top-10 tách thành 2 danh sách độc lập — đã duyệt

**Quyết định đã duyệt**: `topOrganizers[]` (xếp hạng theo nhân sự, định danh bằng email) và `topDepartments[]` (xếp hạng theo phòng ban) là 2 danh sách tính độc lập, không gộp chung 1 bảng trộn 2 loại đối tượng.

### 0.4. Mốc thời gian nhóm bucket — dùng `start_time`, không dùng `created_at` — đã duyệt

Dù BR1 dùng chữ "khởi tạo" (dễ hiểu nhầm sang `created_at`), **quyết định đã duyệt**: dùng `meetings.start_time` để nhóm theo tuần/tháng và lọc `[from,to]`, nhất quán tuyệt đối với UC-AA-04/05/06 đã làm trước đó. `created_at` không được dùng ở bất kỳ đâu trong feature này.

### 0.5. Ngưỡng tối thiểu chống nhiễu ranking — đề xuất mới, người dùng không phản đối

BR/Exception gốc không đề cập ngưỡng mẫu tối thiểu. Nếu không giới hạn, 1 người chỉ tổ chức 1 lịch và bị hủy sẽ có `cancelRate=100%` và có thể lọt Top-10 dù không phản ánh đúng vấn đề thực tế. **Quyết định**: chỉ đưa vào `topOrganizers`/`topDepartments` những đối tượng có `organizedCount >= 3` trong kỳ lọc (hằng số cố định trong code, **không** tạo `system_configs` key mới — giữ đơn giản theo nguyên tắc CLAUDE.md, có thể nâng cấp thành config sau nếu cần).

### 0.6. Sắp xếp Top-10 theo `cancelledCount` trước, `cancelRate` sau

Để tránh 2 tiêu chí (số lượng vs tỷ lệ) cho 2 thứ tự khác nhau gây mơ hồ khi hiển thị 1 bảng duy nhất, **quyết định**: sort chính theo `cancelledCount` giảm dần, `cancelRate` dùng làm tie-breaker và hiển thị kèm — đúng nghĩa "cảnh báo" (nhiều lượt hủy tuyệt đối quan trọng hơn tỷ lệ trên mẫu nhỏ).

### 0.7. `topDepartments` rỗng khi role là MANAGER — đã duyệt

Theo BR1: Manager chỉ xem được phạm vi phòng ban mình quản lý (thường đúng 1 phòng ban) — xếp hạng "Top 10 phòng ban" không có ý nghĩa khi chỉ có 1 phần tử. **Quyết định**: khi `currentUser.role = MANAGER`, `topDepartments` luôn trả `[]`; chỉ `BUSINESS_ADMIN`/`SYSTEM_ADMIN` (xem toàn công ty) mới nhận `topDepartments` có dữ liệu.

### 0.8. Mẫu số "tổng số lịch" — tái dùng định nghĩa `meetingCount` của UC-AA-01

**Quyết định**: `totalMeetingCount` = đếm `meetings` có `status <> 'draft'` trong scope + filter + `[from,to]` (theo `start_time`) — tái dùng đúng định nghĩa đã chốt ở [feat-view-dashboard-overview/spec.md FR-026](../feat-view-dashboard-overview/spec.md). Loại `draft` vì chưa được xem là "lịch trình được khởi tạo thành công" (còn là bản nháp).

### 0.9. "Cancelled" — tái dùng nguyên kết luận đã chốt ở UC-AA-05

Đã xác nhận qua [feat-review-meeting-request/spec.md:144](../../../../spec/features/meeting/feat-review-meeting-request/spec.md) và [feat-view-meeting-status-breakdown/spec.md §0.4](../feat-view-meeting-status-breakdown/spec.md): khi approver reject, `meetings.status` chuyển thẳng sang `cancelled` — cả "chủ động hủy" và "bị từ chối phê duyệt" đã hội tụ về cùng 1 giá trị. **Quyết định**: chỉ lọc `status='cancelled'`, không cần UNION với `meeting_requests`.

### 0.10. Preset khoảng thời gian mở rộng — `month_previous`, `quarter`

Normal Flow bước 3 nêu ví dụ "Tháng trước, Quý 1, phạm vi tùy chỉnh" — khác enum `day/week/month/custom` đã dùng ở UC-AA-02/05. **Quyết định**: `preset IN ('month_current', 'month_previous', 'quarter', 'custom')`, mặc định `month_current`. `quarter` hiểu là quý dương lịch hiện tại (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec) tính theo thời điểm gọi API — không hỗ trợ chọn quý tùy ý trong quá khứ qua `preset`, nếu cần dùng `preset=custom`.

### 0.11. `granularity` tách biệt khỏi `preset` — tái dùng pattern UC-AA-06

**Quyết định**: `granularity IN ('week', 'month')`, mặc định `week`, độc lập với `preset`/`from`/`to` (đúng pattern đã chốt ở [feat-view-meeting-average-duration/spec.md §0.6](../feat-view-meeting-average-duration/spec.md)).

### 0.12. Bộ lọc "Email người tổ chức" — resolve server-side, không bắt FE biết UUID

**Quyết định**: nhận `organizerEmail` (string) ở query, backend tự resolve ra `users.id` bằng so khớp chính xác không phân biệt hoa/thường (`LOWER(email) = LOWER(:organizerEmail)`). Nếu không tìm thấy user nào khớp, coi như filter không match bất kỳ meeting nào (trả EX1), không phải lỗi 400/404.

### 0.13. Bộ lọc phòng ban/phòng họp — tái dùng pattern đã có

`departmentIds` (mảng UUID, tái dùng UC-AA-05/06), `roomId` (UUID đơn, tái dùng UC-AA-04/06) — filter thuần túy áp dụng sau scope theo role.

### 0.14. Bucket rỗng và EX1 — tái dùng pattern UC-AA-04

**Quyết định**: `series` luôn đủ bucket trong `[from,to]` theo `granularity` (kể cả bucket `totalCount=0`), không rút gọn mảng khi rỗng. Khi toàn bộ dải không có meeting nào (`totalMeetingCount=0`): `series` đủ bucket với giá trị 0, `topOrganizers=[]`, `topDepartments=[]`, kèm `message` mô tả EX1 ("Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại").

### 0.15. Field/entity xác nhận tồn tại thật (không suy đoán)

- `MeetingEntity`: `id, organizerId, roomId, status, startTime, cancellationReason, updatedBy, deletedAt`. **Không có `cancelledBy`/`cancelledAt` riêng.**
- `UserEntity`: `id, email, fullName, departmentId`.
- `DepartmentEntity`: `id, departmentName, managerUserId`.
- `SystemConfigEntity` — tái dùng key `analytics.dashboard_max_range_days` đã tạo ở UC-AA-01, không tạo key mới.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, cung cấp biểu đồ xu hướng (line/bar chart) tỷ lệ cuộc họp bị hủy theo thời gian, kèm bảng xếp hạng cảnh báo Top 10 nhân sự/phòng ban có số lượng và tỷ lệ hủy lịch cao nhất, phục vụ Manager/Business Admin giám sát chất lượng lập lịch. Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phòng ban phụ trách), Business Admin, System Admin xem xu hướng tỷ lệ hủy lịch theo tuần/tháng và danh sách cảnh báo nhân sự/phòng ban có tỷ lệ hủy cao bất thường, lọc theo khoảng thời gian/phòng ban/phòng họp/email người tổ chức.

### 1.3 Giá trị mang lại

- Cho Manager: phát hiện nhân sự trong phòng ban mình có xu hướng đặt lịch rồi hủy nhiều, chấn chỉnh quy trình đặt lịch.
- Cho Business Admin/System Admin: giám sát chất lượng lập lịch toàn công ty theo phòng ban, phát hiện bất thường theo mùa vụ/kỳ.

### 1.4 Giả định

- "Cancelled" = `status='cancelled'` thuần túy, đã hội tụ 2 nguồn (chủ động hủy + reject phê duyệt) — §0.9.
- Mẫu số `totalMeetingCount` loại `draft` — §0.8.
- Bucket theo `start_time`, không dùng `created_at` — §0.4.
- Top-10 tính theo `organizer`, có ngưỡng tối thiểu 3 lịch/kỳ để vào bảng — §0.2, §0.5.
- `topDepartments` rỗng với role MANAGER — §0.7.
- `preset` mặc định `month_current`, `granularity` mặc định `week`, độc lập nhau.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (4 quyết định chính về endpoint/ranking-basis/cấu trúc Top-10/mốc thời gian, cùng các phương án khuyến nghị còn lại không bị phản đối) — tổng hợp tại §0.1–§0.14.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem xu hướng + Top-10 nhân sự giới hạn trong phòng ban mình phụ trách (`topDepartments` luôn rỗng) |
| Business Admin | Quản trị viên doanh nghiệp | Xem xu hướng + Top-10 nhân sự/phòng ban toàn công ty, lọc theo `departmentIds` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (nhất quán UC-AA-04/05/06 — API_CONTRACT UC-154 không liệt kê tường minh nhưng theo pattern đặc quyền cao nhất đã áp dụng) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `analytics.meeting.read` (dùng chung UC-AA-04/05/06, đã seed).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope; `departmentIds` là filter thuần túy; nhận đủ `topOrganizers`+`topDepartments`.
- `MANAGER`: scope = phòng ban `departments.manager_user_id = currentUser.id` (tĩnh). Mọi phần tử `departmentIds` phải thuộc scope, nếu không → 403 `DEPARTMENT_OUT_OF_SCOPE`. Nhận `topOrganizers` giới hạn trong scope, `topDepartments=[]` luôn luôn (§0.7).

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.meeting.read`.
- Scope Manager dùng `departments.manager_user_id`, không rollup phòng ban con (nhất quán UC-AA-01/04/05/06).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `meetings`, `users`, `departments`.

FR-002: THE system SHALL tính toán lại toàn bộ `totalMeetingCount`/`cancelledCount`/`cancelRate`/`series`/`topOrganizers`/`topDepartments` trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API.

FR-003: THE system SHALL xác định 1 meeting là "bị hủy" khi và chỉ khi `status='cancelled'` (đã hội tụ chủ động hủy + reject phê duyệt — §0.9), không UNION với `meeting_requests`.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/meetings/cancel-rate, THE system SHALL kiểm tra authentication và permission `analytics.meeting.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `preset`/`from`/`to`, THE system SHALL áp dụng mặc định `preset='month_current'` (Tháng hiện tại, timezone `Asia/Ho_Chi_Minh`).

FR-006: WHEN người dùng truyền `preset IN ('month_current','month_previous','quarter')`, THE system SHALL tự tính `from`/`to` tương ứng (tháng hiện tại / tháng trước / quý dương lịch hiện tại), bỏ qua `from`/`to` nếu có truyền kèm.

FR-007: WHEN người dùng truyền `preset='custom'` kèm `from`/`to` hợp lệ, THE system SHALL dùng đúng khoảng đó.

FR-008: WHEN người dùng không truyền `granularity`, THE system SHALL mặc định `granularity='week'`.

FR-009: WHEN người dùng truyền `granularity IN ('week','month')`, THE system SHALL nhóm `series` theo đúng đơn vị đó.

FR-010: WHEN currentUser có role MANAGER và không truyền `departmentIds`, THE system SHALL tự động giới hạn dữ liệu trong toàn bộ phòng ban mình quản lý.

FR-011: WHEN currentUser có role MANAGER và truyền `departmentIds` mà mọi phần tử thuộc phòng ban mình quản lý, THE system SHALL lọc đúng các phòng ban đó.

FR-012: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `departmentIds`, THE system SHALL lọc theo đúng các phòng ban đó trong toàn hệ thống (không kiểm tra sở hữu).

FR-013: WHEN người dùng truyền `roomId`, THE system SHALL lọc chỉ còn các `meetings` có `room_id` tương ứng.

FR-014: WHEN người dùng truyền `organizerEmail`, THE system SHALL resolve ra `users.id` bằng so khớp chính xác không phân biệt hoa/thường, sau đó lọc `meetings.organizer_id` tương ứng.

### 3.3 State-driven Requirements

FR-015: WHILE tổ hợp filter không có `meetings` nào (`status <> 'draft'`) trong `[from,to]`, THE system SHALL trả `totalMeetingCount=0`, `cancelledCount=0`, `cancelRate=0`, `series` đủ bucket với giá trị 0, `topOrganizers=[]`, `topDepartments=[]`, kèm `message` mô tả không tìm thấy dữ liệu (EX1).

FR-016: WHILE 1 organizer hoặc 1 phòng ban có `organizedCount < 3` trong kỳ lọc, THE system SHALL loại đối tượng đó khỏi `topOrganizers`/`topDepartments` (ngưỡng chống nhiễu — §0.5).

FR-017: WHILE currentUser có role MANAGER, THE system SHALL luôn trả `topDepartments=[]` bất kể dữ liệu (§0.7).

FR-018: WHILE `organizerEmail` được truyền nhưng không khớp bất kỳ `users.email` nào, THE system SHALL coi như filter không match meeting nào và trả response theo FR-015 (không phải lỗi 400/404).

### 3.4 Optional Feature Requirements

FR-019: WHERE `departmentIds` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

FR-020: WHERE `roomId`/`organizerEmail` được cung cấp, THE system SHALL áp dụng như filter bổ sung độc lập với scope phòng ban.

### 3.5 Unwanted Behavior Requirements

FR-021: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-022: IF người dùng không có permission `analytics.meeting.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-023: IF currentUser có role MANAGER và bất kỳ phần tử nào trong `departmentIds` nằm ngoài phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-024: IF `preset` không thuộc {month_current, month_previous, quarter, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-025: IF `preset='custom'` nhưng thiếu `from`/`to`, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-026: IF `granularity` không thuộc {week, month}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-027: IF bất kỳ phần tử nào trong `departmentIds`, hoặc `roomId`, không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-028: IF `organizerEmail` không đúng định dạng email, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-029: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-030: WHEN the user performs a protected action (xem thống kê tỷ lệ hủy), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-031: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban cho mọi truy vấn `meetings`/`users`/`departments`.

### 3.7 Data & State Requirements

FR-032: WHEN tính `totalMeetingCount`, THE system SHALL đếm số `meetings` có `status <> 'draft'` trong scope + filter + `[from,to]` (theo `start_time`) — tái dùng định nghĩa `meetingCount` của UC-AA-01.

FR-033: WHEN tính `cancelledCount`, THE system SHALL đếm số `meetings` thỏa FR-032 và có `status='cancelled'`.

FR-034: WHEN tính `cancelRate`, THE system SHALL tính `cancelledCount ÷ totalMeetingCount × 100`, làm tròn 1 chữ số thập phân. Nếu `totalMeetingCount=0`, trả `cancelRate=0`.

FR-035: WHEN tính `series`, THE system SHALL nhóm `meetings` thỏa FR-032 theo `start_time` vào từng bucket `granularity` (tuần ISO hoặc tháng dương lịch), trả về đủ mọi bucket trong `[from,to]` theo thứ tự thời gian tăng dần (kể cả bucket `totalCount=0`), mỗi bucket có `{period, totalCount, cancelledCount, cancelRate}`.

FR-036: WHEN tính `topOrganizers`, THE system SHALL nhóm `meetings` thỏa FR-032 theo `organizer_id`, tính `organizedCount`/`cancelledCount`/`cancelRate` cho mỗi organizer, loại trừ organizer có `organizedCount < 3` (FR-016), sắp xếp giảm dần theo `cancelledCount` rồi `cancelRate`, lấy tối đa 10 phần tử, resolve `email`/`fullName` từ `users`.

FR-037: WHEN tính `topDepartments` VÀ currentUser không phải MANAGER, THE system SHALL nhóm `meetings` thỏa FR-032 theo `users.department_id` (qua `meetings.organizer_id → users.department_id`), tính `organizedCount`/`cancelledCount`/`cancelRate` cho mỗi phòng ban, loại trừ phòng ban có `organizedCount < 3` (FR-016), sắp xếp giảm dần theo `cancelledCount` rồi `cancelRate`, lấy tối đa 10 phần tử, resolve `departmentName` từ `departments`.

### 3.8 Notification / Audit Requirements

FR-038: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN yêu cầu hoàn tất thành công, THE system SHALL ghi audit log non-blocking `action_type='read_analytics_meeting_cancel_rate'`, `entity_type='meetings'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, granularity, departmentIds, roomId, organizerEmail, resolvedScopeDepartmentIds}`.

### 3.9 Complex / Combined Requirements

FR-039: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL trả về response rỗng như FR-015 thay vì lỗi.

FR-040: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-07 POST-2, BR1 |
| FR-004–FR-014 | Event-driven | UC-AA-07 Normal Flow bước 1-4 |
| FR-015–FR-018 | State-driven | UC-AA-07 EX1, §0.5, §0.7 |
| FR-019, FR-020 | Optional Feature | UC-AA-07 Normal Flow bước 3 (bộ lọc) |
| FR-021–FR-029 | Unwanted Behavior | UC-AA-07 BR1, validation |
| FR-030, FR-031 | Authorization | UC-AA-07 BR1 |
| FR-032–FR-037 | Data & State | UC-AA-07 Normal Flow bước 4-5 |
| FR-038 | Notification/Audit | Pattern audit đã dùng ở UC-AA-01/04/05/06 |
| FR-039, FR-040 | Complex | BR1 + range guard §0.10 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 2 giây cho khoảng thời gian mặc định (tháng hiện tại) trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-029) trước khi chạy aggregation.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở tầng service, không chỉ dựa vào FE.

NFR-005: THE system SHALL NOT để lộ dữ liệu Top-10 phòng ban khác ngoài scope cho role MANAGER dưới bất kỳ hình thức nào.

### 4.3 Reliability & Consistency

NFR-006: THE system SHALL đảm bảo `cancelledCount ÷ totalMeetingCount` (làm tròn) luôn khớp với `cancelRate` trả về trong cùng 1 response.

NFR-007: THE system SHALL sử dụng index sẵn có trên `meetings(start_time, status)`, `meetings(organizer_id)`, `meetings(room_id)`, `users(department_id)`, `users(email)`.

### 4.4 Usability

NFR-008: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meetings` | Nguồn chính cho `totalMeetingCount`/`cancelledCount`/`series` | Lọc `status <> 'draft'`, phân loại hủy qua `status='cancelled'` |
| `users` | Resolve `organizerEmail`, `email`/`fullName` cho `topOrganizers`, `department_id` để resolve scope/`topDepartments` | |
| `departments` | Resolve scope Manager (`manager_user_id`), `departmentName` cho `topDepartments` | |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| preset | string | Không | `month_current`/`month_previous`/`quarter`/`custom`, mặc định `month_current` | Enum hợp lệ |
| from | date | Chỉ khi `preset=custom` | Bắt đầu khoảng | ISO date |
| to | date | Chỉ khi `preset=custom` | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| granularity | string | Không | `week`/`month`, mặc định `week` | Enum hợp lệ |
| departmentIds | UUID[] | Không | Lọc 1 hoặc nhiều phòng ban | Mỗi phần tử UUID hợp lệ; MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | Không | Lọc phòng họp | UUID hợp lệ |
| organizerEmail | string | Không | Lọc theo email người tổ chức | Định dạng email hợp lệ |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| period.from/to | date | Khoảng thời gian áp dụng |
| totalMeetingCount | integer | Tổng số meeting hợp lệ (`status <> 'draft'`) |
| cancelledCount | integer | Số meeting `status='cancelled'` |
| cancelRate | number | `cancelledCount ÷ totalMeetingCount × 100`, làm tròn 1 chữ số thập phân |
| series[].period | string | Label bucket theo `granularity` |
| series[].totalCount | integer | Tổng meeting trong bucket |
| series[].cancelledCount | integer | Meeting bị hủy trong bucket |
| series[].cancelRate | number | Tỷ lệ hủy trong bucket |
| topOrganizers[].userId | UUID | Định danh organizer |
| topOrganizers[].email | string | Email organizer |
| topOrganizers[].fullName | string | Tên hiển thị organizer |
| topOrganizers[].organizedCount | integer | Tổng meeting đã tổ chức trong kỳ |
| topOrganizers[].cancelledCount | integer | Số meeting bị hủy |
| topOrganizers[].cancelRate | number | Tỷ lệ hủy của organizer đó |
| topDepartments[].departmentId | UUID | Định danh phòng ban (rỗng nếu currentUser là MANAGER) |
| topDepartments[].departmentName | string | Tên phòng ban |
| topDepartments[].organizedCount | integer | Tổng meeting đã tổ chức trong kỳ |
| topDepartments[].cancelledCount | integer | Số meeting bị hủy |
| topDepartments[].cancelRate | number | Tỷ lệ hủy của phòng ban đó |
| message | string (optional) | Chỉ có khi `totalMeetingCount=0` — EX1 |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- `series` luôn đủ bucket theo `granularity` trong `[from,to]`, kể cả `totalCount=0`.
- `topOrganizers`/`topDepartments` tối đa 10 phần tử mỗi danh sách, chỉ gồm đối tượng có `organizedCount >= 3`.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope cho MANAGER, THE system SHALL tái dùng đúng query `SELECT id FROM departments WHERE manager_user_id = currentUser.id` đã có ở UC-AA-01/04/05/06.

FR-DATA-002: WHEN resolving `organizerEmail`, THE system SHALL truy vấn `SELECT id FROM users WHERE LOWER(email) = LOWER(:organizerEmail)`.

FR-DATA-003: WHEN tính `topDepartments`, THE system SHALL JOIN `meetings.organizer_id = users.id` rồi GROUP BY `users.department_id`, JOIN `departments` để lấy `department_name`.

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-154 hiện chưa có `topOrganizers`/`topDepartments`, `preset`, `granularity`, `organizerEmail` — cần task đồng bộ tài liệu riêng (giống các CL trước).
- **CL-2**: Ngưỡng tối thiểu `organizedCount >= 3` để vào bảng xếp hạng (§0.5) là giả định hợp lý suy ra từ nghiệp vụ, không có trong BR gốc — có thể điều chỉnh thành `system_configs` nếu phát sinh yêu cầu cấu hình được qua UI admin.
- **CL-3**: `preset=quarter` chỉ hỗ trợ quý dương lịch hiện tại (Q1-Q4 theo ngày gọi API), không hỗ trợ chọn quý bất kỳ trong quá khứ — nếu cần, dùng `preset=custom`.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `preset` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `preset=custom` thiếu `from`/`to` hoặc `from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `granularity` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF phần tử trong `departmentIds`/`roomId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF `organizerEmail` sai định dạng email, THEN 400 `VALIDATION_ERROR`.
ERR-006: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-007: IF chưa đăng nhập, THEN 401.
ERR-008: IF không có permission `analytics.meeting.read`, THEN 403 `PERMISSION_DENIED`.
ERR-009: IF MANAGER truyền `departmentIds` có phần tử ngoài scope, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 6.3 System Errors

ERR-010: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API không tham số,
Then hệ thống trả về `totalMeetingCount`/`cancelledCount`/`cancelRate`/`series` tính trên tháng hiện tại, toàn công ty, kèm `topOrganizers`/`topDepartments`.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API không truyền `departmentIds`,
Then hệ thống chỉ tính trên meetings do phòng ban "Kỹ thuật" tổ chức, và `topDepartments=[]`.

AC-003:
Given organizer A tổ chức 5 meeting trong kỳ, 3 trong đó bị hủy; organizer B tổ chức 1 meeting và bị hủy,
When gọi API,
Then organizer A xuất hiện trong `topOrganizers` với `cancelledCount=3, cancelRate=60`; organizer B **không** xuất hiện (do `organizedCount=1 < 3`, FR-016).

### 7.2 Validation & Authorization Cases

AC-004:
Given Manager truyền `departmentIds=[deptA, deptB]` với `deptB` ngoài phạm vi quản lý,
When gọi API,
Then hệ thống reject 403 `DEPARTMENT_OUT_OF_SCOPE`.

AC-005:
Given `preset=custom` nhưng thiếu `to`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

AC-006:
Given `organizerEmail="not-an-email"`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-007:
Given tổ hợp filter không có meeting nào (`status <> 'draft'`) trong `[from,to]`,
When gọi API,
Then `totalMeetingCount=0`, `series` đủ bucket với giá trị 0, `topOrganizers=[]`, `topDepartments=[]`, kèm `message` (EX1).

AC-008:
Given 1 meeting request bị approver reject (`meetings.status` chuyển thành `cancelled`) do người khác approver thực hiện, không phải organizer,
When gọi API,
Then meeting đó vẫn được tính vào `cancelledCount` của **organizer gốc** (không phải của approver) — đúng §0.2.

AC-009:
Given `organizerEmail` không khớp bất kỳ user nào trong hệ thống,
When gọi API,
Then hệ thống trả response như AC-007 (EX1), không phải lỗi.

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-032-FR-037 |
| AC-002 | FR-010, FR-017, FR-DATA-001 |
| AC-003 | FR-016, FR-036 |
| AC-004 | FR-023, ERR-009 |
| AC-005 | FR-025, ERR-002 |
| AC-006 | FR-028, ERR-005 |
| AC-007 | FR-015, FR-039 |
| AC-008 | FR-003, FR-033 (organizer-based, §0.2) |
| AC-009 | FR-018, FR-DATA-002 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- UC-148/149/150/151/152/153 (các UC/endpoint analytics khác trong cùng mục 16 API_CONTRACT) — không thuộc UC-AA-07.
- Ranking theo actor thực hiện hủy (`updated_by`/`meeting_events.actor_user_id`) — đã chọn ranking theo organizer (§0.2).
- Gộp `topOrganizers`/`topDepartments` thành 1 danh sách trộn — đã chọn tách riêng (§0.3).
- Cấu hình ngưỡng tối thiểu `organizedCount >= 3` qua UI admin/`system_configs` — giữ hardcode trong code (§0.5, CL-2).
- `preset=quarter` cho quý tùy ý trong quá khứ — chỉ hỗ trợ quý hiện tại (§0.10, CL-3).
- Tooltip hover trên biểu đồ — thuần FE, không cần API riêng.
- WebSocket push/invalidate — cùng lý do đã loại ở các feature trước.
- Rollup phòng ban con cho scope Manager.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với `topOrganizers`/`topDepartments`/`preset`/`granularity`/`organizerEmail` (CL-1).
- Nâng ngưỡng tối thiểu thành `system_configs` key nếu cần điều chỉnh runtime (CL-2).
- Mở rộng `preset=quarter` cho phép chọn quý/năm tùy ý nếu phát sinh yêu cầu rõ ràng (CL-3).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement UC-148/149/150/151/152/153 endpoints as part of this feature.
OOS-002: THE system SHALL NOT create new database tables, columns, or system_configs keys for this feature.
OOS-003: THE system SHALL NOT rank topOrganizers/topDepartments by the meeting-cancel actor; ranking is organizer-based only.
OOS-004: THE system SHALL NOT roll up Manager department scope to parent or child departments.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, business rule, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột/config key database mới.
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
