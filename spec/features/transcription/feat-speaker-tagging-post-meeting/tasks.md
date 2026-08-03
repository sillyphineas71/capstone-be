## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo tasks.md ban đầu, tách từ `spec.md`/`plan.md`. | Toàn bộ file (mới) |
| 2026-08-02 | **P4 implement**: T-TAG-001✅→T-TAG-009✅ xong, code+lint+unit test xanh (67 test service-level, 92 test toàn module `transcription`). | T-TAG-001..009 |
| 2026-08-02 | **T-TAG-010✅ — CHẠY THẬT trên RDS chung (`smrmpts-db`), Thiếu Chủ đã duyệt.** 2 migration mới áp thành công (`migration:run:tsx`, verify `role_permissions` đúng 4 role EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN, không có `INTERNAL_USER`). E2E test `test/transcript-speaker-tagging.e2e-spec.ts` **PASS thật** qua Postgres live: gán tên ở transcript v1 → mô phỏng chạy lại (v2, ranh giới segment đổi 4000ms→3500ms) → tên tự động áp lại đúng KHÔNG cần gán lại (AC-005, mục tiêu cốt lõi GIAI ĐOẠN 2) — **bằng chứng thực nghiệm đầu tiên rằng thiết kế `meeting_events` làm nguồn sự thật (plan tổng mục 4.1) hoạt động đúng**. Verify cleanup: 0 row còn sót lại (users/meetings/meeting_events tagged theo test đều đã bị afterAll xoá sạch). **GIAI ĐOẠN 2 (P4) DONE — build/lint/test xanh, đã kiểm chứng thật trên DB chung, không lệch database baseline.** | Không sửa thêm code — chỉ chạy + verify |

# Tasks: TRANS-SPEAKER-TAG-POST-001 Speaker Tagging — Post-Meeting

**Input**: Design documents from `spec/features/transcription/feat-speaker-tagging-post-meeting/`
**Prerequisites**: `spec.md`, `plan.md`

**Tests**: Bắt buộc — spec.md NFR-006 yêu cầu unit test cho toàn bộ logic quan trọng, đặc biệt ERR-TAG-001/002/003/007 (an toàn/mâu thuẫn).

**Không code ở bước này** — chờ Thiếu Chủ duyệt trước khi implement (đúng quy trình đã đặt ra từ đầu phiên).

## Path Conventions

- Backend NestJS: `src/modules/transcription/` (flat structure — xem plan.md mục 5.3)
- Migration: `src/database/migrations/`

---

## Phase 1 — Nền tảng dữ liệu (không phụ thuộc gì)

### T-TAG-001 ✅ — Thêm `MeetingEventType.SPEAKER_TAG` + migration tài liệu hoá

- dependsOn: Không có
- files: `src/modules/meetings/entities/meeting-event.entity.ts` (sửa — thêm `SPEAKER_TAG = 'speaker_tag'` vào enum), `src/database/migrations/<timestamp>-AddSpeakerTagMeetingEventType.ts` (mới, no-op DDL giống mẫu `20260617-UpdateMeetingEventTypeEnum.ts`, chỉ ghi chú lại quyết định)
- acceptance criteria: Enum TypeScript có giá trị mới; migration chạy được (`up`/`down` no-op an toàn), không phá dữ liệu cũ vì cột là `varchar(60)`.
- test requirement: Không cần test riêng cho enum value — verify qua test của T-TAG-004/T-TAG-005 dùng giá trị này thật.

### T-TAG-002 ✅ — Migration seed permission `transcript.speaker_tag`

- dependsOn: Không có (độc lập với T-TAG-001)
- files: `src/database/migrations/<timestamp>-SeedTranscriptSpeakerTagPermission.ts` (mới)
- ⚠️ **CẠM BẪY LỊCH SỬ ĐÃ XÁC NHẬN — đọc trước khi viết migration này**: migration seed gốc cho `transcript.create/read/update` (`20260629020000-SeedTranscriptionPermissions.ts`) từng gán role **`INTERNAL_USER`** — mã role này **KHÔNG TỒN TẠI THẬT** trong bảng `roles` (comment trong `20260720000002-SeedCoreRoles.ts` xác nhận: "INTERNAL_USER, ROOM_ADMIN xuất hiện trong một số migration/seed rất sớm nhưng không còn được tạo/dùng ở đâu" — 4 role thật duy nhất là `SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER, EMPLOYEE`). Bug này đã được vá bằng `20260720000005-BackfillRolePermissions.ts`, trong đó `transcript.create/read/update` được re-seed đúng cho `['BUSINESS_ADMIN', 'EMPLOYEE', 'MANAGER', 'SYSTEM_ADMIN']` (module_code=`'transcription'`, đã xác nhận đọc code thật, dòng ~796-810). **DÙNG ĐÚNG file `20260720000005` làm mẫu tham chiếu cho role list + module_code, KHÔNG copy `20260629020000` (file đó chứa bug đã biết).**
- files (tiếp): theo mẫu `20260729000002-SeedAvatarPhotoUpdatePermission.ts` cho CẤU TRÚC migration (`ON CONFLICT DO NOTHING` + fallback SELECT, idempotent, có `up`/`down`).
- acceptance criteria: Permission `transcript.speaker_tag` được tạo với `module_code='transcription'` (nhất quán với 3 permission `transcript.*` khác). Gán role: **EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN** — dùng đúng 4 mã role thật, không dùng `INTERNAL_USER`.
- test requirement: Không cần unit test — verify bằng chạy migration thật trên DB dev + query `SELECT * FROM permissions WHERE permission_code='transcript.speaker_tag'` + `role_permissions` join đúng 4 role (KHÔNG có `INTERNAL_USER` join nào vì role đó không tồn tại — join rỗng không báo lỗi nhưng cũng không tạo được gì, đây chính là cách bug cũ ẩn mình).

---

## Phase 2 — `SpeakerMappingService`: đọc cụm + tính mốc đại diện

### T-TAG-003 ✅ — `SpeakerMappingService.listSpeakerClusters(transcriptId, userId)` (GA-23)

- dependsOn: Không có
- files: `src/modules/transcription/speaker-mapping.service.ts` (mới), `src/modules/transcription/dto/speaker-cluster-response.dto.ts` (mới)
- acceptance criteria:
  - Authz: đúng pattern Host-of-meeting-or-Admin (copy pattern từ `transcription.service.ts`, KHÔNG import `TranscriptionService` — xem plan.md mục 4).
  - Đọc `speaker_segments_json.segments`, gom nhóm theo `speakerLabel` (bỏ qua `unknown`), trả về mỗi cụm: `speakerLabel`, `totalSpeakingMs`, `segmentCount`, `sampleText` (text của segment dài nhất, để Host "nghe thử"/đọc thử biết ai đang nói), `currentMapping` (nếu cụm đã có `mappedUserId` từ lần gán trước — hiển thị lại cho Host biết đã gán gì).
  - Transcript không tồn tại → 404. Không phải Host/Admin → 403.
- test requirement: `speaker-mapping.service.spec.ts` — case có cụm, case transcript không có segment nào (rỗng), case forbidden.

### T-TAG-004 ✅ — Hàm tính mốc đại diện (CLR-002) + quy đổi wall-clock

- dependsOn: T-TAG-003 (dùng chung logic đọc segment theo speakerLabel)
- files: `src/modules/transcription/speaker-mapping.service.ts` (sửa — thêm private method `computeRepresentativeEventTime(segments, speakerLabel, recordingSessionStartedAt)`)
- acceptance criteria: Trả về `Date` = `recordingSessionStartedAt + midpoint(segment dài nhất có speakerLabel khớp)`. Segment không tồn tại cho label đó → throw lỗi rõ ràng (không xảy ra trong luồng bình thường vì đã validate label tồn tại ở tầng DTO/service trước khi gọi hàm này).
- test requirement: Unit test thuần (không cần mock DB) — input segments cố định, assert đúng công thức, bao gồm case nhiều segment cùng label (chọn đúng segment DÀI NHẤT, không phải segment đầu tiên).

---

## Phase 3 — Ghi mapping (GA-20, GA-21, GA-22)

### T-TAG-005 ✅ — `SpeakerMappingService.createSpeakerMappings(transcriptId, dto, userId)` — validate + gộp/mâu thuẫn trong request

- dependsOn: T-TAG-002, T-TAG-004
- files: `src/modules/transcription/speaker-mapping.service.ts` (sửa — method mới), `src/modules/transcription/dto/create-speaker-mappings.dto.ts` (mới, theo đúng convention `UpdateTranscriptSegmentsDto`)
- acceptance criteria (ánh xạ trực tiếp spec.md):
  - ERR-TAG-004: `speakerLabel` không tồn tại trong transcript → reject toàn bộ request, liệt kê label sai.
  - ERR-TAG-005: DTO-level validation — đúng một trong `speakerUserId`/`externalParticipantId` (dùng `class-validator` custom validator hoặc `@ValidateIf`).
  - FR-010: `externalParticipantId` phải thuộc đúng `meeting_id` của transcript.
  - ERR-TAG-002: cùng speakerLabel, khác identity trong 1 request → reject toàn bộ (400), không ghi gì.
  - ERR-TAG-001: cùng identity, nhiều speakerLabel → chấp nhận, đánh dấu `mergedClusters` trong response.
  - FR-008: transcript đang `processing` → 409.
  - all-or-nothing: dùng transaction (`DataSource.transaction` hoặc `QueryRunner`) — hoặc ghi `meeting_events` thành công hết, hoặc không ghi gì.
- test requirement: Đây là task quan trọng nhất về an toàn — test bắt buộc AC-001, AC-002, AC-003 từ spec.md (happy path, gộp, mâu thuẫn-trong-request).

### T-TAG-006 ✅ — Áp mapping ngay lập tức vào transcript hiện tại (GA-22, FR-006)

- dependsOn: T-TAG-005
- files: `src/modules/transcription/speaker-mapping.service.ts` (sửa — sau khi ghi `meeting_events` thành công, cập nhật `transcripts.speaker_segments_json.segments[].speakerUserId`/`speakerLabel hiển thị` và `detected_speakers_json.speakers[].mappedUserId`/`mappingSource='manual'` cho MỌI segment thuộc cụm vừa gán)
- acceptance criteria: Sau khi gọi `createSpeakerMappings`, `GET` lại transcript (endpoint đã có) phải thấy tên mới ngay, không cần đợi rerun. Các field KHÔNG liên quan trong JSON (totalSpeakingMs, segmentCount, confidence...) giữ nguyên (rủi ro đã ghi ở plan.md mục 7).
- test requirement: Test round-trip: gọi `createSpeakerMappings` → assert trực tiếp trên object transcript đã update, không chỉ assert `meeting_events` được ghi.

### T-TAG-007 ✅ — `TranscriptSpeakerMappingsController` — 2 endpoint HTTP

- dependsOn: T-TAG-003, T-TAG-005
- files: `src/modules/transcription/transcript-speaker-mappings.controller.ts` (mới), `src/modules/transcription/transcription.module.ts` (sửa — thêm controller vào mảng `controllers`, thêm `SpeakerMappingService` vào `providers`, thêm vào `exports` NẾU `TranscriptionService` cần inject nó cho T-TAG-008)
- acceptance criteria:
  - `GET /transcripts/:transcriptId/speaker-clusters` — permission `transcript.read` (đã có, không cần permission mới cho đọc).
  - `POST /transcripts/:transcriptId/speaker-mappings` — permission `transcript.speaker_tag` (mới, T-TAG-002), `@UsePipes(ValidationPipe({whitelist, forbidNonWhitelisted, transform}))` đúng convention đã có.
  - Response format đúng chuẩn `{ success: true, data: ... }` (CLAUDE.md mục 8.1).
- test requirement: Không cần test controller riêng nếu service đã test đủ (đúng cách các controller khác trong module này làm — controller mỏng, logic ở service) — nhưng NÊN có ít nhất 1 e2e-style test nếu team có pattern `test/*.e2e-spec.ts` sẵn cho module (xem `test/transcription-job-lifecycle.e2e-spec.ts` làm mẫu, optional cho task này).

---

## Phase 4 — GA-27: Áp lại tự động khi rerun (mục tiêu cốt lõi của cả GIAI ĐOẠN 2)

### T-TAG-008 ✅ — `SpeakerMappingService.applySpeakerMappingsFromEvents(transcriptId)`

- dependsOn: T-TAG-004
- files: `src/modules/transcription/speaker-mapping.service.ts` (sửa — method mới, public, được gọi từ `TranscriptionService`)
- acceptance criteria:
  - Đọc `meeting_events` where `meeting_id = transcript.meetingId AND event_type = 'speaker_tag' AND metadata_json->>'recordingSessionId' = transcript.recordingSessionId`.
  - Với mỗi event: tính `offsetMs = event.eventTime - recordingSession.startedAt`, tìm segment trong transcript HIỆN TẠI (transcript vừa truyền vào, KHÔNG phải transcript lúc ghi mapping) mà `startMs <= offsetMs < endMs`.
  - ERR-TAG-007: offset không rơi vào segment nào → bỏ qua, không lỗi, KHÔNG đoán segment gần nhất.
  - ERR-TAG-003: 2 event khác identity cùng trỏ 1 speakerLabel mới → `mappingSource='conflict'`, không gán tên, `manualReviewRequired=true`.
  - Cùng identity trỏ nhiều speakerLabel mới → áp bình thường cho tất cả (không phải conflict, đây là case gộp hợp lệ).
  - Ghi lại `transcripts.speaker_segments_json`/`detected_speakers_json` sau khi áp xong.
- test requirement: Bắt buộc — đây là bài test chứng minh thiết kế `meeting_events` (mục 4.1 plan tổng) hoạt động đúng. Case: 1 event áp đúng segment mới dù ranh giới đổi; case ERR-TAG-007 (offset ngoài mọi segment); case ERR-TAG-003 (conflict khi rerun).

### T-TAG-009 ✅ — Chèn gọi `applySpeakerMappingsFromEvents` vào `TranscriptionService.updateTranscriptResult()`

- dependsOn: T-TAG-007, T-TAG-008
- files: `src/modules/transcription/transcription.service.ts` (sửa — chèn đúng vị trí đã xác định ở plan.md mục 5.2, sau khi `transcriptRepo.update(...)` ghi draft xong), `src/modules/transcription/transcription.module.ts` (sửa — inject `SpeakerMappingService` vào constructor `TranscriptionService`, cần export từ providers)
- acceptance criteria: FR-007, NFR-004 (spec.md) — best-effort, try/catch, KHÔNG fail job nếu bước áp lại lỗi (đúng pattern `notifyTranscriptReady` đã có, T029 feature trước).
- test requirement: Cập nhật `transcription.service.spec.ts` (đã có sẵn, file lớn 35KB) — thêm mock `SpeakerMappingService`, assert được gọi sau `transcriptRepo.update`, assert lỗi từ nó không làm `updateTranscriptResult` throw.

### T-TAG-010 ✅ (CHẠY THẬT trên RDS chung, PASS) — Integration test end-to-end: "gán rồi chạy lại không mất công" (AC-005, mục tiêu cốt lõi)

- dependsOn: T-TAG-006, T-TAG-009
- files: `test/transcript-speaker-tagging.e2e-spec.ts` (mới, theo mẫu `test/transcription-job-lifecycle.e2e-spec.ts` — DB + queue thật, mock phần spawn Python)
- acceptance criteria: Kịch bản đầy đủ — tạo transcript v1 (mock kết quả pipeline có 2-3 speakerLabel) → gán tên qua `createSpeakerMappings` → giả lập chạy lại transcription (tạo transcript v2 với `updateTranscriptResult`, segment/ranh giới có thể khác chút) → assert transcript v2 TỰ ĐỘNG có tên đã gán mà không gọi lại API gán nào.
- test requirement: Đây LÀ test requirement — không có acceptance criteria nào khác ngoài chính test này pass.

---

## Dependencies & Execution Order

```text
T-TAG-001 (enum)          T-TAG-002 (permission)
        │                          │
        └──────────┬───────────────┘
                    ▼
              T-TAG-003 (đọc cụm) ──► T-TAG-004 (mốc đại diện)
                    │                        │
                    │                        ▼
                    │                  T-TAG-005 (ghi mapping + an toàn)
                    │                        │
                    │                        ▼
                    │                  T-TAG-006 (áp ngay lập tức)
                    │                        │
                    └────────────┬───────────┘
                                 ▼
                           T-TAG-007 (controller — 2 endpoint)

T-TAG-004 ──► T-TAG-008 (áp lại khi rerun) ──► T-TAG-009 (chèn vào updateTranscriptResult) ──► T-TAG-010 (E2E "sống sót qua rerun")
```

**Điều kiện coi feature này DONE**: T-TAG-010 pass (bằng chứng thực nghiệm cho đúng mục tiêu cốt lõi của GIAI ĐOẠN 2 — "chạy lại transcription không mất công gán tay", một trong các dòng Definition of Done ở plan tổng mục 12) + toàn bộ test ERR-TAG-001/002/003/007 pass + build/lint/test xanh.
