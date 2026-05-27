# Feature Specification: Register Camera/IoT Device

- **Feature ID**: IOT-001
- **Feature Name**: Đăng ký thiết bị camera/IoT vào hệ thống
- **Module / Domain**: iot
- **Created Date**: 2026-05-27
- **Status**: Draft
- **Source Documents**:
  - `CLAUDE.md` (Sections 11.2, 11.13 - 11.21)
  - `spec/global/constitution.md`
  - `.specify/templates/spec-template.md`

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống Intelligent Meeting Lifecycle Management System cần tích hợp với các thiết bị phần cứng để phục vụ điểm danh, phát hiện hiện diện và ghi hình cuộc họp. Hiện tại, v1 của hệ thống hỗ trợ các loại thiết bị camera/IoT chính như:
1. **Door Face Attendance Terminal**: Thiết bị điểm danh khuôn mặt đặt tại cửa (gửi HTTP callback).
2. **IP Room Camera**: Camera IP góc phòng (cung cấp luồng RTSP cho Python Camera Service).

Khác với `equipments` (quản lý tài sản vật lý nói chung), `iot_devices` là các thiết bị có khả năng kết nối mạng, gửi event, heartbeat hoặc metadata. Để hệ thống có thể nhận diện, xác thực và xử lý sự kiện từ các thiết bị này, bước đầu tiên là phải đăng ký thông tin thiết bị (metadata, connection info, credentials) vào hệ thống (bảng `iot_devices`).

### 1.2 Mục tiêu

Cho phép người dùng có quyền quản trị (Admin/Manager) đăng ký một thiết bị camera hoặc IoT mới vào hệ thống thông qua endpoint `POST /api/v1/iot-devices`. Việc này tạo ra một record `iot_devices` để định danh thiết bị, lưu trữ thông tin cấu hình cơ bản, tạo tiền đề cho các chức năng cấu hình chuyên sâu (RTSP, callback token), gán phòng (assign room) và nhận luồng dữ liệu sau này.

### 1.3 Giá trị mang lại

- Cung cấp định danh duy nhất (`device_code`, `id`) trong hệ thống để xác thực các event gửi từ thiết bị (như heartbeat, verify event).
- Lưu trữ cấu hình kết nối mạng (IP, MAC) tập trung.
- Làm cơ sở cho việc phân quyền và quản lý vòng đời thiết bị.

### 1.4 Giả định

- Backend Framework: NestJS, Database: PostgreSQL, ORM: TypeORM.
- Endpoint: `POST /api/v1/iot-devices`.
- Hệ thống phân quyền RBAC và JWT xác thực đã được cấu hình và hoạt động.
- Module `iot` chịu trách nhiệm chính về quản lý thông tin các thiết bị IoT này.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Admin / Manager | Người dùng tạo thiết bị | Cung cấp thông tin cấu hình chính xác của thiết bị (tên, mã thiết bị, loại) |
| System | Máy chủ xử lý yêu cầu | Validate dữ liệu, lưu record vào database, đảm bảo tính unique của mã thiết bị và MAC address |

### 2.2 Role & Permission Rules

- Endpoint yêu cầu xác thực JWT (`Bearer Token`).
- Chỉ những người dùng có quyền `iot_devices:create` (thường là Admin hoặc System Manager) mới được phép thực hiện chức năng này.

### 2.3 Actor Constraints

- Người dùng phải cung cấp `device_code` (mã định danh phần cứng/vendor) duy nhất cho mỗi thiết bị.
- Người dùng không được phép tự do gán trạng thái online ngay khi vừa tạo.

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: Hệ thống phải cung cấp endpoint `POST /api/v1/iot-devices` để đăng ký thiết bị IoT mới.
FR-002: Khi nhận yêu cầu đăng ký, hệ thống phải validate định dạng của request body (DTO validation) trước khi xử lý nghiệp vụ.
FR-003: Nếu request thiếu các trường bắt buộc (`device_name`, `device_code`, `device_type`), hệ thống phải từ chối yêu cầu và trả về mã lỗi 400 (Validation Error).
FR-004: Khi dữ liệu hợp lệ, hệ thống phải kiểm tra sự tồn tại của `device_code` trong bảng `iot_devices`. Nếu đã tồn tại, trả lỗi 409 (Conflict).
FR-005: Nếu người dùng cung cấp `mac_address`, hệ thống phải chuẩn hóa format và kiểm tra trùng lặp. Nếu MAC đã tồn tại ở thiết bị khác, trả lỗi 409. (IP address không yêu cầu unique).
FR-006: `metadata_json` chỉ cần validate là một JSON object hợp lệ (Loose Validation). Không yêu cầu bắt buộc các schema cụ thể theo `device_type` ở bước này.
FR-007: Khi tất cả hợp lệ, hệ thống tiến hành tạo mới bản ghi thiết bị trong database.
FR-008: Khi lưu thiết bị, hệ thống phải thiết lập trạng thái mặc định như sau: `status = offline`, `health_status = unknown`, `last_seen_at = null`.
FR-009: Khi đăng ký thành công, hệ thống trả về thông tin chi tiết của thiết bị vừa tạo. Dù UC này không bắt buộc các trường nhạy cảm, nhưng nếu `metadata_json` chứa các key như `secret`, `token`, `password`, `callback_secret`, hệ thống phải mask (ví dụ `***`) hoặc omit các trường này trong response.
```

### 3.2 Workflow Requirements

```text
FR-011: Quá trình đăng ký KHÔNG bao gồm việc gán phòng họp. Mọi payload chứa `room_id` ở bước này đều bị bỏ qua (việc gán phòng được xử lý qua API riêng `POST /api/v1/iot-devices/:id/assign-room`).
FR-012: UC này KHÔNG tự động tạo hay yêu cầu `secret_token` cho callback. Việc cấu hình bảo mật kết nối sẽ được xử lý ở UC riêng.
FR-013: Khi đăng ký thành công, hệ thống phải lưu vết người thực hiện hành động vào trường `created_by` dựa trên thông tin JWT.
```

### 3.3 Authorization Requirements

```text
FR-014: Nếu request không có JWT hoặc token không hợp lệ, hệ thống phải trả về mã lỗi 401 (Unauthorized).
FR-015: Nếu người dùng không có quyền `iot_devices:create`, hệ thống phải trả về mã lỗi 403 (Forbidden).
```

### 3.4 Data & State Requirements

```text
FR-016: Hệ thống phải hỗ trợ các loại thiết bị (`device_type`) theo chuẩn: `door_face_terminal`, `ip_room_camera`, `room_camera`, `microphone`, `capture_agent`, `occupancy_sensor`, `display`, `other`.
FR-017: Hệ thống cho phép lưu trữ cấu hình tuỳ chọn dưới dạng JSON object (trường `metadata_json`). 
```

### 3.5 Notification / Audit Requirements

```text
FR-018: Khi tạo thiết bị thành công, hệ thống phải sinh ra một Audit Log ghi lại hành động của người dùng (Actor ID, Action: iot_devices.create, Target ID).
```

---

## 4. Non-functional Requirements

### 4.1 Performance
- **NFR-001**: API Response Time cho thao tác đăng ký thiết bị mới phải < 500ms ở điều kiện mạng bình thường.

### 4.2 Security
- **NFR-002**: Không được log các thông tin nhạy cảm. Nếu Client/Frontend gửi các key như `secret`, `token`, `password`, `callback_secret` vào `metadata_json`, KHÔNG được ghi ra log (console/file) và KHÔNG được trả nguyên giá trị trong response (phải mask hoặc omit hoàn toàn).
- **NFR-003**: Cần sanitize input, đặc biệt là trường `metadata_json` để chống JSON injection.
- **NFR-004**: Ràng buộc unique của `device_code` phải được set ở cấp độ Database Schema (Global Unique).
- **NFR-005**: Ràng buộc unique của `mac_address` (nếu có) phải dùng partial unique index (`mac_address IS NOT NULL`).

### 4.3 Reliability & Consistency
- **NFR-006**: Đảm bảo Transaction toàn vẹn. Nếu xảy ra lỗi khi insert `iot_devices` thì rollback toàn bộ transaction (kể cả audit log nếu ghi vào DB).

### 4.4 Usability
- **NFR-007**: Error response phải đồng nhất theo quy chuẩn của dự án (ví dụ `{ statusCode, message, error }`) giúp frontend dễ dàng hiển thị thông báo.

### 4.5 Observability
- **NFR-008**: Ghi Error Log đối với các lỗi system (500) kèm theo stack trace nội bộ (ẩn với người dùng).

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng |
|---|---|
| `iot_devices` | Bảng chính lưu trữ thông tin cấu hình, danh tính của thiết bị |

### 5.2 Dữ liệu đầu vào (Request Payload)

| Field | Type | Required | Mô tả / Validation |
|---|---|---|---|
| `device_name` | string | Yes | Tên định danh thiết bị (ví dụ: "Camera cửa phòng A1"). Max length: 255. |
| `device_code` | string | Yes | Mã phần cứng duy nhất (S/N, mã NSX). Unique. No spaces at start/end. |
| `device_type` | enum | Yes | Phải thuộc list enum cho phép (xem phần 5.4). |
| `ip_address` | string | No | Địa chỉ IP của thiết bị (DHCP hoặc tĩnh). Validate IP format. Không yêu cầu Unique. |
| `mac_address` | string | No | Địa chỉ MAC (nếu có). Validate MAC format, chuẩn hóa in hoa hoặc thường. Unique nếu khác null. |
| `metadata_json` | jsonb | No | Cấu hình động không yêu cầu schema khắt khe (ví dụ: `{"protocol": "http_callback", "vendor": "unknown"}`). |

### 5.3 Dữ liệu đầu ra (Response)

| Field | Type | Mô tả |
|---|---|---|
| `id` | uuid | Khóa chính sinh tự động |
| `device_name` | string | Tên thiết bị |
| `device_code` | string | Mã phần cứng |
| `device_type` | string | Loại thiết bị |
| `ip_address` | string/null | IP (nếu có) |
| `mac_address`| string/null | MAC (nếu có) |
| `status` | string | Trạng thái (luôn là `offline` lúc tạo mới) |
| `health_status` | string | Tình trạng sức khỏe (luôn là `unknown` lúc tạo mới) |
| `last_seen_at` | timestamp/null | Lần cuối trực tuyến (luôn là `null` lúc tạo mới) |
| `metadata_json` | jsonb | Metadata cấu hình (đã được mask/omit các trường nhạy cảm nếu có) |
| `created_by` | uuid | Người tạo |
| `created_at` | timestamp | Thời gian tạo |

### 5.4 State / Status Model (của `iot_devices`)

| Trường | Trạng thái mặc định | Giải thích |
|---|---|---|
| `status` | `offline` | Thiết bị vừa tạo chưa gửi tín hiệu hoặc chưa kết nối. Sẽ chuyển `online` qua các luồng khác. |
| `health_status` | `unknown` | Chưa xác định được tình trạng thiết bị. Cập nhật qua check-health API. |
| `last_seen_at` | `null` | Chưa có tín hiệu ghi nhận nào từ thiết bị. |
| `device_type` (Enum) | N/A | Bao gồm: `door_face_terminal`, `ip_room_camera`, `room_camera`, `microphone`, `capture_agent`, `occupancy_sensor`, `display`, `other`. |

### 5.5 Data Lifecycle
- **Create**: Tạo bởi Admin/Manager qua endpoint này.
- **Update**: Cấu hình chuyên sâu (RTSP, callback token) hoặc cập nhật trạng thái trong các UC khác.
- **Delete**: Có thể là soft-delete hoặc hard-delete (trong UC quản lý thiết bị tương ứng).

---

## 6. Validation & Error Handling

### 6.1 Validation Rules

- `device_name`: Not empty, max length 255.
- `device_code`: Not empty, alphanumeric or specific pattern (tuỳ vendor), trimmed.
- `device_type`: In Enum (`door_face_terminal`, `ip_room_camera`, `room_camera`, `microphone`, `capture_agent`, `occupancy_sensor`, `display`, `other`).
- `ip_address`: Is IP format (if provided).
- `mac_address`: Is MAC address format (if provided). Validates regex format and standardizes casing.
- `metadata_json`: Is valid JSON Object (if provided).

### 6.2 Error Groups & Error Handling

| Mã lỗi HTTP | Error Code / Message | Kịch bản phát sinh |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Payload thiếu trường bắt buộc, sai định dạng enum, sai định dạng IP/MAC/JSON. |
| 401 | `UNAUTHORIZED` | Request không có token hoặc token hết hạn. |
| 403 | `FORBIDDEN` | User không có quyền `iot_devices:create`. |
| 409 | `DEVICE_CODE_EXISTS` | `device_code` đã được sử dụng bởi một thiết bị khác. |
| 409 | `MAC_ADDRESS_EXISTS` | `mac_address` đã được gán cho một thiết bị khác. |
| 500 | `INTERNAL_SERVER_ERROR`| Lỗi hệ thống, lỗi kết nối Database. |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

**Scenario 1: Đăng ký thiết bị Face Attendance Terminal thành công (Loose validation, bỏ qua config nâng cao)**
- **Given** người dùng là Admin đã đăng nhập hợp lệ.
- **When** gửi POST request đến `/api/v1/iot-devices` với payload:
  ```json
  {
    "device_name": "Terminal Cửa Phòng Họp A",
    "device_code": "FACE-DEV-001",
    "device_type": "door_face_terminal",
    "metadata_json": {
      "protocol": "http_callback",
      "vendor": "unknown",
      "model": "face-terminal"
    }
  }
  ```
- **Then** hệ thống trả về status code 201 Created.
- **And** kết quả response chứa thiết bị với `status` là `offline`, `health_status` là `unknown`, `last_seen_at` là `null`.
- **And** thiết bị được lưu thành công vào bảng `iot_devices`.

### 7.2 Validation Cases

**Scenario 2: Đăng ký thất bại do lỗi MAC address trùng lặp**
- **Given** trong hệ thống đã có thiết bị mang `mac_address` là "00:1A:2B:3C:4D:5E".
- **When** người dùng tạo thiết bị mới gửi kèm MAC trên (dù ghi hoa hay thường).
- **Then** hệ thống trả về status code 409 Conflict với lỗi `MAC_ADDRESS_EXISTS`.

**Scenario 3: Thiết bị có truyền IP trùng lặp (Success)**
- **Given** trong hệ thống đã có thiết bị mang `ip_address` là "192.168.1.100".
- **When** người dùng tạo thiết bị mới gửi kèm IP "192.168.1.100".
- **Then** hệ thống KHÔNG chặn lỗi trùng IP, tiếp tục xử lý và trả về 201 Created (miễn `device_code` và `mac_address` hợp lệ).

**Scenario 4: Test bảo mật khi Client vô tình truyền key nhạy cảm**
- **Given** payload tạo thiết bị chứa `metadata_json` với field `"secret_token": "sensitive_data"`.
- **When** thiết bị được tạo thành công.
- **Then** response trả về phải omit trường này hoặc trả về `"secret_token": "***"`.
- **And** không có raw token nào xuất hiện trong Server Logs.

### 7.3 Authorization Cases

**Scenario 5: Người dùng không có quyền truy cập**
- **Given** người dùng đăng nhập bằng tài khoản không có quyền `iot_devices:create`.
- **When** gọi API tạo thiết bị.
- **Then** hệ thống trả về mã lỗi 403 Forbidden.

---

## 8. Out of Scope

Các tính năng/nghiệp vụ sau KHÔNG nằm trong phạm vi của Use Case này:
- Không sinh token, không yêu cầu callback token, và không cấu hình bảo mật callback hoàn chỉnh (Sẽ nằm ở UC riêng: "Cấu hình thông tin kết nối Face Server" / "Generate callback token").
- Không thực hiện strict validation các key bên trong `metadata_json` theo `device_type`. Cấu hình chi tiết (vd: `rtsp_url`) sẽ do các UC riêng đảm nhận (như UC "Cấu hình RTSP cho IP Camera góc phòng").
- Không gửi lệnh kiểm tra/ping (check health) đến thiết bị ngay lập tức sau khi tạo. (Sẽ có API `POST /api/v1/iot-devices/:id/check-health` riêng).
- Không gán thiết bị vào phòng (Gán qua endpoint `POST /api/v1/iot-devices/:id/assign-room`).
- Không xử lý Callback hay Heartbeat từ Face Server (Thuộc UC khác trong module `face-attendance`).
- Không xử lý luồng nhận hình ảnh/RTSP của IP Camera (NestJS không đọc RTSP stream trực tiếp).
- Không lưu, map người dùng vào Face Server hay xử lý thẻ, mã vân tay, dữ liệu khuôn mặt.
- Không cấu hình MQTT / Mosquitto, IVSS.
