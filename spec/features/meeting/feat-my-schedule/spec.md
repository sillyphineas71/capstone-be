# Feature Specification: UC-MM-05 Tra cứu lịch trình cá nhân (My Schedule)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Tạo spec lần đầu | Toàn bộ file |
| 2026-06-09 | Cập nhật clarify: overlap query `[from,to)`; effectiveUserRole và role filter; timezone offset validation; search q mở rộng sang meeting_code | FR-002, FR-005, FR-007, FR-013, FR-027–FR-030; BR2, BR8–BR10; ERR-012; AC-013–AC-016; Edge Cases 13–17; API Contract, Clarifications |

---

- **Feature ID**: UC-MM-05
- **Feature Name**: Tra cứu lịch trình cá nhân (My Schedule)
- **Module / Domain**: meetings (chính), rooms, scheduling
- **Created Date**: 2026-06-09
- **Status**: Draft
- **Source Documents**:
  - AGENTS.md (Backend Agent Guide v1.1)
  - Database v3.2 Compact (39 tables)
  - Meeting Lifecycle Management System use case list

---

## 1. Context & Goal

### 1.1 Bối cảnh

Người dùng (Internal Employee, Manager) cần một giao diện lịch cá nhân để kiểm tra toàn bộ các cuộc họp mà họ có liên quan — với tư cách Người tổ chức, Người chủ trì hoặc Khách mời. Hiện tại hệ thống chưa có chế độ xem lịch tập trung, người dùng phải truy vấn thủ công từng cuộc họp.

Tính năng này thuộc module **meetings**, đọc dữ liệu từ các bảng `meetings`, `meeting_participants`, `rooms`, `room_bookings`, `meeting_agendas`, `meeting_external_participants`, `media_files`, `recording_configs`. Feature là READ-ONLY, không tạo/sửa/xóa dữ liệu.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **người dùng đã đăng nhập** tra cứu lịch trình cuộc họp cá nhân theo ngày/tuần/tháng, xem thông tin tóm tắt trên lưới lịch và xem chi tiết cuộc họp qua popup, nhằm chủ động sắp xếp công việc, không bỏ sót lịch họp.

### 1.3 Giá trị mang lại

- Người dùng có cái nhìn tổng quan về lịch trình trong ngày/tuần/tháng.
- Giảm thiểu tình trạng bỏ quên lịch họp hoặc đến muộn.
- Phân biệt trạng thái sự kiện (sắp diễn ra, đang diễn ra, đã hủy, đã kết thúc) trực quan qua màu sắc/biểu tượng.
- Popup chi tiết cung cấp agenda, danh sách khách mời, tài liệu đính kèm và cấu hình ghi hình — đủ để người dùng chuẩn bị trước khi họp.

### 1.4 Giả định

- Múi giờ mặc định là `Asia/Ho_Chi_Minh` nếu người dùng không cung cấp.
- Feature là READ-ONLY; không có hành động ghi dữ liệu nào (tạo, sửa, xóa, hủy, approve).
- Người dùng không được phép xem lịch của người khác.
- Khoảng thời gian tối đa cho một request khi `view=month` là 1 tháng; nếu `from`/`to` vượt quá giới hạn, hệ thống trả lỗi 422.
- Chỉ hiển thị meeting có status là `scheduled`, `in_progress`, `cancelled`, `completed`. Meeting có status `pending_approval` không được hiển thị trong lịch chính (trừ khi filter `includePending=true` được triển khai sau này).
- Sự kiện `cancelled` vẫn được hiển thị trong range để người dùng biết lịch đã hủy, nhưng có style riêng (gạch ngang/mờ).
- Nếu user vừa là host vừa là participant của cùng một meeting, chỉ hiển thị một event với `userRole` ưu tiên cao nhất: organizer > host > attendee.
- Sự kiện được sắp xếp theo `start_time` tăng dần.
- Không ghi `audit_logs` cho hành động đọc lịch thông thường.
- `from` là inclusive boundary, `to` là exclusive boundary. Truy vấn lấy tất cả meeting có thời gian giao với `[from, to)`.
- `from` và `to` phải là ISO-8601 datetime có offset/timezone rõ ràng (vd `2026-06-08T00:00:00+07:00`).
- `timezone` param là IANA timezone dùng cho response metadata và display context, không dùng để thay thế so sánh timestamp trong database.
- `effectiveUserRole` được xác định theo ưu tiên: organizer > host > attendee. Query param `role` lọc theo `effectiveUserRole`.
- `q` tìm kiếm case-insensitive trên cả `meetings.title` và `meetings.meeting_code`.

### 1.5 Cần làm rõ

(Không có — tất cả quyết định đã được ghi rõ trong spec.)

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Xem lịch cá nhân, xem popup chi tiết | Chỉ xem lịch của chính mình |
| Manager | Xem lịch cá nhân, xem popup chi tiết | Chỉ xem lịch của chính mình, quyền tương tự Employee |

### 2.2 Role & Permission Rules

- Người dùng phải có quyền `schedule.read.self` để truy cập endpoint tra cứu lịch.
- Mọi người dùng đã đăng nhập đều có quyền này (mặc định).
- Không có sự phân biệt Employee/Manager trong phạm vi feature này.

### 2.3 Actor Constraints

- Phải đăng nhập hệ thống Web bằng tài khoản hợp lệ.
- Phải có JWT access token hợp lệ trong mọi request API.
- Token xác định danh tính người dùng; không cho phép override `userId` từ query.

---

## 3. Functional Requirements

> Tất cả Functional Requirements viết theo EARS. Keyword EARS giữ bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL chỉ hiển thị các cuộc họp mà người dùng đang đăng nhập có liên quan, bao gồm: meeting do user làm organizer (meetings.organizer_id), meeting do user làm host (meetings.host_id), hoặc meeting có bản ghi trong meeting_participants (meeting_participants.user_id).
FR-002: THE system SHALL xác định effectiveUserRole cho mỗi sự kiện theo thứ tự ưu tiên: organizer > host > attendee. Nếu user có nhiều vai trò trong cùng một meeting, THE system SHALL trả về duy nhất một event với userRole là effectiveUserRole có độ ưu tiên cao nhất.
FR-003: THE system SHALL hiển thị các cuộc họp có status là scheduled, in_progress, cancelled hoặc completed. Cuộc họp có status pending_approval không được hiển thị trong lịch mặc định.
FR-004: THE system SHALL sắp xếp danh sách sự kiện theo start_time tăng dần.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN người dùng gửi yêu cầu GET /api/v1/me/schedule với các tham số from, to, view hợp lệ, THE system SHALL truy vấn tất cả cuộc họp liên quan đến user trong khoảng thời gian giao với [from, to) bằng điều kiện meetings.start_time < :to AND meetings.end_time > :from, trong đó from là inclusive boundary và to là exclusive boundary.
FR-006: WHEN người dùng gửi yêu cầu GET /api/v1/me/schedule/{meetingId}, THE system SHALL kiểm tra quyền truy cập: nếu user không phải organizer, host hoặc participant của meeting đó, THE system SHALL trả về lỗi 403.
FR-007: WHEN người dùng gửi tham số lọc role, THE system SHALL lọc danh sách theo effectiveUserRole, không lọc theo tất cả raw relationship. WHEN người dùng gửi tham số lọc q, THE system SHALL tìm kiếm case-insensitive trên meetings.title và meetings.meeting_code.
```

### 3.3 State-driven Requirements

```text
FR-008: WHILE người dùng đang xem lịch và sự kiện có thời gian hiện tại nằm giữa start_time và end_time, THE system SHALL đánh dấu sự kiện đó với isCurrent = true để frontend có thể highlight.
FR-009: WHILE sự kiện có end_time nhỏ hơn thời điểm hiện tại, THE system SHALL đánh dấu isPast = true.
```

### 3.4 Optional Feature Requirements

```text
FR-010: WHERE meeting có parent_meeting_id hoặc recurrence_rule_id khác null, THE system SHALL hiển thị sự kiện như một event bình thường trong lịch và có thể bổ sung thông tin "Thuộc chuỗi họp định kỳ" trong popup detail nếu dữ liệu cho phép.
FR-011: WHERE meeting có recording_configs liên quan, THE system SHALL hiển thị thông tin read-only về cấu hình ghi hình/ghi âm trong popup detail.
FR-012: WHERE meeting có media_files liên quan, THE system SHALL hiển thị danh sách tài liệu đính kèm (chỉ read-only) trong popup detail.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-013: IF tham số from hoặc to không được cung cấp, THEN THE system SHALL trả về lỗi 400 Bad Request. IF from hoặc to thiếu offset timezone hoặc không parse được thành datetime hợp lệ, THEN THE system SHALL trả về lỗi 400.
FR-014: IF from >= to, THEN THE system SHALL trả về lỗi 422 Unprocessable Entity với mã lỗi INVALID_DATE_RANGE.
FR-015: IF khoảng cách giữa from và to vượt quá 31 ngày đối với view=month, THEN THE system SHALL trả về lỗi 422 với mã lỗi DATE_RANGE_TOO_WIDE.
FR-016: IF view là week và khoảng cách giữa from và to vượt quá 7 ngày, THEN THE system SHALL trả về lỗi 422.
FR-017: IF view là day và khoảng cách giữa from và to vượt quá 1 ngày, THEN THE system SHALL trả về lỗi 422.
FR-018: IF meetingId trong request detail không tồn tại trong hệ thống, THEN THE system SHALL trả về lỗi 404 Not Found.
FR-019: IF người dùng không cung cấp JWT access token hoặc token không hợp lệ, THEN THE system SHALL trả về lỗi 401 Unauthorized.
FR-020: IF tham số view không phải day|week|month, THEN THE system SHALL trả về lỗi 400.
FR-021: IF không có cuộc họp nào trong khoảng thời gian yêu cầu, THEN THE system SHALL trả về danh sách items rỗng và empty = true.
```

### 3.6 Authorization Requirements

```text
FR-022: THE system SHALL yêu cầu JWT Bearer token hợp lệ cho mọi request đến endpoint /me/schedule và /me/schedule/{meetingId}.
FR-023: THE system SHALL từ chối mọi request chứa tham số userId do client gửi lên; feature chỉ dùng userId từ token.
FR-024: IF người dùng có token hợp lệ nhưng không phải organizer, host hoặc participant của meeting được yêu cầu chi tiết, THEN THE system SHALL trả về lỗi 403 Forbidden.
```

### 3.7 Data & State Requirements

```text
FR-025: THE system SHALL đảm bảo không có event trùng lặp trong danh sách trả về: nếu user vừa là organizer vừa là participant của cùng một meeting, chỉ xuất hiện một event với role ưu tiên cao nhất.
FR-026: THE system SHALL gắn cho mỗi sự kiện một colorKey hoặc iconKey để frontend phân biệt trạng thái: scheduled, in_progress, cancelled, completed.
FR-027: THE system SHALL truy vấn meeting giao với khoảng [from, to) bằng điều kiện meetings.start_time < :to AND meetings.end_time > :from. from là inclusive boundary, to là exclusive boundary. Meeting bắt đầu trước from nhưng kết thúc sau from vẫn được bao gồm.
FR-028: THE system SHALL parse và normalize from và to thành instant/timestamptz để query trong database, không dùng timezone param để thay thế so sánh timestamp. timezone param chỉ dùng cho response metadata và display context.
FR-029: WHEN người dùng gửi tham số q, THE system SHALL trim whitespace đầu cuối. IF q sau khi trim là chuỗi rỗng, THEN THE system SHALL bỏ qua filter q. IF q không rỗng, THEN THE system SHALL tìm kiếm case-insensitive: meetings.title ILIKE '%q%' OR meetings.meeting_code ILIKE '%q%'.
FR-030: THE system SHALL xác định effectiveUserRole cho mỗi meeting liên quan theo ưu tiên organizer > host > attendee. Query param role SHALL lọc theo effectiveUserRole: nếu user có effectiveUserRole = organizer, filter ?role=attendee SHALL loại bỏ meeting đó khỏi kết quả.
```

### 3.8 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MM-05, BR1 | Self-scope data isolation |
| FR-002 | Ubiquitous | UC-MM-05 | Role priority: organizer > host > attendee |
| FR-003 | Ubiquitous | UC-MM-05 | Pending approval out of default view |
| FR-004 | Ubiquitous | UC-MM-05 | Sort by start_time asc |
| FR-005 | Event-driven | UC-MM-05 NF bước 3 | Schedule query |
| FR-006 | Event-driven | UC-MM-05 NF bước 6 | Popup detail access check |
| FR-007 | Event-driven | UC-MM-05 A1 | Filtering/search |
| FR-008 | State-driven | UC-MM-05 | Current-time highlight |
| FR-009 | State-driven | UC-MM-05 | Past event indicator |
| FR-010 | Optional Feature | UC-MM-05 | Recurring meeting display |
| FR-011 | Optional Feature | UC-MM-05 | Recording config in detail popup |
| FR-012 | Optional Feature | UC-MM-05 | Attachments from media_files |
| FR-013 | Unwanted Behavior | UC-MM-05 | Missing required params |
| FR-014 | Unwanted Behavior | UC-MM-05 | Invalid date range |
| FR-015 | Unwanted Behavior | UC-MM-05 | Date range too wide |
| FR-016 | Unwanted Behavior | UC-MM-05 | Week range validation |
| FR-017 | Unwanted Behavior | UC-MM-05 | Day range validation |
| FR-018 | Unwanted Behavior | UC-MM-05 | Meeting not found |
| FR-019 | Unwanted Behavior | UC-MM-05 | Unauthenticated |
| FR-020 | Unwanted Behavior | UC-MM-05 | Invalid view param |
| FR-021 | Unwanted Behavior | UC-MM-05 E1 | Empty state |
| FR-022 | Authorization | UC-MM-05 PRE1 | JWT required |
| FR-023 | Authorization | UC-MM-05 BR1 | No userId override |
| FR-024 | Authorization | UC-MM-05 | Forbidden for non-participant |
| FR-025 | Data | UC-MM-05 | No duplicate event |
| FR-026 | Data | UC-MM-05 BR2 | Color/icon mapping |
| FR-027 | Ubiquitous | UC-MM-05 | Overlap query [from, to) |
| FR-028 | Ubiquitous | UC-MM-05 | Timezone normalize to timestamptz |
| FR-029 | Event-driven | UC-MM-05 | q search title + meeting_code |
| FR-030 | Ubiquitous | UC-MM-05 | effectiveUserRole and role filter |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL trả về danh sách lịch trong vòng 3 giây dưới tải bình thường (dưới 1000 cuộc họp liên quan trong range).
NFR-002: THE system SHALL hỗ trợ ít nhất 50 request đồng thời cho endpoint tra cứu lịch.
```

### 4.2 Security

```text
NFR-003: THE system SHALL yêu cầu xác thực JWT trước khi cho phép truy cập dữ liệu lịch cá nhân.
NFR-004: THE system SHALL không trả về thông tin nhạy cảm (password hash, token, secret) trong response.
NFR-005: THE system SHALL không cho phép một user xem lịch của user khác thông qua tham số truy vấn.
NFR-006: IF token hết hạn hoặc không hợp lệ, THEN THE system SHALL trả về lỗi 401.
```

### 4.3 Reliability & Consistency

```text
NFR-007: THE system SHALL đảm bảo dữ liệu trả về là consistent tại thời điểm request (read-committed isolation).
```

### 4.4 Usability

```text
NFR-008: THE system SHALL trả về lỗi với message bằng tiếng Việt hoặc tiếng Anh theo ngôn ngữ hệ thống, kèm mã lỗi để frontend hiển thị phù hợp.
NFR-009: THE system SHALL dùng response format thống nhất: { success, message, data, meta } theo convention dự án.
```

### 4.5 Observability

```text
NFR-010: THE system SHALL ghi log lỗi server (500) cho mục đích debug; không ghi audit log cho hành động đọc lịch thông thường.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| meetings | Nguồn dữ liệu chính: tiêu đề, thời gian, trạng thái, organizer, host, room | Dùng organizer_id, host_id, room_id, status, start_time, end_time, timezone, recurrence_rule_id, parent_meeting_id |
| meeting_participants | Xác định user có phải participant không; cung cấp participant_role | JOIN với meetings để lấy danh sách sự kiện liên quan |
| rooms | Cung cấp thông tin phòng họp: room_name, room_code, site_name, area_name, location_description | JOIN qua meetings.room_id |
| room_bookings | Kiểm tra thông tin đặt phòng nếu cần hiển thị trong popup | Có thể JOIN qua meeting_id |
| meeting_agendas | Danh sách agenda cho popup detail | JOIN qua meeting_id |
| meeting_external_participants | Khách mời ngoài hiển thị trong popup detail | JOIN qua meeting_id |
| media_files | Tài liệu/attachment liên quan meeting (thay thế bảng documents đã xóa) | JOIN qua reference_type='meeting', reference_id |
| recording_configs | Cấu hình ghi hình/ghi âm read-only trong popup | JOIN qua meeting_id hoặc room_id |

### 5.2 Dữ liệu đầu vào (API query params)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| view | string (enum) | Có | day, week, month | Phải là một trong day, week, month |
| from | string (ISO-8601) | Có | Ngày/giờ bắt đầu khoảng thời gian (inclusive). Phải có offset timezone, vd `2026-06-08T00:00:00+07:00` | Format ISO-8601 có offset, < to |
| to | string (ISO-8601) | Có | Ngày/giờ kết thúc khoảng thời gian (exclusive). Phải có offset timezone | Format ISO-8601 có offset, > from |
| timezone | string | Không | IANA timezone cho response metadata và display context, default Asia/Ho_Chi_Minh | Phải là IANA timezone hợp lệ |
| status | string | Không | Lọc theo trạng thái | scheduled, in_progress, cancelled, completed |
| role | string (enum) | Không | Lọc theo effectiveUserRole (organizer > host > attendee) | organizer, host, attendee |
| roomId | string (UUID) | Không | Lọc theo phòng họp | UUID hợp lệ |
| q | string | Không | Tìm kiếm case-insensitive trên title và meeting_code | Tối đa 200 ký tự, trim whitespace |

### 5.3 Dữ liệu đầu ra (Schedule Event Summary)

| Field | Type dự kiến | Mô tả |
|---|---|---|
| meetingId | string (UUID) | ID cuộc họp |
| meetingCode | string | Mã cuộc họp (nếu có) |
| title | string | Tiêu đề cuộc họp |
| startTime | string (ISO-8601) | Thời gian bắt đầu |
| endTime | string (ISO-8601) | Thời gian kết thúc |
| timezone | string | Múi giờ |
| status | string | scheduled, in_progress, cancelled, completed |
| userRole | string | organizer, host, attendee |
| room | object | { id, roomName, roomCode, location } |
| colorKey | string | scheduled, in_progress, cancelled, completed |
| isCurrent | boolean | True nếu đang diễn ra |
| isPast | boolean | True nếu đã kết thúc (end_time < now) |

### 5.4 State / Status Model (meeting status hiển thị)

| Status | Ý nghĩa | Hiển thị trong lịch | Style gợi ý |
|---|---|---|---|
| scheduled | Cuộc họp đã được xác nhận, chưa diễn ra | Có | Màu xanh dương |
| in_progress | Cuộc họp đang diễn ra | Có | Màu xanh lá, highlight |
| cancelled | Cuộc họp đã bị hủy | Có | Màu xám, gạch ngang |
| completed | Cuộc họp đã kết thúc | Có | Màu xám nhạt |
| pending_approval | Chờ duyệt (không hiển thị mặc định) | Không | — |

### 5.5 Lưu ý về truy vấn

Feature này có thể đề xuất tạo SQL view / read model tên `v_meeting_schedule` để gộp logic JOIN giữa meetings, meeting_participants, rooms, room_bookings. View này không bắt buộc — chỉ dùng để tối ưu nếu cần. Không tạo bảng mới.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF from hoặc to missing, THEN THE system SHALL trả về 400 và mã lỗi MISSING_REQUIRED_PARAM.
ERR-002: IF from >= to, THEN THE system SHALL trả về 422 và mã lỗi INVALID_DATE_RANGE.
ERR-003: IF khoảng cách from-to vượt quá giới hạn của view, THEN THE system SHALL trả về 422 và mã lỗi DATE_RANGE_TOO_WIDE.
ERR-004: IF view không phải day|week|month, THEN THE system SHALL trả về 400 và mã lỗi INVALID_VIEW_PARAM.
ERR-005: IF timezone không phải IANA timezone hợp lệ, THEN THE system SHALL trả về 400 và mã lỗi INVALID_TIMEZONE.
ERR-006: IF meetingId không phải UUID hợp lệ, THEN THE system SHALL trả về 400 và mã lỗi INVALID_UUID.
ERR-012: IF from hoặc to thiếu offset timezone hoặc không parse được thành datetime hợp lệ, THEN THE system SHALL trả về 400 và mã lỗi INVALID_DATETIME_FORMAT.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-007: IF không có JWT token, THEN THE system SHALL trả về 401 và mã lỗi UNAUTHENTICATED.
ERR-008: IF JWT token hết hạn hoặc không hợp lệ, THEN THE system SHALL trả về 401 và mã lỗi INVALID_TOKEN.
ERR-009: IF user không phải organizer/host/participant của meeting được yêu cầu chi tiết, THEN THE system SHALL trả về 403 và mã lỗi FORBIDDEN_NOT_PARTICIPANT.
```

### 6.3 Business Rule Errors

```text
ERR-010: IF meetingId không tồn tại trong hệ thống, THEN THE system SHALL trả về 404 và mã lỗi MEETING_NOT_FOUND.
ERR-011: IF request gửi kèm tham số userId, THEN THE system SHALL bỏ qua tham số đó và chỉ dùng userId từ token.
```

### 6.4 Error Response Format

```json
{
  "success": false,
  "message": "Invalid date range: from must be before to",
  "error": {
    "code": "INVALID_DATE_RANGE"
  },
  "timestamp": "2026-06-09T10:00:00.000Z",
  "path": "/api/v1/me/schedule"
}
```

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001: Danh sách lịch tuần hiện tại
Given user A đã đăng nhập và có 3 cuộc họp trong tuần hiện tại (2 với tư cách participant, 1 với tư cách organizer),
When user A gọi GET /api/v1/me/schedule?view=week&from=2026-06-08T00:00:00Z&to=2026-06-14T23:59:59Z,
Then hệ thống trả về 200 với items chứa 3 sự kiện, mỗi sự kiện có userRole tương ứng, sắp xếp theo start_time tăng dần.

AC-002: Popup chi tiết cuộc họp
Given user A là participant của meeting M,
When user A gọi GET /api/v1/me/schedule/{M},
Then hệ thống trả về 200 với thông tin đầy đủ: meeting detail, room, organizer, host, participants, externalParticipants, agendas, attachments, recordingConfig.

AC-003: Empty state
Given user A không có cuộc họp nào trong khoảng thời gian T,
When user A gọi schedule với from=T_from, to=T_to,
Then hệ thống trả về 200 với items = [] và empty = true.
```

### 7.2 Validation Cases

```text
AC-004: Thiếu tham số from
Given request không có from,
When user gọi GET /api/v1/me/schedule,
Then hệ thống trả về 400 với mã lỗi MISSING_REQUIRED_PARAM.

AC-005: Date range ngược
Given from > to,
When user gọi schedule,
Then hệ thống trả về 422 với mã lỗi INVALID_DATE_RANGE.

AC-006: Khoảng thời gian quá rộng
Given view=month và from-to cách nhau 60 ngày,
When user gọi schedule,
Then hệ thống trả về 422 với mã lỗi DATE_RANGE_TOO_WIDE.
```

### 7.3 Authorization Cases

```text
AC-007: Không có token
Given request không có Authorization header,
When user gọi bất kỳ endpoint nào,
Then hệ thống trả về 401.

AC-008: User không phải participant
Given user A không liên quan đến meeting M,
When user A gọi GET /api/v1/me/schedule/{M},
Then hệ thống trả về 403 với mã lỗi FORBIDDEN_NOT_PARTICIPANT.

AC-009: Meeting không tồn tại
Given meeting M không tồn tại trong hệ thống,
When user gọi GET /api/v1/me/schedule/{M},
Then hệ thống trả về 404 với mã lỗi MEETING_NOT_FOUND.
```

### 7.4 Business Rule Cases

```text
AC-010: Vai trò ưu tiên cao nhất
Given user A vừa là organizer vừa là participant của meeting M trong cùng một range,
When user gọi schedule,
Then danh sách chỉ có một event cho meeting M với userRole = organizer.

AC-011: Cancelled event vẫn hiển thị
Given meeting M có status = cancelled và nằm trong range,
When user gọi schedule,
Then danh sách items chứa meeting M với status = cancelled và isCancelled style.

AC-012: Lọc theo status
Given user có 5 cuộc họp, trong đó 2 cancelled,
When user gọi schedule với status=cancelled,
Then danh sách items chỉ chứa 2 cuộc họp cancelled.

AC-013: Overlap — meeting vắt qua ranh giới
Given meeting M bắt đầu lúc 2026-06-07T23:00:00+07:00 và kết thúc lúc 2026-06-08T01:00:00+07:00,
When user gọi schedule với from=2026-06-08T00:00:00+07:00, to=2026-06-09T00:00:00+07:00,
Then meeting M được trả về trong items (vì start_time < to AND end_time > from).

AC-014: effectiveUserRole filter
Given user A vừa là organizer vừa có record participant của meeting M,
When user gọi schedule với role=attendee,
Then meeting M không xuất hiện (vì effectiveUserRole = organizer, không phải attendee).

AC-015: from/to thiếu offset timezone
Given from=2026-06-08T00:00:00 (không có offset),
When user gọi schedule,
Then hệ thống trả về 400 với mã lỗi INVALID_DATETIME_FORMAT.

AC-016: q tìm kiếm trên meeting_code
Given meeting M có meeting_code = "MTG-2026-001",
When user gọi schedule với q=001,
Then meeting M được trả về trong items.
```

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

### 8.1 Không triển khai trong feature này

- Tạo cuộc họp mới (create meeting).
- Cập nhật thông tin cuộc họp (update meeting).
- Hủy cuộc họp (cancel meeting).
- Phê duyệt / từ chối yêu cầu họp (approval flow).
- Đổi phòng họp.
- Điểm danh, check-in/check-out.
- Bắt đầu / kết thúc / tạm dừng cuộc họp (live meeting control).
- Export lịch ra file (PDF, CSV, iCal).
- Đồng bộ với Google Calendar, Outlook Calendar.
- Tích hợp WebSocket realtime cho lịch (frontend tự xử lý polling hoặc dùng WebSocket riêng nếu có).
- Ghi audit_log cho hành động đọc lịch.

### 8.2 Không thêm bảng/cột mới

- Feature này chỉ đọc dữ liệu từ các bảng hiện có trong Database v3.2 Compact.
- Không tạo bảng mới, không thêm cột mới.
- Có thể đề xuất SQL view `v_meeting_schedule` để tối ưu truy vấn, nhưng không bắt buộc.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT cho phép tạo, sửa, hủy cuộc họp thông qua các endpoint của feature này.
OOS-002: THE system SHALL NOT tạo bảng database mới hoặc thêm cột mới cho feature này.
OOS-003: THE system SHALL NOT cho phép user A xem lịch của user B qua bất kỳ tham số truy vấn nào.
OOS-004: THE system SHALL NOT thực hiện đồng bộ lịch với bên thứ ba (Google Calendar, Outlook, iCal).
OOS-005: THE system SHALL NOT ghi audit log cho hành động đọc lịch.
```

---

## 9. API Contract

### 9.1 GET /api/v1/me/schedule

Tra cứu danh sách lịch trình cá nhân.

**Permission**: `schedule.read.self`

**Auth**: JWT Bearer required

**Query Parameters**:

| Param | Type | Required | Default | Mô tả |
|---|---|---|---|---|
| view | string | Có | — | day, week, month |
| from | string (ISO-8601) | Có | — | ISO-8601 datetime có offset (vd `2026-06-08T00:00:00+07:00`). Inclusive boundary. |
| to | string (ISO-8601) | Có | — | ISO-8601 datetime có offset. Exclusive boundary. |
| timezone | string | Không | Asia/Ho_Chi_Minh | IANA timezone cho response metadata và display context |
| status | string | Không | — | Lọc: scheduled, in_progress, cancelled, completed |
| role | string | Không | — | Lọc theo effectiveUserRole: organizer, host, attendee |
| roomId | string (UUID) | Không | — | Lọc theo phòng |
| q | string | Không | — | Tìm kiếm case-insensitive trên title và meeting_code (max 200 ký tự) |

**Response 200**:

```json
{
  "success": true,
  "message": "Schedule retrieved successfully",
  "data": {
    "items": [
      {
        "meetingId": "uuid-xxx",
        "meetingCode": "MTG-2026-001",
        "title": "Sprint Planning",
        "startTime": "2026-06-10T09:00:00+07:00",
        "endTime": "2026-06-10T10:30:00+07:00",
        "timezone": "Asia/Ho_Chi_Minh",
        "status": "scheduled",
        "userRole": "organizer",
        "room": {
          "id": "uuid-yyy",
          "roomName": "Phòng họp A",
          "roomCode": "RM-A",
          "location": "Tầng 5, Tòa nhà B"
        },
        "colorKey": "scheduled",
        "isCurrent": false,
        "isPast": false
      }
    ],
    "range": {
      "view": "week",
      "from": "2026-06-08T00:00:00+07:00",
      "to": "2026-06-14T23:59:59+07:00",
      "timezone": "Asia/Ho_Chi_Minh"
    },
    "empty": false
  }
}
```

**Errors**: 400 (invalid query, invalid datetime format, invalid timezone, invalid UUID), 401 (unauthenticated), 422 (invalid date range, date range too wide)

### 9.2 GET /api/v1/me/schedule/{meetingId}

Xem chi tiết một cuộc họp.

**Permission**: `schedule.read.self`

**Auth**: JWT Bearer required

**Access**: Chỉ trả về nếu user là organizer, host hoặc participant.

**Response 200**:

```json
{
  "success": true,
  "message": "Meeting detail retrieved successfully",
  "data": {
    "meeting": {
      "meetingId": "uuid-xxx",
      "meetingCode": "MTG-2026-001",
      "title": "Sprint Planning",
      "description": "Kế hoạch sprint 12",
      "startTime": "2026-06-10T09:00:00+07:00",
      "endTime": "2026-06-10T10:30:00+07:00",
      "timezone": "Asia/Ho_Chi_Minh",
      "status": "scheduled",
      "recurrenceRuleId": null,
      "parentMeetingId": null
    },
    "room": {
      "id": "uuid-yyy",
      "roomName": "Phòng họp A",
      "roomCode": "RM-A",
      "siteName": "Tòa nhà B",
      "areaName": "Khu vực 1",
      "location": "Tầng 5"
    },
    "organizer": {
      "id": "uuid-org",
      "fullName": "Nguyễn Văn A",
      "email": "a@company.com"
    },
    "host": {
      "id": "uuid-host",
      "fullName": "Trần Thị B",
      "email": "b@company.com"
    },
    "participants": [
      {
        "id": "uuid-p1",
        "fullName": "Lê Văn C",
        "email": "c@company.com",
        "participantRole": "member",
        "invitationStatus": "accepted",
        "attendanceStatus": "not_yet"
      }
    ],
    "externalParticipants": [
      {
        "name": "Khách mời ngoài",
        "email": "guest@external.com"
      }
    ],
    "agendas": [
      {
        "id": "uuid-ag1",
        "title": "Review sprint",
        "durationMinutes": 30,
        "sortOrder": 1
      }
    ],
    "attachments": [
      {
        "id": "uuid-file1",
        "fileName": "sprint-planning.pptx",
        "fileUrl": "/media/xxx.pptx",
        "fileType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "fileSize": 2048000
      }
    ],
    "recordingConfig": {
      "autoRecord": false,
      "allowRecording": true
    },
    "userRole": "organizer"
  }
}
```

**Errors**: 400 (invalid UUID), 401 (unauthenticated), 403 (forbidden/not participant), 404 (meeting not found)

---

## 10. Business Rules

BR1: **Cách ly dữ liệu cá nhân**. Hệ thống chỉ hiển thị cuộc họp mà chính tài khoản đang đăng nhập có liên quan. User A không thể xem lịch cá nhân của User B qua tính năng này.

BR2: **Vai trò ưu tiên**. Nếu user có nhiều vai trò trong cùng một meeting, thứ tự hiển thị: organizer > host > attendee.

BR3: **Không trùng lặp**. Một meeting chỉ xuất hiện một lần trong danh sách, bất kể user có bao nhiêu vai trò.

BR4: **Trạng thái tối thiểu**. Chỉ hiển thị meeting có status: scheduled, in_progress, cancelled, completed. Pending_approval không hiển thị mặc định.

BR5: **Cancelled vẫn hiển thị**. Sự kiện cancelled được hiển thị để user biết lịch đã hủy, nhưng có style riêng (mờ, gạch ngang).

BR6: **Color-coding**. Hệ thống dùng colorKey để frontend phân biệt trạng thái: scheduled (xanh dương), in_progress (xanh lá, highlight), cancelled (xám), completed (xám nhạt).

BR7: **Sắp xếp**. Sự kiện sắp xếp theo start_time tăng dần.

BR8: **Date range overlap**. Hệ thống truy vấn meeting giao với `[from, to)` theo điều kiện `meetings.start_time < :to AND meetings.end_time > :from`. `from` là inclusive, `to` là exclusive. Meeting vắt qua ranh giới (bắt đầu trước from nhưng kết thúc sau from) vẫn được bao gồm.

BR9: **effectiveUserRole**. Mỗi meeting liên quan đến user được gán một `effectiveUserRole` duy nhất theo ưu tiên: organizer > host > attendee. Query param `role` lọc dựa trên `effectiveUserRole` này.

BR10: **Search scope**. Tham số `q` tìm kiếm case-insensitive trên cả `meetings.title` và `meetings.meeting_code`. Nếu `q` chỉ chứa whitespace sau khi trim, filter `q` được bỏ qua.

---

## 11. Edge Cases

| # | Tình huống | Mong đợi |
|---|---|---|
| 1 | User không có bất kỳ cuộc họp nào trong range | items = [], empty = true |
| 2 | Meeting chưa được duyệt (pending_approval) | Không hiển thị (out of default view) |
| 3 | Meeting bị hủy vẫn nằm trong range | Hiển thị với status = cancelled, style riêng |
| 4 | User vừa là organizer vừa là participant | Một event duy nhất, role = organizer |
| 5 | Meeting không có room (room_id = null) | room = null, không hiển thị thông tin phòng |
| 6 | Meeting không có participant nào ngoài organizer | Chỉ có organizer trong response |
| 7 | from và to giống nhau | from < to sai → 422 INVALID_DATE_RANGE |
| 8 | timezone không hợp lệ (vd "ABC") | 400 INVALID_TIMEZONE |
| 9 | Tham số status có giá trị không hợp lệ | 400 (do validation pipe) |
| 10 | meetingId không phải UUID | 400 INVALID_UUID |
| 11 | Meeting có parent_meeting_id (thuộc chuỗi định kỳ) | Hiển thị như event bình thường |
| 12 | Attachment từ media_files trỏ đến file không còn trên storage | Vẫn hiển thị metadata, frontend xử lý lỗi tải file |
| 13 | Meeting bắt đầu trước from nhưng kết thúc trong [from, to) | Vẫn được trả về (overlap) |
| 14 | Meeting bắt đầu trong [from, to) nhưng kết thúc sau to | Vẫn được trả về (overlap) |
| 15 | User có effectiveUserRole = organizer, filter role=attendee | Meeting bị loại khỏi kết quả |
| 16 | from/to thiếu offset timezone (vd "2026-06-08T00:00:00") | 400 INVALID_DATETIME_FORMAT |
| 17 | q chỉ chứa whitespace (vd "   ") | Bỏ qua filter q, trả về toàn bộ kết quả |

---

## 12. Success Metrics

| Metric | Target | Cách đo |
|---|---|---|
| Thời gian tải danh sách lịch | ≤ 3 giây cho range 1 tháng (< 1000 events) | Backend response time monitoring |
| User có thể xem lịch chỉ với 1 click | 100% user truy cập được "Lịch của tôi" từ menu chính | Manual testing, UI test |
| Không có lỗi 500 cho request hợp lệ | 100% request hợp lệ thành công | Error rate monitoring |
| Data isolation | 0 trường hợp user A xem được lịch của user B | Security test, penetration test |

---

## 13. Clarifications / Resolved Assumptions

| # | Vấn đề | Quyết định |
|---|---|---|
| 1 | Default view khi vào "Lịch của tôi" lần đầu | Week view của tuần hiện tại |
| 2 | Feature có cho phép truyền userId không? | Không. Chỉ dùng userId từ JWT token |
| 3 | Khoảng thời gian tối đa cho một request? | view=month: tối đa 31 ngày; view=week: tối đa 7 ngày; view=day: tối đa 1 ngày |
| 4 | Meeting được xem là "liên quan" khi nào? | organizer_id = user.id OR host_id = user.id OR có trong meeting_participants |
| 5 | Pending approval có hiển thị không? | Không hiển thị mặc định; có thể triển khai filter `includePending` ở feature sau |
| 6 | Audit log cho read? | Không ghi audit log cho hành động đọc lịch |
| 7 | Attachment dùng bảng nào? | `media_files` (bảng `documents` đã xóa trong DB v3.2) |
| 8 | Logic truy vấn theo khoảng thời gian? | Overlap `[from, to)`: `meetings.start_time < :to AND meetings.end_time > :from`. from inclusive, to exclusive. |
| 9 | effectiveUserRole và role filter? | Mỗi meeting có một effectiveUserRole duy nhất (organizer > host > attendee). Query param `role` lọc theo effectiveUserRole. |
| 10 | from/to có bắt buộc offset timezone không? | Có. from và to phải là ISO-8601 datetime có offset (vd +07:00). Nếu thiếu → 400. |
| 11 | timezone param dùng để làm gì? | Dùng cho response metadata, display context, current-time indicator. Không dùng để thay thế so sánh timestamp trong database. |
| 12 | q tìm kiếm trên những field nào? | meetings.title và meetings.meeting_code, case-insensitive. Trim whitespace; nếu rỗng sau trim thì bỏ qua filter. |
