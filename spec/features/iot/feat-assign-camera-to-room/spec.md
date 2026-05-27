# Feature Specification: Gán camera vào phòng họp

- **Feature ID**: IOT-002
- **Feature Name**: Gán camera vào phòng họp
- **Module / Domain**: iot
- **Created Date**: 2026-05-28
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu người dùng & Feature Table (Cập nhật từ tên cũ `Gán thủ công camera nhận diện vào phòng họp`)
  - Database Schema v3.2 Compact (39 tables)

---

## 1. Context & Goal

### 1.1 Bối cảnh
Trong hệ thống quản lý phòng họp và thiết bị IoT, sau khi đăng ký thiết bị (UC IOT-001), camera và các terminal (Door Face Attendance Terminal, IP Room Camera) cần được liên kết vật lý/logic vào một phòng họp cụ thể.
Tính năng IOT-002 đảm nhiệm vai trò cập nhật ánh xạ này, cho phép hệ thống nhận biết thiết bị nào đang hoạt động ở phòng nào để phục vụ cho các nghiệp vụ như điểm danh, ghi hình, theo dõi hiện diện sau này. Không sử dụng bảng trung gian, nguồn chân lý (source of truth) được đặt trực tiếp trên trường `room_id` của bảng `iot_devices`.

### 1.2 Mục tiêu
Mục tiêu của tính năng này là cho phép admin thực hiện gán một camera (đã được đăng ký) vào một phòng họp nhằm xác lập mối quan hệ quản lý không gian và thiết bị.

### 1.3 Giá trị mang lại
- **Cho quản trị viên:** Cung cấp cơ chế quản lý thiết bị theo không gian, tránh nhầm lẫn phòng ban. Ngăn chặn việc gán trùng lặp do sơ suất (Overwrite protection).
- **Cho hệ thống:** Chuẩn bị dữ liệu định tuyến chính xác để các service xử lý event từ thiết bị biết được thiết bị đó thuộc phòng nào.

### 1.4 Giả định
- Thiết bị (Camera/Terminal) và Phòng (Room) đã được tạo sẵn trong cơ sở dữ liệu và đang ở trạng thái kích hoạt (active).
- Không yêu cầu thiết bị phải đang có kết nối mạng (online) tại thời điểm gán.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Người dùng có permission `iot_devices:assign_room` | Thực hiện gán camera vào phòng | Có quyền truy cập danh sách camera và phòng, thực thi hành động gán qua API. |

### 2.2 Role & Permission Rules
- Actor phải có quyền (permission) `iot_devices:assign_room`.
- Không hard-code role cụ thể (Admin/Manager), role sẽ được BA team map sau.

### 2.3 Actor Constraints
- Phải đăng nhập hợp lệ (có Bearer Token) và token không bị hết hạn hoặc blacklist.

---

## 3. Functional Requirements

### 3.1 Core Requirements

FR-001: THE system SHALL cập nhật trường `room_id` của bảng `iot_devices` để liên kết thiết bị với phòng họp tương ứng.

### 3.2 Event-driven Requirements

FR-002: WHEN một yêu cầu gán phòng hợp lệ được xử lý thành công, THE system SHALL ghi lại lịch sử vào bảng `audit_logs` với `action_type = 'assign_room'`, `entity_type = 'iot_devices'` cùng `old_room_id` và `new_room_id` trong metadata.

FR-002b: THE system SHALL đảm bảo việc cập nhật `iot_devices.room_id` và ghi `audit_logs` diễn ra trong cùng một database transaction. IF việc ghi log thất bại, THEN THE system SHALL rollback toàn bộ thao tác gán phòng.

### 3.3 State-driven Requirements

FR-003: WHILE một camera đã có `room_id` mang giá trị hợp lệ (khác null) thuộc phòng A, IF có yêu cầu gán nó sang phòng B (khác A), THEN THE system SHALL báo lỗi và không tự động ghi đè phòng.

FR-003b: IF một camera đã có `room_id` bằng đúng với `room_id` được gửi lên, THEN THE system SHALL trả về 200 OK và không thay đổi dữ liệu cũng như không ghi thêm audit log mới.

### 3.4 Unwanted Behavior Requirements

FR-004: IF loại thiết bị (device type) không thuộc nhóm (`door_face_terminal`, `ip_room_camera`, `room_camera`), THEN THE system SHALL từ chối gán và trả về lỗi `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM`.

FR-005: IF thiết bị hoặc phòng họp được yêu cầu không tồn tại, THEN THE system SHALL từ chối gán và trả về lỗi 404 Not Found (`IOT_DEVICE_NOT_FOUND` hoặc `ROOM_NOT_FOUND`).

FR-006: IF thiết bị hoặc phòng họp đang ở trạng thái bị xóa (deleted), vô hiệu hóa (disabled), hoặc ngưng hoạt động (inactive), THEN THE system SHALL từ chối gán.

FR-007: IF người dùng gửi yêu cầu nhưng không có quyền `iot_devices:assign_room`, THEN THE system SHALL từ chối yêu cầu và không thay đổi dữ liệu.

### 3.5 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | IOT-002 Clarification Q1 | Sử dụng `iot_devices.room_id` |
| FR-002 | Event-driven | IOT-002 Clarification Q6 | Thay thế cho bảng lịch sử assignment |
| FR-002b | Unwanted Behavior | IOT-002 Clarification | Transaction requirement |
| FR-003 | State + Unwanted | IOT-002 Clarification Q2 | Chống thao tác nhầm |
| FR-003b | Unwanted Behavior | IOT-002 Clarification | Idempotent rule |
| FR-004 | Unwanted Behavior | IOT-002 Clarification Q3 | Giới hạn loại thiết bị |
| FR-005 | Unwanted Behavior | IOT-002 Clarification Q7 | |
| FR-006 | Unwanted Behavior | IOT-002 Clarification Q7 | |
| FR-007 | Unwanted Behavior | IOT-002 Clarification Q5 | |

---

## 4. Non-functional Requirements

### 4.1 Security
NFR-001: THE system SHALL yêu cầu xác thực người dùng bằng JWT Token cho mỗi yêu cầu gán phòng.

### 4.2 Usability
NFR-002: WHEN yêu cầu gán thất bại do camera đang thuộc phòng khác (FR-003), THE system SHALL trả về mã lỗi `DEVICE_ALREADY_ASSIGNED_TO_ROOM` kèm ID phòng hiện tại nếu phù hợp.

### 4.3 Observability
NFR-003: THE system SHALL lưu thông tin `user_id` của người thực hiện thao tác vào `audit_logs` dựa trên thông tin trích xuất từ JWT Token.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `iot_devices` | Lưu thiết bị và quan hệ phòng họp | Sử dụng trường `room_id` |
| `rooms` | Xác minh thông tin phòng hợp lệ | Dữ liệu phòng họp |
| `audit_logs` | Lưu lịch sử chuyển phòng | |

### 5.2 Dữ liệu đầu vào (API Assign Room)

- **Endpoint**: `POST /api/v1/iot-devices/:id/assign-room` (hoặc dùng param `:device_id`)
- **Body Format**: JSON (snake_case)

| Field | Type dự kiến | Bắt buộc | Vị trí | Mô tả | Validation |
|---|---:|---:|---|---|---|
| `id` (hoặc `device_id`) | `uuid` | Có | Path | ID của thiết bị IoT | UUID format |
| `room_id` | `uuid` | Có | Body | ID của phòng muốn gán | UUID format |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `success` | `boolean` | Trạng thái API |
| `message` | `string` | Thông báo thành công |
| `data` | `object` | Thông tin `iot_device` sau khi được cập nhật (IotDeviceResponseDto) |

### 5.4 Data-related EARS Requirements

FR-DATA-001: WHEN API thực thi thành công, THE system SHALL cập nhật `iot_devices.room_id` bằng giá trị được truyền vào.

---

## 6. Error Handling

### 6.1 Validation Errors
ERR-001: IF trường `room_id` không đúng định dạng UUID, THEN THE system SHALL trả về mã lỗi 400 Bad Request.

### 6.2 Business Rule Errors
ERR-002: IF thiết bị đã có `room_id` khác với `room_id` mới, THEN THE system SHALL trả về 409 Conflict với code `DEVICE_ALREADY_ASSIGNED_TO_ROOM`.
ERR-003: IF thiết bị không phải là camera (`door_face_terminal`, `ip_room_camera`, `room_camera`), THEN THE system SHALL trả về lỗi validation hoặc business error `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM`.

### 6.3 Resource Errors
ERR-004: IF không tìm thấy `iot_device` theo `id`/`device_id`, THEN THE system SHALL trả về 404 với code `IOT_DEVICE_NOT_FOUND`.
ERR-005: IF không tìm thấy `room` theo `room_id`, THEN THE system SHALL trả về 404 với code `ROOM_NOT_FOUND`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path
AC-001:
- Given một camera hợp lệ (chưa gán phòng) và một phòng đang active,
- When người dùng có quyền gửi yêu cầu gán camera vào phòng đó,
- Then hệ thống cập nhật `room_id` của camera, ghi log vào `audit_logs`, và trả về 200 OK cùng dữ liệu camera mới.

### 7.2 Conflict Overwrite Case
AC-002:
- Given một camera đã được gán vào phòng A,
- When người dùng gửi yêu cầu gán camera đó sang phòng B,
- Then hệ thống từ chối yêu cầu, trả về lỗi 409 `DEVICE_ALREADY_ASSIGNED_TO_ROOM` và không thay đổi `room_id`.

### 7.3 Invalid Device Type Case
AC-003:
- Given một thiết bị có loại là `microphone` (hoặc khác 3 loại cho phép),
- When người dùng gửi yêu cầu gán thiết bị vào phòng,
- Then hệ thống từ chối yêu cầu, trả về lỗi `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM`.

### 7.4 Resource Not Active Case
AC-004:
- Given một camera (hoặc phòng) có trạng thái deleted/inactive,
- When người dùng gửi yêu cầu gán,
- Then hệ thống từ chối và trả về lỗi nghiệp vụ phù hợp.

### 7.5 Idempotent Assignment Case
AC-005:
- Given một camera đã được gán vào phòng A,
- When người dùng gửi yêu cầu gán camera đó tiếp tục vào phòng A (trùng `room_id`),
- Then hệ thống trả về 200 OK, không update dữ liệu, và không ghi thêm audit log mới.

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của tính năng này:

- Không sử dụng MQTT/Mosquitto để giao tiếp với thiết bị khi gán phòng.
- Không sử dụng IVSS hoặc xử lý RTSP stream.
- Không xử lý Face Server callback.
- Không xử lý điểm danh (attendance), presence, recording hay no-show trong UC này.
- Không dùng bảng `equipments` và không tạo khóa ngoại (FK) từ/sang `equipments`.
- Không tạo API Unassign Room (Gỡ camera) trong scope của UC IOT-002 này. API `POST /api/v1/iot-devices/:id/unassign-room` được thiết kế riêng dưới dạng một Use Case/API khác.
- Không kiểm tra trạng thái online/health check của thiết bị.

OOS-001: THE system SHALL NOT tạo mới bảng `device_room_assignments` trong khuôn khổ tính năng này.
