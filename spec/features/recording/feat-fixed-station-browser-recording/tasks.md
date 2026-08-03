## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-03 | Tạo tasks.md ban đầu, tách từ `spec.md`/`plan.md`. Chưa implement — dừng ở bước này chờ Thiếu Chủ duyệt (đặc biệt P-1/P-2/P-3 ở plan.md mục 6). | Toàn bộ file (mới) |
| 2026-08-03 | **Phase 4-6 (FE) XONG**: T-REC006-006✅→013✅. Hook `useStationRecording.js` (MediaRecorder + IndexedDB `stationRecordingDB`, timeslice 30s, mốc gán tên lưu chung record, phục hồi sau crash). Component `StationRecorder.jsx` (nút Bắt đầu/Dừng ghi, picker gán người đang nói, banner phục hồi, fallback rõ ràng khi không hỗ trợ). `transcriptionServices.js` thêm `createOffsetSpeakerMarks()`. Nhúng vào `InMeetingRoom.jsx` trong khối `isHost`, điều kiện `room.hasMicrophone` (D-8) — KHÔNG đụng `AudioUploader.jsx` (vẫn còn nguyên làm phương án dự phòng, FR-011/012). ESLint 0 lỗi (chỉ warning pre-existing không liên quan). `npm run build` KHÔNG chạy được hết — chặn bởi lỗi **pre-existing, không liên quan REC-006**: thiếu package `@mediapipe/tasks-vision` trong `node_modules` (dùng bởi `useFaceGuidance.js` có từ trước) — ngoài phạm vi feature này, cần Thiếu Chủ chạy `npm install` lại. **T-REC006-014/015/016 (smoke test phần cứng thật) CHƯA chạy được** — cần trạm cố định + mic hội nghị thật, ngoài khả năng của agent. | T-REC006-006..013 |
| 2026-08-03 | Thiếu Chủ đồng ý P-1/P-2/P-3 → bắt đầu implement. **Phase 1-3 (BE) XONG**: T-REC006-001✅→005✅. DTO `CreateOffsetSpeakerMarksDto`, error code `OFFSET_OUT_OF_RANGE`, method `SpeakerMappingService.createOffsetSpeakerMarks()` (all-or-nothing, `tagSource='post'`), route `POST meetings/:meetingId/recording-sessions/:sessionId/speaker-marks` trong `live-speaker-tagging.controller.ts` (permission `transcript.speaker_tag`, không seed mới). 24 test mới trong `speaker-mapping.service.spec.ts` (gồm 1 test tích hợp xác nhận event tạo ra được `applySpeakerMappingsFromEvents()` áp đúng, không sửa gì ở đó) — toàn module `transcription` **124/124 test pass**, không regression. Lint sạch (`eslint --fix` cho lỗi prettier). `tsc --noEmit`: 0 lỗi mới trong các file đã sửa (lỗi baseline pre-existing ở module khác không liên quan). | T-REC006-001..005 |

# Tasks: REC-006 Fixed-Station Browser Recording

**Input**: Design documents from `spec/features/recording/feat-fixed-station-browser-recording/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md` (D-1..D-8), và toàn bộ code GIAI ĐOẠN 2 (`feat-speaker-tagging-post-meeting`, đã implement + verify thật)

**Tests**: Bắt buộc cho phần BE — mở rộng `speaker-mapping.service.spec.ts` đã có (không tạo file test service mới), xem plan.md mục 5. Phần FE ưu tiên smoke test tay cho RISK-001/003 trước khi viết unit test.

**⚠️ KHÔNG CODE Ở BƯỚC NÀY** — dừng lại đúng ở tasks.md, chờ Thiếu Chủ đồng ý mới bắt đầu implement (yêu cầu tường minh của Thiếu Chủ).

**⚠️ 3 điểm CHỜ XÁC NHẬN trước khi bắt đầu Phase 1** (plan.md mục 6 — P-1/P-2/P-3): xử lý `duration_seconds = null`, permission `transcript.speaker_tag` cho endpoint mới, route path `recording-sessions/:sessionId/speaker-marks`. Các task dưới đây giả định 3 điểm này được duyệt theo đúng đề xuất ở plan.md — nếu Thiếu Chủ đổi ý, phải sửa lại task tương ứng trước khi code.

## Path Conventions

- Backend NestJS: `src/modules/transcription/` (flat structure, giống GIAI ĐOẠN 2/3)
- Frontend: `FE_SmarTracking/src/` (service/, hooks hoặc utils/, components/recording/ — mới)

---

## Phase 1 — BE: DTO + error code (nền tảng)

### T-REC006-001 ✅ — DTO `CreateOffsetSpeakerMarksDto` + `OffsetSpeakerMarkItemDto`

- dependsOn: Không có
- files: `src/modules/transcription/dto/create-offset-speaker-marks.dto.ts` (mới — xem plan.md mục 4.1 cho shape đầy đủ)
- acceptance criteria: `offsetSeconds` là number `>= 0` (`@Min(0)`); `speakerUserId`/`externalParticipantId` optional UUID; `displayName` bắt buộc 1-255 ký tự; `marks` là mảng tối thiểu 1 phần tử, `@ValidateNested`.
- test requirement: Không cần test riêng cho DTO thuần — verify qua test service ở T-REC006-004.

### T-REC006-002 ✅ — Error code `OFFSET_OUT_OF_RANGE`

- dependsOn: Không có
- files: `src/modules/transcription/constants/transcription-error-codes.ts` (sửa — thêm 1 key)
- acceptance criteria: Key mới `OFFSET_OUT_OF_RANGE: 'OFFSET_OUT_OF_RANGE'`, không đổi key nào đã có.
- test requirement: Không cần test riêng.

---

## Phase 2 — BE: `SpeakerMappingService.createOffsetSpeakerMarks()`

### T-REC006-003 ✅ — Implement method (đọc session, authz, validate)

- dependsOn: T-REC006-001, T-REC006-002
- files: `src/modules/transcription/speaker-mapping.service.ts` (sửa — method mới, xem plan.md mục 4.3 code mẫu)
- acceptance criteria:
  - Load `recording_sessions` theo `sessionId`; không tồn tại hoặc `meetingId` khác → `NotFoundException` với `RECORDING_SESSION_NOT_FOUND` (tái dùng code có sẵn).
  - `assertHostOrAdmin(meetingId, userId)` — tái dùng nguyên method private đã có trong service này, KHÔNG viết lại.
  - Validate đúng-một-trong-hai (`speakerUserId`/`externalParticipantId`) cho MỌI item — sai bất kỳ item nào → 400, KHÔNG ghi gì (all-or-nothing, copy pattern `createSpeakerMappings`).
  - Validate `offsetSeconds`: `< 0` luôn reject; `> session.durationSeconds` chỉ reject KHI `durationSeconds != null` (P-1 plan.md mục 6) — sai bất kỳ item nào → 400 `OFFSET_OUT_OF_RANGE`, all-or-nothing.
  - Validate identity tồn tại thật (`speakerUserId` → `userRepo`, `externalParticipantId` → `externalParticipantRepo` với đúng `meetingId`) — TÁI DÙNG đúng cách batch `findBy` + `In()` mà `createSpeakerMappings` đã làm (không viết lại thuật toán, chỉ đổi nguồn mảng đầu vào).
- test requirement: Case session không tồn tại/khác meeting (404); case thiếu/thừa identity (400, all-or-nothing — verify KHÔNG có event nào được ghi); case offset âm (400); case offset vượt duration khi duration có giá trị (400); case offset "vượt" nhưng duration=null → KHÔNG bị chặn bởi lý do cận trên (chỉ chặn nếu âm); case identity không tồn tại (400); case forbidden (403).

### T-REC006-004 ✅ — Ghi `meeting_events` trong transaction (phần ghi dữ liệu)

- dependsOn: T-REC006-003
- files: `speaker-mapping.service.ts` (tiếp tục method T-REC006-003)
- acceptance criteria:
  - Dùng `dataSource.transaction()` — all-or-nothing đúng NFR-003/NFR spec.md.
  - Mỗi item ghi 1 bản ghi `meeting_events`: `eventType=SPEAKER_TAG`, `eventTime = new Date(session.startedAt.getTime() + offsetSeconds*1000)`, `actorUserId=userId`, `sourceType=MANUAL`, `metadataJson={ recordingSessionId: sessionId, speakerUserId, externalParticipantId, displayName, tagSource:'post' }` — **`tagSource='post'` KHÔNG PHẢI `'live'`** (điểm quan trọng nhất của cả feature — nếu ghi nhầm `'live'`, `applySpeakerMappingsFromEvents()` sẽ đi tìm `recording_start_marker` không tồn tại và bỏ qua toàn bộ, feature sẽ "im lặng không hoạt động").
  - Trả về `{ savedCount: dto.marks.length }`.
- test requirement: **Test quan trọng nhất của cả feature** — ghi event xong, gọi `applySpeakerMappingsFromEvents()` (KHÔNG sửa, dùng nguyên) trên 1 transcript giả lập có segment khớp offset → xác nhận mapping áp đúng tên vào đúng cụm giọng. Chạy lại toàn bộ test `tagSource='post'` cũ (GIAI ĐOẠN 2) — phải PASS nguyên vẹn, xác nhận method mới không có side-effect nào lên logic áp mapping.

---

## Phase 3 — BE: Controller (lộ ra HTTP)

### T-REC006-005 ✅ — Route `POST meetings/:meetingId/recording-sessions/:sessionId/speaker-marks`

- dependsOn: T-REC006-004, **P-2/P-3 đã được Thiếu Chủ xác nhận** (plan.md mục 6)
- files: `src/modules/transcription/live-speaker-tagging.controller.ts` (sửa — thêm 1 route vào controller đã có, KHÔNG tạo controller mới)
- acceptance criteria:
  - Permission `transcript.speaker_tag` (tái sử dụng, KHÔNG seed mới — nếu P-2 bị bác bỏ, task này phải sửa lại trước khi code).
  - `HttpCode(201)`, `ValidationPipe({whitelist:true, transform:true})`.
  - Response `{ success: true, message: '...', data: { savedCount } }` đúng chuẩn CLAUDE.md mục 8.1.
- test requirement: Controller mỏng, logic đã test ở service — không bắt buộc test controller riêng (đúng pattern module này đã theo, giống `LiveSpeakerTaggingController` GA-30/32/35).

**Checkpoint BE**: Đến đây, phần BE hoàn chỉnh và có thể test độc lập bằng Postman/curl mà không cần FE — endpoint nhận `sessionId` thật (từ 1 lần gọi `audio-upload` thủ công) + mảng `marks` giả lập → verify `meeting_events` được ghi đúng.

---

## Phase 4 — FE: Ghi âm trực tiếp + lưu bền (IndexedDB)

### T-REC006-006 ✅ — Module ghi âm: `MediaRecorder` + cắt đoạn định kỳ

- dependsOn: Không có (độc lập với BE, có thể làm song song)
- files: `FE_SmarTracking/src/hooks/useStationRecording.js` (mới, tên/thư mục chính xác quyết định lúc code — xem plan.md mục 4.5)
- acceptance criteria (FR-001, FR-008 spec.md):
  - `getUserMedia({audio:true})` xin quyền mic 1 lần khi bắt đầu ghi.
  - `MediaRecorder` với `timeslice` ~30-60s (giá trị chính xác quyết định lúc code, xem T-REC006-014 smoke test).
  - Mỗi `ondataavailable` lưu ngay đoạn (Blob) xuống IndexedDB — KHÔNG tích luỹ trong biến JS/RAM.
- test requirement: Smoke test tay bắt buộc trên trình duyệt thật của trạm (không phải unit test tự động) — xem T-REC006-014 (RISK-001).

### T-REC006-007 ✅ — Lưu mốc gán tên vào cùng bản ghi IndexedDB

- dependsOn: T-REC006-006
- files: cùng file T-REC006-006 (mở rộng)
- acceptance criteria (FR-007, D-5 research.md): khi Host bấm gán "người này đang nói" trong lúc ghi, tính `offsetSeconds = (Date.now() - recordingStartTimestamp) / 1000` bằng đồng hồ trình duyệt cục bộ, lưu vào CÙNG bản ghi IndexedDB với các đoạn audio (không phiên IndexedDB riêng) — đảm bảo cùng sống/cùng phục hồi (D-5).
- test requirement: Verify mốc gán tên và đoạn audio nằm chung 1 record IndexedDB, offset tính đúng bằng cách so `Date.now()` giả lập trong test.

### T-REC006-008 ✅ — Nối đoạn thành 1 file khi "Dừng ghi"

- dependsOn: T-REC006-006
- files: cùng module ghi âm
- acceptance criteria (FR-004): `MediaRecorder.stop()` → đọc lại toàn bộ đoạn từ IndexedDB THEO ĐÚNG THỨ TỰ → nối thành 1 Blob `.webm` (nối byte thuần, KHÔNG cần ffmpeg — xem RISK-001 spec.md, do chunk sau chunk đầu không có header riêng nên PHẢI giữ đúng thứ tự và không thiếu đoạn).
- test requirement: Case nối đúng thứ tự cho ra file phát được; case xoá/thiếu 1 đoạn giữa → phải phát hiện được lỗi thay vì âm thầm tạo file hỏng (chi tiết hành vi lúc thiếu đoạn — quyết định lúc code, không có trong spec).

### T-REC006-009 ✅ — Phục hồi phiên ghi dang dở (crash recovery)

- dependsOn: T-REC006-006, T-REC006-008
- files: cùng module ghi âm + nơi khởi tạo trang họp
- acceptance criteria (FR-009, AC-005 spec.md): khi mở app trên trạm mà IndexedDB còn bản ghi CHƯA upload xong của phiên trước, đề nghị Host phục hồi — luôn bắt đầu từ đoạn ghi đầu tiên, không bỏ sót đoạn nào (RISK-001).
- test requirement: Case có bản ghi dang dở → hiện đề nghị phục hồi đúng; case IndexedDB trống → không hiện gì.

---

## Phase 5 — FE: Upload + gửi mốc gán tên (điểm nối với BE)

### T-REC006-010 ✅ — Service gọi API mới

- dependsOn: T-REC006-005 (BE xong)
- files: `FE_SmarTracking/src/service/transcriptionServices.js` (sửa — thêm hàm mới, cạnh `uploadAudio` đã có)
- acceptance criteria: hàm `createOffsetSpeakerMarks(meetingId, sessionId, marks)` gọi đúng `POST /meetings/:meetingId/recording-sessions/:sessionId/speaker-marks`.
- test requirement: Không bắt buộc test riêng cho service call thuần (theo mức coverage hiện có của `transcriptionServices.js`).

### T-REC006-011 ✅ — Luồng "Dừng ghi" → upload → gửi mốc gán tên

- dependsOn: T-REC006-008, T-REC006-010
- files: module ghi âm (T-REC006-006) + component UI (T-REC006-012)
- acceptance criteria (FR-005 spec.md): sau khi `audio-upload` trả về `recordingSessionId` thành công, gọi NGAY `createOffsetSpeakerMarks` với các mốc đã thu thập (nếu có) kèm `recordingSessionId` vừa nhận — chỉ xoá dữ liệu IndexedDB sau khi CẢ HAI bước thành công (NFR-004 spec.md — giữ lại nếu upload thất bại để thử lại).
- test requirement: Case có mốc gán tên → gọi đúng thứ tự 2 API; case không có mốc nào → chỉ gọi `audio-upload`, không gọi API mốc gán tên (tránh request rỗng không cần thiết).

### T-REC006-012 ✅ — UI: nút Bắt đầu/Dừng ghi + nút gán tên trong lúc họp

- dependsOn: T-REC006-006, T-REC006-007
- files: `FE_SmarTracking/src/components/recording/StationRecorder.jsx` (mới, tên chính xác quyết định lúc code)
- acceptance criteria (FR-001, FR-007, FR-012 spec.md): UI tối thiểu gồm nút Bắt đầu/Dừng ghi, khu vực bấm gán tên người đang nói (chọn participant có sẵn của meeting, giống danh sách participant hiện có trong `InMeetingRoom.jsx`); IF trình duyệt từ chối quyền mic hoặc không hỗ trợ MediaRecorder/IndexedDB THEN báo lỗi rõ ràng và KHÔNG ẩn `AudioUploader.jsx` (luôn còn phương án dự phòng, FR-011/FR-012).
- test requirement: Case quyền mic bị từ chối → báo lỗi, `AudioUploader` vẫn hiển thị được.

---

## Phase 6 — FE: Điều kiện hiển thị theo phòng

### T-REC006-013 ✅ — Chỉ hiện `StationRecorder` khi `room.hasMicrophone = true`

- dependsOn: T-REC006-012
- files: trang họp nơi nhúng `StationRecorder` (vị trí chính xác — `InMeetingRoom.jsx` hoặc trang khác, quyết định lúc code theo actor nào cần thấy nút này, xem D-6 research.md: Host tự đăng nhập trên trạm)
- acceptance criteria (FR-010 spec.md): đọc `room.hasMicrophone` đã có sẵn trong response chi tiết meeting (`meetings.controller.ts:738`, không cần gọi API mới) để quyết định hiện/ẩn.
- test requirement: Case `hasMicrophone=true` → hiện; case `false`/thiếu → ẩn, không lỗi.

---

## Phase 7 — Verification / Smoke Test (bắt buộc trước khi coi feature DONE)

### T-REC006-014 — Smoke test RISK-001 (chunk webm nối đúng thứ tự)

- dependsOn: T-REC006-008
- files: N/A (kiểm thử tay trên trình duyệt thật của trạm, không phải code)
- acceptance criteria: ghi thử ≥10 phút trên Chrome/Edge thật với `timeslice` đã chọn → nối lại → file phát được, không hỏng, không mất tiếng đoạn nào.
- **Đây là gate bắt buộc** trước khi coi T-REC006-008/009 DONE — không được giả định đúng nếu chưa chạy tay.

### T-REC006-015 — Smoke test RISK-003 (HTTPS/quyền mic trên máy trạm thật)

- dependsOn: Không có (có thể làm sớm, song song BE)
- files: N/A
- acceptance criteria: xác nhận máy trạm truy cập app qua HTTPS (hoặc `localhost`), cấp quyền mic 1 lần, quyền được nhớ lại ở lần mở sau.

### T-REC006-016 — Đo dung lượng thật trên mic hội nghị sẽ dùng

- dependsOn: Không có
- files: N/A
- acceptance criteria: ghi thử ~60-90 phút bằng đúng loại mic hội nghị dự kiến lắp → xác nhận dung lượng file dưới `STORAGE_MAX_FILE_SIZE` hiện tại (500MB) — spec.md mục 1.5 "Dung lượng file thực tế".

---

## Dependencies & Execution Order

```text
BE:
T-REC006-001 (DTO) ──┬──► T-REC006-003 (service: đọc session/authz/validate)
T-REC006-002 (err code) ┘         │
                                   ▼
                          T-REC006-004 (ghi meeting_events — QUAN TRỌNG NHẤT, tagSource='post')
                                   │
                                   ▼
                          T-REC006-005 (controller — CẦN P-2/P-3 xác nhận trước)
                                   │
                        ◄──────────┘ (Checkpoint BE — test độc lập bằng Postman)

FE (song song với BE, gặp nhau ở T-REC006-011):
T-REC006-006 (MediaRecorder+IndexedDB) ──┬──► T-REC006-008 (nối đoạn) ──► T-REC006-009 (phục hồi)
                                          └──► T-REC006-007 (mốc gán tên)
T-REC006-005 ──► T-REC006-010 (service call) ──┐
T-REC006-008 + T-REC006-007 + T-REC006-010 ────┴──► T-REC006-011 (luồng dừng→upload→gửi mốc)
T-REC006-006 + T-REC006-007 ──► T-REC006-012 (UI) ──► T-REC006-013 (điều kiện hiện theo phòng)

Verification (chạy khi phần liên quan đã xong, KHÔNG được bỏ qua):
T-REC006-008 ──► T-REC006-014 (smoke RISK-001)
T-REC006-015, T-REC006-016 (độc lập, làm sớm nếu có điều kiện phần cứng)
```

**Điều kiện coi feature này DONE**: T-REC006-004 pass đủ test "không regression GIAI ĐOẠN 2" + toàn bộ test `speaker-mapping.service.spec.ts` cũ vẫn PASS 100% + build/lint/test BE xanh + T-REC006-014/015/016 (smoke test) đã chạy tay và đạt + FE luôn còn đường lùi về `AudioUploader.jsx` nếu ghi trực tiếp thất bại (FR-011/FR-012, không có lối nào khiến Host "kẹt" không upload được audio).

---

> Trạng thái: **CHỜ DUYỆT**. Chưa có dòng code nào được viết. Dừng lại đúng ở đây theo yêu cầu của Thiếu Chủ — chờ xác nhận P-1/P-2/P-3 (plan.md mục 6) và đồng ý bắt đầu implement trước khi chuyển sang code Phase 1.
