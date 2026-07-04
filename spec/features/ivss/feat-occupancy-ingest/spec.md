---
name: "Feature Specification: Occupancy webhook receiver cho IVSS bridge"
description: "IVSS-OCC-001 / A-OCC: route POST /api/v1/internal/ivss/occupancy-events nhận People-Counting từ IVSS bridge, resolve channel→room qua system_configs, tái dùng logic ghi occupancy hiện có."
version: "1.0"
date: "2026-06-30"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-30 | Khởi tạo spec A-OCC (IVSS-OCC-001) sau RECON: route thứ ba họ `internal/ivss/*`, guard `IvssInternalTokenGuard`, channel→room qua `system_configs['ivss.channel_room_map']`, tái dùng `persistOccupancy` (refactor tách từ OccupancyIngestService). Mọi quyết định đã khóa ở §Locked Decisions. | Toàn bộ file |
| 2026-06-30 | Revise 4 điểm: (1) khóa `confidence=null` cho IVSS (§7-9, gỡ khỏi §9); (2) đảo §4 ghi raw TRƯỚC channel-map + cập nhật AC-05/11/12; (3) §9 thêm việc PLAN verify NULL-constraint `iot_device_events.room_id`/`room_events.room_id`; (4) §7-5 cấm nhân bản `persistOccupancy` (duy nhất 1 nơi, A-OCC import). | §4, §6, §7, §9 |
| 2026-06-30 | Back-port **AC-17** (A-OCC `number` ngoài [0,MAX] → ghi raw + ack 200, persist ném BadRequest bị nuốt, KHÔNG persist room-level) theo PLAN LOCKED-A — spec là nguồn AC đầy đủ. | §6 |

> **SPEC-ONLY.** Chưa plan/tasks/code. Nền RECON coi là sự thật. KHÔNG migration, KHÔNG cột/bảng mới, KHÔNG seed device/map.

---

# 1. Tóm tắt & Mục tiêu
Thêm endpoint **`POST /api/v1/internal/ivss/occupancy-events`** nhận sự kiện **đếm người (People Counting / Number Stat)** từ IVSS bridge (fire-and-forget, system-to-system), **resolve `channelId` → `room_id`** qua config sẵn có, rồi **ghi occupancy** vào hệ thống (`room_events` + `presence_snapshots`/`room_booking_usages` + `rooms.current_status` + WebSocket) bằng cách **tái dùng** logic ghi occupancy hiện có (refactor tách `persistOccupancy`).

Đây là **route thứ ba** cùng họ `internal/ivss/*` (sau `events` = face, `vehicle-events` = ANPR), cùng cơ chế auth shared-secret.

# 2. Phạm vi (Scope)

## 2.1. In-scope
- Controller + DTO + service mới trong **module `ivss`** cho route occupancy.
- Auth bằng `IvssInternalTokenGuard` (header `X-Internal-Token` = `IVSS_BRIDGE_TOKEN`).
- Resolve `channelId → room_id` qua `system_configs['ivss.channel_room_map']` (mirror `resolveRoom`).
- Resolve device bridge qua `device_code='IVSS-BRIDGE'`; ghi raw `iot_device_events` với `device.id` của bridge.
- **Refactor**: tách method dùng chung `persistOccupancy(...)` (transaction + WS) từ `OccupancyIngestService` để **cả room-camera path lẫn A-OCC** cùng gọi.
- Hành vi biên: channel không map → skip+ack; count==0 → không đổi status; presence/usage chỉ khi có booking; eventTime parse + fallback now.

## 2.2. Out-of-scope
- **KHÔNG** recording/RTSP (camera occupation ≠ A5 check-availability/recording).
- **KHÔNG** hướng đếm vào/ra chi tiết (C13/C14) — `enteredNumber`/`exitedNumber` chỉ lưu raw payload, **chưa** dùng cho count.
- **KHÔNG** tạo seed device `IVSS-BRIDGE` / seed `ivss.channel_room_map` (dữ liệu vận hành, ngoài scope).
- **KHÔNG** migration / cột / bảng mới.
- **KHÔNG** đổi auth model của room-camera (`deviceCode` + `x-callback-token` giữ nguyên).

# 3. Contract (API)

## 3.1. Endpoint
| Method + Path | Auth | Body | Mã thành công |
| :--- | :--- | :--- | :--- |
| `POST /api/v1/internal/ivss/occupancy-events` | `IvssInternalTokenGuard` (header `X-Internal-Token`) | JSON (§3.2) | **200** (ack-always) |

System-to-system, **KHÔNG JWT user**. Đặt trong module `ivss` (cùng họ `events`/`vehicle-events`).

## 3.2. Request body schema
| Field | Kiểu | Bắt buộc | Ý nghĩa / map |
| :--- | :--- | :--- | :--- |
| `type` | string | có | = `"occupancy"` (phân loại sự kiện) |
| `channelId` | int | có | Channel IVSS → resolve `room_id` qua config-map |
| `number` | int | có | Số người hiện tại trong phòng → **`occupancyCount = number`** |
| `enteredNumber` | int | optional | Số vào — **chỉ lưu raw `payload_json`**, KHÔNG dùng cho count |
| `exitedNumber` | int | optional | Số ra — **chỉ lưu raw `payload_json`**, KHÔNG dùng cho count |
| `utc` | string (ISO) | có | → `eventTime` (parse; lệch/sai → now) |
| `eventAction` | string | optional | Lưu raw payload (chưa dùng) |

Header: `X-Internal-Token: <IVSS_BRIDGE_TOKEN>`.

## 3.3. Response
Ack-always (mirror `internal/ivss/events`):
```json
{ "success": true, "message": "IVSS occupancy event accepted", "data": { "accepted": true } }
```

## 3.4. Mã trả về
| Tình huống | Mã |
| :--- | :--- |
| Token hợp lệ (kể cả khi skip ghi do channel không map / device chưa seed) | **200** + `{accepted:true}` |
| Thiếu / sai `X-Internal-Token` (guard, fail-closed) | **401** `UNAUTHORIZED` |
| `IVSS_BRIDGE_TOKEN` chưa cấu hình (env rỗng) | **401** (fail-closed, mirror guard hiện có) |
| Body malformed (sai kiểu/thiếu field bắt buộc — ValidationPipe) | **400** |

> Mọi lỗi nghiệp vụ/ghi (channel không map, device chưa seed, count bất thường, lỗi transaction) → **vẫn ack 200** + log (try/catch quanh handler, mirror `IvssWebhookController`), KHÔNG để bridge retry.

# 4. Luồng nghiệp vụ (mô tả — KHÔNG code)
**Nguyên tắc**: ghi **raw `iot_device_events` TRƯỚC** khi resolve room — raw là hộp đen truy vết (thấy event tới từ channel nào, kể cả channel chưa cấu hình map) khi livetest.
1. **Guard** `IvssInternalTokenGuard` verify `X-Internal-Token` (constant-time, fail-closed) → sai/thiếu → 401.
2. **Normalize** body → DTO. `occupancyCount = number`. `eventTime` = parse(utc) (lệch/sai → now).
3. **Resolve bridge device**: `SELECT id FROM iot_devices WHERE device_code='IVSS-BRIDGE'`. **Không có → skip + log + ack 200** (tiền đề chưa seed) — KHÔNG ghi gì.
4. **Ghi raw `iot_device_events`** (device_id = bridge.id, event_type occupancy, `payload_json` = body đã `maskSensitiveMetadata` gồm `enteredNumber`/`exitedNumber`/`eventAction`, `event_time` = eventTime). `room_id` = room resolve được ở bước 5; **nếu chưa resolve → ghi NULL** (tùy NULL-constraint — xem §9; PLAN có thể buộc đẩy ghi raw xuống sau bước 5 nếu cột NOT NULL).
5. **Resolve room**: `resolveRoom(channelId)` qua `system_configs['ivss.channel_room_map']` (validate UUID). **Không map → log skip + ack 200, DỪNG** (đã có raw vết ở bước 4; KHÔNG ghi `room_events`/persist).
6. **Resolve meeting** best-effort: booking active của room tại `eventTime` (để có `meeting_id` cho presence_snapshots).
7. **Gọi `persistOccupancy(roomId, meetingId, occupancyCount, null, eventTime)`** (method dùng chung — §Locked-5; `confidence` luôn `null` cho IVSS — §Locked-9): transaction `room_events` + (nếu booking) `presence_snapshots` + `room_booking_usages` + `rooms.current_status` (count>0 → occupied) + WS emit. Trả `{ statusChanged }`.
8. **Ack 200**.

# 5. SEC
- KHÔNG log `X-Internal-Token` (guard không log).
- Raw payload lưu qua `maskSensitiveMetadata` (mirror room-camera) — redact field nhạy cảm nếu có.
- WS best-effort: lỗi WS KHÔNG ảnh hưởng ack/DB.

# 6. Acceptance Criteria
1. **AC-01 (auth pass)**: Given token đúng; When POST occupancy hợp lệ + channel có map; Then **200** `{accepted:true}` và đã ghi occupancy.
2. **AC-02 (auth sai)**: Token sai → **401** `UNAUTHORIZED`, KHÔNG ghi gì.
3. **AC-03 (auth thiếu)**: Thiếu header `X-Internal-Token` → **401**.
4. **AC-04 (channel có map → ghi đủ)**: channel ∈ `ivss.channel_room_map` → ghi raw `iot_device_events` + `room_events` cho đúng `room_id`.
5. **AC-05 (channel không map → vẫn ghi raw, skip persist)**: device `IVSS-BRIDGE` tồn tại nhưng channel ∉ map → **CÓ ghi raw `iot_device_events`** (room_id NULL hoặc bỏ trống tùy constraint §9) làm vết, **KHÔNG** ghi `room_events`/`presence`/`usage`/status, có log skip → **200** `{accepted:true}`.
6. **AC-06 (count>0 → occupied + WS)**: `number>0` → `rooms.current_status='occupied'` (khi đang khác) + WS `room.status.updated` (chỉ khi status thật sự đổi) + WS `room.occupancy.updated`.
7. **AC-07 (count==0 → không đổi status)**: `number==0` → KHÔNG đổi `rooms.current_status` (D-4); vẫn ghi `room_events` count=0.
8. **AC-08 (có booking → presence + usage)**: booking active tại eventTime → ghi `presence_snapshots` (với `meeting_id` của booking) + cập nhật `room_booking_usages`.
9. **AC-09 (không booking → chỉ room_events)**: không booking active → chỉ `room_events`, KHÔNG `presence_snapshots`/`room_booking_usages`.
10. **AC-10 (eventTime)**: `utc` hợp lệ trong ngưỡng skew → dùng làm `eventTime`; thiếu/sai/lệch quá ngưỡng → `now`.
11. **AC-11 (raw event ghi sớm)**: raw `iot_device_events` ghi **ngay sau resolve device** (TRƯỚC channel-map) với `device.id` của `IVSS-BRIDGE`, `payload_json` chứa `enteredNumber`/`exitedNumber`/`eventAction` (đã redact); ghi cả khi channel có map lẫn không map.
12. **AC-12 (device chưa seed → không ghi raw)**: không tồn tại device `IVSS-BRIDGE` → skip TRƯỚC khi ghi raw (KHÔNG ghi `iot_device_events`) → **200** `{accepted:true}` + log skip (KHÔNG 500).
13. **AC-13 (refactor không hồi quy)**: sau khi tách `persistOccupancy`, **toàn bộ test room-camera (OCC-001) GIỮ XANH** — đây là tiêu chí pass cứng.
14. **AC-14 (SEC)**: response/log KHÔNG lộ token; raw payload đã `maskSensitiveMetadata`.
15. **AC-15 (WS best-effort)**: lỗi WS KHÔNG làm vỡ ack 200 / KHÔNG rollback DB.
16. **AC-16 (ack-always nghiệp vụ)**: lỗi nghiệp vụ/transaction trong handler → vẫn **200** `{accepted:true}` + log (try/catch), KHÔNG để bridge retry.
17. **AC-17 (count bất thường — hệ quả PLAN LOCKED-A)**: A-OCC với `number` ngoài `[0, MAX_OCCUPANCY]` → **CÓ ghi raw `iot_device_events`** (vết, `room_id=NULL`); `persistOccupancy` validate count → ném `BadRequest`; handler **nuốt → 200** `{accepted:true}` + log; **KHÔNG** ghi `room_events`/`presence_snapshots`/`room_booking_usages`/status.

# 7. Locked Decisions (chép từ chỉ đạo — KHÔNG đổi)
1. **Route**: `POST /api/v1/internal/ivss/occupancy-events`, module `ivss`, HTTP 200 ack-always.
2. **Auth**: tái dùng `IvssInternalTokenGuard` (cùng `IVSS_BRIDGE_TOKEN`); KHÔNG callback-token room-camera.
3. **Channel→room**: tái dùng `system_configs['ivss.channel_room_map']`, mirror `resolveRoom`; KHÔNG cột/bảng/migration mới.
4. **Field mapping**: `occupancyCount = number`; `enteredNumber`/`exitedNumber` chỉ vào `payload_json` raw (chưa dùng cho count).
5. **Tái dùng ghi (OQ-1=a)**: **REFACTOR** tách `persistOccupancy(roomId, meetingId, occupancyCount, confidence, eventTime) → {statusChanged}` (gồm WS) từ `OccupancyIngestService`, dùng chung room-camera + A-OCC. Ranh giới tách **SAU** ghi raw `iot_device_events` (mỗi đường resolve `device.id` khác nhau). Ràng buộc cứng: **test OCC-001 room-camera giữ xanh**. **`persistOccupancy` tồn tại DUY NHẤT một nơi** (giữ tại `OccupancyIngestService` + export, hoặc tách provider chung — chốt ở PLAN); A-OCC **IMPORT/gọi lại**, **TUYỆT ĐỐI KHÔNG copy/nhân bản** logic ghi sang module `ivss`. Cách wiring cross-module → PLAN.
6. **Device**: A-OCC resolve bridge qua `device_code='IVSS-BRIDGE'`; raw event ghi `device.id` của bridge.
7. **Hành vi biên** (mirror face/room-camera): channel không map → skip+ack; count==0 → không đổi status (D-4); presence/usage chỉ khi có booking; eventTime parse + fallback now.
8. **SEC**: không log token; redact payload (`maskSensitiveMetadata`).
9. **`confidence` luôn `null` cho occupancy nguồn IVSS bridge** (Number Stat KHÔNG cung cấp độ tin cậy) — khác room-camera/Python vốn có `confidence`. `persistOccupancy` vẫn nhận `confidence` param để dùng chung; **A-OCC luôn truyền `null`**.

# 8. File dự kiến đụng (KHÔNG code ở pha này — chỉ liệt kê)
| Loại | Đường dẫn (dự kiến) | Vai trò |
| :--- | :--- | :--- |
| TẠO | `src/modules/ivss/controllers/ivss-occupancy.controller.ts` | Route + guard + ack-always (mirror `ivss-webhook.controller.ts`) |
| TẠO | `src/modules/ivss/dto/occupancy-event.dto.ts` | Validate body (`type`/`channelId`/`number`/`utc` bắt buộc; `entered/exited/eventAction` optional) |
| TẠO | `src/modules/ivss/services/ivss-occupancy-ingest.service.ts` | Resolve channel→room + bridge device + ghi raw event + gọi `persistOccupancy` |
| SỬA (refactor) | `src/modules/presence/services/occupancy-ingest.service.ts` | Tách `persistOccupancy` (transaction+WS) thành method dùng chung; giữ nguyên auth/raw room-camera + test OCC-001 xanh |
| SỬA (wiring) | `src/modules/ivss/ivss.module.ts` (+ có thể `presence.module.ts` export) | Đăng ký controller/service; cross-module reuse `persistOccupancy` (chi tiết wiring → PLAN) |
| TẠO (test) | spec controller/service A-OCC | Phủ AC-01…AC-16 |
| TẠO (docs) | `spec/features/ivss/feat-occupancy-ingest/{plan,tasks}.md` | Pha sau |

# 9. Open Questions — Cần người chốt
**Không còn câu hỏi mở** — mọi quyết định đã khóa ở §7.

**Việc PLAN phải verify (KHÔNG tự quyết — dựa schema thật):**
- **NULL-constraint** của `iot_device_events.room_id` (cho trường hợp ghi raw ở bước §4-4 KHI channel chưa map → room_id NULL) **và** `room_events.room_id`. Nếu `iot_device_events.room_id` **NOT NULL** → raw-khi-không-map phải **ghi `room_id` placeholder hợp lệ** hoặc **hoãn ghi raw xuống sau resolve room** (điều chỉnh lại thứ tự bước §4-4/§4-5). Nêu phương án ở PLAN dựa entity/migration thật, KHÔNG tự chọn.
- Nơi đặt `persistOccupancy` để cross-module reuse sạch (giữ tại `OccupancyIngestService` + export vs tách provider chung) — chốt ở PLAN (§Locked-5: duy nhất một nơi, cấm nhân bản).
