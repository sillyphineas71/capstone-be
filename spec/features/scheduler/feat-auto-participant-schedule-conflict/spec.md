# 📝 CHANGELOG & REVISION HISTORY
| blocked | KHÔNG sử dụng cho participant conflict | conflict_check_status (chỉ dùng cho room/policy conflict ở tính năng khác) |
| not_checked | Chưa kiểm tra | conflict_check_status |

### 5.6 Data Constraints

- meeting_requests.conflict_summary_json lưu snapshot conflict dưới dạng JSON.
- meeting_requests.conflict_check_status là enum string.
- Conflict được tính động từ meetings + meeting_participants, không lưu bảng riêng.
- Không lưu participant busy status riêng — chỉ lưu snapshot khi submit booking.

### 5.7 Data Lifecycle

- **Realtime check**: Dữ liệu không được lưu, chỉ tính toán và trả về trong request-response.
- **Submit re-check**: Snapshot conflict được lưu vào meeting_requests.conflict_summary_json tại thời điểm tạo meeting request.
- conflict_summary_json được ghi một lần khi tạo meeting request, không tự động cập nhật sau đó.

### 5.8 Cần làm rõ

- (Không có — database v3.2 Compact đã có meeting_requests.conflict_summary_json và conflict_check_status đủ đáp ứng.)

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF startTime is missing or invalid, THEN THE system SHALL reject the request and return a validation error.

ERR-002: IF endTime is missing or invalid, THEN THE system SHALL reject the request and return a validation error.

ERR-003: IF endTime is not after startTime, THEN THE system SHALL reject the request and return a validation error.

ERR-004: IF participantUserIds contains an invalid UUID format, THEN THE system SHALL reject the request and return a validation error.

ERR-005: IF participantUserIds contains a userId that does not exist in the system, THEN THE system SHALL reject the request and return a validation error.

ERR-006: IF participantUserIds exceeds the maximum allowed limit (50), THEN THE system SHALL reject the request and return a 400 validation error (PARTICIPANT_CONFLICT_CHECK_LIMIT_EXCEEDED). Frontend must batch requests for large meetings.

ERR-007: IF participantUserIds contains duplicate userIds, THEN THE system SHALL reject the request and return a validation error.

ERR-008: IF excludeMeetingId is provided but is not a valid UUID, THEN THE system SHALL reject the request and return a validation error.

ERR-014: IF excludeMeetingId is provided but the user does not have permission to view/edit that meeting, or the meeting does not exist/is deleted, THEN THE system SHALL return a 403 Forbidden or 404 Not Found error respectively.

### 6.2 Authentication / Authorization Errors

ERR-009: IF the user is not authenticated, THEN THE system SHALL return an authentication error (401).

ERR-010: IF the user does not have scheduling.conflict.participant.check permission, THEN THE system SHALL return an authorization error (403).

### 6.3 Conflict Error (không phải lỗi — cần nhấn mạnh)

ERR-011: IF participant busy status is detected, THEN THE system SHALL NOT treat this as an error; the API SHALL return HTTP 200 with status: busy in the response.

ERR-012: IF participant busy status is detected during submit re-check, THEN THE system SHALL NOT reject the booking request; the system SHALL create the meeting request with conflictCheckStatus: warning.

### 6.4 System Errors

ERR-013: IF an internal server error occurs during conflict check, THEN THE system SHALL return an internal error (500) and log the error for troubleshooting.

### 6.5 Error Response Expectations

Response lỗi nên có tối thiểu:

| Field | Mô tả |
|---|---|
| statusCode | HTTP status code |
| message | Thông báo lỗi |
| error | Loại lỗi ngắn gọn |
| code | Mã lỗi nội bộ |
| details | Chi tiết lỗi validation nếu cần |
| 	imestamp | Thời điểm xảy ra lỗi |
| path | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given internal participant A có meeting khác từ 14:00-15:30 trùng với khung giờ đang chọn (14:00-16:00),
When người dùng thêm participant A vào danh sách khách mời,
Then API realtime check trả về participant A với status = "busy", busySlots chứa { busyFrom: "14:00", busyTo: "15:30" }, displayWarning = true.

AC-002:
Given internal participant A đang rảnh trong khung giờ đã chọn (14:00-16:00),
When người dùng thêm participant A vào danh sách khách mời,
Then API realtime check trả về participant A với status = "free", displayWarning = false.

AC-013 (Merge busySlots):
Given participant A có các meeting khác từ 14:00-15:00, 14:30-15:30 và 15:30-16:00,
When API realtime check được gọi cho khung giờ 14:00-16:00,
Then hệ thống trả về duy nhất 1 khoảng busySlots là { busyFrom: "14:00", busyTo: "16:00" }.

AC-003:
Given danh sách participants có 3 người, trong đó 1 người bị busy,
When người dùng đổi startTime từ 14:00 thành 15:00 (khoảng mới không còn conflict với A),
Then API realtime check trả về participant A với status = "free", các participant khác giữ nguyên trạng thái.

### 7.2 External Participant Cases

AC-004:
Given người dùng thêm email khách ngoài "guest@external.com",
When API realtime check được gọi với externalParticipantEmails chứa email đó,
Then response trả external participant với status = "unknown" và warningMessage = "Không rõ lịch trình".

### 7.3 Submit Re-check Cases

AC-005:
Given submit booking request có participant conflict,
When backend kiểm tra lại conflict,
Then backend tạo meeting request thành công với conflictCheckStatus = "warning", không trả lỗi 409/422.

AC-006:
Given submit booking request không có participant conflict,
When backend kiểm tra lại conflict,
Then backend tạo meeting request thành công với conflictCheckStatus = "clear".

### 7.4 Privacy Cases

AC-007:
Given participant A bị conflict,
When API realtime check trả response,
Then response KHÔNG chứa title, description, agenda, room name, participant list của cuộc họp khác — chỉ trả busyFrom và busyTo.

### 7.5 Overlap Detection Cases

AC-008:
Given A có meeting từ 13:00-15:00 và khung giờ đang chọn là 14:00-16:00,
When API kiểm tra conflict,
Then A được phát hiện busy (overlap vắt ngang biên: existing.end (15:00) > requestedStart (14:00) AND existing.start (13:00) < requestedEnd (16:00)).

### 7.6 Exclude Meeting Cases

AC-009:
Given người dùng đang edit meeting X (đã có A trong participants), A chỉ bận trong meeting X,
When API được gọi với excludeMeetingId = X,
Then API trả A với status = "free" (không tự conflict với chính meeting đang edit).

AC-014:
Given người dùng truyền excludeMeetingId = Y (một meeting mà họ không có quyền truy cập),
When API được gọi,
Then system rejects with 403 Forbidden (ngăn chặn IDOR).

### 7.7 Validation Error Cases

AC-010:
Given request có startTime > endTime,
When API receive request,
Then system rejects with 400 validation error.

AC-011:
Given request có participantUserIds chứa UUID không tồn tại trong hệ thống,
When API receive request,
Then system rejects with 400 validation error.

### 7.8 Authorization Cases

AC-012:
Given user không có permission "scheduling.conflict.participant.check",
When user gọi API conflict check,
Then system trả 403 Forbidden.

### 7.9 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-005, FR-020 | Thêm participant busy → trả busy + busySlots |
| AC-002 | FR-001, FR-005 | Thêm participant rảnh → trả free |
| AC-003 | FR-006 | Đổi giờ → participant hết conflict → free |
| AC-004 | FR-019 | External participant → unknown |
| AC-005 | FR-008, FR-009, FR-021 | Submit có conflict → warning + thành công |
| AC-006 | FR-008, FR-010, FR-022 | Submit không conflict → clear |
| AC-007 | FR-002 | Privacy-safe response |
| AC-008 | FR-016 | Overlap vắt ngang biên |
| AC-009 | FR-018 | excludeMeetingId loại trừ meeting đang edit |
| AC-010 | FR-013, ERR-003 | Time range sai → 400 |
| AC-011 | FR-012, ERR-005 | User không tồn tại → 400 |
| AC-012 | FR-024, ERR-010 | Không permission → 403 |
| AC-013 | FR-020 | Merge busySlots bị chồng lấn/tiếp nối |
| AC-014 | FR-018, ERR-014 | excludeMeetingId ngăn chặn IDOR → 403 |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- **Approve/reject meeting request**: Không xử lý duyệt hoặc từ chối booking request. Đây là scope của module approvals riêng.
- **Tự động đổi giờ họp**: Hệ thống không tự động điều chỉnh thời gian họp khi phát hiện conflict.
- **Tự động xóa participant bị bận**: Hệ thống không tự động loại bỏ participant khỏi danh sách.
- **Gửi email/notification**: Không gửi thông báo cho participant bị conflict.
- **Room conflict**: Không kiểm tra xung đột phòng họp trong feature này.
- **Tạo personal calendar event mới**: Không tạo sự kiện lịch cá nhân cho participant.
- **Hiển thị chi tiết cuộc họp riêng tư của participant**: Không lộ title, description, agenda của meeting khác.
- **Thêm bảng database mới**: Database v3.2 Compact (39 bảng) đã đáp ứng đủ.
- **Tính conflict từ schedule_conflicts**: Bảng này đã bị loại khỏi DB compact; conflict tính động.
- **Không tạo snapshot cập nhật sau khi meeting request đã tạo**: conflict_summary_json chỉ ghi một lần.

### 8.1 Không triển khai trong feature này

- Không implement endpoint approve/reject meeting request.
- Không implement auto-adjust time/participant.
- Không implement email/push notification gửi participant.
- Không implement room conflict check (UC-52).
- Không tạo bảng database mới.

### 8.2 Có thể xem xét ở feature khác

- **Room conflict check**: UC-52 (POST /api/v1/scheduling/room-conflicts/check).
- **Time suggestion**: UC-51 (POST /api/v1/scheduling/time-suggestions).
- **Approval flow**: module approvals.
- **Notification cho participant khi bị conflict**: Có thể thêm ở phiên bản sau.

### 8.3 Out-of-scope EARS Guardrails

OOS-001: THE system SHALL NOT approve or reject meeting requests as part of this feature.
OOS-002: THE system SHALL NOT automatically adjust meeting time or remove conflicting participants.
OOS-003: THE system SHALL NOT send email or push notifications for participant conflicts.
OOS-004: THE system SHALL NOT check room booking conflicts in this feature.
OOS-005: THE system SHALL NOT create new database tables or fields for this feature.
OOS-006: THE system SHALL NOT expose private meeting details (title, description, room, participant list) of other meetings.

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh.
- [x] Đã có đủ 5 EARS basic patterns.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, auth, authorization, system error.
- [x] Error requirements đã ưu tiên format IF ... THEN THE system SHALL.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR.
- [x] Out of Scope đủ rõ.
- [x] Các phần thiếu thông tin đã được đưa vào Cần làm rõ.
