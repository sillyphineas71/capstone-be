# Tasks: Occupancy webhook receiver cho IVSS bridge — IVSS-OCC-001 / A-OCC

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-30 | Tạo tasks theo plan v1.0: refactor `OccupancyPersistenceService`(+test) → **GATE OCC-001 xanh** → DTO → ivss service(+test) → controller(+test) → wiring IvssModule → cổng chất lượng. Truy vết AC-01…AC-17. Không migration/seed. | Toàn bộ file |

> Bám [spec.md](./spec.md) + [plan.md](./plan.md) (đã duyệt). **TASK-ONLY — chưa code.**
> **Build order (khóa cứng — plan §6)**: refactor persist + delegate + export → **GATE chạy lại OCC-001 xanh** (DỪNG nếu đỏ) → DTO → ivss service → controller → wiring → cổng chất lượng.

---

## Danh sách Task

### T-01 — Tách `OccupancyPersistenceService` + delegate `OccupancyIngestService` + export — *plan §2/§3*
- **Mục tiêu**: đưa khối **transaction + WS** (occupancy-ingest 160-269) thành provider **DUY NHẤT** dùng chung; room-camera delegate sang nó (hành vi KHÔNG đổi).
- **File tạo mới**: `src/modules/presence/services/occupancy-persistence.service.ts`.
- **File sửa**:
  - `src/modules/presence/services/occupancy-ingest.service.ts` — bỏ khối transaction+WS inline, gọi `this.occupancyPersistence.persist(...)`; **giữ nguyên** auth(deviceCode+callback-token) + raw + giao diện `ingest()` (`IngestInput`→`{accepted:true}`).
  - `src/modules/presence/presence.module.ts` — `providers: [OccupancyIngestService, OccupancyPersistenceService]`, `exports: [TypeOrmModule, OccupancyPersistenceService]`.
- **Việc cần làm** (mô tả, KHÔNG code):
  - `persist({ roomId, meetingId, occupancyCount, confidence, eventTime }) → { statusChanged }`: `createQueryRunner` → `room_events` (meeting_id = `input.meetingId`) → **booking lookup nội bộ** → (nếu booking) `presence_snapshots` (meeting_id = booking.meeting_id) + `room_booking_usages` → `rooms.current_status` (count>0→occupied, `RETURNING id`) → commit/rollback/release → WS `room.occupancy.updated` + (statusChanged) `room.status.updated`.
  - **LOCKED-A**: guard `occupancyCount` ∈ `[0, MAX_OCCUPANCY]` đặt **TRONG `persist`** (đầu hàm) → sai → ném `BadRequestException` (mã `INVALID_OCCUPANCY_PAYLOAD`, mirror cũ). Hằng `MAX_OCCUPANCY`/`TIME_SKEW_MS` chuyển/giữ ở service phù hợp.
  - Inject `DataSource` + `WebsocketService`.
- **DoD**: persist tạo **đúng cùng query/WS** như khối cũ; `ingest()` chỉ thay khối inline bằng 1 call persist; biên dịch sạch.
- **Phụ thuộc**: —.

### T-01b — Unit test `OccupancyPersistenceService` — *plan §5*
- **File tạo mới**: `src/modules/presence/services/occupancy-persistence.service.spec.ts` (mock `DataSource`/`queryRunner`/`WebsocketService`).
- **Phủ**: **AC-06** (count>0→occupied + WS status khi đổi), **AC-07** (count==0→không đổi status), **AC-08** (booking→presence+usage), **AC-09** (không booking→chỉ room_events), **AC-15** (WS lỗi→không vỡ/không rollback), + count ngoài [0,MAX]→ném BadRequest.
- **DoD**: test xanh; coverage persist ≥ ngưỡng dự án.
- **Phụ thuộc**: T-01.

### T-02 — GATE: chạy lại OCC-001 (room-camera) phải XANH — *plan §2.5/§6, AC-13*
- **Mục tiêu**: chứng minh refactor KHÔNG hồi quy room-camera **TRƯỚC** khi xây A-OCC.
- **File**: KHÔNG sửa test — chạy lại `src/modules/presence/services/occupancy-ingest.service.spec.ts` (+ `room-camera.controller.spec.ts` nếu liên quan).
- **Việc cần làm**: `npx jest src/modules/presence` → **toàn bộ OCC-001 xanh**.
- **Nhánh điều kiện (LOCKED-A verify)**: nếu OCC-001 **đỏ vì vị trí ném 400 đổi** (test kỳ vọng ném từ `ingest()` trước persist) → **áp fallback (b)**: chuyển guard count ra trước call persist trong `ingest()` (room-camera tự validate), persist vẫn guard phòng thủ; chạy lại tới xanh. Ghi rõ đã (a) hay (b).
- **DoD (HARD GATE)**: **OCC-001 xanh**. **Nếu chưa xanh → DỪNG, KHÔNG đi T-03+** (sửa T-01/persist hoặc áp (b) tới khi xanh).
- **Phụ thuộc**: T-01, T-01b.

### T-03 — `OccupancyEventDto` (module ivss) — *plan §1, spec §3.2*
- **File tạo mới**: `src/modules/ivss/dto/occupancy-event.dto.ts`.
- **Việc cần làm**: validate body — `type` (string, bắt buộc), `channelId` (int, bắt buộc, `@Type`), `number` (int, bắt buộc), `utc` (string, bắt buộc); `enteredNumber`/`exitedNumber` (int, optional), `eventAction` (string, optional). Whitelist (mirror `FaceEventDto`).
- **DoD**: DTO biên dịch; field bắt buộc/optional đúng spec §3.2.
- **Phụ thuộc**: —.

### T-04 — `IvssOccupancyIngestService` — *plan §1/§2.4, spec §4*
- **File tạo mới**: `src/modules/ivss/services/ivss-occupancy-ingest.service.ts`.
- **Inject**: `DataSource` (resolve device/room + ghi raw) + `OccupancyPersistenceService` (từ PresenceModule export).
- **Việc cần làm** (thứ tự plan §1, mirror `IvssPresenceIngestionService.resolveRoom`):
  1. `occupancyCount = dto.number`; `eventTime = parseUtc(dto.utc)` (lệch/sai → now, mirror `TIME_SKEW_MS`).
  2. Resolve bridge: `SELECT id FROM iot_devices WHERE device_code='IVSS-BRIDGE'` → **không có → log skip + return** (KHÔNG ghi raw — AC-12).
  3. **Ghi raw** `iot_device_events` (device_id=bridge.id, **room_id=NULL** §2.4, event_type occupancy, `payload_json` = body đã `maskSensitiveMetadata` gồm entered/exited/eventAction/channelId, event_time=eventTime) — AC-11.
  4. `resolveRoom(channelId)` qua `system_configs['ivss.channel_room_map']` (validate UUID) → **không map → log skip + return** (đã có raw — AC-05).
  5. Gọi `persist({ roomId, meetingId:null, occupancyCount, confidence:null, eventTime })` (AC-04/06/07/08/09); để exception (vd count ngoài [0,MAX]) trồi lên controller (AC-17).
- **DoD**: service đúng thứ tự; raw luôn room_id=NULL; confidence luôn null; KHÔNG nhân bản logic persist (chỉ gọi).
- **Phụ thuộc**: T-01 (persist), T-02 (gate xanh), T-03 (DTO).

### T-04b — Unit test `IvssOccupancyIngestService` — *plan §5*
- **File tạo mới**: `src/modules/ivss/services/ivss-occupancy-ingest.service.spec.ts` (mock `DataSource` + `OccupancyPersistenceService`).
- **Phủ**: **AC-04** (channel map→persist gọi đúng `(roomId, null, count, null, eventTime)`), **AC-05** (không map→raw ghi, persist KHÔNG gọi), **AC-10** (parseUtc valid/lệch→now), **AC-11** (raw ghi sớm trước resolveRoom, room_id NULL, payload có entered/exited), **AC-12** (device chưa seed→không ghi raw, không persist), **AC-17** (persist mock ném `BadRequest`→service để trồi; raw vẫn ghi, room-level không ghi).
- **DoD**: test xanh; coverage service ≥ ngưỡng.
- **Phụ thuộc**: T-04.

### T-05 — `IvssOccupancyController` (route + guard + ack-always) — *plan §1, spec §3*
- **File tạo mới**: `src/modules/ivss/controllers/ivss-occupancy.controller.ts`.
- **Việc cần làm** (mirror `IvssWebhookController`): `@Post('internal/ivss/occupancy-events')` + `@HttpCode(200)` + `@UseGuards(IvssInternalTokenGuard)` + `@UsePipes(ValidationPipe whitelist/transform)`; **try/catch** quanh `ivssOccupancyIngestService.ingest(dto)` → lỗi (gồm BadRequest từ persist) **nuốt + log → vẫn ack 200**; trả `{ success:true, message:'IVSS occupancy event accepted', data:{accepted:true} }`.
- **DoD**: route đúng path/guard/200; ack-always; KHÔNG đụng `IvssWebhookController`/`vehicle-webhook`.
- **Phụ thuộc**: T-04.

### T-05b — Unit test controller — *plan §5*
- **File tạo mới**: `src/modules/ivss/controllers/ivss-occupancy.controller.spec.ts`.
- **Phủ**: **AC-01** (token đúng→200 accepted, gọi service), **AC-02/03** (guard: sai/thiếu token→401 — overrideGuard giả 401 hoặc unit guard), **AC-16** (service ném→controller nuốt→200), envelope đúng.
- **DoD**: test xanh.
- **Phụ thuộc**: T-05.

### T-06 — Wiring `IvssModule` — *plan §3*
- **File sửa**: `src/modules/ivss/ivss.module.ts`.
- **Việc cần làm**: `imports: [..., PresenceModule]`; thêm `IvssOccupancyController` vào `controllers`; `IvssOccupancyIngestService` vào `providers`. Xác nhận `IvssInternalTokenGuard` (ConfigService global) + `OccupancyPersistenceService` (PresenceModule export) resolve được. KHÔNG thêm import thừa, KHÔNG circular.
- **DoD**: AppModule compile; DI resolve controller/service (0 circular/UnknownDependencies).
- **Phụ thuộc**: T-01, T-04, T-05.

### T-07 — Cổng chất lượng cuối (KHÔNG commit) — *plan §6*
- **Việc cần làm**:
  - `npx tsc -p tsconfig.build.json --noEmit` = 0.
  - eslint file mới/sửa = 0 (vùng A-OCC; baseline shared-file ghi rõ nếu có).
  - `npx jest src/modules/ivss src/modules/presence` xanh — **OCC-001 (room-camera) GIỮ XANH** (AC-13) + spec A-OCC mới xanh.
  - Coverage (glob relative rootDir=src): `occupancy-persistence.service.ts` + `ivss-occupancy-ingest.service.ts` ≥ ngưỡng.
  - DI-proof: compile AppModule (0 circular/UnknownDependencies liên quan A-OCC/presence).
- **DoD**: tất cả pass; **STOP, KHÔNG commit**, chờ duyệt.
- **Phụ thuộc**: T-01…T-06.

---

## Bảng truy vết AC → Task
| AC | Task phủ |
|---|---|
| AC-01 auth pass | T-05b (+ T-04b service e2e) |
| AC-02 / AC-03 auth sai/thiếu | T-05b (guard) |
| AC-04 channel map→ghi đủ | T-04b (ivss) + T-01b (persist) |
| AC-05 không map→raw, skip persist | T-04b |
| AC-06 count>0→occupied+WS | T-01b |
| AC-07 count==0→không đổi status | T-01b |
| AC-08 booking→presence+usage | T-01b |
| AC-09 không booking→chỉ room_events | T-01b |
| AC-10 eventTime | T-04b |
| AC-11 raw ghi sớm (room_id NULL) | T-04b |
| AC-12 device chưa seed→không raw | T-04b |
| AC-13 refactor không hồi quy | **T-02 (GATE)** + T-07 |
| AC-14 SEC (mask, không log token) | T-04b (mask) + T-05b (guard) |
| AC-15 WS best-effort | T-01b |
| AC-16 ack-always nghiệp vụ | T-05b |
| AC-17 count bất thường→raw+ack, no persist | T-04b (+ T-01b: persist ném BadRequest) |

---

## Out-of-task (KHÔNG làm trong A-OCC)
- **KHÔNG migration / cột / bảng mới** (tái dùng `iot_device_events`/`room_events`/`presence_snapshots`/`room_booking_usages`/`rooms` + `system_configs` hiện có).
- **KHÔNG seed** device `IVSS-BRIDGE` / `ivss.channel_room_map` (dữ liệu vận hành — setup qua scripts/livetest, ngoài scope).
- **KHÔNG nhân bản** `persist` sang module ivss (chỉ IMPORT/gọi — §Locked-5).
- **KHÔNG đụng** auth room-camera (deviceCode+callback-token), `IvssWebhookController`/`vehicle-webhook`, recording/RTSP, hướng đếm vào/ra C13/14.

## Open Questions — Cần người chốt
**Không còn câu mở.** Mọi quyết định đã khóa ở spec §7 + plan §0/§8 (LOCKED-A). Nhánh điều kiện duy nhất = fallback (b) ở **T-02** (chỉ kích hoạt nếu OCC-001 đỏ vì vị trí ném 400) — đã ghi rõ là nhánh-điều-kiện trong DoD, không phải câu hỏi mở.
