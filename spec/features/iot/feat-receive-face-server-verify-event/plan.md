---
name: feat-receive-face-server-verify-event
description: Implementation plan for receiving verify events from Face Server (IOT-007)
category: iot
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-02 | Sửa đổi logic controller, interceptor limit theo review | Toàn bộ file |

# Kế hoạch triển khai (Implementation Plan) - IOT-007

Mục tiêu: Hiện thực hóa endpoint nhận verify callback từ Face Server nhằm thu thập payload thô (telemetry discovery) theo thiết kế trong `spec.md`.

## Proposed Changes

---

### Module Controllers (`src/modules/iot/controllers`)

#### [MODIFY] [device-callbacks.controller.ts](file:///d:/capstone-be/src/modules/iot/controllers/device-callbacks.controller.ts)
- Cập nhật thêm 2 endpoint canonical mới:
  - `@Get('face/verify')`
  - `@Post('face/verify')`
- Hỗ trợ parser linh hoạt: Thêm `@UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } }))` cho `@Post` để parse được các trường hợp payload dạng `multipart/form-data` một cách an toàn.
- Chuyển tiếp toàn bộ data (`req`, `req.body`, `req.query`, `req.headers`, `req.params`) xuống service method `receiveVerifyEvent()`.
- Không sử dụng `JwtAuthGuard` hay `PermissionsGuard`.

#### [NEW] [verify-short-device-callbacks.controller.ts](file:///d:/capstone-be/src/modules/iot/controllers/verify-short-device-callbacks.controller.ts)
- Tạo controller mới dành riêng cho short alias: `@Controller('vf')`.
- Cập nhật thêm 2 endpoint alias mới:
  - `@Get(':deviceCode/:callbackToken')`
  - `@Post(':deviceCode/:callbackToken')`
- Hỗ trợ parser linh hoạt: Thêm `@UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } }))` cho `@Post`.
- Tương tự như controller trên, chuyển tiếp data xuống `receiveVerifyEvent()`.
- Không sử dụng `JwtAuthGuard` hay `PermissionsGuard`.

---

### Module Services (`src/modules/iot/services`)

#### [MODIFY] [iot-devices.service.ts](file:///d:/capstone-be/src/modules/iot/services/iot-devices.service.ts)
- **Tái sử dụng Helper:** Tái sử dụng logic của `extractValue` để trích xuất `device_code` và `callback_token` theo đúng thứ tự ưu tiên (Header -> Body -> Query -> Query alias -> Path param).
- **Tạo method mới `receiveVerifyEvent(input)`:**
  1. Trích xuất `device_code`. Báo lỗi `400 DEVICE_CODE_REQUIRED` nếu rỗng.
  2. Trích xuất `callback_token`. Báo lỗi `401 CALLBACK_TOKEN_REQUIRED` nếu rỗng.
  3. Tìm thiết bị trong DB. Báo lỗi `404 IOT_DEVICE_NOT_FOUND` nếu không thấy.
  4. Xác thực type (`door_face_terminal`) -> lỗi `409 DEVICE_TYPE_NOT_FACE_SERVER`.
  5. Xác thực callback_enabled -> lỗi `409 FACE_CALLBACK_NOT_ENABLED`.
  6. Verify SHA-256 hash của `callback_token` -> lỗi `401 INVALID_CALLBACK_TOKEN`.
  7. Check IP (best-effort) như IOT-006.
- **Xử lý Payload (Tolerant Ingestion):**
  - Xử lý mảng `req.files` (nếu có do AnyFilesInterceptor cung cấp): trích xuất `fieldname`, `originalname`, `mimetype`, `size`. KHÔNG LƯU `buffer`, KHÔNG LOG `buffer`.
  - Giới hạn độ dài các text fields (vd: 2000 ký tự). Nếu dài hơn, cắt bỏ và đánh cờ `truncated: true`.
  - Tổng hợp `raw_payload_sample` bằng cách gộp body text fields và file metadata.
  - Quét payload qua `maskSensitiveMetadata()` trước khi lưu.
- **Cập nhật Database:**
  - Dùng TypeORM update.
  - Update `last_seen_at` = `new Date()`.
  - Update `status` = `'online'`, `health_status` = `'healthy'`.
  - Clone `metadata_json` cũ để merge.
  - Đẩy event hiện tại vào `metadata_json.last_verify_event_sample`.
  - Thêm event mới vào đầu mảng `recent_verify_event_samples` và giới hạn tối đa 5 items: `[newSample, ...oldSamples].slice(0, 5)`.
  - Không xóa các thuộc tính khác (face_server_config, rtsp_config...).
- **Response Format:**
  - Trả về JSON chuẩn với data chứa `device_code`, `event_type` ("face_verify"), và `received_at`.
  - Đảm bảo Response không leak secret/token/password.

---

### Thử nghiệm (Tests)

#### [NEW] [verify-short-device-callbacks.controller.spec.ts](file:///d:/capstone-be/src/modules/iot/tests/verify-short-device-callbacks.controller.spec.ts)
- Bổ sung unit test cho endpoint `/vf` (`GET` và `POST`).
- Mock service để verify đúng dữ liệu được gọi.

#### [MODIFY] [iot-devices.service.spec.ts](file:///d:/capstone-be/src/modules/iot/services/iot-devices.service.spec.ts)
- Cập nhật mock testing cho method `receiveVerifyEvent`.
- Viết test-case đảm bảo `recent_verify_event_samples` không vượt quá 5.
- Viết test-case đảm bảo file buffer không bị lọt vào DB.

---

## Verification Plan

### Automated Tests
1. Chạy command `npm run test -- verify-short-device-callbacks.controller.spec.ts` để đảm bảo routing và parameter mapping hoạt động chính xác.
2. Viết curl hoặc Postman query gửi payload với các chuẩn (JSON, URL encoded, Multipart/form-data) đảm bảo không crash:
```bash
# Test GET
curl -X GET "http://localhost:3000/api/v1/vf/TEST-CAM-001/my-short-token"

# Test POST with Multipart (Giả lập Face Server gửi Snap)
curl -X POST "http://localhost:3000/api/v1/vf/TEST-CAM-001/my-short-token" \
  -F "person_id=123" \
  -F "image=@/path/to/dummy.jpg"
```

### Manual Verification
1. Trong môi trường thử nghiệm thật, cấu hình Face Server (Verify Subscription = Verify without Pic) và gán URL `/api/v1/vf/TEST-CAM-001/<token>`.
2. Cho người quét mặt hoặc quẹt thẻ trên camera.
3. Kiểm tra trực tiếp trong PostgreSQL: `SELECT metadata_json->'last_verify_event_sample', metadata_json->'recent_verify_event_samples' FROM iot_devices WHERE device_code = 'TEST-CAM-001';` để xác nhận `recent_verify_event_samples` lưu đúng sample.
