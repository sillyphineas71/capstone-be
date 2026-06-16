---
name: feat-occupancy-ingest-plan
description: Kế hoạch OCC-001 — ingest occupancy (module presence): auth device-callback → raw → room_events → presence/usage → status → WS → 202.
category: presence
---

# Implementation Plan: Occupancy Ingest (OCC-001)

- **Feature ID**: OCC-001 · **Module**: presence (+ iot raw entity) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo plan.md OCC-001 (controller/service presence, auth-trước-raw, transaction room_events+presence/usage+status, WS best-effort, seed). D-1..5 chốt. | Toàn bộ file |

---

## 1. XÁC NHẬN RECON (file:line)

### 1.1 PATH (CLAUDE §22.7b — trích nguyên)
CLAUDE.md §22.7b "Room Camera (từ Python Camera Service)":
```
POST   /api/v1/room-camera/presence
POST   /api/v1/room-camera/occupancy-snapshots
POST   /api/v1/room-camera/events
```
⇒ **Chọn `POST /api/v1/room-camera/occupancy-snapshots`** — semantic khớp "occupancy event (count)" nhất; §22.7b ưu tiên hơn contract `/internal/camera-service/occupancy-events` (CLAUDE > API contract path khi lệch, theo thứ tự tài liệu). Controller `@Controller('room-camera')` + `@Post('occupancy-snapshots')`.

### 1.2 Resolve meeting/booking active của room tại eventTime
- Entity: **`room_bookings`** [room-booking.entity.ts:38-59](../../../../src/modules/rooms/entities/room-booking.entity.ts) — `meeting_id`(NN), `room_id`(NN), `reserved_start_time`, `reserved_end_time`, `status` (enum `RoomBookingStatus`: pending/approved/**active**/completed/cancelled/released).
- Query active booking:
  ```sql
  SELECT id AS booking_id, meeting_id FROM room_bookings
  WHERE room_id = $1 AND reserved_start_time <= $2 AND reserved_end_time >= $2
    AND status IN ('approved','active')
  ORDER BY reserved_start_time ASC LIMIT 1;   -- overlap → đầu theo thời gian
  ```
- `room_booking_usages` [room-booking-usage.entity.ts](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts) tìm theo `booking_id` (+ meeting_id) để UPDATE first/last_presence_at, usage_status.

### 1.3 Token provisioning
- **KHÔNG có** cơ chế cấp callback-token per-device tái dùng cho camera service. Face dùng `configureFaceServer` → set `metadata_json.face_server_config.callback_token_hash` (sha256) [iot-devices.service.ts:705-720](../../../../src/modules/iot/services/iot-devices.service.ts). Device resolve = `iotDeviceRepo.findOne({where:{deviceCode}})` [:1023]; sha256 compare [:1074].
- ⇒ Camera: token ở **`metadata_json.camera_service_config.callback_token_hash`** (mirror). Chưa có endpoint cấu hình → **seed device test** bằng SQL/metadata update: `callback_token_hash = sha256(<plain token>)`. Ghi hướng dẫn seed trong tasks.

---

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Mới | `presence/controllers/room-camera.controller.ts` (POST occupancy-snapshots) |
| Mới | `presence/services/occupancy-ingest.service.ts` |
| Mới | `presence/dto/occupancy-event.dto.ts` |
| Sửa | `presence/presence.module.ts` (forFeature + controller/service + WebsocketModule) |
| (Seed) | tài liệu seed camera_service_config.callback_token_hash cho device test (tasks) |
| Mới (test) | `presence/services/occupancy-ingest.service.spec.ts` |

## 3. Service luồng (đúng thứ tự — D-5 auth-trước-raw)
```text
ingest(input: {headers, body, query, params, clientIp}):
1. AUTH:
   deviceCode = extract(header X-Device-Code / body.deviceCode / query / param) → thiếu → 400.
   device = iotDeviceRepo.findOne({deviceCode}) → null → 404 DEVICE_NOT_FOUND.
   token = extract(header X-Callback-Token / body.callbackToken / query / param) → thiếu → 401.
   hash = sha256(token); device.metadata_json.camera_service_config.callback_token_hash khác hash → 401 INVALID_CALLBACK_TOKEN.
   device.status != online → 403 (hoặc 409) DEVICE_INACTIVE; device.room_id != body.roomId → 403 DEVICE_ROOM_MISMATCH.
2. RAW (sau auth): INSERT iot_device_events {device_id, room_id, meeting_id?, event_type:'occupancy_detected', payload_json=body, event_time}.
3. VALIDATE: occupancyCount Number.isInteger >=0 & <= MAX (vd 1000) → sai → 400 INVALID_OCCUPANCY_PAYLOAD; eventTime parse (NaN/lệch>1h → now).
4. TRANSACTION (QueryRunner):
   a. INSERT room_events {room_id, meeting_id?, event_type:'occupancy_detected', event_time, occupancy_count, confidence_score, source_type:'camera'}.
   b. booking = resolve active (query §1.2). CÓ booking:
      - INSERT presence_snapshots {meeting_id, room_id, occupancy_count, presence_status:'present', snapshot_time, source_type:'camera', confidence_score}.
      - usage = room_booking_usages by booking_id. CÓ → UPDATE first_presence_at(if NULL)=eventTime, last_presence_at=eventTime,
        usage_status='in_use'(if not_started && count>0), occupancy_source='camera'.
   c. count>0 → UPDATE rooms SET current_status='occupied' WHERE id=roomId AND current_status<>'occupied'. count==0 → KHÔNG đổi.
   commit; lỗi → rollback → 500 (raw đã lưu ở b2).
5. WS best-effort (try/catch riêng): websocketService.emitToRoom(`room:${roomId}`,'room.occupancy.updated',{roomId,occupancyCount,timestamp}) (+broadcast). Lỗi WS log, KHÔNG ảnh hưởng.
6. return { accepted: true }  (controller @HttpCode 202).
```

## 4. Controller
`@Controller('room-camera')` + `@Post('occupancy-snapshots')` `@HttpCode(202)`. KHÔNG JwtAuthGuard user. Nhận `@Req() req` (raw headers/body/query/params/ip) → service.ingest. Trả `{ accepted:true }`.

## 5. Module
presence.module: `TypeOrmModule.forFeature([PresenceSnapshotEntity, IoTDeviceEntity, RoomEventEntity, RoomBookingUsageEntity, RoomEntity])` (+ RoomBookingEntity để query) + import `WebsocketModule` (export WebsocketService) + controller + service. (Token validate tự làm trong service — KHÔNG import IotModule, tránh coupling nặng; chỉ cần IoTDeviceEntity repo.)

## 6. DTO
`OccupancyEventDto { deviceCode?, roomId @IsUUID, meetingId? @IsUUID, eventType?, occupancyCount @IsInt @Min(0), confidence? @IsNumber, eventTime? @IsISO8601, metadata? }`. (Raw vẫn nhận tại boundary; DTO validate field chính khi normalize.)

## 7. Tests (mock repo/qr/ws, ≥80%)
- có-meeting: auth ok + booking active → raw+room_events+presence+usage(first/last) + rooms occupied + WS gọi.
- không-meeting: booking none → raw+room_events + occupied, KHÔNG presence/usage.
- count=0: room_events ghi, KHÔNG occupied.
- token sai → 401, KHÔNG raw (iot_device_events insert KHÔNG gọi).
- count âm/không-số → 400 sau raw.
- device.room_id mismatch → 403.
- raw-sau-auth: business (transaction) lỗi → raw vẫn insert (gọi trước).
- SEC: token KHÔNG xuất hiện trong log/insert payload đã che? (payload_json lưu raw body — token KHÔNG nằm trong body nếu gửi qua header; nếu body có token, lưu ý). WS lỗi → vẫn 202.

## 8. [NEEDS CLARIFICATION]
- Không còn (D-1..5 chốt). Lưu ý seed token thủ công (chưa có endpoint cấp token camera).

## 9. DoD
```
[ ] controller room-camera/occupancy-snapshots @HttpCode202, no JWT user
[ ] service: auth(404/401/403)→raw→validate(400)→transaction(room_events+presence/usage+status)→WS best-effort→202
[ ] auth-trước-raw; count>0→occupied; count==0 giữ; resolve booking active đúng query
[ ] module forFeature + WebsocketModule; DTO validate
[ ] tests ≥80%; build/lint/jest/boot(route mapped,0 DI) xanh; KHÔNG migration
```

> Trạng thái: CHỜ REVIEW sau implement. Chưa commit.
