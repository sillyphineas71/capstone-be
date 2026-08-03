## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo tasks.md ban đầu, tách từ `spec.md`/`plan.md`. | Toàn bộ file (mới) |
| 2026-08-03 | **P6 implement**: T-LIVE-001✅→T-LIVE-007✅ xong. Enum `RECORDING_START_MARKER` + migration tài liệu hoá (chưa chạy lên RDS chung — no-op thật, không ảnh hưởng gì nếu chưa chạy). `SpeakerMappingService` mở rộng 3 method mới (`createStartMarker`/`createLiveSpeakerTag`/`setManualRecordingStart`) + `applySpeakerMappingsFromEvents()` mở rộng xử lý `tagSource='live'` với anchor riêng (marker thay vì `recording_sessions.started_at`), KHÔNG viết lại logic gộp/mâu thuẫn đã có. `LiveSpeakerTaggingController` — 3 endpoint mới, tái sử dụng permission `transcript.speaker_tag` (không seed mới). 19 test mới, tổng **111 test toàn module `transcription` pass** (92 cũ + 19 mới), không regression. `tsc --noEmit` sạch, lint sạch (trừ lỗi hệ thống pre-existing đã xác nhận ở migration). Không cần E2E DB chung (đúng quyết định plan.md mục 5 — phần mở rộng thuần logic). | T-LIVE-001..007 |

# Tasks: TRANS-SPEAKER-TAG-LIVE-001 Speaker Tagging — Live

**Input**: Design documents from `spec/features/transcription/feat-speaker-tagging-live/`
**Prerequisites**: `spec.md`, `plan.md`, và toàn bộ code GIAI ĐOẠN 2 (`feat-speaker-tagging-post-meeting`, đã implement + verify thật)

**Tests**: Bắt buộc — mở rộng `speaker-mapping.service.spec.ts` đã có (không tạo file test mới), xem plan.md mục 5.

**Không code ở bước này** — chờ Thiếu Chủ duyệt trước khi implement.

## Path Conventions

- Backend NestJS: `src/modules/transcription/` (flat structure, giống GIAI ĐOẠN 2)
- Migration: `src/database/migrations/`

---

## Phase 1 — Nền tảng (GA-30 phần enum)

### T-LIVE-001 ✅ — Thêm `MeetingEventType.RECORDING_START_MARKER` + migration tài liệu hoá

- dependsOn: Không có
- files: `src/modules/meetings/entities/meeting-event.entity.ts` (sửa — thêm enum value), `src/database/migrations/<timestamp>-AddRecordingStartMarkerMeetingEventType.ts` (mới, no-op DDL, cùng mẫu `20260802000001`)
- acceptance criteria: Enum có giá trị mới; migration `up`/`down` no-op an toàn (varchar(60), không cần ALTER).
- test requirement: Không cần test riêng — verify qua T-LIVE-003/T-LIVE-006 dùng giá trị thật.

---

## Phase 2 — Ghi mốc marker + tag live (GA-30, GA-32, GA-35)

### T-LIVE-002 ✅ — Inject `MeetingEntity` repo vào `SpeakerMappingService`

- dependsOn: Không có
- files: `src/modules/transcription/speaker-mapping.service.ts` (sửa — thêm `@InjectRepository(MeetingEntity)` vào constructor, KHÔNG cần sửa `transcription.module.ts` — `MeetingEntity` đã export qua `MeetingsModule` đã import sẵn, xem plan.md mục 4.3)
- acceptance criteria: Service khởi tạo được (DI resolve đúng), không phá bất kỳ test cũ nào của GIAI ĐOẠN 2.
- test requirement: Chạy lại toàn bộ `speaker-mapping.service.spec.ts` cũ — phải PASS nguyên vẹn sau khi thêm dependency (cập nhật mock provider trong `beforeEach`).

### T-LIVE-003 ✅ — `SpeakerMappingService.createStartMarker(meetingId, userId)` (GA-30)

- dependsOn: T-LIVE-001
- files: `speaker-mapping.service.ts` (sửa — method mới)
- acceptance criteria: FR-001/FR-004 spec.md — ghi `meeting_events` đúng `event_type='recording_start_marker'`, `event_time=server now()` (KHÔNG nhận timestamp từ client), authz Host-of-meeting-or-Admin. Cho phép gọi nhiều lần (CLR-001 — không reject lần 2).
- test requirement: Case ghi đúng field, case forbidden, case gọi 2 lần đều thành công (2 bản ghi).

### T-LIVE-004 ✅ — `SpeakerMappingService.createLiveSpeakerTag(meetingId, dto, userId)` (GA-32)

- dependsOn: T-LIVE-002
- files: `speaker-mapping.service.ts` (sửa — method mới), `dto/create-live-speaker-tag.dto.ts` (mới — `{ speakerUserId?, externalParticipantId?, displayName }`, KHÔNG có `speakerLabel` — khác `SpeakerMappingItemDto` của GIAI ĐOẠN 2)
- acceptance criteria: FR-002/FR-005 — ghi đúng `metadata_json.recordingSessionId=null`, `tagSource='live'`. Validate đúng-một-trong-hai identity (copy pattern ERR-TAG-005, không tách hàm dùng chung vì input shape khác — 1 item vs mảng). Validate identity tồn tại thật (user/external participant) — TÁI SỬ DỤNG cách kiểm tra đã có trong `createSpeakerMappings` nếu tách được thành helper riêng mà không phá code cũ; nếu không tách gọn, chấp nhận trùng lặp nhỏ (đây KHÔNG phải task bắt buộc phải DRY tuyệt đối — ưu tiên không đụng code GIAI ĐOẠN 2 đã verify thật).
- test requirement: Case ghi đúng, case thiếu/thừa identity → 400, case identity không tồn tại → 400, case forbidden.

### T-LIVE-005 ✅ — `SpeakerMappingService.setManualRecordingStart(meetingId, dto, userId)` (GA-35)

- dependsOn: T-LIVE-002, T-LIVE-003 (dùng chung event_type)
- files: `speaker-mapping.service.ts` (sửa — method mới), `dto/set-manual-recording-start.dto.ts` (mới — `{ startedAt: string (ISO) }`)
- acceptance criteria: ERR-LIVE-002 (tương lai → 400), ERR-LIVE-003 (cách xa `meetings.actual_start_time`/`start_time` quá ±24h → 400 — **ngưỡng cần Thiếu Chủ xác nhận lại, xem plan.md mục 6**), happy path tạo `recording_start_marker` với `event_time` = giá trị client cung cấp (NGOẠI LỆ DUY NHẤT trong toàn bộ GIAI ĐOẠN 2+3 cho phép client set event_time — phải ghi rõ trong code comment tại sao đây là ngoại lệ có chủ đích).
- test requirement: 2 case validate (ERR-LIVE-002/003) + happy path, dùng `meetings.actual_start_time` khi có, fallback `start_time` khi null.

---

## Phase 3 — Mở rộng quy chiếu (GA-33, GA-34 — tái sử dụng, không viết lại)

### T-LIVE-006 ✅ — Mở rộng `applySpeakerMappingsFromEvents()` xử lý `tagSource='live'`

- dependsOn: T-LIVE-003, T-LIVE-004
- files: `speaker-mapping.service.ts` (sửa — CHỈ đoạn tính `offsetMs`/lọc `relevantEvents`, KHÔNG động vào phần group-by-label/gộp/mâu thuẫn đã có, xem plan.md mục 4.2 code mẫu)
- acceptance criteria (bám sát spec.md, KHÔNG viết lại logic cũ):
  - Mở rộng câu lọc `relevantEvents`: chấp nhận thêm event có `metadataJson.recordingSessionId === null && metadataJson.tagSource === 'live'` (đã lọc theo `meetingId` từ trước).
  - Với mỗi event `tagSource='live'`: query marker MỚI NHẤT (`ORDER BY event_time DESC LIMIT 1`) của cùng `meetingId` làm anchor.
  - FR-007/ERR-LIVE-004: KHÔNG có marker nào → bỏ qua TOÀN BỘ event live của meeting đó, không lỗi.
  - Event `tagSource='post'` (đã có): hành vi GIỮ NGUYÊN 100%, không regression.
  - AC-006: event live + event post cùng identity, khác speakerLabel mới → gộp đúng (logic gộp/mâu thuẫn hiện có tự động xử lý đúng vì không phân biệt nguồn — chỉ cần verify KHÔNG bị phá khi thêm nguồn thứ 2).
- test requirement: Đây là task quan trọng nhất — bắt buộc AC-001 (happy path quy chiếu live), AC-003 (không marker → bỏ qua), AC-006 (gộp xuyên nguồn). Chạy lại TOÀN BỘ test T-TAG-008 cũ (GIAI ĐOẠN 2) — phải PASS nguyên vẹn, xác nhận không regression trên luồng `post`.

---

## Phase 4 — Controller (GA-30/32/35 lộ ra HTTP)

### T-LIVE-007 ✅ — `LiveSpeakerTaggingController` — 3 endpoint

- dependsOn: T-LIVE-003, T-LIVE-004, T-LIVE-005
- files: `src/modules/transcription/live-speaker-tagging.controller.ts` (mới), `transcription.module.ts` (sửa — thêm controller vào mảng `controllers`, `SpeakerMappingService` đã có sẵn trong `providers` từ GIAI ĐOẠN 2 — KHÔNG cần thêm lại)
- acceptance criteria:
  - `POST meetings/:meetingId/recording/start-marker` — permission `transcript.speaker_tag` (tái sử dụng, KHÔNG seed mới).
  - `POST meetings/:meetingId/recording/live-speaker-tag` — cùng permission.
  - `POST meetings/:meetingId/recording/start-marker/manual` — cùng permission.
  - Response format `{ success: true, data: ... }` đúng chuẩn CLAUDE.md mục 8.1.
- test requirement: Controller mỏng, logic đã test ở service — không bắt buộc test controller riêng (đúng pattern module này đã theo).

---

## Dependencies & Execution Order

```text
T-LIVE-001 (enum)
      │
      ▼
T-LIVE-002 (inject MeetingEntity)
      │
      ├──► T-LIVE-003 (marker) ──┬──► T-LIVE-005 (manual — dùng chung event_type)
      │                          │
      └──► T-LIVE-004 (live-tag) ┘
                    │
                    ▼
            T-LIVE-006 (mở rộng apply — GATE AN TOÀN: không regression GIAI ĐOẠN 2)
                    │
                    ▼
            T-LIVE-007 (controller, lộ HTTP)
```

**Điều kiện coi feature này DONE**: T-LIVE-006 pass đủ AC-001/AC-003/AC-006 + toàn bộ test T-TAG-xxx cũ của GIAI ĐOẠN 2 vẫn PASS 100% (không regression) + build/lint/test xanh. Không cần chạy lại E2E trên DB chung (đã verify hạ tầng chung ở T-TAG-010, phần mở rộng này thuần logic, unit test đủ tin cậy — xem plan.md mục 5).
