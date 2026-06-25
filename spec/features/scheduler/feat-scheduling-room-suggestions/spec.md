# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo mới spec cho UC-SM-01 — Xem danh sách phòng họp đề xuất | Toàn bộ file |
| 2026-06-16 | Hoàn thành implement toàn bộ code (module, DTO, service, controller, tests) | Toàn bộ file |
| 2026-06-16 | Cập nhật logic sort phụ, rule thiết bị EXISTS, bỏ buffer time, fix duration max 24h, bổ sung limit 20 phòng, mapping thiết bị theo DB | Các mục 1, 3, 5, 6, 7 |

---

# Feature Specification: Xem danh sách phòng họp đề xuất (Room Suggestion)

- **Feature ID**: UC-SM-01 (tương ứng UC-50 trong API Contract v1.0)
- **Feature Name**: Xem danh sách phòng họp đề xuất
- **Module / Domain**: Scheduling Management (`scheduling`)
- **Created Date**: 2026-06-16
- **Status**: Draft
- **Source Documents**:
  - AGENTS.md (Backend Agent Guide v1.1)
  - API_CONTRACT_v1.0_with_system_roles.md (UC-50)
  - database_v3_2_compact_39_tables.md
  - UseCase_List_SMRMPTS.xlsx (UC-SM-01)

---

## 1. Context & Goal

### 1.1 Bối cảnh

UC-SM-01 thuộc module Scheduling Management, cung cấp cơ chế gợi ý phòng họp thông minh khi người dùng bắt đầu quy trình lên lịch cho một cuộc họp mới. Hiện tại, người dùng phải tự kiểm tra thủ công phòng nào còn trống, đủ sức chứa và thiết bị — dẫn đến mất thời gian, dễ sai sót và tăng nguy cơ double-booking hoặc đặt phòng thiếu thiết bị.

Chức năng này tự động rà soát tài nguyên phòng họp của công ty dựa trên thời gian dự kiến, số người tham gia, yêu cầu thiết bị và các tiêu chí phụ khác, trả về danh sách phòng đang trống và phù hợp nhất. UC-SM-01 là read-only suggestion API, không tạo booking, không giữ chỗ, không approve.

Tính năng này nằm ở giai đoạn **trước cuộc họp** (pre-meeting) trong meeting lifecycle: hỗ trợ người dùng chọn phòng trước khi tạo meeting request hoặc đặt phòng.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Internal Employee** tra cứu danh sách phòng họp đề xuất dựa trên thời gian, sức chứa, thiết bị và vị trí, nhằm giảm thao tác thủ công, tránh conflict booking và tăng hiệu quả đặt phòng.

### 1.3 Giá trị mang lại

- **Người dùng**: Tiết kiệm thời gian tìm phòng, tránh đặt phòng thiếu thiết bị hoặc quá sức chứa.
- **Admin/Quản trị**: Giảm số lượng booking sai, tăng hiệu suất sử dụng phòng họp.
- **Vận hành**: Giảm no-show và phantom booking nhờ kết quả gợi ý chính xác hơn.
- **Dữ liệu**: Tạo cơ sở cho các tính năng analytics về utilization và nhu cầu phòng sau này.

### 1.4 Giả định

- Dữ liệu phòng (`rooms`), thiết bị (`equipments`) và booking (`room_bookings`) đã được đồng bộ và chính xác.
- Trạng thái thiết bị (`asset_status`, `health_status`) được cập nhật kịp thời bởi module Equipment.
- Kết quả gợi ý là snapshot tại thời điểm query; không đảm bảo phòng còn trống sau khi trả kết quả.
- API contract chuẩn đã định nghĩa endpoint `GET /api/v1/scheduling/room-suggestions`.

### 1.5 Định hướng tương lai (Future Enhancements)

- Tham số lọc thiết bị hiện dùng boolean (`hasCamera`, `hasMicrophone`, `hasDisplay`) để tương thích API Contract hiện tại. Khuyến nghị tương lai chuyển sang dùng mảng `requiredEquipmentTypes` (ví dụ: `["camera", "microphone", "display", "speaker"]`) để cover toàn bộ enum `equipment_type`.
- V1 không áp dụng buffer time giữa các cuộc họp (back-to-back booking được phép). Việc thêm buffer time (nếu cần) sẽ là một enhancement sau này và được quản lý qua `system_configs`.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Người dùng nội bộ cần tìm phòng họp phù hợp | Xem danh sách phòng đề xuất, chọn phòng để tiếp tục luồng tạo meeting |
| Manager | Quản lý cần kiểm tra phòng cho team | Xem danh sách phòng đề xuất |
| Business Admin | Quản trị viên đơn vị kinh doanh | Xem danh sách phòng đề xuất |
| System Admin | Quản trị viên hệ thống | Xem danh sách phòng đề xuất |

### 2.2 Role & Permission Rules

- `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` đều được phép sử dụng API gợi ý phòng.
- Permission yêu cầu: `scheduling.suggest.rooms`.
- Không có giới hạn theo phòng ban hay owner — tất cả user authenticated có permission đều xem được tất cả phòng.

### 2.3 Actor Constraints

- Phải đăng nhập (authenticated).
- Phải có quyền `scheduling.suggest.rooms`.
- Phải đang ở trạng thái tài khoản active (không bị locked/inactive).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

```text
FR-001: THE system SHALL chỉ đề xuất các phòng có `is_active = true`, không bao gồm phòng đã bị soft delete (`deleted_at IS NULL`).
FR-002: THE system SHALL chỉ đề xuất các phòng có sức chứa lớn hơn hoặc bằng `attendeeCount` do người dùng cung cấp.
FR-003: THE system SHALL xếp hạng phòng đề xuất theo ưu tiên: 1. Độ chênh lệch sức chứa (`capacity - attendeeCount` ASC), 2. Tên phòng (`room_name` ASC), 3. Mã phòng (`room_code` ASC).
FR-004: THE system SHALL trả về danh sách phòng dưới dạng snapshot tại thời điểm query, không giữ chỗ hay lock phòng.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN người dùng gửi yêu cầu GET tới endpoint `/api/v1/scheduling/room-suggestions` với các query params hợp lệ, THE system SHALL thực hiện validation input trước khi xử lý business logic.
FR-006: WHEN người dùng không truyền `requiredEquipmentTypes` (dạng hasCamera, hasMicrophone, hasDisplay tương ứng), THE system SHALL bỏ qua filter thiết bị và chỉ lọc theo thời gian, sức chứa, trạng thái phòng.
FR-007: WHEN hệ thống tìm thấy phòng đáp ứng tiêu chí, THE system SHALL trả về danh sách phòng kèm `score` (mức độ phù hợp), `matchedFeatures` và `warnings` nếu có.
```

### 3.3 State-driven Requirements

```text
FR-008: WHILE phòng đang ở trạng thái `maintenance` hoặc `inactive` (`current_status`), THE system SHALL không đưa phòng đó vào danh sách đề xuất.
FR-009: WHILE phòng đã có booking overlap với khung giờ yêu cầu (booking status là `pending`, `approved` hoặc `active`), THE system SHALL loại phòng đó khỏi danh sách đề xuất.
```

### 3.4 Optional Feature Requirements

```text
FR-010: WHERE `roomType` được truyền, THE system SHALL chỉ đề xuất phòng có `room_type` khớp với giá trị được yêu cầu.
FR-011: WHERE `siteName` được truyền, THE system SHALL chỉ đề xuất phòng có `site_name` khớp với giá trị được yêu cầu.
FR-012: WHERE `allowRecording` được truyền với giá trị `true`, THE system SHALL chỉ đề xuất phòng có `allow_recording = true`. Nếu truyền `false` hoặc không truyền, THE system SHALL bỏ qua tiêu chí lọc này.
FR-013: WHERE các boolean thiết bị (`hasCamera`, `hasMicrophone`, `hasDisplay`) được truyền với giá trị `true`, THE system SHALL kiểm tra xem phòng có tồn tại ít nhất 1 thiết bị thuộc loại tương ứng (logic EXISTS với `equipments.equipment_type` là `camera`, `microphone`, hoặc `display`) đáp ứng điều kiện: `asset_status = 'assigned'` VÀ `health_status = 'healthy'` VÀ `deleted_at IS NULL`. Các thiết bị cùng loại nhưng bị lỗi (`faulty`, `offline`, `maintenance`...) trong phòng không làm fail phòng đó nếu vẫn còn ít nhất 1 thiết bị `healthy` cùng loại. Nếu truyền `false` hoặc không truyền, THE system SHALL bỏ qua tiêu chí tương ứng.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-014: IF `startTime` hoặc `endTime` không được cung cấp hoặc không đúng định dạng ISO-8601 có timezone, THEN THE system SHALL từ chối yêu cầu và trả về validation error (422).
FR-015: IF `endTime <= startTime` HOẶC khoảng cách giữa `endTime` và `startTime` lớn hơn 24 giờ, THEN THE system SHALL từ chối yêu cầu và trả về validation error (422) với mã `SCHEDULING_DURATION_TOO_LONG` và message "Thời lượng tìm phòng không được vượt quá 24 giờ."
FR-016: IF `startTime` nằm trong quá khứ, THEN THE system SHALL từ chối yêu cầu và trả về validation error (422).
FR-017: IF `attendeeCount` không được cung cấp, không phải số nguyên dương hoặc <= 0, THEN THE system SHALL từ chối yêu cầu và trả về validation error (422).
FR-018: IF người dùng chưa đăng nhập hoặc token hết hạn, THEN THE system SHALL trả về 401.
FR-019: IF người dùng không có quyền `scheduling.suggest.rooms`, THEN THE system SHALL trả về 403.
FR-020: IF không có phòng nào đáp ứng đủ tiêu chí, THEN THE system SHALL trả về danh sách rỗng và message "Không tìm thấy phòng họp nào đáp ứng đủ các tiêu chí của bạn trong khung giờ này."
```

### 3.6 Authorization Requirements

```text
FR-021: IF the user is not authenticated, THEN THE system SHALL reject access to this feature with HTTP 401.
FR-022: IF the user does not have `scheduling.suggest.rooms`, THEN THE system SHALL reject the request with HTTP 403.
```

### 3.7 Data & State Requirements

```text
FR-023: WHEN yêu cầu gợi ý phòng được thực hiện, THE system SHALL kiểm tra booking overlap sử dụng logic: `existing.reserved_start_time < :endTime AND existing.reserved_end_time > :startTime`, chỉ tính conflict với booking có status là `pending`, `approved` hoặc `active` (cho phép back-to-back booking, mặc định buffer time = 0).
FR-024: THE system SHALL sắp xếp kết quả theo độ chênh lệch sức chứa tăng dần (`capacity - attendeeCount` ASC). Nếu bằng nhau, tiếp tục sắp xếp theo `room_name` tăng dần (ASC), rồi đến `room_code` tăng dần (ASC).
FR-025: THE system SHALL giới hạn kết quả trả về tối đa 20 phòng phù hợp nhất sau khi đã sắp xếp. Không hỗ trợ phân trang (không dùng `page`, `pageSize`, `limit`).
```

### 3.8 Requirement Notes

- Feature này hoàn toàn là read-only, không ghi nhận dữ liệu nào vào database ngoại trừ audit log nếu project convention yêu cầu.
- Không tạo `schedule_conflicts` record — conflict được tính động từ `room_bookings` theo requirement FR-023.
- Kết quả gợi ý không đảm bảo phòng còn trống tại thời điểm người dùng xác nhận booking; conflict cuối cùng phải được check lại ở luồng tạo booking/meeting request.
- Các boolean filter thiết bị (`hasCamera`, `hasMicrophone`, `hasDisplay`) sẽ map trực tiếp sang cột `equipment_type` tương ứng trong bảng `equipments` (`camera`, `microphone`, `display`). Không dùng các enum ngoài chuẩn như `screen`.

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-SM-01, BR2 | Lọc phòng active |
| FR-002 | Ubiquitous | UC-SM-01, BR1 | Lọc sức chứa |
| FR-003 | Ubiquitous | UC-SM-01, BR6 | Sắp xếp ưu tiên |
| FR-004 | Ubiquitous | UC-SM-01, BR7 | Snapshot, không giữ chỗ |
| FR-005 | Event-driven | UC-SM-01 | Validate input |
| FR-006 | Event-driven | UC-SM-01, BR5 | Không filter thiết bị |
| FR-007 | Event-driven | UC-SM-01, Normal Flow step 10 | Trả danh sách |
| FR-008 | State-driven | UC-SM-01, BR2 | Phòng maintenance/inactive |
| FR-009 | State-driven | UC-SM-01, BR3 | Booking overlap |
| FR-010 | Optional Feature | UC-SM-01, A2 | roomType filter |
| FR-011 | Optional Feature | UC-SM-01, A2 | siteName filter |
| FR-012 | Optional Feature | UC-SM-01, A3 | allowRecording |
| FR-013 | Optional Feature | UC-SM-01, BR4 | Thiết bị bắt buộc |
| FR-014 | Unwanted Behavior | UC-SM-01, E2 | Invalid time |
| FR-015 | Unwanted Behavior | UC-SM-01, E2 | endTime <= startTime |
| FR-016 | Unwanted Behavior | UC-SM-01, E2 | startTime trong quá khứ |
| FR-017 | Unwanted Behavior | UC-SM-01, E3 | attendeeCount invalid |
| FR-018 | Unwanted Behavior | UC-SM-01, E5 | Chưa đăng nhập |
| FR-019 | Unwanted Behavior | UC-SM-01, E6 | Không đủ quyền |
| FR-020 | Unwanted Behavior | UC-SM-01, E1 | Không có phòng |
| FR-021 | Authorization | UC-SM-01 | 401 |
| FR-022 | Authorization | UC-SM-01 | 403 |
| FR-023 | Data & State | UC-SM-01, BR3 | Overlap logic |
| FR-024 | Data & State | UC-SM-01, BR6 | Sort logic |
| FR-025 | Data & State | UC-SM-01 | Limit 20 phòng |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL trả về kết quả gợi ý phòng trong vòng 3 giây dưới điều kiện tải bình thường (dưới 50 yêu cầu đồng thời).
```

### 4.2 Security

```text
NFR-002: THE system SHALL require authentication before allowing access to room suggestion data.
NFR-003: THE system SHALL enforce authorization for every request via permission `scheduling.suggest.rooms`.
NFR-004: THE system SHALL NOT expose sensitive data (password hash, token, internal IDs không cần thiết) trong API response.
```

### 4.3 Reliability & Consistency

```text
NFR-005: THE system SHALL đảm bảo dữ liệu phòng và thiết bị được query tại cùng một thời điểm snapshot để tránh inconsistent result.
```

### 4.4 Usability

```text
NFR-006: THE system SHALL return clear error messages phù hợp với API convention của dự án (success, message, data, meta).
NFR-007: THE system SHALL sử dụng field names nhất quán với API contract (camelCase trong response).
```

### 4.5 Observability

```text
NFR-008: THE system SHALL log errors and important processing failures cho feature này.
NFR-009: THE system SHALL ghi audit log nếu project convention yêu cầu cho read-only action (tùy vào policy của team).
```

### 4.6 Maintainability

```text
NFR-010: THE system SHALL giữ logic scheduling riêng trong module `scheduling`, không phụ thuộc chéo vào module `meetings` hay `rooms` ở mức implementation.
NFR-011: THE system SHALL provide test cases for success flows, validation failures, authorization failures, và các business rule chính (overlap, capacity, equipment).
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `rooms` | Thông tin phòng: sức chứa, vị trí, loại phòng, trạng thái, allow_recording | Cột `current_status` kiểm tra available/maintenance/inactive; `is_active` kiểm tra active/deleted |
| `room_bookings` | Kiểm tra phòng bị chiếm trong khoảng thời gian | Dùng `reserved_start_time`, `reserved_end_time`, `status` để tính overlap |
| `equipments` | Kiểm tra thiết bị bắt buộc đang gắn với phòng | Dùng `current_room_id`, `equipment_type`, `asset_status`, `health_status` |
| `audit_logs` | Ghi log truy cập nếu project convention yêu cầu | Optional cho read-only action |

### 5.2 Dữ liệu đầu vào (Query Parameters)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---:|---|---|
| `startTime` | string (ISO-8601) | Có | Thời gian bắt đầu dự kiến | `endTime > startTime`, `startTime >= now()`, đúng định dạng ISO-8601 có timezone |
| `endTime` | string (ISO-8601) | Có | Thời gian kết thúc dự kiến | `endTime > startTime`, đúng định dạng ISO-8601 có timezone |
| `attendeeCount` | integer | Có | Số người tham gia dự kiến | >= 1, integer |
| `roomType` | string | Không | Loại phòng (meeting_room, board_room, training_room, open_space) | Optional, theo enum rooms.room_type |
| `siteName` | string | Không | Tên cơ sở/tòa nhà | Optional |
| `allowRecording` | boolean | Không | Yêu cầu phòng cho phép recording | Optional, nếu false hoặc không truyền thì bỏ qua filter |
| `hasCamera` | boolean | Không | Yêu cầu phòng có camera (map: `equipment_type='camera'`) | Optional, nếu false hoặc không truyền thì bỏ qua filter |
| `hasMicrophone` | boolean | Không | Yêu cầu phòng có microphone (map: `equipment_type='microphone'`) | Optional, nếu false hoặc không truyền thì bỏ qua filter |
| `hasDisplay` | boolean | Không | Yêu cầu phòng có màn hình/máy chiếu (map: `equipment_type='display'`) | Optional, nếu false hoặc không truyền thì bỏ qua filter |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `roomId` | uuid | ID phòng |
| `roomCode` | string | Mã phòng |
| `roomName` | string | Tên phòng hiển thị |
| `capacity` | integer | Sức chứa phòng |
| `score` | number | Điểm phù hợp (0-100) dựa trên độ vừa vặn sức chứa |
| `available` | boolean | true (phòng trống trong khung giờ) |
| `matchedFeatures` | string[] | Danh sách tính năng phòng đáp ứng (vd: ["camera", "microphone", "display"]) |
| `warnings` | string[] | Cảnh báo nếu có (vd: "Room does not have camera") |

### 5.4 State / Status Model

| Status | Ý nghĩa | Áp dụng cho |
|---|---|---|
| `available` | Phòng đang trống, có thể đặt | rooms.current_status |
| `occupied` | Phòng đang có người sử dụng | rooms.current_status |
| `reserved` | Phòng đã được đặt trước | rooms.current_status |
| `maintenance` | Phòng đang bảo trì — không đề xuất | rooms.current_status |
| `inactive` | Phòng không hoạt động — không đề xuất | rooms.current_status |
| `pending` | Booking đang chờ duyệt — tính là conflict | room_bookings.status |
| `approved` | Booking đã duyệt — tính là conflict | room_bookings.status |
| `active` | Booking đang active — tính là conflict | room_bookings.status |
| `completed` | Booking đã hoàn tất — không tính conflict | room_bookings.status |
| `cancelled` | Booking đã hủy — không tính conflict | room_bookings.status |
| `released` | Booking đã giải phóng — không tính conflict | room_bookings.status |

### 5.5 Data Constraints

- `rooms.is_active = true` và `rooms.deleted_at IS NULL` — chỉ đề xuất phòng đang hoạt động.
- `rooms.current_status` không được là `maintenance` hoặc `inactive`.
- Không có unique constraint đặc biệt cho feature này.

### 5.6 Data Lifecycle

- Feature này chỉ đọc dữ liệu, không tạo hoặc cập nhật bản ghi nào.
- Dữ liệu phòng, booking, thiết bị được quản lý bởi module `rooms`, `equipment` và `meetings`.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `startTime` is missing or invalid format, THEN THE system SHALL reject the request with HTTP 422 and error code `VALIDATION_ERROR`.
ERR-002: IF `endTime` is missing or invalid format, THEN THE system SHALL reject the request with HTTP 422 and error code `VALIDATION_ERROR`.
ERR-003: IF `endTime <= startTime` HOẶC `endTime - startTime > 24h`, THEN THE system SHALL reject the request with HTTP 422, error code `SCHEDULING_DURATION_TOO_LONG` and message "Thời lượng tìm phòng không được vượt quá 24 giờ."
ERR-004: IF `startTime` is in the past, THEN THE system SHALL reject the request with HTTP 422 and error code `VALIDATION_ERROR`.
ERR-005: IF `attendeeCount` is missing, not a positive integer, or <= 0, THEN THE system SHALL reject the request with HTTP 422 and error code `VALIDATION_ERROR`.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-006: IF the user is not authenticated, THEN THE system SHALL return HTTP 401 with error code `TOKEN_EXPIRED` or `TOKEN_REVOKED`.
ERR-007: IF the user does not have permission `scheduling.suggest.rooms`, THEN THE system SHALL return HTTP 403 with error code `PERMISSION_DENIED`.
```

### 6.3 Business Rule Errors

```text
ERR-008: IF no rooms match the given criteria, THEN THE system SHALL return HTTP 200 with an empty array and message "Không tìm thấy phòng họp nào đáp ứng đủ các tiêu chí của bạn trong khung giờ này." (không trả 404).
ERR-009: IF thiết bị yêu cầu đang ở trạng thái `maintenance`, `faulty`, `offline`, `retired` hoặc `lost`, THEN thiết bị đó KHÔNG được tính vào danh sách `matchedFeatures`. Phòng sẽ bị loại nếu KHÔNG còn thiết bị nào cùng loại ở trạng thái `healthy` & `assigned` (logic EXISTS).
```

### 6.4 Error Response Expectations

| Field | Mô tả |
|---|---|
| `success` | false |
| `message` | Thông báo lỗi có thể hiển thị |
| `error.code` | Mã lỗi nội bộ (VALIDATION_ERROR, PERMISSION_DENIED, ...) |
| `error.details` | Chi tiết lỗi validation nếu cần |
| `timestamp` | Thời điểm xảy ra lỗi (ISO-8601) |
| `path` | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001: [Happy Path — Có phòng phù hợp]
Given người dùng authenticated có quyền `scheduling.suggest.rooms`,
And có phòng active, đủ sức chứa, không bị overlap booking, đủ thiết bị,
When người dùng gửi GET request tới `/api/v1/scheduling/room-suggestions` với startTime, endTime, attendeeCount hợp lệ,
Then the system returns HTTP 200 với danh sách phòng đề xuất đã sort theo score (capacity phù hợp nhất lên đầu).
```

### 7.2 Validation Cases

```text
AC-002: [Validation — Thiếu startTime]
Given người dùng authenticated,
When người dùng gửi request không có `startTime`,
Then the system returns HTTP 422 với error code `VALIDATION_ERROR`.

AC-003: [Validation — Invalid Duration]
Given người dùng authenticated,
When người dùng gửi request với `endTime <= startTime` hoặc khoảng thời gian lớn hơn 24 giờ,
Then the system returns HTTP 422 với error code `SCHEDULING_DURATION_TOO_LONG` và message "Thời lượng tìm phòng không được vượt quá 24 giờ."

AC-004: [Validation — startTime trong quá khứ]
Given người dùng authenticated,
When người dùng gửi request với `startTime` trong quá khứ,
Then the system returns HTTP 422 với error code `VALIDATION_ERROR`.

AC-005: [Validation — attendeeCount không hợp lệ]
Given người dùng authenticated,
When người dùng gửi request với `attendeeCount` <= 0 hoặc không phải integer,
Then the system returns HTTP 422 với error code `VALIDATION_ERROR`.
```

### 7.3 Authorization Cases

```text
AC-006: [Auth — Chưa đăng nhập]
Given người dùng chưa authenticated,
When người dùng gửi request tới endpoint,
Then the system returns HTTP 401.

AC-007: [Auth — Không đủ quyền]
Given người dùng authenticated nhưng không có permission `scheduling.suggest.rooms`,
When người dùng gửi request tới endpoint,
Then the system returns HTTP 403.
```

### 7.4 Business Rule Cases

```text
AC-008: [Business Rule — Lọc phòng inactive/maintenance]
Given có phòng đang ở trạng thái `maintenance` hoặc `inactive`,
When hệ thống xử lý gợi ý phòng,
Then the system loại các phòng đó khỏi danh sách đề xuất.

AC-009: [Business Rule — Booking overlap]
Given phòng có booking overlap với khung giờ yêu cầu (booking status: pending/approved/active),
When hệ thống xử lý gợi ý phòng,
Then the system loại phòng đó khỏi danh sách đề xuất.

AC-010: [Business Rule — Sức chứa không đủ]
Given phòng có capacity < attendeeCount,
When hệ thống xử lý gợi ý phòng,
Then the system loại phòng đó khỏi danh sách đề xuất.

AC-011: [Business Rule — Sắp xếp ưu tiên]
Given có nhiều phòng đáp ứng tiêu chí,
When hệ thống xử lý gợi ý phòng,
Then the system sắp xếp kết quả theo `capacity - attendeeCount` ASC, nếu bằng nhau thì theo `room_name` ASC, nếu vẫn bằng thì theo `room_code` ASC.

AC-012: [Business Rule — Thiết bị bắt buộc và Logic EXISTS]
Given người dùng truyền `hasCamera=true`,
And có một phòng có 1 camera `healthy` (assigned) và 1 camera `faulty`,
When hệ thống xử lý gợi ý phòng,
Then the system vẫn đề xuất phòng đó (vì có ít nhất 1 camera healthy), và thiết bị `faulty` không được liệt kê trong `matchedFeatures`.

AC-013: [Business Rule — Không yêu cầu thiết bị]
Given người dùng không truyền hasCamera/hasMicrophone/hasDisplay,
When hệ thống xử lý gợi ý phòng,
Then the system bỏ qua filter thiết bị và chỉ lọc theo thời gian/sức chứa/trạng thái.
```

### 7.5 Empty Result Cases

```text
AC-014: [Empty — Không có phòng đáp ứng]
Given không có phòng nào đáp ứng đủ tiêu chí,
When hệ thống xử lý gợi ý phòng,
Then the system returns HTTP 200 với danh sách rỗng và message "Không tìm thấy phòng họp nào đáp ứng đủ các tiêu chí của bạn trong khung giờ này."
(Không trả 404.)

AC-016: [Business Rule — Back-to-back booking]
Given phòng có booking kết thúc đúng bằng `startTime` hoặc bắt đầu đúng bằng `endTime` của yêu cầu gợi ý,
When hệ thống xử lý gợi ý phòng,
Then the system không coi đó là conflict (v1 không áp dụng buffer time).

AC-017: [Business Rule — Bỏ qua tiêu chí khi truyền false]
Given người dùng truyền `allowRecording=false`,
When hệ thống xử lý gợi ý phòng,
Then the system không lọc bỏ các phòng `allow_recording = false` (tương đương với việc bỏ qua tiêu chí này).

AC-018: [Business Rule — Giới hạn số lượng phòng (Limit)]
Given có 50 phòng đáp ứng toàn bộ tiêu chí,
When hệ thống xử lý gợi ý phòng,
Then the system chỉ trả về danh sách 20 phòng tốt nhất (sau khi đã sort) và có thể kèm thông tin `meta: { resultLimit: 20 }`.
```

### 7.6 Concurrency Cases

```text
AC-015: [Concurrency — Snapshot không giữ chỗ]
Given hai người dùng cùng thấy một phòng trong danh sách đề xuất,
When cả hai cùng tiến hành đặt phòng,
Then người xác nhận booking trước sẽ giữ được phòng, người sau phải check conflict lại ở luồng tạo booking và nhận lỗi conflict.
UC-SM-01 không xử lý việc giữ chỗ.
```

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-003, FR-004, FR-005 | Happy path with valid input |
| AC-002 | FR-014, ERR-001 | Missing startTime |
| AC-003 | FR-015, ERR-003 | Duration invalid or > 24h |
| AC-004 | FR-016, ERR-004 | Past startTime |
| AC-005 | FR-017, ERR-005 | Invalid attendeeCount |
| AC-006 | FR-021, ERR-006 | Unauthenticated |
| AC-007 | FR-022, ERR-007 | Unauthorized |
| AC-008 | FR-008, FR-001 | Room inactive/maintenance |
| AC-009 | FR-009, FR-023 | Booking overlap |
| AC-010 | FR-002 | Insufficient capacity |
| AC-011 | FR-003, FR-024 | Sorting by best fit and names |
| AC-012 | FR-013 | Equipment EXISTS logic |
| AC-013 | FR-006 | No equipment filter |
| AC-014 | FR-020, ERR-008 | Empty result |
| AC-015 | FR-004 | Concurrency snapshot |
| AC-016 | FR-023 | Back-to-back booking |
| AC-017 | FR-012, FR-013 | Ignore filter on false |
| AC-018 | FR-025 | Max 20 results limit |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của UC-SM-01:

### 8.1 Không triển khai trong feature này

- **Không tạo meeting**: UC-SM-01 chỉ gợi ý phòng, không tạo meeting record.
- **Không tạo meeting request**: Không tạo `meeting_requests`.
- **Không tạo room booking**: Không tạo `room_bookings`.
- **Không approve/reject booking**: Gợi ý không liên quan đến approval flow.
- **Không giữ chỗ tạm thời**: Kết quả là snapshot, không lock phòng.
- **Không gửi notification/email**: Không tạo `notifications`.
- **Không kiểm tra conflict lịch cá nhân của participant**: Chỉ check conflict phòng, không check `meeting_participants`.
- **Không xử lý recurring meeting**: Chỉ gợi ý cho một khung giờ cụ thể.
- **Không điều khiển IoT/MQTT**: Không gửi/tương tác với thiết bị.
- **Không cập nhật trạng thái thiết bị/phòng**: Read-only.
- **Không thêm bảng mới**: Database v3.2 Compact (39 bảng) đã đáp ứng đủ.
- **Không tính conflict từ `schedule_conflicts`**: Bảng này đã bị loại khỏi DB compact.
- **Không tự động gợi ý khung giờ thay thế**: Đây là scope của UC-51 (time suggestions).

### 8.2 Có thể xem xét ở feature khác

- **Gợi ý thời gian họp tối ưu**: UC-51 (`POST /api/v1/scheduling/time-suggestions`).
- **Kiểm tra conflict phòng chi tiết**: UC-52 (`POST /api/v1/scheduling/room-conflicts/check`).
- **Kiểm tra conflict participant**: UC-53 (`POST /api/v1/scheduling/participant-conflicts/check`).
- **alternativeSuggestions trong empty result**: Có thể thêm ở phiên bản sau nếu cần.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT create any meeting, meeting_request, or room_booking record as part of this feature.
OOS-002: THE system SHALL NOT hold or lock any room temporarily as part of the suggestion query.
OOS-003: THE system SHALL NOT create new database tables or fields for this feature.
OOS-004: THE system SHALL NOT send notifications or emails during the suggestion query.
OOS-005: THE system SHALL NOT check participant schedule conflicts; only room booking conflicts are checked.
```
