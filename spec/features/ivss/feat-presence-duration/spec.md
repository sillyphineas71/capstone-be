# IPD-001 — IVSS per-person duration + timeline (#41 duration + #42 entry/exit timeline)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo spec IPD-001 (#41+#42): session-builder dùng chung dựng present-segments từ iot_device_events (ivss_face_event) → #41 duration (interval/approx) + #42 timeline (segments+rawlog). READ-ONLY. RECON code thật. OQ chờ chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa plan/tasks/code. **READ-ONLY thuần** (không mutate). Tiêu thụ event IPI-001 (#38+#39, đã commit). KHÔNG report file (#43), KHÔNG WS (#40).

---

## 0. RECON findings (đọc CODE THẬT)

### 0.1. Query iot_device_events — pattern + đào jsonb
[stranger-alert.service.ts:156-170](../../../../src/modules/face-access/services/stranger-alert.service.ts) + [unmapped-review.service.ts:60-79](../../../../src/modules/face-access/services/unmapped-review.service.ts): `this.dataSource.manager.query(\`SELECT … FROM iot_device_events e WHERE e.event_type = '…' AND e.created_at >= … \`, [params])` — **bind tham số** (SEC-03), lọc `event_type` cụ thể. Đào jsonb: `e.payload_json->'extracted_fields'->>'stranger_id'`.
- ⇒ IPD-001 payload IPI-001 là **flat** (không `extracted_fields`): dùng `e.payload_json->>'userId'`, `e.payload_json->>'direction'`, `e.payload_json->>'matchState'`, `e.payload_json->>'szUid'`, `e.payload_json->>'similarity'`. Lọc `event_type='ivss_face_event'` + `meeting_id=$1` (+ optional `payload_json->>'userId'=$2`). `ORDER BY e.event_time ASC`. **KHÔNG select imageBase64** (IPI-001 không lưu — SEC-01 an toàn sẵn).

### 0.2. Endpoint admin-gated (mirror)
[stranger-alert.controller.ts](../../../../src/modules/face-access/controllers/stranger-alert.controller.ts): `@Controller('…')` + `@Get()` + `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + `@Permissions('…')` + `@UsePipes(new ValidationPipe({whitelist:true, transform:true}))` + query DTO → envelope `{ success, message, data, meta? }`. Mock `Permissions`/`MockPermissionsGuard` decorator nhất quán (eslint-disable header). Mirror nguyên.

### 0.3. Participant + tên hiển thị
`meeting_participants.user_id` (đã dùng #37). `users.full_name` ([user.entity.ts:55](../../../../src/modules/accounts/entities/user.entity.ts)) cho hiển thị. → per-meeting endpoint: lấy participants → builder mỗi user → JOIN full_name.

### 0.4. Thời gian (bound timeline + ratio)
`meetings.start_time`/`end_time` (tstz, NOT NULL); `actual_start_time`/`actual_end_time` (tstz, nullable) ([meeting.entity.ts:103-112](../../../../src/modules/meetings/entities/meeting.entity.ts)). `iot_device_events.event_time` tstz (có utc-fallback IPI-001). Bound: dùng `[start_time, end_time]` (hoặc actual nếu có — OQ). meeting-length cho presentRatio (OQ-7).

### 0.5. Interval util — KHÔNG có lib
Grep package.json: **không** date-fns/dayjs/moment/luxon. ⇒ interval-merge/duration **tự code thủ công** (sort theo event_time → dựng segment → Σ ms). Đơn giản, không thêm dependency.

---

## 1. Scope #41 + #42 (READ-ONLY)
1. **Session builder (core)** dùng chung: `(meetingId, userId?)` → đọc `iot_device_events` (ivss_face_event + meeting + optional user, matched) → sort `event_time` → dựng **present-segments** defensive theo direction.
2. **#41 duration**: `Σ segment-length` (method `interval`) hoặc `first→last seen` (method `approx`) + cờ `method`.
3. **#42 timeline**: `segments [{start,end,state:'present'}]` + `absent-gaps` + **event log thô** (rows gốc, debug).
4. **Endpoint(s)** đọc admin-gated → JSON.

KHÔNG thuộc: report file (#43), WS (#40), mutate gì.

## 2. Session builder (1 nguồn — #41 & #42 không lệch)
`buildSession(meetingId, userId) → { segments: Segment[], duration: { ms, method }, eventLog: RawEvent[], presentRatio? }`:
- Đọc events (matched, sort event_time ASC).
- **Phân loại chuỗi (OQ-2)**: nếu direction tạo chuỗi enter/leave **hợp lệ** → **interval segments** (method `interval`). Chuỗi rối / chỉ `seen` → **gap-cluster** (gộp event cách ≤ gap-threshold thành 1 present-segment) → method `approx` (hoặc `interval` nếu cluster rõ — chốt OQ).
- `duration.ms = Σ (seg.end - seg.start)` (interval) hoặc `last.event_time - first.event_time` (approx fallback nếu 0/1 segment).
- `eventLog` = rows thô (event_time, direction, matchState, similarity, szUid — KHÔNG ảnh).
- `presentRatio` (OQ-7) = `duration.ms / meetingLengthMs` (clamp ≤ 1).

## 3. #41 Duration (2 tầng)
- **(a) interval**: có cặp enter/leave hợp lệ → Σ [enter,leave]. `method:'interval'`.
- **(b) approx**: chỉ `seen` / thiếu cặp → `first→last seen`. `method:'approx'`.
- Mỗi kết quả **ghi rõ `method`** + (OQ) `confidence`/`segmentCount`. Output: `{ userId, fullName, durationMs, durationHuman?, method, segmentCount }`.

## 4. #42 Timeline
- `segments: [{ start, end, state:'present', source:'interval'|'cluster' }]` (đầu ra chính).
- `absentGaps: [{ start, end }]` (khoảng giữa các present-segment trong bound meeting).
- `events: [{ at, direction, matchState, similarity }]` (log thô nền debug — KHÔNG ảnh, SEC).
- Bound timeline theo meeting `[start,end]` (segment hở → đóng theo OQ-3).

## 5. Endpoint(s) (OQ-4) — admin-gated
Đề xuất **2**:
- `GET /api/v1/ivss/meetings/:meetingId/presence/:userId` → builder 1 người → `{ duration(#41), timeline(#42) }`.
- `GET /api/v1/ivss/meetings/:meetingId/presence` → mọi participant → `[{ userId, fullName, durationMs, method, segmentCount }]` (gọi builder từng người; timeline chi tiết để endpoint per-user).
- Guard `JwtAuthGuard + MockPermissionsGuard`, `@Permissions('ivss.presence.read')`, ValidationPipe per-route, envelope `{success,message,data}`. SEC-02 admin-only.

## 6. gap-threshold + bounds config (OQ-5)
`ivss.presence.gap_threshold_seconds` — đề xuất `system_configs` (tunable sau khi biết event thật; mirror reader IPI-001 channel-map / NoShowConfig precedence). Default vd 120s. (Cân nhắc thêm `ivss.presence.bound_source = scheduled|actual`.)

## 7. Defensive design
- Chuỗi rối (2 enter liên tiếp / leave không enter) → KHÔNG vỡ: rơi xuống gap-cluster approx (OQ-2).
- Segment hở (enter không leave) → đóng theo OQ-3 (meeting end / last-seen / now).
- `utcFallback` event (IPI-001) → vẫn dùng `event_time` (đã là now-fallback); cân nhắc đánh dấu `lowConfidence` nếu nhiều fallback (OQ).
- 0 event → duration 0, segments rỗng, method `approx` (hoặc `none`).
- unmatched event (matchState≠matched) → KHÔNG vào builder chính (OQ-6); có thể đếm riêng `unmatchedCount`.

## 8. Test (mock DataSource feed chuỗi event giả — KHÔNG thiết bị)
- **enter/leave sạch**: [enter t0, leave t1, enter t2, leave t3] → duration = (t1-t0)+(t3-t2), method `interval`, 2 segments.
- **chỉ-seen**: [seen, seen, seen] cách nhau ≤ threshold → 1 segment cluster, method `approx`, duration ≈ first→last.
- **chuỗi rối**: [enter, enter, leave] → defensive (không âm, không vỡ) → approx hoặc interval-best-effort.
- **hở**: [enter, (không leave)] → đóng theo OQ-3.
- **gap > threshold** giữa seen → 2 segments (đã rời giữa chừng).
- assert: durationMs, segments (start/end/state), method flag, presentRatio; SEC eventLog KHÔNG ảnh; bind tham số (query chứa `event_type='ivss_face_event'` + `meeting_id`).
- Coverage ≥80% builder service.

## 9. Constitution
- **SEC-02**: endpoint admin-gated (JwtAuthGuard + PermissionsGuard).
- **SEC-03**: bind tham số mọi raw SQL; KHÔNG nội suy meetingId/userId vào chuỗi.
- **SEC-01**: KHÔNG trả imageBase64 (IPI-001 không lưu); eventLog chỉ metadata.
- **ARCH-01**: **READ-ONLY** — KHÔNG mutate, KHÔNG đụng occupancy/no-show/early-vacancy/presence_snapshots; chỉ đọc `iot_device_events` (lọc `event_type='ivss_face_event'` → không nhiễm). KHÔNG NetSDK.
- **DATA-01**: no-migration (thuần đọc).

## 10. OPEN QUESTIONS (chốt trước plan/tasks)
- **OQ-1 (crux) gộp segment**: cặp enter/leave rõ → 1 segment; `seen` rời rạc → gộp các seen cách ≤ **gap-threshold** thành 1 present-segment, > threshold = đã rời. Threshold từ `system_configs` (OQ-5). Xác nhận thuật toán cluster + cách trộn khi vừa có enter/leave vừa có seen (ưu tiên interval, seen lấp khoảng?).
- **OQ-2 direction "hợp lệ"**: định nghĩa chuỗi hợp lệ = enter trước leave, **xen kẽ** (enter,leave,enter,leave…), không 2 enter liên tiếp / leave-không-enter. Hợp lệ → interval; rối → approx/seen-based. Đề xuất defensive (rối → approx). Xác nhận.
- **OQ-3 segment hở** (enter không leave): đóng tại **meeting end** (nếu đã kết thúc) / **now** (nếu đang diễn ra) / **last-seen**? Đề xuất: đang diễn ra → `now` (clamp ≤ end); đã kết thúc → `end_time`. Xác nhận.
- **OQ-4 endpoint scope**: **cả hai** (per-(meeting,user) chi tiết timeline + per-meeting summary mọi participant) [đề xuất]. Xác nhận.
- **OQ-5 gap-threshold + bounds**: `system_configs['ivss.presence.gap_threshold_seconds']` (default 120) [đề xuất] vs const. Bound source `scheduled` (start/end) vs `actual` (actual_start/end nếu có)? Đề xuất scheduled v1.
- **OQ-6 unmatched/approx**: chỉ `matchState='matched'` vào builder chính [đề xuất]; unmatched đếm riêng (`unmatchedCount`), KHÔNG tính duration. Xác nhận.
- **OQ-7 presentRatio**: tính `duration/meeting-length` sẵn (rẻ, cho #43) [đề xuất]. Xác nhận (+ clamp ≤ 1; dùng bound nào theo OQ-5).

## 11. Residuals / known-gaps
- **Live-runbook (số liệu đúng/sai chỉ biết khi thiết bị thật)**: duration/segments phụ thuộc (a) **eventAction thật** (direction enter/leave — IPI-001 còn defensive đoán) → nếu direction sai, builder rơi xuống approx; (b) **channel-map thật** (room resolve đúng thì meeting_id mới đúng → event mới vào đúng meeting); (c) tần suất event bridge gửi (gap-threshold phải khớp nhịp thật).
- `method:'approx'` là **xấp xỉ** — không phải thời lượng chính xác; UI/#43 phải hiển thị rõ cờ method.
- utc-fallback nhiều → timeline lệch; cân nhắc cờ lowConfidence (OQ).
- Event trùng (IPI-001 OQ-6 chấp nhận trùng) → builder cần DISTINCT/idempotent theo (event_time,direction) nếu trùng làm sai cluster — ghi gap.
- presentRatio > 1 nếu event ngoài bound (clamp).
- Không xử multi-room 1 người trong cùng meeting (giả định 1 meeting = 1 room).

> **STOP.** Spec-only. Chờ Thiếu Chủ review + chốt OQ-1…OQ-7 trước khi plan/tasks.
