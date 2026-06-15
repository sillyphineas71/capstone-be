# Tasks: Lưu raw event từ thiết bị camera (IOT-009)

## 1. Kiểm tra codebase hiện tại
- [x] Kiểm tra `src/modules/iot/iot.module.ts` để biết cách đăng ký entity/service provider.
- [x] Kiểm tra `src/modules/iot/entities/iot-device.entity.ts` để xem convention entity hiện tại.
- [x] Kiểm tra codebase đã có `IotDeviceEvent` entity chưa.
- [x] Kiểm tra codebase đã có `IotDeviceEventsService` chưa.
- [x] Kiểm tra `src/modules/iot/services/iot-devices.service.ts`.
- [x] Kiểm tra method `receiveVerifyEvent()` từ IOT-007.
- [x] Kiểm tra method `receiveStrangerEvent()` từ IOT-008.
- [x] Kiểm tra method `receiveHeartbeat()` để đảm bảo không gọi raw event storage.
- [x] Kiểm tra helper `maskSensitiveMetadata()`.
- [x] Kiểm tra helper truncate payload/file metadata đã có từ IOT-007/IOT-008.
- [x] Kiểm tra convention transaction hiện tại: `DataSource`, `EntityManager`, hoặc `QueryRunner`.

## 2. Tạo hoặc cập nhật Entity `IotDeviceEvent`
- [x] Nếu chưa có, tạo file `src/modules/iot/entities/iot-device-event.entity.ts`.
- [x] Map entity vào bảng có sẵn `iot_device_events`.
- [x] Không tạo migration mới.
- [x] Không thêm column mới.
- [x] Map đúng các column:
  - `id`
  - `device_id`
  - `room_id`
  - `meeting_id`
  - `event_type`
  - `event_time`
  - `source_protocol`
  - `severity`
  - `payload_json`
  - `processed_status`
  - `error_message`
  - `created_at`
- [x] Dùng camelCase ở entity và snake_case ở database mapping.
- [x] Dùng đúng type PostgreSQL:
  - `uuid`
  - `timestamptz`
  - `jsonb`
  - `varchar`
  - `text`
- [x] Nếu có relation với `IotDevice`, chỉ thêm relation nếu không làm rối code hiện tại; tối thiểu phải có `deviceId`.

## 3. Đăng ký Entity/Repository trong module
- [x] Cập nhật `src/modules/iot/iot.module.ts`.
- [x] Thêm `IotDeviceEvent` vào `TypeOrmModule.forFeature([...])`.
- [x] Đảm bảo không ảnh hưởng các entity hiện có như `IotDevice`.
- [x] Không bật hoặc dựa vào TypeORM synchronize để thay đổi schema.

## 4. Tạo internal service `IotDeviceEventsService`
- [x] Tạo file `src/modules/iot/services/iot-device-events.service.ts` nếu chưa có.
- [x] Đăng ký service trong `providers` của `iot.module.ts`.
- [x] Export service nếu `IotDevicesService` cần inject từ cùng module hoặc module khác.
- [x] Service này không có controller riêng.
- [x] Không expose API `GET /api/v1/iot-device-events`.

## 5. Tạo input interface cho `storeRawEvent`
- [x] Tạo internal interface/type, ví dụ `StoreRawEventInput`.
- [x] Input cần có:
  - `device`
  - `eventType`
  - `sourceProtocol`
  - `severity`
  - `receivedAt`
  - `occurredAt`
  - `sourceIp`
  - `httpMethod`
  - `contentType`
  - `contentLength`
  - `rawPayloadSample`
  - `fileMetadata`
  - `extractedFields`
  - `storedByUc`
- [x] Không đưa plain `callback_token` vào input.
- [x] Không đưa `file.buffer` vào input.

## 6. Implement `storeRawEvent(input, entityManager?)`
- [x] Tạo method `storeRawEvent(input, entityManager?)`.
- [x] Nếu caller truyền `EntityManager`, dùng manager đó để insert.
- [x] Nếu không có `EntityManager`, dùng repository/manager mặc định.
- [x] Không tự mở nested transaction nếu caller đã truyền `EntityManager`.
- [x] Insert vào bảng `iot_device_events`.
- [x] Nếu insert fail, throw error, không nuốt lỗi.

## 7. Mapping dữ liệu vào `iot_device_events`
- [x] Set `deviceId = input.device.id`.
- [x] Set `roomId = input.device.roomId` hoặc `null`.
- [x] Set `meetingId = null` trong UC này.
- [x] Set `eventType = face_verify` hoặc `face_stranger`.
- [x] Set `eventTime`:
  - dùng `occurredAt` nếu valid Date.
  - fallback `receivedAt` nếu `occurredAt` thiếu/invalid.
  - không throw nếu timestamp payload invalid.
- [x] Set `sourceProtocol = http`.
- [x] Set `severity = info` với `face_verify`.
- [x] Set `severity = warning` với `face_stranger`.
- [x] Set `processedStatus = received`.
- [x] Set `errorMessage = null`.

## 8. Build `payload_json`
- [x] Build object `payload_json` gồm:
  - `raw_payload_sample`
  - `file_metadata`
  - `request_meta`
  - `device_snapshot`
  - `extracted_fields`
  - `payload_hash`
  - `raw_event_version`
  - `stored_by_uc`
- [x] `request_meta` gồm:
  - `source_ip`
  - `http_method`
  - `content_type`
  - `content_length`
  - `received_at`
- [x] `device_snapshot` gồm:
  - `device_code`
  - `device_type`
  - `room_id`
- [x] `raw_event_version = 1`.
- [x] `stored_by_uc = IOT-009`.
- [x] `payload_hash` phải nằm trong `payload_json.payload_hash`.
- [x] Không thêm column `payload_hash`.

## 9. Security & sanitize
- [x] Chạy `maskSensitiveMetadata()` với payload trước khi lưu.
- [x] Không lưu plain `callback_token`.
- [x] Không lưu secret/password/token ở dạng plain.
- [x] Không log full callback URL.
- [x] Không log plain token.
- [x] Không lưu `file.buffer`.
- [x] Không lưu binary image.
- [x] Không lưu base64 image.
- [x] Nếu có file ảnh, chỉ lưu metadata:
  - `fieldname`
  - `originalname`
  - `mimetype`
  - `size`
- [x] Text field dài phải truncate theo convention IOT-007/IOT-008, ví dụ 2000 ký tự.
- [x] Nếu truncate, giữ flag `truncated: true` nếu convention hiện có hỗ trợ.

## 10. Tính payload hash
- [x] Tính SHA-256 từ object đã sanitize.
- [x] Không đưa plain callback token vào hash.
- [x] Không đưa `file.buffer` vào hash.
- [x] Lưu hash vào `payload_json.payload_hash`.
- [x] Không reject duplicate trong MVP.
- [x] Không tạo unique constraint chống duplicate.

## 11. Tích hợp vào IOT-007 `receiveVerifyEvent()`
- [x] Inject `IotDeviceEventsService` vào `IotDevicesService` nếu cần.
- [x] Cập nhật `receiveVerifyEvent()` trong `src/modules/iot/services/iot-devices.service.ts`.
- [x] Sau khi validate device/token/source IP thành công và build verify sample, gọi `storeRawEvent(...)`.
- [x] Gọi trong cùng transaction với update `iot_devices`.
- [x] Truyền `EntityManager` vào `storeRawEvent`.
- [x] Set:
  - `eventType = face_verify`
  - `severity = info`
  - `sourceProtocol = http`
  - `storedByUc = IOT-009`
- [x] Không thay đổi response contract hiện tại của IOT-007.
- [x] Nếu insert raw event fail, rollback transaction và không trả success giả.

## 12. Tích hợp vào IOT-008 `receiveStrangerEvent()`
- [x] Cập nhật `receiveStrangerEvent()` trong `src/modules/iot/services/iot-devices.service.ts`.
- [x] Sau khi validate device/token/source IP thành công và build stranger sample, gọi `storeRawEvent(...)`.
- [x] Gọi trong cùng transaction với update `iot_devices`.
- [x] Truyền `EntityManager` vào `storeRawEvent`.
- [x] Set:
  - `eventType = face_stranger`
  - `severity = warning`
  - `sourceProtocol = http`
  - `storedByUc = IOT-009`
- [x] Không thay đổi response contract hiện tại của IOT-008.
- [x] Nếu insert raw event fail, rollback transaction và không trả success giả.

## 13. Không lưu heartbeat
- [x] Kiểm tra `receiveHeartbeat()`.
- [x] Đảm bảo `receiveHeartbeat()` không gọi `storeRawEvent()`.
- [x] Heartbeat vẫn chỉ update:
  - `iot_devices.last_seen_at`
  - `status`
  - `health_status`
  - `metadata_json.last_heartbeat`
- [x] Không tạo record `iot_device_events` cho heartbeat trong UC này.

## 14. Transaction rollback behavior
- [x] Đảm bảo update `iot_devices` và insert `iot_device_events` cùng một transaction trong verify.
- [x] Đảm bảo update `iot_devices` và insert `iot_device_events` cùng một transaction trong stranger.
- [x] Nếu insert raw event lỗi:
  - rollback update `iot_devices`
  - rollback metadata changes
  - throw error
  - callback trả lỗi qua exception filter hiện có
- [x] Không catch error rồi trả HTTP 200 giả.

## 15. Unit/integration tests
- [x] Test verify callback hợp lệ tạo 1 record `iot_device_events`.
- [x] Record verify phải có:
  - `event_type = face_verify`
  - `source_protocol = http`
  - `severity = info`
  - `processed_status = received`
- [x] Test stranger callback hợp lệ tạo 1 record `iot_device_events`.
- [x] Record stranger phải có:
  - `event_type = face_stranger`
  - `source_protocol = http`
  - `severity = warning`
  - `processed_status = received`
- [x] Test `payload_json.payload_hash` tồn tại.
- [x] Test không có plain callback token/password/secret trong `payload_json`.
- [x] Test event có file ảnh chỉ lưu metadata file.
- [x] Test không lưu `file.buffer`.
- [x] Test không lưu binary/base64 image.
- [x] Test heartbeat callback không tăng số lượng record `iot_device_events`.
- [x] Test insert raw event fail thì transaction rollback và callback không trả success giả.
- [x] Test event time invalid thì dùng `receivedAt`, không crash.
- [x] Test metadata cũ trong `iot_devices.metadata_json` không bị mất khi transaction thành công.
- [x] Test không có API `GET /api/v1/iot-device-events`.

## 16. Manual verification
- [x] Gửi verify event hợp lệ qua Postman hoặc Face Server thật.
- [x] Kiểm tra bảng `iot_device_events` có record `face_verify`.
- [x] Gửi stranger event hợp lệ qua Postman hoặc Face Server thật.
- [x] Kiểm tra bảng `iot_device_events` có record `face_stranger`.
- [x] Kiểm tra `payload_json.payload_hash`.
- [x] Kiểm tra `payload_json` không có token/password/secret.
- [x] Kiểm tra `iot_devices.metadata_json` vẫn giữ sample gần nhất.
- [x] Gửi heartbeat và xác nhận `iot_device_events` không tăng record.
- [x] Không test hoặc cấu hình API query raw event vì UC này không expose API.

## 17. Final verification
- [x] Chạy linter toàn project (`npm run lint` hoặc command tương đương).
- [x] Chạy test (`npm run test` hoặc command tương đương).
- [x] Chạy build (`npm run build` hoặc command tương đương).
- [x] Nếu không chạy được command nào, ghi rõ lý do.
- [x] Cập nhật checkbox trong `tasks.md`.
- [x] Ghi walkthrough ngắn sau implement:
  - file đã tạo/sửa
  - entity/service đã thêm
  - IOT-007/IOT-008 đã integrate
  - test pass/fail
  - manual DB verification nếu có
