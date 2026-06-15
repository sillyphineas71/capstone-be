# Feature Specification: Nhận stranger event từ Face Server

- **Feature ID**: IOT-008
- **Feature Name**: Receive Stranger Event from Face Server
- **Module / Domain**: iot
- **Created Date**: 2026-06-02
- **Status**: Draft
- **Source Documents**:
  - IOT-007 (Nhận verify event từ Face Server)
  - Yêu cầu từ thiết kế hệ thống IoT v1

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống Intelligent Meeting Lifecycle Management System tương tác với phần cứng Face Server. Thiết bị này không chỉ nhận dạng khuôn mặt đã đăng ký (Verify event) mà còn có thể phát hiện người lạ, khuôn mặt không khớp với cơ sở dữ liệu và kích hoạt luồng cảnh báo (Stranger event).
Tương tự IOT-007, thiết bị bị giới hạn về độ dài cấu hình URL và có thể làm mất các tham số truy vấn (query params) sau dấu `&`. Do đó, cần có thiết kế URL dạng Short Alias (dùng Path param thay vì Query param) để nhận Stranger event một cách đáng tin cậy.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Backend nhận các sự kiện phát hiện người lạ (Stranger event) từ Face Server thông qua một endpoint bảo mật bằng `callback_token`, trích xuất thông tin thiết bị, kiểm tra tính hợp lệ của request, cập nhật trạng thái thiết bị thành `online` / `healthy`, và lưu trữ mẫu dữ liệu (payload sample) vào `metadata_json` để chuẩn bị cho quá trình bóc tách dữ liệu và kích hoạt luồng cảnh báo an ninh ở các Use Case tiếp theo.

### 1.3 Giá trị mang lại

- Đảm bảo thiết bị Face Server có thể gửi Stranger event thành công về Backend mà không bị lỗi 404/400 do giới hạn URL phần cứng.
- Hệ thống có khả năng thích ứng (tolerant) với nhiều loại định dạng payload (JSON, form-data, multipart/form-data kèm ảnh) mà không bị crash hay phình to Database do dung lượng ảnh lớn.
- Thu thập mẫu payload thực tế của sự kiện Stranger để đội ngũ kỹ thuật có cơ sở xây dựng logic cảnh báo an ninh (Security Alert).
- Giám sát trạng thái hoạt động (online/offline) của thiết bị thông qua các luồng sự kiện.

### 1.4 Giả định

- Stranger event từ Face Server có thể kèm theo một bức ảnh (Snapshot) dung lượng tối đa 5MB.
- Dữ liệu `device_code` và `callback_token` có thể được trích xuất từ 1 trong 5 nguồn: Header, Body JSON, Query param, hoặc Path param.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| IoT Device (Face Server) | Client gửi request | Tự động gửi tín hiệu HTTP POST/GET mỗi khi phát hiện người lạ. |

### 2.2 Role & Permission Rules

- Endpoint dành riêng cho thiết bị IoT (Machine-to-Machine).
- Không sử dụng JWT guard, không sử dụng Role/Permission guard của người dùng thông thường.
- Xác thực hoàn toàn dựa trên sự khớp nhau của `callback_token` được truyền trong request và `callback_token_hash` lưu trong database.

### 2.3 Actor Constraints

- Thiết bị phải được đăng ký trong hệ thống (`device_code` tồn tại, `device_type` = `door_face_terminal`).
- Thiết bị phải được cấu hình bật chức năng callback (`callback_enabled = true`).
- Nếu Backend có cấu hình `allowed_source_ip`, IP gốc của thiết bị phải khớp (best-effort).

---

## 3. Functional Requirements

### 3.1 Event-driven Requirements

FR-001: WHEN thiết bị Face Server gửi tín hiệu Stranger event, THE system SHALL trích xuất `device_code` (ưu tiên: Header `X-Device-Code` > Body JSON `device_code` > Query param `device_code` > Query param `d` > Path param `deviceCode`) và `callback_token` (ưu tiên: Header `X-Callback-Token` > Body JSON `callback_token` > Query param `callback_token` > Query param `t` > Path param `callbackToken`).
FR-002: WHEN tín hiệu Stranger event chứa `device_code` và `callback_token` hợp lệ, THE system SHALL ghi nhận thời điểm nhận tín hiệu vào `last_seen_at`, cập nhật `status = online`, và `health_status = healthy`.
FR-003: WHEN tín hiệu Stranger event hợp lệ được xử lý, THE system SHALL lưu trữ mẫu payload tối giản vào `metadata_json.last_stranger_event_sample` và đẩy vào đầu mảng `metadata_json.recent_stranger_event_samples` (tối đa 5 phần tử).

### 3.2 Unwanted Behavior Requirements

FR-004: IF request không chứa `device_code` ở bất kỳ vị trí nào, THEN THE system SHALL từ chối request với mã lỗi `400 DEVICE_CODE_REQUIRED`.
FR-005: IF không tìm thấy thiết bị nào khớp với `device_code`, THEN THE system SHALL từ chối request với mã lỗi `404 IOT_DEVICE_NOT_FOUND`.
FR-006: IF loại thiết bị (device type) không phải là `door_face_terminal`, THEN THE system SHALL từ chối request với mã lỗi `409 DEVICE_TYPE_NOT_FACE_SERVER`.
FR-007: IF tính năng callback của thiết bị chưa được bật (`callback_enabled = false`), THEN THE system SHALL từ chối request với mã lỗi `409 FACE_CALLBACK_NOT_ENABLED`.
FR-008: IF request không chứa `callback_token` ở bất kỳ vị trí nào, THEN THE system SHALL từ chối request với mã lỗi `401 CALLBACK_TOKEN_REQUIRED`.
FR-009: IF tính năng callback đã bật nhưng thiết bị chưa được cấu hình `callback_token_hash`, THEN THE system SHALL từ chối request với mã lỗi `409 CALLBACK_TOKEN_NOT_CONFIGURED`.
FR-010: IF hash SHA-256 của `callback_token` trong request không khớp với hash lưu trong database, THEN THE system SHALL từ chối request với mã lỗi `401 INVALID_CALLBACK_TOKEN`.
FR-011: IF `allowed_source_ip` có cấu hình, IP gốc của request xác định rõ ràng và không khớp, THEN THE system SHALL từ chối request với mã lỗi `403 SOURCE_IP_NOT_ALLOWED`.
FR-012: IF payload chứa dữ liệu quá lớn (với multipart/form-data: giới hạn `fileSize = 5 * 1024 * 1024` (5MB) mỗi file và tối đa 5 files), THEN THE system SHALL từ chối request bằng mã lỗi `413 Payload Too Large` để bảo vệ server.

### 3.3 Data Masking Requirements

FR-013: THE system SHALL cắt gọn (truncate) bất kỳ trường văn bản nào trong payload có độ dài vượt quá 2000 ký tự và gắn nhãn `truncated: true` để tránh phình Database.
FR-014: THE system SHALL NOT lưu trữ nội dung file (binary/base64, `file.buffer`) của bức ảnh đính kèm vào database hoặc storage, mà chỉ lưu thông tin metadata của file (`fieldname`, `originalname`, `mimetype`, `size`).
FR-015: THE system SHALL che giấu (mask) hoặc loại bỏ `callback_token` (nếu có trong payload) trước khi lưu vào `metadata_json` để bảo đảm an toàn bảo mật.

---

## 4. Non-functional Requirements

### 4.1 Security

NFR-001: THE system SHALL NOT trả về nội dung `callback_token`, hash, hay mật khẩu trong các API response (kể cả khi báo lỗi).
NFR-002: THE system SHALL NOT lưu trữ plain-text của `callback_token` xuống DB.
NFR-003: THE system SHALL thực hiện kiểm tra IP gốc (source IP) của request so với `allowed_source_ip` (nếu có cấu hình) dưới dạng best-effort (có xử lý chuyển đổi IPv4-mapped IPv6).

### 4.2 Usability & Maintenance

NFR-004: THE system SHALL duy trì một controller riêng biệt (ví dụ `stranger-short-device-callbacks.controller.ts` dùng `@Controller('sf')`) để xử lý các Short Alias Route (`GET/POST /api/v1/sf/:deviceCode/:callbackToken`) nhằm không làm bẩn Canonical Route (`/api/v1/device-callbacks/face/stranger`). Controller này tuyệt đối không được nhầm lẫn sang `/hb` hay `/vf`.
NFR-005: THE system SHALL NOT sao chép logic (duplicate business logic) ở Controller mới. Short Alias Controller chỉ làm nhiệm vụ parse tham số và gọi chung service method xử lý Stranger Event.
NFR-006: THE system SHALL chấp nhận request ngay cả khi Body hoàn toàn trống rỗng hoặc là dữ liệu rác không parse được, miễn là Path param cung cấp đủ token hợp lệ.

---

## 5. Data Model

### 5.1 Cập nhật Entity `iot_devices`

Không tạo bảng mới. Cập nhật các trường sau trong bảng `iot_devices` có sẵn:
- `last_seen_at` (cập nhật thành thời điểm hiện tại).
- `status` (cập nhật thành `online`).
- `health_status` (cập nhật thành `healthy`).
- `metadata_json` (merge thêm dữ liệu mới, KHÔNG xóa dữ liệu cũ).

### 5.2 Cấu trúc `metadata_json` cho Stranger Event

Dữ liệu sẽ được lưu trong `metadata_json` như sau:

```json
{
  "last_stranger_event_sample": {
    "received_at": "2026-06-03T00:00:00.000Z",
    "source_ip": "192.168.2.3",
    "raw_payload_sample": {
      "method": "POST",
      "content_length": "12345",
      "content_type": "multipart/form-data; boundary=---123",
      "_files": [
        {
          "fieldname": "image",
          "originalname": "stranger.jpg",
          "mimetype": "image/jpeg",
          "size": 1342695
        }
      ],
      "PersonID": "",
      "VerifyStatus": "0"
    },
    "extracted_fields": {
      "stranger_id": null,
      "event_time": null,
      "capture_time": null,
      "similarity": null,
      "event_result": "stranger"
    }
  },
  "recent_stranger_event_samples": [
    // Tối đa 5 phần tử (Object tương tự như last_stranger_event_sample), phần tử mới nhất ở index 0
  ]
}
```

---

## 6. Error Handling

| Error Code | HTTP Status | Message | Giải thích |
|---|---|---|---|
| `DEVICE_CODE_REQUIRED` | 400 | Device code is required | Không tìm thấy device_code trong Header, Body, Query hay Path |
| `IOT_DEVICE_NOT_FOUND` | 404 | IoT device not found | device_code không tồn tại trong DB |
| `DEVICE_TYPE_NOT_FACE_SERVER` | 409 | Device is not a face server | Device không phải là door_face_terminal |
| `FACE_CALLBACK_NOT_ENABLED` | 409 | Face callback is not enabled | Cờ callback_enabled đang tắt |
| `CALLBACK_TOKEN_NOT_CONFIGURED`| 409 | Callback token is not configured | Cờ callback_enabled đang bật nhưng thiếu hash trong DB |
| `CALLBACK_TOKEN_REQUIRED` | 401 | Callback token is required | Không tìm thấy token trong Header, Body, Query hay Path |
| `INVALID_CALLBACK_TOKEN` | 401 | Invalid callback token | Token bị sai (hash không khớp) |
| `SOURCE_IP_NOT_ALLOWED` | 403 | Source IP is not allowed | IP gốc của client rõ ràng nhưng không khớp allowed_source_ip |

---

## 7. Acceptance Criteria

- **AC-001**: Thiết bị gọi thành công vào endpoint Short Alias (`GET /api/v1/sf/:deviceCode/:callbackToken` hoặc `POST`) và dữ liệu được ghi nhận vào `last_stranger_event_sample`.
- **AC-002**: Thiết bị gọi thành công vào endpoint Canonical (`GET /api/v1/device-callbacks/face/stranger` hoặc `POST`) nếu cấu hình truyền `X-Device-Code` và `X-Callback-Token` qua Header.
- **AC-003**: Nếu `callback_token` bị thiếu hoặc sai, hệ thống lập tức trả về lỗi `401` và không cập nhật bất kỳ trạng thái nào.
- **AC-004**: Payload chứa một file ảnh dung lượng lớn (ví dụ 1.5MB) không làm sập server; thông tin siêu dữ liệu của file (tên, kích thước, mimetype) được lưu vào mẫu (sample) nhưng dữ liệu nhị phân (binary/buffer) hoàn toàn bị loại bỏ.
- **AC-005**: Nếu gửi liên tiếp 10 sự kiện Stranger, mảng `recent_stranger_event_samples` trong `metadata_json` chỉ chứa đúng 5 sự kiện mới nhất.
- **AC-006**: Toàn bộ dữ liệu cấu hình cũ (như `face_server_config`, `last_verify_event_sample`, `last_heartbeat`) trong `metadata_json` vẫn được giữ nguyên vẹn sau khi cập nhật Stranger Event.

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Không tạo thông báo đẩy, chuông báo động (Notification/Security Alert) cho FE (Front-end). Việc này sẽ được thực hiện ở Use Case khác.
- Không tạo dữ liệu liên quan tới điểm danh: Không tạo `attendance_records`, check-in/check-out event, presence snapshots hay map user.
- Không lưu trữ tệp tin ảnh (image/media file) vào hệ thống Storage.
- Không tạo bảng mới trong database.
- Không tạo các bản ghi Audit Log (do sự kiện này có tần suất xảy ra rất cao).
- Không xử lý tích hợp nhận dạng khuôn mặt (Face Recognition) hay giao tiếp với luồng MQTT/IVSS/Center Connection.
