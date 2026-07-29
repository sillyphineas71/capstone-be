# PLAN FE — người nhận: Nam — 2026-07-26

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo mới: plan FE theo bản đồ `FE_BE_API_MAP_2026-07-26.md` — P0 vá 8 việc service, P1 1-2 màn, P2 ~11 cụm màn, CHỜ BE 10 việc | Toàn bộ file |
| 2026-07-26 (v2) | Bổ sung PHỤ LỤC ĐẶC TẢ API: mô tả đầy đủ request (path/query/body theo DTO thật) + response `data`/`meta` + mã lỗi cho TOÀN BỘ 85 route Nhóm-3 và các route đích P0 — trích trực tiếp từ code BE sống, Nam KHÔNG cần mở Swagger. Thêm 2 bug BE mới phát hiện (§A.4) | Phụ lục A + B (mới), B.0-B.5 giữ nguyên |
| 2026-07-26 (v3) | Sửa 5 đường dẫn file `recording-session.controller.ts` / `recording-session.service.ts` — thêm đúng tiền tố module `recording/controllers/` và `recording/services/` (KHÔNG thuộc `live-meeting/`); không đổi nội dung nào khác | Dòng 48, 88 (§A.4), §B-P1.8, §B-P1.9, §B-P1.10 |

> **Nguồn:** `capstone-be/docs/FE_BE_API_MAP_2026-07-26.md` + đặc tả trích từ code sống 2026-07-26. Plan BE song song: `PLAN_SUA_BE_cho_Tai_2026-07-26.md` (ID `BE-xx` trỏ vào đó).

---

## B.0 ⚠ NGUYÊN TẮC — đọc trước khi làm bất kỳ mục nào

**Việc số 0 — bỏ hardcode base URL.** `src/utils/request.js:1`:
```js
const API_BASE_URL = 'http://localhost:3000/api/v1';
```
Dự án là CRA (`react-scripts` 5.0.1 — `package.json:20`) → đổi thành:
```js
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000/api/v1';
```
thêm `.env.development` / `.env.production` với `REACT_APP_API_BASE_URL` (CRA chỉ đọc biến prefix `REACT_APP_`, giá trị nướng vào bundle lúc build).

**Nguồn route đúng DUY NHẤT:** PHỤ LỤC B của file này (trích từ controller/DTO thật) — không cần Swagger. **TUYỆT ĐỐI KHÔNG** lấy endpoint từ `src/docs/*` — 17 file lỗi thời (đã liệt kê ở bản đồ §7.5, khuyến nghị archive; giữ lại `src/docs/AGENTS.md`).

**Phân biệt lỗi khi test:** **404** = sai đường/method → việc Nam; **403** = đúng đường nhưng permission chưa seed trong DB → việc BE (báo Hải/Tài, KHÔNG tự đổi path để né); **422** = sai enum/validate semantic (một số route dùng 422 thay 400 — ghi rõ trong phụ lục).

---

## B.1 🔴 P0 — VÁ ĐƯỜNG GỌI SAI (chỉ sửa `src/service/*`) — đặc tả từng đích: PHỤ LỤC B-P0

| ID | Sửa gì | FE hiện tại | Đích đúng (spec ở B-P0) | Màn ảnh hưởng |
|---|---|---|---|---|
| P0-1 | `POST` → **`PATCH`** `/zones/:id/devices`; body đổi thành `{ "device_ids": [uuid…] }` (snake_case!) — FE đang gửi `{ deviceId }` sẽ bị strip → 400 `device_ids` required | `zoneServices.js:57`; `ZoneManagement.jsx:158` gửi `{deviceId}` | Spec §B-P0.1 | `systemAdmin/ZoneManagement.jsx` |
| P0-2 | `GET /rooms` → **`GET /rooms/search`** | `sysAdminServices.js:349` | §B-P0.2 — ⚠ đọc kỹ bẫy `onlyAvailable` | `systemAdmin/DeviceManagement.jsx:84` |
| P0-3 | `POST /users/face-profile` → **`POST /users/:userId/face-profile`**, body **multipart field `file`** (≤5MB); sửa chữ ký hàm thành `(userId, formData)` — component đã gọi 2 tham số (`employee/FaceRegistration.jsx:155`) | `employeeServices.js:113` | §B-P0.3 — ⚠ bản manager (`managerServices.js:167`) đúng path nhưng đang gửi JSON `data`, cũng phải đổi sang FormData | 2 màn FaceRegistration |
| P0-4 | `POST /live-meetings/:id/extension-requests` → **`POST /meetings/:id/extension-requests`** | `managerServices.js:301`, `employeeServices.js:227` | §B-P0.4 (route decide giữ nguyên — FE đang đúng) | Hàm chưa nối màn |
| P0-5 | `GET /rooms/:roomId/devices` → **`GET /iot-devices?roomId=<id>`** | `managerServices.js:333`, `employeeServices.js:259` | §B-P0.5 | Hàm chưa nối màn |
| P0-6 | Tách `PATCH /meetings/:id`: đổi giờ → `PATCH /meetings/:id/time`; đổi phòng → `PATCH /meetings/:id/room`; recording → `PATCH /meetings/:id/recording-config` (Nhóm 1, FE có sẵn); title/description **CHỜ BE-03** | `businessAdminServices.js:237`, `managerServices.js:187`, `employeeServices.js:133`; payload gộp ở `manager/MeetingDetail.jsx:264-272` | §B-P0.6 + §B-P0.7 | MeetingDetail (manager+employee), MeetingManagement |
| P0-7 | Đổi hàm `getRoomRealtimeStatus` (`businessAdminServices.js:171`) đang gọi `/rooms/search` → gọi đúng `GET /rooms/realtime-status` | | §B-P0.8 | Bẫy tên hàm |
| P0-8 | Treo cờ `// CHỜ BE-11` cho `checkInMeeting` (`managerServices.js:201`, `employeeServices.js:147`) — BE không có route | | — | Hàm chưa nối màn |

**Agenda (BookMeeting):** FE gọi `PUT /meetings/:id/agendas` là ĐÚNG convention nhưng BE khai thiếu prefix (route thật `PUT /:meetingId/agendas` — `meetings.controller.ts:959`, controller rỗng `:114`). **GIỮ NGUYÊN FE, chờ BE-06.** Body/response xem §B-P0.9 (dùng được ngay khi BE-06 merge). Màn ảnh hưởng: `employee/BookMeeting.jsx:578`.

## B.2 🟠 P1 — ĐÒN BẨY CAO, DỮ LIỆU SỐNG

- **P1-1 Recording (BR-05):** `InMeetingRoom.jsx:11-12` đã nối start/pause/resume/stop/status/media-files. Việc còn lại: smoke test với BE thật; poll trạng thái phiên theo §B-P1.8 (các field realtime: `live`, `durationSeconds`, `fileSizeBytes`, `captured`); thêm câu **"Đoạn tạm dừng sẽ không có trong file ghi"** cạnh nút Pause; chỉ nối thêm 3 route §B-P1.9-11 khi nghiệp vụ cần. ⚠ perm `recording.video.status` có thể CHƯA seed cho EMPLOYEE (comment `recording/controllers/recording-session.controller.ts:180-183`) — nếu 403 khi poll bằng vai employee → báo Tài seed, không phải lỗi FE.
- **P1-2 Màn "Ra vào cổng" (UC-107):** 1 màn 3 tab (log thô / phiên ghép cặp / thống kê xe) — spec đủ 7 route ở §B-P1.1-7. Dữ liệu ĐÃ SỐNG (UC-105 nghiệm thu).
- **P1-3 Zones:** đã phủ 7/7, chỉ cần P0-1 rồi test lại gán/gỡ thiết bị.

## B.3 🟡 P2 — MÀN HÌNH SCOPE MỚI (route gom theo màn; đặc tả từng route ở PHỤ LỤC B)

| # | Màn | Spec route | Dữ liệu | Ước lượng |
|---|---|---|---|---|
| M1 | Trung tâm cảnh báo an ninh | §B-M1 (5 route) | MỘT PHẦN — nguồn alert từ cron `RestrictedZoneModule`/`CrowdAlertModule` (`app.module.ts:120,122`) chờ dữ liệu camera; UI + ack/resolve test bằng seed. ⚠ luồng trạng thái ÉP: `new → acknowledged → resolved` (resolve thẳng từ `new` bị 409) | Lớn |
| M2 | Cấu hình Alert Rules | §B-M2 (5 route) | SỐNG (CRUD thuần) | Vừa |
| M3 | Watchlist người | §B-M3 (5 route) | SỐNG | Vừa |
| M4 | Kiểm soát phương tiện | §B-M4 (6 route) | SỐNG | Vừa |
| M5 | Campus Dashboard | §B-M5 (3 route) | CHỜ PHẦN CỨNG (heatmap/timeline ăn `zone_presence_events` từ IVSS) + CHỜ Tài chốt A.2 (shape timeline sẽ đổi) — **làm CUỐI** | Lớn |
| M6 | Biên bản nâng cao (mở rộng màn Minutes) | §B-M6 (9 route) | SỐNG | Vừa |
| M7 | Gửi thông báo meeting (nhúng MeetingDetail) | §B-M7 (5 route) | SỐNG | Nhỏ |
| M8 | Participants nâng cao + agenda item (mở rộng BookMeeting/MeetingDetail) | §B-M8 (9 route) | SỐNG (remove-internal + agenda chờ BE-06 sửa prefix) | Vừa |
| M9 | Cấu hình vận hành phòng (settings admin) | §B-M9 (8 route) | SỐNG | Nhỏ-vừa |
| M10 | Analytics chi tiết + tiện ích quản trị | §B-M10 (6 route) | SỐNG | Nhỏ-vừa |
| M11 | Báo cáo exports + IoT bổ sung + IVSS | §B-M11 (10 route) | SỐNG (export security-alert phụ thuộc M1 có dữ liệu; PDF report IVSS đang bị bug BE — §A.4) | Vừa |

`crowd-alert`/`restricted-zone`: module BE tồn tại nhưng cron-only, KHÔNG có HTTP route → không có màn; kết quả đổ về M1.

## B.4 ⏸ CHỜ BE (không đổi so với v1): C1 refresh (BE-01) · C2 GET /meetings (BE-02) · C3 PATCH title/description (BE-03) · C4 users/export (BE-04) · C5 prefix agendas/participants (BE-06) · C6 notifications read/read-all (BE-07) · C7 departments PATCH (BE-08) · C8 system-configurations (BE-09) · C9 stranger-alert resolve (BE-10) · C10 self check-in (BE-11).

## B.5 TỔNG KẾT (không đổi): P0 8 việc ~1-2 ngày → P1 1 màn mới + hoàn thiện InMeetingRoom → P2 ~6 màn mới + ~5 mở rộng → M5 cuối. CHỜ BE 10 việc.

---
---

# PHỤ LỤC A — QUY ƯỚC CHUNG (áp cho mọi route bên dưới, trích từ code sống)

1. **Envelope:** mọi response JSON bọc `{ success, message, data, meta? }` — spec dưới chỉ mô tả `data` (+`meta` nếu có). Lỗi: `{ success:false, message, error:{code, details} }`. 2 ngoại lệ trả **binary**: §B-M8.3 (template xlsx) và §B-M11.10 (PDF).
2. **`meta` phân trang chuẩn:** `{ page, limit, total, totalPages }` (`totalPages = ceil(total/limit)`). Route nào KHÔNG có meta sẽ ghi rõ.
3. **Wire-format field:** DTO các module SAVP (zones, gate-access, anpr, alerts, iot ai-config) dùng `@Expose({name})` → client PHẢI gửi **snake_case** (`device_ids`, `zone_id`, `list_type`, `plate_raw`, `alert_type`, `resolution_note`, `user_id`…). DTO core (meetings, live-meeting, notifications, minutes, recording, rooms) KHÔNG có `@Expose` → gửi **camelCase** (`startTime`, `extensionMinutes`, `plannedDurationMinutes`…). Ngoại lệ ngược: query `userId` của timeline campus-dashboard là camelCase (§B-M5.3). Mỗi route dưới ghi đúng tên wire.
4. **ValidationPipe theo từng route** (không có global pipe — `main.ts:6-24`): đa số `whitelist:true` → field lạ bị **strip im lặng**; route nào `forbidNonWhitelisted:true` (field lạ → 400) sẽ ghi ⚠. `Date` serialize thành chuỗi ISO; `bigint` (`file_size_bytes`) trả về **string**.
5. **Bẫy boolean query:** `GET /rooms/search?onlyAvailable=false` vẫn thành `true` (class-transformer `Boolean('false')`) → muốn tắt filter phải **OMIT** param. Các DTO alerts/anpr dùng `@Transform(value==='true')` nên `active=false`/`enabled=false` hoạt động đúng.

## A.4 — 2 BUG BE MỚI PHÁT HIỆN khi trích đặc tả (đã ngoài plan Tài v1 — báo Tài bổ sung)

1. **`GET /ivss/meetings/:meetingId/presence/report` KHÔNG THỂ GỌI ĐƯỢC:** route khai SAU `GET :meetingId/presence/:userId` (`ivss-presence.controller.ts:29` vs `:65`) → chữ `report` bị `:userId` nuốt, `ParseUUIDPipe` chặn 400. Fix: đảo thứ tự khai báo 2 handler.
2. **Perm `recording.video.status` nghi chưa seed cho EMPLOYEE** (comment `recording/controllers/recording-session.controller.ts:180-183`) — CẦN Tài xác minh migration seed; nếu thiếu, employee poll trạng thái ghi hình sẽ 403.

---

# PHỤ LỤC B — ĐẶC TẢ TỪNG ROUTE (đầy đủ 85 route Nhóm-3 + đích P0)

## B-P0 — Đích đúng của các mục P0

### B-P0.1 `PATCH /api/v1/zones/:id/devices` — perm `zones.zone.assign_device`
- Path: `id` uuid (ParseUUIDPipe). Body (wire): `{ "device_ids": string[] }` — uuid v4, không rỗng, không trùng, ≤50 phần tử. Field khác bị strip.
- `data`: `{ zone: { id, zone_code, zone_name, zone_type('room|gate|corridor|lobby|parking'), building|null, floor|null, description|null, metadata_json|null, status('active|inactive'), created_at, updated_at }, assigned_device_ids: string[] }` (chỉ phản chiếu id gửi lên, không kèm thông tin device).
- Nguồn: `zones.controller.ts:113-135`; `dto/assign-zone-devices.dto.ts:25-33`; `dto/zone-response.dto.ts:8-36`.

### B-P0.2 `GET /api/v1/rooms/search` — chỉ JWT
- Query (đủ 6 param, KHÔNG có keyword/sort): `capacityMin` int≥1 · `capacityMax` int≥1 (min>max → 400 `VALIDATION_ERROR`) · `areaName` string≤255 (**so BẰNG chính xác, không LIKE**) · `onlyAvailable` bool (⚠ bẫy §A.5 — omit để tắt) · `page`=1 · `limit`=50 max 100.
- `data[]`: `{ roomId, roomCode, roomName, siteName|null, areaName|null, locationDescription|null, capacity, roomType('meeting_room|training_room|board_room|open_space'), currentStatus('available|occupied|reserved|maintenance|inactive'), hasCamera, hasMicrophone, hasDisplay, allowRecording }`. Luôn loại phòng inactive/deleted; sort `roomCode ASC`. KHÔNG có occupancy/booking (dùng §B-P0.8).
- `meta`: chuẩn + `appliedFilters` (chỉ chứa key client gửi). Nguồn: `rooms.controller.ts:60-82`; `dto/search-rooms-query.dto.ts:16-51`; `services/room-search.service.ts:22-128`.

### B-P0.3 `POST /api/v1/users/:userId/face-profile` — JWT (PermissionsGuard đang mock)
- Path: `userId` uuid. Body: **multipart/form-data, field `file`** (ảnh chân dung, giới hạn `FACE_PORTRAIT_MAX_BYTES` default 5MB). HTTP 201.
- `data`: kết quả enroll từ `FaceProfileService.enrollPortrait` (CẦN XÁC MINH shape chi tiết — chưa đọc service; test 1 call là thấy). Nguồn: `face-profile.controller.ts:29-58`.

### B-P0.4 `POST /api/v1/meetings/:meetingId/extension-requests` — perm `meeting.extension.request.own` (HTTP 200)
- Body: `{ extensionMinutes: int≥1 (bắt buộc), reason?: string≤500 }`.
- `data`: `{ requestId, meetingId, oldEndTime, newEndTime?, requestedNewEndTime?, extensionMinutes, approvalMode:'auto'|'manual', status:'applied'|'pending', conflictCheckStatus:'clear'|'blocked', managerNotificationSent? }` — `status='applied'` = gia hạn luôn; `'pending'` = đã gửi Manager duyệt.
- Decide (FE đang đúng): `POST /live-meetings/:meetingId/extension-requests/:requestId/decide`, body `{ decision:'approved'|'rejected', reason?≤500 }` (sai decision → 422); `data`: `{ requestId, decision, status:'applied'|'rejected', oldEndTime?, newEndTime?, extensionMinutes?, rejectionReason?, decisionAt, message }`. Perm: rỗng ở decorator — service tự check `meeting.session.extension.decide|override`.
- Nguồn: `live-meeting.controller.ts:120-246`; `dto/extension-request.dto.ts:13-23`, `extension-request-response.dto.ts:5-20`, `decide-extension.dto.ts:6-16`, `decide-extension-response.dto.ts:4-18`.

### B-P0.5 `GET /api/v1/iot-devices?roomId=<uuid>` — perm `iot.device.read`
- Query DTO có `roomId` (`dto/list-iot-devices-query.dto.ts:49`; các filter khác: xem DTO cùng file).
- `data[]` (snake_case): `{ id, device_name, device_code, device_type, room_id|null, ip_address|null, mac_address|null, status, health_status, last_seen_at|null, metadata_json|null, created_by_name?, created_at, updated_at }` + `meta` chuẩn. Nguồn: `iot-devices.controller.ts:37-50`; `dto/iot-device-response.dto.ts:4-19`.

### B-P0.6 `PATCH /api/v1/meetings/:meetingId/time` — perm `meeting.time.update` ⚠ forbidNonWhitelisted
- Body: `{ startTime: ISO8601-strict (bắt buộc), endTime: ISO8601-strict (bắt buộc), newRoomId?: uuid, overrideParticipantConflict?: bool, changeReason?: ≤500 }`.
- `data`: `{ meetingId, oldStartTime, oldEndTime, newStartTime, newEndTime, oldRoomId|null, newRoomId|null, bookingId, notificationStatus, updatedAt }`; `meta:{requestId}`.
- Nguồn: `meetings.controller.ts:173-228`; `dto/update-meeting-time.dto.ts:10-30`; `services/meetings.service.ts:152-163`.

### B-P0.7 `PATCH /api/v1/meetings/:meetingId/room` — perm `meeting.room.update` ⚠ forbidNonWhitelisted
- Body: `{ newRoomId: uuid4 (bắt buộc), confirmCapacityOverride?: bool=false, changeReason?: ≤500 }`.
- `data`: `{ meetingId, oldRoom:{id,name}, newRoom:{id,name}, oldBookingId, newBookingId, startTime, endTime, notificationStatus, updatedAt }`.
- Nguồn: `meetings.controller.ts:426-475`; `dto/update-meeting-room.dto.ts:10-23`; `dto/update-meeting-room-response.dto.ts:1-15`.

### B-P0.8 `GET /api/v1/rooms/realtime-status` — perm `room.utilization.read`
- Query: `siteName?`, `areaName?` (so bằng chính xác). KHÔNG meta, KHÔNG phân trang; trả CẢ phòng `is_active=false`.
- `data[]`: `{ roomId, roomCode, roomName, currentStatus, currentBooking:{ meetingId|null, meetingTitle|null, hostName|null, reservedEndTime|null }|null, occupancyCount|null, noShowStatus: LUÔN null (hardcode `room-status.service.ts:151`), lastPresenceAt|null }`.
- Nguồn: `rooms.controller.ts:238-250`; `services/room-status.service.ts:20-34,96-153`.

### B-P0.9 `PUT /api/v1/:meetingId/agendas` (sau BE-06: `/meetings/:meetingId/agendas`) — JWT ⚠ forbidNonWhitelisted (HTTP 200)
- Body: `{ items: [{ id?: uuid4, title: ≤255 (bắt buộc), description?: ≤2000, ownerId?: uuid4|null, plannedDurationMinutes: int≥1 (bắt buộc) }] }` — atomic replace, `items:[]` hợp lệ (xoá hết).
- `data`: `{ meetingId, totalPlannedDurationMinutes, remainingDurationMinutes, items:[{ id, agendaOrder, title, description|null, ownerId|null, ownerName|null, plannedDurationMinutes, status }] }`.
- Lỗi: 400 `AGENDA_ITEMS_REQUIRED|AGENDA_INVALID_PAYLOAD`, 403 `AGENDA_WRITE_FORBIDDEN`, 404 `MEETING_NOT_FOUND`, 409 `AGENDA_MEETING_STATUS_BLOCKED|MEETING_TIME_INVALID_FOR_AGENDA`, 422 validation.
- Nguồn: `meetings.controller.ts:959-1028`; `dto/replace-agenda.dto.ts:5-11`, `dto/agenda-item.dto.ts:11-53`, `dto/agenda-response.dto.ts:32-41`.

## B-P1 — Ra vào cổng + Recording bổ sung

### B-P1.1 `GET /api/v1/gate-access-logs` — JWT (tự lấy user từ token)
- Query (snake_case): `page`=1 · `limit`=20 max100 · `from`/`to` ISO8601 · `direction` ∈ `enter|leave` · `zone_id` uuid4.
- `data[]`: `{ id, zone_id, zone_name|null, direction, access_time, plate_number|null, vehicle_registration_id|null, paired_log_id|null, duration_seconds|null }` — KHÔNG có block user. `meta` chuẩn. Sort `access_time DESC`.
- Nguồn: `zones/controllers/gate-access-log.controller.ts:42-60`; `dto/list-gate-access-logs-query.dto.ts:22-52`; `dto/gate-access-log-response.dto.ts:9-36`.

### B-P1.2 `GET /api/v1/admin/gate-access-logs` — perm `zones.gate_log.read`
- Query: kế thừa B-P1.1 + `user_id` uuid4 + `plate` ≤20 (BE normalize rồi so exact).
- `data[]`: như B-P1.1 + `zone_code|null` + `user: { user_id, full_name, email } | null`. `meta` chuẩn.
- Nguồn: `gate-access-log.controller.ts:63-75`; `dto/admin-list-gate-access-logs-query.dto.ts:16-26`; mapper `gate-access-log-response.dto.ts:45-71`.

### B-P1.3 `GET /api/v1/gate-access/history` — JWT (self). 1 dòng = 1 PHIÊN ghép cặp
- Query: `page`=1 · `limit`=20 max100 · `from`/`to` ISO · `zone_id` uuid.
- `data[]`: `{ id, zone_id|null, zone_code|null, zone_name|null, check_in_time|null, check_out_time|null, duration_seconds|null, plate_number|null, session_status:'completed'|'incomplete' }`. `meta` chuẩn. Sort `COALESCE(check_in,check_out) DESC`.
- Nguồn: `gate-access-history.controller.ts:34-51`; `dto/list-gate-access-history-query.dto.ts:15-41`; `dto/gate-access-history-item-response.dto.ts:20-52`.

### B-P1.4 `GET /api/v1/gate-access/admin/history` — perm `gate_access.history.read_all`
- Query: kế thừa B-P1.3 + `user_id` uuid + `department_id` uuid. `data[]`: như B-P1.3 + `user_id?` (⚠ nếu log không có user thì field BỊ LOẠI khỏi JSON, không phải null). Nguồn: `gate-access-history.controller.ts:53-65`; `dto/list-gate-access-history-admin-query.dto.ts:9-19`.

### B-P1.5 `GET /api/v1/gate-access/history/:id` — JWT (self, WHERE owner) · **B-P1.6** `GET /api/v1/gate-access/admin/history/:id` — perm `gate_access.history.read_all`
- `data`: mọi field B-P1.3 + `image_url|null` (từ `metadata_json.imageUrl`); bản admin thêm `user_id?`. 404 `GATE_ACCESS_LOG_NOT_FOUND`. Nguồn: `gate-access-history.controller.ts:67-94`; `dto/gate-access-history-detail-response.dto.ts:11-25`.

### B-P1.7 `GET /api/v1/gate-access/admin/vehicle-traffic-stats` — perm `gate_access.stats.read`
- Query (snake_case): `from`+`to` ISO **BẮT BUỘC** (from>to → 400 `INVALID_DATE_RANGE`) · `zone_id` uuid · `vehicle_type` ≤50 · `group_by` ∈ `day|hour` (default day).
- `data`: `{ summary:{ total_events, total_matched, total_unmatched, total_enter, total_leave, total_seen, unique_vehicles }, series:[{ bucket:'YYYY-MM-DD'|'YYYY-MM-DD HH24:00', enter, leave, seen }] }` — direction vocabulary `enter|leave|seen` (KHÔNG in/out). Không meta.
- Nguồn: `vehicle-traffic-stats.controller.ts:21-38`; `dto/vehicle-traffic-stats-query.dto.ts:12-46`; `services/vehicle-traffic-stats.service.ts:44-141`.

### B-P1.8 `GET /api/v1/live-meetings/:meetingId/recording/:sessionId/status` — perm `recording.video.status` (⚠ §A.4.2)
- `data`: `{ recordingSessionId, meetingId, sessionType('audio|video|mixed'), status('starting|recording|paused|stopped|failed|processing'), startedAt, stoppedAt|null, live:bool, durationSeconds|null (live=wall-clock trừ pause), fileSizeBytes:string|null (live=size hiện tại), hasProcessHandle:bool, errorMessage|null, captured:bool }`. Read-only, an toàn để poll. 404 `RECORDING_SESSION_NOT_FOUND`.
- Nguồn: `recording/controllers/recording-session.controller.ts:239-256`; `recording/services/recording-session.service.ts:1307-1389`.

### B-P1.9 `POST /api/v1/meetings/:meetingId/recording-sessions` — perm `transcript.create` + phải là Host/Organizer hoặc BUSINESS_ADMIN/SYSTEM_ADMIN (403 `PERMISSION_DENIED`)
- Body: `{ notes?: ≤500 }` (có thể `{}`). HTTP 201. `data`: `{ recordingSessionId, sessionType:'audio', status:'starting', startedAt }` — dùng sessionId này cho B-P1.10. Nguồn: `recording/controllers/recording-session.controller.ts:156-178`; `recording/services/recording-session.service.ts:697-744`.

### B-P1.10 `POST /api/v1/meetings/:meetingId/recording-sessions/:sessionId/audio-tracks` — perm `recording.upload_track` + phải là participant (403 `NOT_A_PARTICIPANT`) + meeting đã `completed` (400 `MEETING_NOT_ENDED`)
- Body: **multipart field `file`**, ≤50MB (env `STORAGE_MAX_FILE_SIZE`), đuôi cho phép: `.wav .mp3 .m4a .mp4 .aac .flac .ogg .webm` (sai → 400 `UNSUPPORTED_MEDIA_FORMAT`; rỗng → `EMPTY_AUDIO_FILE`). 1 user 1 track/session (409 `AUDIO_TRACK_ALREADY_EXISTS`).
- HTTP 201. `data`: `{ mediaFileId, storageKey, channelUserId, durationSeconds|null }`. ⚠ token thiếu userId → **201 nhưng `success:false` không data** — luôn check `success`. Nguồn: `recording/controllers/recording-session.controller.ts:205-236`; `recording/services/recording-session.service.ts:949-1108`.

### B-P1.11 `GET /api/v1/media-files/:fileId` — perm `recording.files.read`
- `data`: `{ id, fileCode|null, fileName, fileType('audio|video|image|document|transcript|minutes_attachment|export|evidence'), mimeType, storageProvider('local|s3|minio|cloud_provider'), storageBucket|null, fileSizeBytes:string|null, durationSeconds|null, checksum|null, versionNo, visibilityLevel('internal|participants|department|public'), isActive, relatedEntityType|null, relatedEntityId|null, recordingSessionId|null, uploadedAt, metadataJson|null, downloadUrl|null (link secure-download TTL 600s) }`. 404 `MEDIA_FILE_NOT_FOUND`. Nguồn: `media-files.controller.ts:53-64`; `services/media-files.service.ts:82-133`.

## B-M1 — Security Alerts (perm `security_alert.*`)

### B-M1.1 `GET /api/v1/security-alerts` — perm `security_alert.read`
- Query (snake_case): `page`=1 · `limit`=20 max100 · `alert_type` ∈ `stranger|unknown_vehicle|vehicle_control_match|crowd|intrusion|device_error|person_watchlist_match` · `zone_id` uuid · `status` ∈ `new|acknowledged|resolved` (không lọc mặc định — BR1 cảnh báo không tự ẩn) · `from`/`to` ISO · sort mặc định `triggeredAt DESC` (sortBy ∈ `triggeredAt|severity|status`).
- `data[]` (snake_case): `{ id, alert_type, severity, zone_id|null, status, triggered_at, last_seen_at|null, occurrence_count, source_event_id|null, rule_id|null, payload_json|null, acknowledged_by|null, acknowledged_at|null, resolved_by|null, resolved_at|null, resolution_note|null, created_at, updated_at }`. `meta` chuẩn.
- Nguồn: `alerts.controller.ts:40-51`; `dto/query-security-alerts.dto.ts:13-52`; `dto/security-alert-response.dto.ts:7-26`; `services/alerts.service.ts:156-170`.

### B-M1.2 `GET /api/v1/security-alerts/:id` — perm `security_alert.read` → `data`: 1 item shape B-M1.1.
### B-M1.3 `POST /api/v1/security-alerts/:id/acknowledge` — perm `security_alert.acknowledge`
- Body: KHÔNG có. Chỉ ack được từ `status='new'` — đã xử lý rồi → **409** (`alerts.service.ts:224-238`). `data`: bản ghi alert sau cập nhật (shape B-M1.1).
### B-M1.4 `POST /api/v1/security-alerts/:id/resolve` — perm `security_alert.resolve`
- Body (wire): `{ "resolution_note": string ≤1000 (BẮT BUỘC) }`. Chỉ resolve được từ `status='acknowledged'` — resolve thẳng từ `new` → **409** (`alerts.service.ts:243-255`). `data`: alert sau cập nhật. **UI phải ép luồng new→ack→resolve.**
### B-M1.5 `POST /api/v1/security-alerts/bulk-acknowledge` — perm `security_alert.acknowledge`
- Body: `{ ids: uuid4[] (1..50) }` (`dto/bulk-acknowledge-security-alerts.dto.ts:8-14`). `data`: CẦN XÁC MINH shape (đếm updated/skipped hay danh sách) — test 1 call.

## B-M2 — Alert Rules (perm `alert_rules.*`)

### B-M2.1 `POST /api/v1/alert-rules` — perm `alert_rules.create`
- Body (wire): `{ "alert_type": enum B-M1.1 (bắt buộc), "zone_id"?: uuid, "threshold"?: int≥1 (BẮT BUỘC khi alert_type='crowd'), "channels": ('in_app'|'email')[] không rỗng (bắt buộc), "enabled"?: bool, "restricted_hours_json"?: { "allow_from"?: 'HH:mm', "allow_to"?: 'HH:mm' }, "allowed_person_ids_json"?: uuid[] (CẦN XÁC MINH — field có trong response, kiểm DTO create có nhận không) }`.
- `data` (snake_case): `{ id, alert_type, zone_id|null, threshold|null, channels[], enabled, restricted_hours_json|null, allowed_person_ids_json|null, created_by|null, updated_by|null, created_at, updated_at }`.
- Nguồn: `alert-rules.controller.ts:41-55`; `dto/create-alert-rule.dto.ts:19-95`; `dto/alert-rule-response.dto.ts:7-38`.
### B-M2.2 `GET /api/v1/alert-rules` — query: `page/limit` + `alert_type` + `zone_id` + `enabled` (`'true'/'false'` hoạt động đúng nhờ @Transform) → `data[]` shape B-M2.1 + `meta` chuẩn (`alert-rules.service.ts:74-90`).
### B-M2.3 `GET /api/v1/alert-rules/:id` → 1 item. · **B-M2.4** `PATCH /api/v1/alert-rules/:id` — body: mọi field B-M2.1 đều optional (`dto/update-alert-rule.dto.ts:28-58`) → item sau cập nhật. · **B-M2.5** `DELETE /api/v1/alert-rules/:id` — soft-delete; `data`: CẦN XÁC MINH (thường `{success,message}`).

## B-M3 — Person Control List (perm `person_control_list.*`)

### B-M3.1 `POST /api/v1/person-control-list` — perm `...create`
- Body (wire): `{ "display_name": ≤255 (BẮT BUỘC), "user_id"?: uuid, "face_profile_id"?: uuid, "photo_media_file_id"?: uuid, "list_type"?: 'watchlist'|'blocklist', "reason"?: ≤255, "priority"?: 'low'|'medium'|'high'(+…— cùng vocabulary severity) }`. `active` KHÔNG nhận từ body (mặc định true), `created_by` từ JWT.
- `data` (snake_case): `{ id, user_id|null, face_profile_id|null, display_name, photo_media_file_id|null, list_type, reason|null, priority, active, created_by|null, created_at, updated_at }`.
- Nguồn: `person-control-list.controller.ts:44-57`; `dto/create-person-control-list.dto.ts:13-70`; `dto/person-control-list-response.dto.ts:7-38`.
### B-M3.2 `GET /api/v1/person-control-list` — query: `page/limit` + `list_type` + `active`('true'/'false' đúng) + `user_id` → `data[]` + `meta` chuẩn (`person-control-list.service.ts:68-90`). · **B-M3.3** `GET :id` · **B-M3.4** `PATCH :id` (body: mọi field optional, `user_id|face_profile_id|photo_media_file_id` nhận null để gỡ — `dto/update-person-control-list.dto.ts:23-60`) · **B-M3.5** `DELETE :id` (soft-delete).

## B-M4 — Kiểm soát phương tiện (anpr)

### B-M4.1 `POST /api/v1/anpr/admin/control-list` — perm `vehicle_control.create`
- Body (wire): `{ "plate_raw": ≤20 (BẮT BUỘC — BE tự normalize), "list_type": 'blocklist'|'watchlist' (bắt buộc), "reason"?: ≤255 }`.
- `data` (snake_case): `{ id, plate_number (đã normalize), plate_raw|null, list_type, reason|null, active, created_by|null, created_at, updated_at }`.
- Nguồn: `vehicle-control-list.controller.ts:45-60`; `dto/create-vehicle-control-list.dto.ts:11-35`; `dto/vehicle-control-list-response.dto.ts:7-25`.
### B-M4.2 `GET /api/v1/anpr/admin/control-list` — perm `vehicle_control.read` — query: `page/limit` + `plate` ≤20 + `list_type` + `active`('true'/'false' đúng) → `data[]` + `meta`. · **B-M4.3** `GET :id` · **B-M4.4** `PATCH :id` — body `{ reason?: ≤255, active?: bool }` (`dto/update-vehicle-control-list.dto.ts:10-19`) · **B-M4.5** `DELETE :id` — perm `vehicle_control.delete`.
### B-M4.6 `GET /api/v1/anpr/admin/vehicle-registrations` — perm `anpr.vehicle.admin_read`
- Query: kế thừa list thường (page/limit/from/to/…) + `user_id` uuid4 + `owner` ≤255 (ILIKE full_name OR email).
- `data[]` (snake_case): `{ id, user_id, plate_raw, plate_number, vehicle_type|null, note|null, status, created_at, updated_at }` + `meta`. Nguồn: `dto/admin-list-vehicle-registrations-query.dto.ts:17-29`; `dto/vehicle-registration-response.dto.ts:7-33`.

## B-M5 — Campus Dashboard (perm `campus_dashboard.*`)

### B-M5.1 `GET /api/v1/campus-dashboard/overview` — perm `...overview.read`
- Query: `building`? ≤100 · `floor`? ≤30. Không meta.
- `data`: `{ generatedAt: ISO, buildings:[{ building|null, floors:[{ floor|null, zones:[{ zoneId, zoneCode, zoneName, zoneType, coordinates: LUÔN null (blocked spec §2.1), occupancy:{ count|null, status:'ok'|'no_data' }, gateTraffic:{ entriesToday, exitsToday }, cameraStatus:{ online, offline, disabled, maintenance, overall:'no_device'|'online'|'degraded'|'offline' } }] }] }] }`; không zone khớp → `buildings: []`.
- Nguồn: `dashboard-overview.controller.ts:28-40`; `dto/dashboard-overview-response.dto.ts:1-49`; `services/dashboard-overview.service.ts:28-95`.

### B-M5.2 `GET /api/v1/campus-dashboard/zones/traffic` — perm `...traffic.read`
- Query: `from`+`to` ISO **BẮT BUỘC** (>31 ngày → 400 `INVALID_TRAFFIC_RANGE`) · `building`? · `floor`?.
- `data`: `{ series:[{ zoneId, hourBucket: ISO (trunc giờ), avgOccupancy, peakOccupancy }], heatmap:[{ zoneId, zoneName, building|null, floor|null, avgOccupancy, peakOccupancy, peakAt|null, relativeDensity: 0..1, coordinates: LUÔN null }] }`. Nguồn dữ liệu: `zone_presence_events.event_type='count'` (IVSS) → **trống tới khi phần cứng nghiệm thu**.
- Nguồn: `zone-traffic-heatmap.controller.ts:26-43`; `dto/query-zone-traffic.dto.ts:4-20`; `dto/zone-traffic-response.dto.ts:1-24`.

### B-M5.3 `GET /api/v1/campus-dashboard/zones/:zoneId/timeline` — perm `...timeline.read` — ⚠ SHAPE SẼ ĐỔI theo quyết định A.2 của Tài, chưa xây UI
- Path `zoneId` uuid. Query: `from`+`to` ISO BẮT BUỘC (>31 ngày → 400 `INVALID_TIMELINE_RANGE`) · `userId`? uuid — ⚠ **camelCase** (ngoại lệ duy nhất).
- `data` hiện tại: `{ events:[{ eventTime: ISO, eventType:'appear'|'disappear'|'count', occupancyCount|null, userId|null }], personDataAvailable: bool|null, totalDurationSeconds: number|null (chỉ khi có userId; hiện LUÔN 0 do mô hình chỉ-appear — lý do A.2), ongoing: bool, message?: chỉ khi events rỗng }`. 404 `ZONE_NOT_FOUND`.
- Nguồn: `zone-presence-timeline.controller.ts:28-43`; `dto/query-zone-timeline.dto.ts:4-13`; `dto/zone-timeline-response.dto.ts:1-15`; `services/zone-presence-timeline.service.ts:37-118`.

## B-M6 — Minutes nâng cao (perm `meeting.minutes.*`)

### B-M6.1 `GET /api/v1/meeting-minutes/search-by-person` — perm `...search_by_person`
- Query: `userId` uuid4 **BẮT BUỘC** · `page`=1 · `limit`=20 **max 20**. `data[]`: shape list item minutes `{ id, title, status('draft|published|archived'), versionNo, createdAt, meeting:{...}, host:{...}|null, isAiGenerated }` + `meta`. Nguồn: `minutes-list.controller.ts:133`; `dto/search-minutes-by-person-query.dto.ts:4-20`; `dto/minutes-list-item.dto.ts:6-33`.
### B-M6.2 `PATCH /api/v1/meeting-minutes/:id/link-resources` — perm `...link_resources` — body `{ recordingFileId?: uuid4|null, transcriptId?: uuid4|null }` (null = gỡ link) (`dto/link-minutes-resources.dto.ts:11-21`).
### B-M6.3 `POST /api/v1/meeting-minutes/:id/shares` — perm `...share.create` — body `{ userId: uuid4 }` → `data`: `{ id, minutesId, userId, userFullName, grantedBy, grantedAt }` (`dto/create-minutes-share.dto.ts:7-10`; `dto/minutes-share-response.dto.ts:4-15`).
### B-M6.4 `GET /api/v1/meeting-minutes/:id/shares` — perm `...share.read` → `data[]` shape B-M6.3.
### B-M6.5 `DELETE /api/v1/meeting-minutes/:id/shares/:userId` — perm `...share.delete` → `data`: `{ minutesId, userId, revoked: true }`.
### B-M6.6 `POST /api/v1/meeting-minutes/:id/exports` — perm `...export` — body `{ format:'pdf'|'docx' (bắt buộc), includeTranscript?: bool, includeActionItems?: bool }` → `data`: `{ jobId, status:'queued', minutesId, format, estimatedCompletion|null }` → poll `GET /background-jobs/:jobId` (`dto/create-minutes-export.dto.ts:9-20`; `dto/create-minutes-export-response.dto.ts:8-18`).
### B-M6.7 `POST /api/v1/meeting-minutes/:minutesId/attachments` — perm `...attachment.create` — **multipart field `file`** (`minutes-list.controller.ts:571`) → `data`: `{ id, fileName, fileType, mimeType, fileSizeBytes:string|null, fileUrl|null, uploadedBy|null, uploadedAt }` (`dto/minutes-attachment-response.dto.ts:1-21`).
### B-M6.8 `GET .../attachments` — perm `...attachment.read` → `data[]` shape B-M6.7. · **B-M6.9** `DELETE .../attachments/:fileId` — perm `...attachment.delete`.

## B-M7 — Gửi thông báo meeting (class-level ⚠ forbidNonWhitelisted; các POST trả **HTTP 202**, response không có `message`)

### B-M7.1 `POST /api/v1/meetings/:meetingId/invitations` — perm `notification.invite.send` — body `{ channels: ('email'|'in_app')[] ≥1 (bắt buộc), includeAgenda?: bool, message?: ≤1000 }` → `data`: `{ notificationId, deliveryStatus, queuedRecipientCount, skippedRecipientCount }` (`notifications.controller.ts:55-69`; `services/meeting-notifications.service.ts:77-86`).
### B-M7.2 `POST .../reminders` — perm `notification.reminder.send` — body `{ channels (bắt buộc), reminderType:'manual'|'scheduled' (bắt buộc), sendAt?: ISO strict }` → `data`: `{ notificationId, deliveryStatus, scheduledSendAt|null }`.
### B-M7.3 `POST .../cancellation-notifications` — perm `notification.cancellation.send` — body `{ channels (bắt buộc), reason?: ≤1000 }`; meeting chưa cancelled → 409 `MEETING_NOT_CANCELLED` → `data`: `{ meetingId, notificationId, queuedRecipientCount }`.
### B-M7.4 `POST .../minutes/distributions` — perm `minutes.distribute` — body `{ minutesId: uuid (bắt buộc), recipientScope:'participants'|'custom' (bắt buộc), recipientUserIds?: uuid[] (khi custom), channels (bắt buộc), message? }` → `data`: `{ notificationId, queuedRecipientCount, minutesId }`.
### B-M7.5 `GET /api/v1/notifications/:id` — perm `notification.read.self` (chỉ xem được nếu mình là recipient — 403 `NOTIFICATION_ACCESS_DENIED`) → `data`: `{ id, notificationType, subject|null, content, relatedEntityType|null, relatedEntityId|null, priority, createdAt }`. (List `GET /notifications`: query chỉ `page/limit`; cùng item shape + `meta` — Nhóm 1, FE có sẵn.)

## B-M8 — Participants & Agenda item (meetings)

### B-M8.1 `GET /api/v1/meetings/:meetingId/available-rooms` — JWT — query: `capacityWarningMode`?='true' · `includeCurrentRoom`?='true' (string so sánh 'true') → `data[]`: `{ roomId, roomName, roomCode, capacity, location|null, equipmentFlags: string[], availabilityStatus, isCurrentRoom, capacityWarning:{ roomCapacity, attendeeCount, message }|null }` (`meetings.controller.ts:253-288`; `dto/available-room.dto.ts:1-17`).
### B-M8.2 `GET /api/v1/me/schedule/:meetingId` — perm `schedule.read.self` → `data` = `MyScheduleDetailDto`: `{ meeting:{ meetingId, meetingCode, title, description|null, startTime, endTime, timezone, status, recurrenceRuleId|null, parentMeetingId|null }, room:{ id, roomName, roomCode, siteName|null, areaName|null, location|null }|null, organizer:{ id, fullName, email }, host:{...}|null, participants:[{ id, userId?, fullName, email, participantRole, invitationStatus, attendanceStatus }], externalParticipants:[{ name, email }], agendas:[{ id, title, durationMinutes|null, sortOrder }], attachments:[{ id, fileName, fileUrl|null, fileType, fileSize|null }], recordingConfig:{ autoRecord, allowRecording, enableTranscription }|null, userRole }` (`dto/my-schedule-detail.dto.ts:138-162`). ⚠ `GET /meetings/:meetingId` (Nhóm 1) trả **CÙNG shape** — cùng gọi `getMyScheduleDetail` (`meetings.controller.ts:242`).
### B-M8.3 `GET /api/v1/meetings/:meetingId/participants/import/template` — perm `meeting.participant.import` — trả **FILE .xlsx binary** (Content-Disposition attachment; header: type, email, employee_code, full_name, organization_name, phone_number) — FE tải blob, KHÔNG parse JSON (`meetings.controller.ts:341-363`).
### B-M8.4 `POST /api/v1/meetings/:meetingId/participants/import` — perm `meeting.participant.import` — **multipart**: field `file` (.xlsx) + field text `forceAddWithWarnings`?('true'). HTTP 200. Lần 1 có dòng cảnh báo → **422 kèm preview**; gửi lại `forceAddWithWarnings=true` để commit. `data`: `{ totalRows, successCount, failedCount, warningCount, results:[{ row, type|'unknown', identifier, status, reason?, participantId? }] }` (`meetings.controller.ts:365-424`; `dto/import-participants-response.dto.ts:10-32`).
### B-M8.5 `POST /api/v1/meetings/:meetingId/participants/external` — perm `meeting.participant.add.external` ⚠ forbidNonWhitelisted — body `{ fullName: ≤255 (bắt buộc), email (bắt buộc), organizationName?: ≤255, phoneNumber?: ≤30, overrideWarnings?: bool, warningToken?: string }`. HTTP 201. `data`: `{ externalParticipantId, meetingId, fullName, email, organizationName|null, phoneNumber|null, role, status }` (`dto/add-external-participant.dto.ts:11-38`; `dto/add-external-participant-response.dto.ts:1-10`).
### B-M8.6 `DELETE /api/v1/meetings/:meetingId/participants/external/:externalParticipantId` — JWT ⚠ forbidNonWhitelisted — body optional `{ reason?: ≤1000, scope?: 'instance'|'series' }` → `data`: `{ meetingId, removedExternalParticipantId, removed, removedAt, notificationQueued, notificationId|null, backgroundJobId|null }`.
### B-M8.7 `DELETE /api/v1/:meetingId/participants/:participantUserId` (CHỜ BE-06 thêm prefix `meetings/`) — JWT — body `{ reason?: ≤1000, scope?: 'instance'|'series' }` → `data`: `{ meetingId, removedParticipantUserId, removed, removedAt, notificationQueued, notificationId, backgroundJobId }` (`meetings.controller.ts:795-845`).
### B-M8.8 `GET /api/v1/:meetingId/agendas` (CHỜ BE-06) — JWT → `data`: `{ meetingId, meetingStatus, meetingDurationMinutes, totalPlannedDurationMinutes, remainingDurationMinutes, durationStatus:'valid'|'overflow', isLockedForEditing, lockReason|null, items:[shape B-P0.9] }` (`dto/agenda-response.dto.ts:16-30`).
### B-M8.9 `PATCH /api/v1/:meetingId/agendas/:agendaId` (CHỜ BE-06) — JWT ⚠ forbidNonWhitelisted — body (partial, ≥1 field): `{ title?≤255, description?≤2000|null, ownerId? uuid|null, plannedDurationMinutes? int≥1, agendaOrder? int≥1 }` → `data`: `{ id, meetingId, agendaOrder, title, description|null, ownerId|null, ownerName|null, plannedDurationMinutes, status, updatedAt, totalPlannedDurationMinutes, remainingDurationMinutes }`. Lỗi 400 `AGENDA_UPDATE_PAYLOAD_EMPTY`, 409 `AGENDA_MEETING_STATUS_BLOCKED|MEETING_TIME_INVALID_FOR_AGENDA`. · **B-M8.10 (đếm cùng mục 9)** `DELETE .../agendas/:agendaId` → `data`: `{ deleted, agendaId, meetingId, totalPlannedDurationMinutes, remainingDurationMinutes, remainingItemCount }` (`dto/update-agenda-item.dto.ts:10-52`; `dto/agenda-response.dto.ts:43-73`).

## B-M9 — Vận hành phòng

### B-M9.1 `GET /api/v1/rooms/:roomId/deletion-impact` — perm `room.delete` → `data`: `{ roomId, roomName, affectedMeetingCount, blockedByInProgressMeeting }` (`rooms.controller.ts:177-202`; `dto/deletion-impact-response.dto.ts:1-10`).
### B-M9.2 `GET /api/v1/rooms/realtime-status` — xem B-P0.8. · **B-M9.3** `GET /api/v1/rooms/:roomId/status` — perm `room.utilization.read` → `data`: `{ roomId, roomCode, currentStatus, currentBooking:{ bookingId|null, meetingId|null, title|null, hostName|null, reservedStartTime|null, reservedEndTime|null }|null, noShowCase: LUÔN null, releaseHistory: LUÔN [], lastPresenceAt|null, occupancyCount|null }`; 404 `ROOM_NOT_FOUND` (`room-status.service.ts:36-52,117-134`).
### B-M9.4 `GET /api/v1/room-bookings` — perm `room.booking.read` — ⚠ data-scope: không phải SYSTEM/BUSINESS_ADMIN thì chỉ thấy booking của người mình quản lý (list rỗng, không 403)
- Query: `page`=1 · `limit`=20 max100 · `roomId` uuid4 · `status` ∈ `pending|approved|active|completed|cancelled|released` (**sai → 422**) · `bookingType` ∈ `scheduled|ad_hoc|extension|relocated` (**sai → 422**) · `from`/`to` (`from<=to`) · `q` (chỉ ILIKE `bookingCode`) · `sortBy` ∈ `reserved_start_time|created_at|status` (default reserved_start_time) · `sortOrder` desc.
- `data[]`: `{ id, bookingCode, bookingType, status, roomId, meetingId, bookedBy, reservedStartTime, reservedEndTime, approvedBy|null, approvedAt|null, cancellationReason|null, createdAt, updatedAt, room:{id,roomName}|⚠undefined, meeting:{id,title}|null, bookedByUser:{id,fullName,email}|⚠undefined, approvedByUser:{...}|null }` + `meta`.
- Nguồn: `room-bookings.controller.ts:39-66`; `dto/room-booking-query.dto.ts:13-61`; `dto/room-booking-list-item.dto.ts:6-64`.
### B-M9.5-6 `GET|PUT /api/v1/no-show-config` — perm `room.noshow.configure` (GET cũng gated)
- GET `data`: `{ thresholdMinutes:{value,source}, warningGraceMinutes:{value,source}, autoReleaseGraceMinutes:{value,source} }` — `source` ∈ `system_configs|env|default`; default 15/0/5.
- PUT (HTTP 200) body ⚠ forbidNonWhitelisted: `{ thresholdMinutes? int 1-1440, warningGraceMinutes? int 0-1440, autoReleaseGraceMinutes? int 1-1440 }` — **≥1 field** nếu không 400 `NO_CONFIG_FIELDS`; response = shape GET. Nguồn: `no-show-config.controller.ts:27-50`; `services/no-show-config.service.ts:36-177`.
### B-M9.7-8 `GET|PUT /api/v1/early-vacancy-config` — perm `room.early_vacancy.configure` — tương tự: keys `emptyMinutes`(≥1, def 10) / `minRemainingMinutes`(≥0, def 15) / `minElapsedMinutes`(≥0, def 10); PUT ⚠ forbidNonWhitelisted + ≥1 field (`early-vacancy-config.controller.ts:29-52`).

## B-M10 — Analytics chi tiết + tiện ích quản trị

### B-M10.1 `GET /api/v1/analytics/rooms/usage-history` — perm `analytics.room.read`
- Query: `preset` ∈ `day|week|month|custom` (def month) · `from`/`to` ISO (khi custom) · `roomId` uuid4 · `siteName` ≤150 · (xem thêm DTO `query-room-usage-history.dto.ts:17-47`).
- `data`: `{ period:{from,to}, summary:{ totalReservedHours, totalActualHours|null, noShowCount, reservationUtilizationRate, roomOccupancyRate|null }, sessions:[{ roomId, roomName, meetingId, meetingTitle, hostName, reservedStartTime, reservedEndTime, actualStartTime|null, actualEndTime|null, sessionStatus }] }` (`dto/room-usage-history-response.dto.ts:12-37`).
### B-M10.2 `GET /api/v1/analytics/rooms/:roomId/detail` — perm `analytics.room.read` — query `preset|from|to` → `data`: `{ room:{ roomId, roomName, siteName|null, areaName|null, capacity }, period, bookedHours, actualHours|null, reservationUtilizationRate, roomOccupancyRate|null, hasActualData, heatmap:[{ hourOfDay:0-23, actualMinutes }], meetings:[{ meetingId, title, organizerName, reservedStartTime, reservedEndTime, actualStartTime|null, actualEndTime|null, status }] }` (`dto/room-usage-response.dto.ts:25-57`).
### B-M10.3 `GET /api/v1/analytics/attendance/on-time-rate/users/:userId/late-history` — perm `analytics.attendance.read` — query `preset ∈ day|week|month|quarter|custom` · `from|to` · `graceMinutes?` int → `data`: `{ user:{ userId, fullName, email }, period, lateMeetings:[…] }` (`dto/query-late-history.dto.ts:5-35`; `dto/on-time-rate-response.dto.ts:47-55`).
### B-M10.4 `GET /api/v1/users/manage` — perm `accounts.user.manage` (Business Admin bị giới hạn department scope)
- Query: `departmentId` uuid4 · `roleId` uuid4 · `accountStatus` ∈ `active|inactive|locked|pending_reset` · `search` (tên/email/mã NV) · `sortBy` ∈ `fullName|email|employeeCode|accountStatus|createdAt` (def fullName) · `sortOrder` asc · `page`=1 · `limit`=20 max100.
- `data[]`: `{ id, fullName, email, employeeCode|null, accountStatus, departmentId|null, roles: string[] (roleCode) }` + `meta`. Nguồn: `users.controller.ts:693-744`; `dto/manage-users-query.dto.ts:10-51`; `dto/manage-user-item.dto.ts:7-31`.
### B-M10.5 `DELETE /api/v1/roles/:roleId/permissions/:permissionId` — perm `admin.manage_permissions` — KHÔNG body; response CHỈ `{ success, message }`, **không có `data`** (`role-permissions.controller.ts:70-91`).
### B-M10.6 `GET /api/v1/meetings/:meetingId/attendance/:recordId` — perm `attendance.read`
- `data`: 17 field của `ManualAttendanceResponseDto` `{ id, meetingId, userId, participantId|null, checkInMethod('manual|door_camera|room_camera|qr|system'), attendanceSource('manual|camera|presence_snapshot|mixed'), checkInTime|null, checkOutTime|null, isLate, lateMinutes|null, leftEarly, attendanceStatus('present|absent|late|left_early|invalidated|pending_review'), verifiedBy|null, verifiedAt|null, … }` + `userFullName|null, meetingTitle|null, editHistory:[{ at, actorUserId|null, actionType('create_manual_attendance|update_attendance_status|update_attendance_record|invalidate_attendance'), changes|null }]`. 404 `ATTENDANCE_RECORD_NOT_FOUND`. (List `GET .../attendance`: query `status ∈ all|present|late|absent|not_checked_in|left_early`, `search`, `page`, **`pageSize`** — không phải `limit`! — `attendance.controller.ts:48-55`.)
- Nguồn: `attendance.controller.ts:81-113`; `dto/attendance-record-detail-response.dto.ts:7-51`; enum `entities/attendance-record.entity.ts:14-36`.
### B-M10.7 `GET /api/v1/meetings/:meetingId/timeline` — perm `meeting.timeline.read` (chỉ host/participant — 403 `NOT_A_MEETING_PARTICIPANT`) ⚠ forbidNonWhitelisted
- Query: `from`/`to` ISO · `types` string CSV · `sort` asc|desc (def asc) · `page`=1 · `limit`=20 max100.
- `data[]`: `{ time: ISO, category:'meeting_event'|'attendance'|'note', type (vd meeting_started, check_in, note, warning_sent…), actorUserId|null, actorName|null, detail|null, refId }` + `meta`. Nguồn: `live-meeting.controller.ts:733-792`; `dto/timeline-query.dto.ts:18-47`; `dto/timeline-item.dto.ts:6-33`.

## B-M11 — Reports exports + IoT + IVSS

**Chung 4 export (B-M11.1-4):** HTTP 201, `data`: `{ jobId, status:'queued', delivery:'download', outputFileId: null }` → poll `GET /background-jobs/:jobId` tới `completed` rồi lấy file qua media-files. Body chung: `from`+`to` ISO **BẮT BUỘC** + `format`.
### B-M11.1 `POST /api/v1/reports/room-utilization/exports` — perm `report.room_utilization.export` — `format ∈ pdf|xlsx|csv`; `scope?: { roomId? uuid }`; `delivery?: 'download'` (`dto/create-room-utilization-export.dto.ts:24-42`).
### B-M11.2 `POST /api/v1/reports/gate-access/exports` — perm `report.gate_access.export` — `format ∈ pdf|xlsx`; `scope?: { zoneId?, departmentId?, userId? }` (`dto/create-gate-access-export.dto.ts:33-47`).
### B-M11.3 `POST /api/v1/reports/security-alert/exports` — perm `report.security_alert.export` — `format ∈ pdf|xlsx`; `filters?: { alertType?, zoneId?, status? ∈ new|acknowledged|resolved }` (`dto/create-security-alert-export.dto.ts:37-51`).
### B-M11.4 `POST /api/v1/reports/vehicle/exports` — perm `report.vehicle.export` — `format ∈ pdf|xlsx`; `content ∈ registrations|traffic_stats|both` (BẮT BUỘC); `filters?: { vehicleType?, zoneId? }` (`dto/create-vehicle-export.dto.ts:30-44`).
### B-M11.5 `GET /api/v1/iot-devices/status-summary` — perm `iot.device.read` → `data`: `{ total, online, offline, unknown, byType: Record<string,number> }` (`iot-devices.service.ts:402-427`).
### B-M11.6 `POST /api/v1/iot-devices/probe-status` — perm `iot.device.probe` — KHÔNG body, HTTP 200 → `data`: `{ checked, online_count, offline_count, transitions:[{ id, from, to }] }` — probe chỉ chạy trên IP camera (`iot-devices.service.ts:472-488`).
### B-M11.7 `PATCH /api/v1/iot-devices/:id/ai-config` — perm `iot.device.configure_ai` — body (wire snake_case): `{ "face_recognition"?: bool, "plate_recognition"?: bool, "people_counting"?: bool }` → `data`: device shape B-P0.5 (`dto/configure-ai-config.dto.ts:24-39`).
### B-M11.8 `GET /api/v1/ivss/meetings/:meetingId/presence` — perm `ivss.presence.read` → `data`: `{ participants:[{ userId, fullName|null, durationMs, method:'interval'|'approx', segmentCount, presentRatio, unmatchedCount }], meetingUnmatchedIdentityCount }`; 404 `MEETING_NOT_FOUND` (`ivss-presence-query.service.ts:120-131`). (FE đã gọi — Nhóm 1, để đây cho đủ bộ.)
### B-M11.9 `GET /api/v1/ivss/meetings/:meetingId/presence/:userId` — perm `ivss.presence.read` → `data`: `{ duration:{ durationMs, method, segmentCount, presentRatio }, timeline:{ segments:[{ start, end, state:'present', source:'interval'|'cluster' }], absentGaps:[{start,end}], events:[{ at: ISO, direction|null, similarity|null }], unmatchedCount } }` (`ivss-presence-query.service.ts:65-117`).
### B-M11.10 `GET /api/v1/ivss/meetings/:meetingId/presence/report` — perm `ivss.presence.read` — trả **PDF binary** (không envelope). ⚠ **HIỆN KHÔNG GỌI ĐƯỢC** — bug thứ tự route (§A.4.1), chờ Tài sửa rồi mới nối nút "Tải PDF".
### B-M11.11 `GET /api/v1/ivss/health` — perm `ivss.health.read` → `data`: `{ bridge:'up'|'down'|'degraded', detail?: string }` (`ivss-health.controller.ts:19-40`).
