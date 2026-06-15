# Tasks: Chuẩn hóa payload sự kiện camera (IOT-010)

## 1. Kiểm tra codebase hiện tại

* [x] Kiểm tra `src/modules/iot/services/iot-device-events.service.ts` đã được tạo từ IOT-009 chưa.
* [x] Kiểm tra `src/modules/iot/entities/iot-device-event.entity.ts`.
* [x] Kiểm tra `IotDeviceEvent` entity có các field: `id`, `eventType`, `eventTime`, `payloadJson`, `processedStatus`, `errorMessage`, `createdAt`.
* [x] Kiểm tra convention update JSONB trong codebase.
* [x] Kiểm tra helper `maskSensitiveMetadata()` hoặc helper sanitize error hiện có.
* [x] Kiểm tra file test service hiện có, ví dụ `iot-device-events.service.spec.ts`.
* [x] Đảm bảo không có controller/API cho UC này.

## 2. Mở rộng `IotDeviceEventsService`

* [x] Cập nhật `src/modules/iot/services/iot-device-events.service.ts`.
* [x] Thêm method `normalizeRawEvent(rawEventId: string)`.
* [x] Thêm method `normalizePendingRawEvents(limit: number)`.
* [x] Không tạo service mới nếu convention đang gộp logic event vào `IotDeviceEventsService`.
* [x] Không tạo controller/API.
* [x] Không tạo queue/cron/background job.

## 3. Implement `normalizeRawEvent(rawEventId)`

* [x] Query `iot_device_events` theo `rawEventId`.
* [x] Nếu không tồn tại, xử lý theo convention codebase, ví dụ `NotFoundException`.
* [x] Nếu `processedStatus !== 'received'`, trả `{ status: 'skipped', reason: 'Already processed or invalid status' }`.
* [x] Không normalize lại event đã `processed`, `ignored`, hoặc `failed`.
* [x] Không ghi đè `payloadJson.normalized_event` nếu event đã xử lý trước đó.
* [x] Nếu `eventType` không thuộc `face_verify` hoặc `face_stranger`, update:
  * `processedStatus = 'ignored'`
  * `errorMessage = 'Unsupported event type for normalization'`
* [x] Nếu event hợp lệ, build `normalized_event`.
* [x] Merge `payloadJson.normalized_event = builtNormalizedEvent`.
* [x] Update:
  * `processedStatus = 'processed'`
  * `errorMessage = null`
* [x] Save lại entity.

## 4. Implement `normalizePendingRawEvents(limit)`

* [x] Query tối đa `limit` events có:
  * `processedStatus = 'received'`
  * `eventType IN ('face_verify', 'face_stranger')`
* [x] Order theo `createdAt ASC`.
* [x] Xử lý từng event độc lập bằng `normalizeRawEvent(event.id)` hoặc private method tương đương.
* [x] Dùng `for...of`, không dùng logic làm fail cả batch khi một event lỗi.
* [x] Nếu một event lỗi kỹ thuật:
  * catch error
  * update riêng event đó thành `processedStatus = 'failed'`
  * ghi `errorMessage` đã sanitize
  * tiếp tục xử lý event tiếp theo
* [x] Trả summary:
  * `total`
  * `processed`
  * `ignored`
  * `failed`
  * `skipped` nếu có

## 5. Không sửa raw snapshot gốc

* [x] Khi update `payloadJson`, phải clone/merge object cũ.
* [x] Chỉ thêm hoặc thay đổi `payloadJson.normalized_event` khi event đang `received`.
* [x] Không sửa/xóa:
  * `payloadJson.raw_payload_sample`
  * `payloadJson.file_metadata`
  * `payloadJson.request_meta`
  * `payloadJson.device_snapshot`
  * `payloadJson.payload_hash`
* [x] Không replace toàn bộ `payloadJson` bằng object chỉ chứa `normalized_event`.

## 6. Build `normalized_event`

* [x] Tạo private helper, ví dụ `buildNormalizedEvent(rawEvent)`.
* [x] Output phải có:
  * `normalized_event_version = 1`
  * `source = 'face_server'`
  * `raw_event_id`
  * `event_type`
  * `recognition_result`
  * `device`
  * `person`
  * `event_time`
  * `received_at`
  * `recognition`
  * `media`
  * `normalization`
* [x] `normalization.status = 'success'`.
* [x] `normalization.normalized_at = now`.
* [x] `normalization.mapper_version = 'face_server_v1'`.

## 7. Device object trong normalized event

* [x] Lấy device info từ `payloadJson.device_snapshot`.
* [x] Build object:
  * `device_id`
  * `device_code`
  * `device_type`
  * `room_id`
* [x] Nếu thiếu một số field trong snapshot thì để `null`, không throw lỗi.

## 8. Person object trong normalized event

* [x] Extract `device_person_id`.
* [x] Extract `device_person_code`.
* [x] Extract `device_person_name`.
* [x] Với `face_stranger`, person fields có thể là `null`.
* [x] Không map `user_id`.
* [x] Không query `device_user_mappings`.
* [x] Không query `users`.

## 9. Field extraction helper

* [x] Tạo helper nội bộ `extractField(payload, possibleKeys)`.
* [x] Helper phải support flat object.
* [x] Helper phải support nested object ở mức hợp lý.
* [x] Không throw nếu không tìm thấy field.
* [x] Nếu không tìm thấy, return `null`.

Alias Person ID:
* [x] Support `person_id`, `personId`, `PersonID`, `UserID`, `user_id`, `EmployeeID`, `employee_id`, `card_no`, `CardNo`, `id`.

Alias Person Name:
* [x] Support `person_name`, `personName`, `PersonName`, `name`, `Name`, `UserName`, `employee_name`, `EmployeeName`.

Alias Similarity / confidence:
* [x] Support `similarity`, `Similarity`, `score`, `Score`, `confidence`, `confidence_score`, `Confidence`, `FaceScore`.

Alias Event time:
* [x] Support `event_time`, `eventTime`, `EventTime`, `capture_time`, `captureTime`, `CaptureTime`, `verify_time`, `verifyTime`, `VerifyTime`, `timestamp`, `Timestamp`, `time`, `Time`.

## 10. Date parsing helper

* [x] Tạo helper nội bộ `parseTolerantDate(payloadVal, dbEventTime, requestReceivedAt)`.
* [x] Support ISO string.
* [x] Support local datetime string nếu parse được.
* [x] Support Unix timestamp seconds.
* [x] Support Unix timestamp milliseconds.
* [x] Nếu payload timestamp invalid/thiếu, dùng `dbEventTime`.
* [x] Nếu `dbEventTime` invalid/thiếu, dùng `requestReceivedAt`.
* [x] Không throw lỗi chỉ vì timestamp payload invalid.

## 11. Recognition result rules

* [x] Với `eventType = 'face_verify'`, set `recognition_result = 'recognized'`.
* [x] Với `eventType = 'face_stranger'`, set `recognition_result = 'stranger'`.
* [x] MVP chưa cần detect fail flag trong verify payload.
* [x] Không block normalize nếu thiếu person id/name trong stranger.

## 12. Media object

* [x] Build media từ `payloadJson.file_metadata`.
* [x] `has_image = file_metadata.length > 0`.
* [x] `file_count = file_metadata.length`.
* [x] `file_metadata = payloadJson.file_metadata`.
* [x] Không xử lý/lưu binary image.
* [x] Không xử lý/lưu base64 image.

## 13. Security & error handling

* [x] Không thêm plain token/password/secret vào `normalized_event`.
* [x] Không log full `raw_payload_sample`.
* [x] Không log token.
* [x] Nếu ghi `errorMessage`, phải sanitize/mask.
* [x] Error message phải ngắn gọn.
* [x] Không đưa raw payload vào error message.
* [x] Không lưu binary/base64 image.

## 14. Processing status behavior

* [x] Normalize success:
  * `processedStatus = 'processed'`
  * `errorMessage = null`
* [x] Unsupported event:
  * `processedStatus = 'ignored'`
  * `errorMessage = 'Unsupported event type for normalization'`
* [x] Technical error:
  * `processedStatus = 'failed'`
  * `errorMessage = sanitized short error`
* [x] Already processed/ignored/failed:
  * không update DB
  * return `{ status: 'skipped', reason: '...' }`

## 15. Unit tests

* [x] Test normalize `face_verify` thành công.
* [x] Test normalize `face_stranger` thành công dù thiếu person id/name.
* [x] Test `processedStatus = received` đổi thành `processed`.
* [x] Test `payloadJson.normalized_event` được merge vào.
* [x] Test raw fields không bị sửa:
  * `raw_payload_sample`
  * `file_metadata`
  * `request_meta`
  * `device_snapshot`
  * `payload_hash`
* [x] Test tolerant alias extraction với `PersonID`.
* [x] Test tolerant alias extraction với `personId`.
* [x] Test tolerant alias extraction với `UserID`.
* [x] Test tolerant alias extraction với nested object.
* [x] Test date parsing với ISO string.
* [x] Test date parsing với Unix seconds.
* [x] Test date parsing với Unix milliseconds.
* [x] Test invalid timestamp fallback về `eventTime`.
* [x] Test unsupported event type chuyển thành `ignored`.
* [x] Test technical error chuyển thành `failed`.
* [x] Test `errorMessage` được sanitize.
* [x] Test batch normalize xử lý từng event độc lập.
* [x] Test một event fail không làm dừng cả batch.
* [x] Test event đã `processed` không bị normalize lại.
* [x] Test event đã `ignored` không bị normalize lại.
* [x] Test event đã `failed` không bị normalize lại.
* [x] Test không expose REST API/controller.

## 16. Manual verification

* [x] Tạo hoặc dùng sẵn record `iot_device_events` có:
  * `eventType = face_verify`
  * `processedStatus = received`
  * `payloadJson.raw_payload_sample`
* [x] Gọi service normalize trong test/manual runner nếu có.
* [x] Kiểm tra DB:
  * `processed_status = processed`
  * `payload_json.normalized_event` tồn tại.
* [x] Kiểm tra raw fields vẫn còn nguyên.
* [x] Tạo hoặc dùng record `face_stranger`.
* [x] Normalize và kiểm tra `recognition_result = stranger`.
* [x] Không test API vì UC này không expose endpoint.

## 17. Final verification

* [x] Chạy linter toàn project (`npm run lint` hoặc command tương đương).
* [x] Chạy test (`npm run test` hoặc command tương đương).
* [x] Chạy build (`npm run build` hoặc command tương đương).
* [x] Nếu không chạy được command nào, ghi rõ lý do.
* [x] Cập nhật checkbox trong `tasks.md`.
* [x] Ghi walkthrough ngắn sau implement:
  * file đã sửa
  * method đã thêm
  * helper đã thêm
  * test pass/fail
  * manual DB verification nếu có
