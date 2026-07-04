---
name: "Implementation Plan: Occupancy webhook receiver cho IVSS bridge"
description: "Kế hoạch triển khai IVSS-OCC-001 / A-OCC: route occupancy + refactor tách OccupancyPersistenceService dùng chung. RECON constraint + wiring code thật."
version: "1.0"
date: "2026-06-30"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-30 | Khởi tạo plan IVSS-OCC-001 sau RECON: chốt 2 việc §9 SPEC — (1) `iot_device_events.room_id` nullable → giữ thứ tự raw-trước; (2) tách `OccupancyPersistenceService` (presence module, export) cho cả room-camera + A-OCC. Kiến trúc + refactor + wiring + AC-map + test + thứ tự + rủi ro. | Toàn bộ file |
| 2026-06-30 | Revise 2 điểm: (1) §2.4 CHỐT raw A-OCC luôn `room_id=NULL` (bỏ UPDATE tùy chọn); (2) §8 khóa LOCKED-A = validate count TRONG `persist` (fallback (b) nếu OCC-001 đỏ). Thêm **AC-17** (A-OCC count bất thường → raw+ack, no persist) vào §4/§5; flag back-port AC-17 vào spec §6. | §2.3, §2.4, §4, §5, §7, §8 |

> **PLAN-ONLY.** Bám [spec.md](./spec.md) (đã duyệt). Chưa tasks/code. KHÔNG migration, KHÔNG cột/bảng mới.

---

## 0. BƯỚC RECON — code thật (giải 2 việc §9 SPEC)

### 0.1. NULL-constraint (việc §9-1) — ĐÃ CHỐT
- **`iot_device_events.room_id` = NULLABLE** ([iot-device-event.entity.ts:54-55](../../../../src/modules/iot/entities/iot-device-event.entity.ts#L54)): `@Column({ name: 'room_id', type: 'uuid', nullable: true })` + FK `onDelete: 'SET NULL'`.
- **`room_events.room_id` = NOT NULL** ([room-event.entity.ts:18-19](../../../../src/modules/rooms/entities/room-event.entity.ts#L18)): `@Column({ name: 'room_id', type: 'uuid' })` (không `nullable`).

**→ CHỐT: GIỮ NGUYÊN thứ tự SPEC §4** (ghi raw TRƯỚC, `room_id=NULL` khi channel chưa map).
- Lý do: `iot_device_events.room_id` nullable → ghi raw vết với NULL hoàn toàn hợp lệ, **không cần placeholder bẩn, không mất vết**. Phương án (a)/(b) ở SPEC §9 **không phát sinh** (chỉ áp dụng nếu cột NOT NULL — không phải trường hợp này).
- `room_events.room_id` NOT NULL **không gây vấn đề**: `room_events` chỉ được ghi **bên trong `persistOccupancy`** — tức **SAU** khi đã resolve room (roomId luôn có giá trị tại đó). Channel-không-map → DỪNG trước persist → không chạm `room_events`.
- **AC-05/AC-11/AC-12 GIỮ NGUYÊN** như SPEC (không đổi).

### 0.2. Nơi đặt `persistOccupancy` (việc §9-2) — ĐÃ CHỐT
RECON:
- [OccupancyIngestService.ingest()](../../../../src/modules/presence/services/occupancy-ingest.service.ts#L48): phần **transaction (160-243)** + **WS (245-269)** là khối tái dùng; phần auth (deviceCode + callback-token, 48-119) + raw (121-141) là room-camera-specific.
- [PresenceModule](../../../../src/modules/presence/presence.module.ts): `providers: [OccupancyIngestService]`, **chưa export** service; dùng `dataSource.manager` raw (không forFeature nhiều entity); import `WebsocketModule`.
- [IvssModule](../../../../src/modules/ivss/ivss.module.ts): `imports: [AuthModule, AccountsModule, WebsocketModule]` — **chưa import PresenceModule**.
- **Circular check**: không module nào import `PresenceModule`; chain presence (Rooms/Meetings/Accounts/Websocket) **không** import ivss → **`IvssModule → PresenceModule` ACYCLIC** ✅.

**→ CHỐT: PHƯƠNG ÁN (b) — tách `OccupancyPersistenceService` mới** (provider trong `presence` module), **cả room-camera lẫn A-OCC cùng inject**.
- Lý do chọn (b) thay vì (a) export `OccupancyIngestService`:
  - (b) là **single-responsibility**: `OccupancyPersistenceService` chỉ chứa logic ghi (transaction+WS), **không kèm auth room-camera**. A-OCC inject service "sạch", không lệ thuộc method `ingest()` mang callback-token.
  - Tránh **leaky dependency**: nếu (a), ivss phải inject cả `OccupancyIngestService` (vốn chứa auth callback-token của room-camera) — không hợp lý về boundary.
  - `persistOccupancy` **tồn tại DUY NHẤT** ở service mới (đúng §Locked-5: một nơi, cấm nhân bản).

---

## 1. Kiến trúc & luồng cuối

```
Bridge ──POST /internal/ivss/occupancy-events (X-Internal-Token)──▶
  IvssOccupancyController (module ivss)
    @UseGuards(IvssInternalTokenGuard)  ──sai/thiếu token──▶ 401
    try { IvssOccupancyIngestService.ingest(dto) } catch ──▶ log + ack 200 (R2)
    ──▶ 200 { success, message, data:{accepted:true} }

  IvssOccupancyIngestService.ingest(dto):       [module ivss — auth/resolve/raw]
    1. occupancyCount = dto.number ; eventTime = parseUtc(dto.utc)→now
    2. bridge = SELECT iot_devices WHERE device_code='IVSS-BRIDGE'
         └─ không có → log skip + return (ack 200)            [AC-12]
    3. INSERT iot_device_events (device_id=bridge.id, room_id=NULL tạm, payload mask) [AC-11]
    4. roomId = resolveRoom(dto.channelId) via system_configs['ivss.channel_room_map']
         └─ không map → log skip + return (đã có raw, room_id=NULL — §2.4)  [AC-05]
    5. OccupancyPersistenceService.persist({ roomId, meetingId:null, occupancyCount,
         confidence:null, eventTime })                          [AC-04/06/07/08/09]

  OccupancyPersistenceService.persist(input):   [module presence — DUY NHẤT, dùng chung]
    transaction: room_events + (booking? presence_snapshots + room_booking_usages)
      + rooms.current_status (count>0→occupied) ; WS room.occupancy.updated
      + room.status.updated (khi đổi) → { statusChanged }

  RoomCameraController ─▶ OccupancyIngestService.ingest()        [GIỮ NGUYÊN hành vi]
    auth(deviceCode+callback-token) + raw → OccupancyPersistenceService.persist(...) (giống hệt cũ)
```

**Thành phần & trách nhiệm:**
| Thành phần | Module | Trách nhiệm |
|---|---|---|
| `IvssOccupancyController` (TẠO) | ivss | Route + `IvssInternalTokenGuard` + ack-always (try/catch, mirror `IvssWebhookController`) |
| `OccupancyEventDto` (TẠO) | ivss | Validate body (type/channelId/number/utc bắt buộc; entered/exited/eventAction optional) |
| `IvssOccupancyIngestService` (TẠO) | ivss | resolve bridge device + ghi raw + `resolveRoom` (channel-map) + gọi `persist` |
| `OccupancyPersistenceService` (TẠO) | presence | **persist DUY NHẤT**: transaction(room_events+presence+usage+status) + WS |
| `OccupancyIngestService` (SỬA) | presence | giữ auth(callback-token)+raw room-camera; **delegate** persist sang service mới |

## 2. Refactor `persistOccupancy` → `OccupancyPersistenceService`

### 2.1. Chữ ký
```
persist(input: {
  roomId: string;
  meetingId: string | null;     // meeting_id cấp-event cho room_events (room-camera: body; A-OCC: null)
  occupancyCount: number;       // đã validate 0..MAX ở caller hoặc trong persist (chốt ở §2.3)
  confidence: number | null;    // A-OCC luôn null (§Locked-9); room-camera: từ body
  eventTime: Date;
}): Promise<{ statusChanged: boolean }>
```

### 2.2. Phần CHUYỂN VÀO `persist` (từ `ingest()` hiện tại)
- **Toàn bộ transaction** [160-243](../../../../src/modules/presence/services/occupancy-ingest.service.ts#L160): `createQueryRunner` → `room_events` insert → **booking lookup nội bộ** (182-189) → (nếu booking) `presence_snapshots` + `room_booking_usages` → `rooms.current_status` (count>0) → commit/rollback/release.
- **WS** [245-266](../../../../src/modules/presence/services/occupancy-ingest.service.ts#L245): `room.occupancy.updated` + `room.status.updated` (khi `statusChanged`).
- **Hằng số** `MAX_OCCUPANCY`, `TIME_SKEW_MS` (nếu persist cần) — giữ ở service phù hợp.

> Lưu ý semantics `meetingId`: `room_events.meeting_id` = `input.meetingId` (cấp-event); `presence_snapshots.meeting_id` = `booking.meeting_id` (lookup **nội bộ** persist). → A-OCC truyền `meetingId:null` cho room_events; presence vẫn có meeting qua booking lookup. (Đúng hành vi `ingest()` hiện tại — body meetingId vs booking.meeting_id.)

### 2.3. Phần Ở LẠI `OccupancyIngestService` (room-camera)
- Auth [48-119]: deviceCode + callback-token hash + status + room match (KHÔNG đổi).
- Raw event [121-141]: INSERT `iot_device_events` (device.id của room-camera) (KHÔNG đổi).
- Validate `occupancyCount` [143-156]: **CHỐT (a) — guard count 0..MAX đặt TRONG `persist`** (single source, mọi caller được bảo vệ). `persist` ném `BadRequest` nếu count sai → room-camera giữ nguyên hành vi (ném 400 qua persist), A-OCC bọc try/catch → ack 200. **Fallback (b)** (mỗi caller tự validate) CHỈ áp dụng nếu chạy OCC-001 đỏ vì vị trí ném đổi — verify ở pha implement, KHÔNG tự quyết cứng. (§8)
- Sau validate → gọi `this.occupancyPersistence.persist({ roomId, meetingId, occupancyCount, confidence, eventTime })`.

### 2.4. Raw event room_id của A-OCC — CHỐT: luôn `NULL`, KHÔNG update
- Raw `iot_device_events` của A-OCC (bước §1-3) **luôn ghi `room_id=NULL`** (cột nullable — §0.1). **KHÔNG** `UPDATE` room_id sau khi resolve room.
- Lý do: room đã sống ở `room_events` (ghi trong `persist` sau khi có room); khi cần truy vết, raw event đã mang `channelId` trong `payload_json` → tra `channel_room_map` ra room, **không cần denormalize** room_id lên raw. Bỏ UPDATE thứ hai = một câu ghi ít hơn, một nhánh quyết định ít hơn ở TASKS, không phát sinh điểm-lỗi.

### 2.5. Bảo toàn hành vi room-camera (test OCC-001 xanh)
- `OccupancyIngestService.ingest()` **giao diện ngoài KHÔNG đổi** (vẫn nhận `IngestInput`, trả `{accepted:true}`); chỉ thay khối inline transaction+WS bằng 1 call `persist(...)` tạo **đúng cùng các query** (room_events/presence/usage/status) + cùng WS event.
- [occupancy-ingest.service.spec.ts](../../../../src/modules/presence/services/occupancy-ingest.service.spec.ts) (OCC-001) test end-to-end qua `ingest()` với mock `dataSource`/`websocketService` → **chạy lại phải xanh** (tiêu chí pass cứng). Nếu mock kỳ vọng `createQueryRunner` gọi từ `dataSource` (giờ gọi trong persist service nhưng cùng `DataSource` inject) → vẫn khớp.

## 3. Module wiring (tránh circular)
- **PresenceModule**: `providers: [OccupancyIngestService, OccupancyPersistenceService]`, `exports: [TypeOrmModule, OccupancyPersistenceService]`. (WebsocketModule đã import — persist service inject `WebsocketService` + `DataSource`.)
- **IvssModule**: `imports: [..., PresenceModule]`; `controllers: [..., IvssOccupancyController]`; `providers: [..., IvssOccupancyIngestService]`. `IvssOccupancyIngestService` inject `DataSource` (resolveRoom/device/raw) + `OccupancyPersistenceService` (từ PresenceModule export). Guard `IvssInternalTokenGuard` dùng `ConfigService` (global) — đã có.
- **Circular**: `IvssModule → PresenceModule` acyclic (đã verify §0.2). PresenceModule KHÔNG import ivss.

## 4. Mapping AC → thành phần
| AC | Phủ ở |
|---|---|
| AC-01 auth pass | controller (guard) + ivss service + persist (e2e service test) |
| AC-02/03 auth sai/thiếu | `IvssInternalTokenGuard` (controller test override/guard unit) |
| AC-04 channel map→ghi đủ | ivss service (resolveRoom) + persist |
| AC-05 không map→raw, skip persist | ivss service (DỪNG sau resolveRoom null) |
| AC-06 count>0→occupied+WS | persist (room-camera test cũ + ivss service test) |
| AC-07 count==0→không đổi status | persist |
| AC-08 booking→presence+usage | persist (booking lookup nội bộ) |
| AC-09 không booking→chỉ room_events | persist |
| AC-10 eventTime | ivss service (parseUtc) |
| AC-11 raw ghi sớm | ivss service (raw trước resolveRoom) |
| AC-12 device chưa seed→không raw | ivss service (skip trước raw) |
| AC-13 refactor không hồi quy | **occupancy-ingest.service.spec (OCC-001) chạy lại xanh** |
| AC-14 SEC | ivss service (mask) + guard (không log token) |
| AC-15 WS best-effort | persist (try/catch WS) |
| AC-16 ack-always nghiệp vụ | controller (try/catch quanh ingest) |
| **AC-17** A-OCC count bất thường | ivss service (raw đã ghi) + persist (ném BadRequest) + controller (nuốt→ack 200) |

> **AC-17 (MỚI — hệ quả LOCKED-A)**: A-OCC với `number` ngoài `[0, MAX_OCCUPANCY]` → **CÓ ghi raw `iot_device_events`** (vết, room_id=NULL), `persist` ném `BadRequest`, handler **nuốt → 200** `{accepted:true}` + log; **KHÔNG** ghi `room_events`/`presence`/`usage`/status. *(AC-17 cần back-port vào spec.md §6 ở lần chạm spec kế — flag cho người duyệt; pha PLAN chỉ sửa plan.)*

## 5. Chiến lược test
- **TẠO** `ivss-occupancy-ingest.service.spec.ts` (unit, mock `DataSource`/`OccupancyPersistenceService`): AC-04/05/10/11/12/**17** (+ resolveRoom map/no-map, device có/không, raw ghi sớm, parseUtc, persist được gọi đúng tham số `confidence:null`; **AC-17**: persist mock ném `BadRequest` cho count ngoài [0,MAX] → service nuốt, raw vẫn ghi, không persist room-level).
- **TẠO** `ivss-occupancy.controller.spec.ts` (mock service + overrideGuard / guard unit): AC-01/02/03/16 (ack-always, envelope, guard metadata).
- **TẠO** `occupancy-persistence.service.spec.ts` (unit, mock `DataSource`/`WebsocketService`): AC-06/07/08/09/15 (transaction + WS, các nhánh booking/status).
- **CHẠY LẠI** `occupancy-ingest.service.spec.ts` (OCC-001) — **KHÔNG sửa test**, phải xanh sau refactor → chứng minh AC-13 + không hồi quy room-camera.
- (Tùy) bổ sung ít assert vào persist spec để chắc behavior chuyển từ ingest sang persist không lệch.

## 6. Thứ tự thực thi (đề xuất)
1. **Refactor TRƯỚC**: tách `OccupancyPersistenceService` + sửa `OccupancyIngestService` delegate + wiring PresenceModule export → **chạy lại OCC-001 xanh** (cô lập thay đổi rủi ro nhất, chứng minh không hồi quy trước khi xây mới).
2. `OccupancyEventDto` (ivss).
3. `IvssOccupancyIngestService` (resolve bridge/room + raw + gọi persist) + test.
4. `IvssOccupancyController` (route + guard + ack) + test.
5. Wiring `IvssModule` (import PresenceModule, đăng ký controller/service).
6. Cổng chất lượng: tsc/eslint + jest module ivss + presence (OCC-001 xanh) + DI.
- **Lý do refactor trước**: thay đổi shared-file (occupancy-ingest) là rủi ro cao nhất; làm + verify OCC-001 xanh **trước**, rồi A-OCC chỉ consume service ổn định.

## 7. Rủi ro & giảm thiểu
- **Refactor đụng OCC-001** (cao): giữ giao diện `ingest()` không đổi; persist tạo **đúng cùng query/WS**; chạy lại spec OCC-001 không sửa → tiêu chí pass. Nếu mock-shape lệch (vd test spy `createQueryRunner`), điều chỉnh **chỉ ở persist service** để khớp `DataSource` mock, KHÔNG sửa kỳ vọng test.
- **Circular dep** (đã loại): ivss→presence acyclic (verify §0.2); KHÔNG để presence import ivss.
- **Validate count đặt ở đâu** → đã CHỐT (a) (§8; fallback (b) nếu OCC-001 đỏ).
- **Bridge device chưa seed / channel-map trống** khi livetest: đã xử bằng skip+ack (AC-05/12) + raw vết (room_id=NULL).

## 8. Locked Decisions (pha PLAN) & Open Questions
**LOCKED-A (validate `occupancyCount`) = phương án (a)**: guard count `0..MAX_OCCUPANCY` đặt **TRONG `persist`** (single source — mọi caller được bảo vệ). `persist` ném `BadRequest` nếu sai → room-camera giữ ném 400 (qua persist), A-OCC bọc try/catch → ack 200 (xem **AC-17**).
- **Điều kiện fallback (b)** (mỗi caller tự validate): **CHỈ** khi chạy lại OCC-001 đỏ vì vị trí ném 400 đổi → khi đó chuyển (b), KHÔNG tự quyết cứng — verify ở pha implement.

**Open Questions**: **Không còn câu mở.** (Các điểm §9 SPEC đã giải ở §0; OQ-A đã khóa (a) ở trên.)
