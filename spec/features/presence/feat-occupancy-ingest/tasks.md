# Tasks: Occupancy Ingest (OCC-001)

- **Feature ID**: OCC-001 · **Module**: presence
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> Ingest UC-75 → room-camera/occupancy-snapshots. Auth-trước-raw. Transaction. WS best-effort. KHÔNG migration. Test MOCK.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo tasks.md OCC-001 (D-1..5: path §22.7b, WS best-effort, token per-device, count==0 giữ, auth-trước-raw). | Toàn bộ file |

---

## 1. DTO
**File**: `presence/dto/occupancy-event.dto.ts` (mới)
- [ ] `OccupancyEventDto`: roomId @IsUUID; occupancyCount @IsInt @Min(0); meetingId? @IsUUID; deviceCode?/eventType? @IsString; confidence? @IsNumber; eventTime? @IsISO8601; metadata? . **Ref**: FR-001/004.

## 2. Service
**File**: `presence/services/occupancy-ingest.service.ts` (mới)
- [ ] AUTH: resolve device (404), sha256 token vs camera_service_config.callback_token_hash (401), active + room match (403). **Trước raw.**
- [ ] RAW: INSERT iot_device_events (sau auth).
- [ ] VALIDATE occupancyCount int>=0 (400); eventTime parse.
- [ ] TRANSACTION: room_events (luôn) + presence_snapshots/room_booking_usages (nếu booking active) + rooms.current_status occupied (count>0).
- [ ] WS best-effort try/catch. return {accepted:true}. **Ref**: FR-003..011, NFR-001..005.

## 3. Controller + Module
**File**: `presence/controllers/room-camera.controller.ts` + `presence.module.ts`
- [ ] `@Controller('room-camera')` `@Post('occupancy-snapshots')` `@HttpCode(202)` no JWT user → service.ingest.
- [ ] module: forFeature [PresenceSnapshot, IoTDevice, RoomEvent, RoomBookingUsage, RoomBooking, Room] + WebsocketModule + controller + service. **Ref**: FR-001/010.

## 4. Seed token (thủ công — chưa có endpoint)
- [ ] Ghi hướng dẫn: set `iot_devices.metadata_json.camera_service_config.callback_token_hash = sha256(<token>)` cho device test (SQL). (Không seed-runner.)

## 5. Tests (mock, ≥80%)
**File**: `presence/services/occupancy-ingest.service.spec.ts` (mới)
- [ ] có-meeting (raw+room_events+presence+usage+occupied+WS) / không-meeting (raw+room_events+occupied) / count=0 (room_events, no occupied) / token sai (401, no raw) / count âm (400 sau raw) / room mismatch (403) / business lỗi → raw còn / WS lỗi → vẫn 202 / SEC token không log.

## 6. Verify
- [ ] build · lint per-file · jest · boot smoke (route room-camera/occupancy-snapshots mapped + 0 DI).

---
> Trạng thái: CHỜ REVIEW sau implement.
