# SAL-001 — Stranger → cảnh báo + review (stranger alert)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo spec SAL-001 (Face-access #20): cảnh báo khuôn mặt lạ (Notifications + WS, throttle) + admin read-list. Tái dùng iot_device_events + Notifications + WS (như UMR-001). KHÔNG migration; review-state thật defer. | Toàn bộ |
| 2026-06-19 | Resolve 4 chốt: recipients=admins(in-app)+WS room-scoped; channels WS+in-app, email opt-in env default false; FR-008 strip SanpPic BẮT BUỘC (cả payload_json LẪN recent_stranger_event_samples), alert metadata-only; throttle in-memory + ghi limitation single-instance/restart. | §2,§3.1,§3.4,§4,§5,§8 |

## 1. Mục tiêu
Door Face Terminal phát hiện **người lạ** (không khớp face DB của cam) → gửi **stranger event** về backend. Hiện `receiveStrangerEvent` chỉ **lưu raw** (không cảnh báo, không cho admin xem có cấu trúc). SAL-001 (MVP):
1. **Cảnh báo** admin/chủ phòng khi có stranger (Notifications + WebSocket), có **throttle/dedupe** tránh spam.
2. **Admin read-list** các stranger gần đây (đọc có cấu trúc, KHÔNG lộ snapshot base64).

**NC-1 (kế thừa FAT-001): KHÔNG gác/deny cửa** — chỉ cảnh báo + ghi. **KHÔNG đụng verify path.** **DATA-01: KHÔNG migration** — tái dùng `iot_device_events` (nguồn) + `NotificationsService` + `WebsocketService` (như UMR-001). Review-state thật (review_status/reviewed_by) cần migration của Tài → **defer**.

## 2. RECON (đã đọc, KHÔNG sửa)
- **`StrangerShortDeviceCallbacksController`** ([stranger-short-device-callbacks.controller.ts](../../../../src/modules/iot/controllers/stranger-short-device-callbacks.controller.ts)): `@Controller('sf')`, `GET`/`POST :deviceCode/:callbackToken` → `iotDevicesService.receiveStrangerEvent`.
- **`receiveStrangerEvent`** ([iot-devices.service.ts:~1470-1670](../../../../src/modules/iot/services/iot-devices.service.ts)): xác thực device/token/IP như verify; lưu raw vào **`iot_device_events`** (`event_type='face_stranger'`, `severity='warning'`) + `device.metadataJson.last_stranger_event_sample` / `recent_stranger_event_samples` (5 mẫu). `extractedFields = { stranger_id, event_time, capture_time, similarity, event_result:'stranger' }`. `payload_json` chứa `extracted_fields` + `raw_payload_sample`.
- ⚠ **SanpPic CHƯA strip ở stranger** (khác verify): handler chỉ **truncate >2000**. `newSample.raw_payload_sample = maskSensitiveMetadata({ ...body })`, và `newSample` được dùng cho **CẢ** `storeRawEvent` (→ `iot_device_events.payload_json.raw_payload_sample`) **LẪN** `device.metadataJson.last_stranger_event_sample` / `recent_stranger_event_samples[]`. ⇒ **cả hai nơi đều có thể chứa ~2000 ký tự base64 snapshot** (cùng nguồn `payloadToMask`). (Verify dùng `stripSanpPic`; stranger thì không.) → **FR-008 BẮT BUỘC strip** — strip 1 chỗ trên `payloadToMask` trước khi build `newSample` là phủ cả hai.
- **Hook iot→face-access cho stranger**: **CHƯA có** (chỉ `FACE_VERIFY_HOOK` trong `common/ports/`). `receiveStrangerEvent` hiện **không** gọi Notifications/WS.
- **`WebsocketService`** ([websocket.service.ts:27,42](../../../../src/modules/websocket/websocket.service.ts)): `emitToRoom(room: string, event: string, data: unknown): void`; `emitToUser(userId, event, data)`.
- **`NotificationsService`** ([notifications.service.ts:69,101](../../../../src/modules/notifications/notifications.service.ts)): `createNotification(dto): Promise<NotificationEntity>`; `enqueueEmailNotification(dto)`.
- **`iot_device_events`**: **KHÔNG có** cột `review_status`/`reviewed_by`/`reviewed_at` — chỉ `processed_status` + `payload_json` (jsonb) + `created_at`/`event_time`. → review-state riêng = **cần migration** (defer).

## 3. Functional Requirements (EARS)

### 3.1. Cảnh báo stranger (sau lưu raw)
- **FR-SAL-001-001** (hook, NC-4 no-cycle): mở rộng `receiveStrangerEvent` — **sau khi lưu raw** (đã commit, như verify), gọi hook **`STRANGER_ALERT_HOOK`** (port ở `common`, mẫu `FACE_VERIFY_HOOK`) trong **try/catch** — lỗi cảnh báo KHÔNG làm hỏng response 200. iot `@Optional() @Inject` (không import face-access → tránh circular).
- **FR-SAL-001-002** (recipients + channels — CHỐT): face-access cung cấp `StrangerAlertService implements StrangerAlertHook`; `onStranger({ deviceId, deviceCode, roomId, strangerId, similarity, capturedAt })`:
  - **throttle/dedupe** (FR-003) → nếu trong window → bỏ qua (không cảnh báo lại).
  - **WS room-scoped**: `WebsocketService.emitToRoom(\`room:${roomId}\`, 'face.stranger.alert', { deviceId, roomId, strangerId, similarity, capturedAt })`. `roomId` null → **bỏ emit room** (vẫn in-app notify admins).
  - **In-app notification cho ADMINS**: `NotificationsService.createNotification({ notificationType:'stranger_alert', recipientScope (admins), payloadJson: metadata-only })`. **Recipients = admins** (theo role/scope của Notifications), KHÔNG phải user lạ.
  - **Payload metadata-only** (FR-008): `{ deviceId, roomId, strangerId, similarity, capturedAt }` — **TUYỆT ĐỐI không** snapshot/base64.
- **FR-SAL-001-002b** (channels): **WS + in-app LUÔN bật**. **Email opt-in** qua env **`STRANGER_ALERT_EMAIL_ENABLED`** (bool, default **false**): khi `true` → thêm `NotificationsService.enqueueEmailNotification(...)` cho admins (subject/nội dung metadata-only). Default false → không gửi email.
- **FR-SAL-001-003** (throttle): **1 cảnh báo / device / window** — `STRANGER_ALERT_THROTTLE_SECONDS` (env, default 300). **In-memory `Map<deviceId, lastAlertAt>`** trong `StrangerAlertService`. ⚠ **Limitation (ghi rõ)**: chỉ đúng **single-instance** (Map theo process — nếu scale nhiều instance, mỗi instance throttle riêng) và **reset khi restart** (ngay sau restart có thể có 1 cảnh báo thừa). Chấp nhận MVP; persist (DB/Redis) là ticket sau. Stranger dồn dập → chỉ 1 cảnh báo/window/device.

### 3.2. Admin read-list
- **FR-SAL-001-004**: `GET /api/v1/face-access/stranger-alerts` — **admin-only** (`JwtAuthGuard` + `@Permissions('face.stranger.read')`, SEC-02). Trả stranger gần đây từ `iot_device_events` `event_type='face_stranger'` trong `STRANGER_ALERT_WINDOW_MINUTES` (env, default 1440), dedupe/sort theo `(device_id)` hoặc theo event mới nhất; phân trang (page/limit max 100).
- **FR-SAL-001-005** (SEC-02): response **CHỈ** `deviceId, strangerId, roomId, similarity, lastSeen, hitCount` — **KHÔNG** trả `payload_json` thô / `raw_payload_sample` / snapshot base64. Lấy field qua `payload_json->'extracted_fields'->>'stranger_id'` v.v.

### 3.3. Review/dismiss — MVP defer
- **FR-SAL-001-006**: MVP **KHÔNG** có review-state riêng (đánh dấu đã xử lý) vì `iot_device_events` thiếu cột review → cần migration (Tài). → **OUT-OF-SCOPE** (xem §7). Cảnh báo tự "rụng" khỏi list khi trôi khỏi window.

### 3.4. Không đụng verify + strip
- **FR-SAL-001-007**: KHÔNG sửa verify path (FAT/DCO/UMR). Chỉ thêm hook-call ở `receiveStrangerEvent` + service/controller mới ở face-access.
- **FR-SAL-001-008** (strip SanpPic — BẮT BUỘC): `receiveStrangerEvent` `stripSanpPic(payloadToMask)` **TRƯỚC** khi build `newSample` → phủ **CẢ** `iot_device_events.payload_json.raw_payload_sample` **LẪN** `device.metadataJson.last_stranger_event_sample` / `recent_stranger_event_samples[]` (cùng nguồn). KHÔNG bao giờ lưu base64 ở bất kỳ đâu. Tái dùng `stripSanpPic` ([face-verify-payload.util.ts](../../../../src/modules/iot/utils/face-verify-payload.util.ts)). Alert (FR-002) = **metadata-only**.

## 4. Non-Functional / Constraints
- **NFR-DATA-01**: KHÔNG migration — `iot_device_events` (read) + `notifications` (write qua NotificationsService) + WS.
- **NFR-SEC-02**: read-list admin-only; response không lộ base64/snapshot/secret.
- **NFR-SEC-03**: SQL parameterized, raw qua `DataSource`.
- **NFR-ARCH (NC-4)**: `STRANGER_ALERT_HOOK` ở `common/ports` (leaf) → iot inject mà KHÔNG import face-access (mẫu `FACE_VERIFY_HOOK`); face-access `@Global` provide `useExisting`.
- **NFR-CFG**: `STRANGER_ALERT_THROTTLE_SECONDS` (Joi scoped int default 300) + `STRANGER_ALERT_WINDOW_MINUTES` (int default 1440) + `STRANGER_ALERT_EMAIL_ENABLED` (bool default **false**). Chỉ chèn dòng Joi scoped, KHÔNG prettier cả file.
- **NFR-ENG-01**: unit test ≥ 80% branch (service + controller).

## 5. Acceptance Criteria
- **AC-001**: stranger event hợp lệ (sau lưu raw) → hook gọi → `emitToRoom('room:<roomId>', 'face.stranger.alert', metadata)` + `createNotification(stranger_alert, recipients=admins, payload metadata-only)`.
- **AC-002** (throttle): 2 stranger cùng device trong window → **chỉ 1** cảnh báo (Notifications/WS gọi 1 lần).
- **AC-003**: lỗi hook (Notifications/WS throw) → `receiveStrangerEvent` vẫn trả 200 (try/catch nuốt lỗi).
- **AC-004**: `roomId` null → **không** emit room nhưng vẫn `createNotification` cho admins.
- **AC-005** (read-list): GET trả stranger gần đây trong window, dedupe (device) + lastSeen + hitCount; **KHÔNG** chứa `payload_json`/base64.
- **AC-006**: GET không phải admin → 401/403 (guard).
- **AC-007**: stranger ngoài window → KHÔNG xuất hiện trong list.
- **AC-008** (NC-1): KHÔNG deny; verify path không đổi.
- **AC-009** (email opt-in): `STRANGER_ALERT_EMAIL_ENABLED=false` → KHÔNG `enqueueEmailNotification`; `=true` → có gọi (metadata-only).
- **AC-010** (strip): sau `receiveStrangerEvent`, **cả** `payload_json.raw_payload_sample` **lẫn** `recent_stranger_event_samples[].raw_payload_sample` KHÔNG chứa base64 (`SanpPic='[stripped]'`).

## 6. Edge cases (ý định test — chi tiết để tasks)
- **stranger dồn dập** (nhiều event/giây cùng device) → throttle: chỉ 1 cảnh báo/window (AC-002).
- **device/room null**: roomId null → skip WS room emit, vẫn notify (AC-004); device không có room → list vẫn hiện (device_id từ event).
- **snapshot lớn (base64)**: read-list KHÔNG expose payload (AC-005); (tùy chọn) strip ở handler (FR-008).
- **throttle reset khi restart** (in-memory): chấp nhận MVP — có thể có 1 cảnh báo thừa ngay sau restart (ghi nhận, không chặn).
- hook không wired (face-access không provide) → `@Optional()` → iot bỏ qua, vẫn lưu raw + 200.

## 7. Out of scope
- **Review/dismiss state** (đánh dấu đã xử lý 1 stranger) — cần cột `review_status`/`reviewed_by` ở `iot_device_events` hoặc bảng `stranger_alerts` → **migration của Tài**, defer.
- Throttle bền vững (persist last-alert qua DB/Redis thay in-memory) — defer; MVP in-memory đủ.
- Backend nhận diện/đối chiếu khuôn mặt lạ với DB người dùng (face matching) — backend KHÔNG chạy model (CLAUDE §11.12).
- Gửi snapshot ảnh stranger cho admin (lưu media_files) — defer (cần xử lý base64/storage).
- Gác/deny cửa (NC-1).

## 8. Quyết định đã chốt (resolved 2026-06-19)
| # | Vấn đề | CHỐT |
|---|---|---|
| NC-A | Người nhận cảnh báo | **Admins** (in-app) + **WS room-scoped** (`room:<roomId>`). KHÔNG gửi user lạ. (FR-002) |
| NC-B | Kênh | **WS + in-app LUÔN bật**; **email opt-in** `STRANGER_ALERT_EMAIL_ENABLED` (default **false**). (FR-002b) |
| NC-C | Strip SanpPic ở handler | **BẮT BUỘC** — strip `payloadToMask` 1 chỗ → phủ cả `payload_json` LẪN `recent_stranger_event_samples`; alert metadata-only. (FR-008) |
| NC-D | Throttle in-memory vs persist | **In-memory Map** (MVP); limitation single-instance + reset-khi-restart đã ghi; persist là ticket sau. (FR-003) |

> Trạng thái: **CHỜ Thiếu Chủ xác nhận spec FINAL** (chưa plan/tasks/code).
