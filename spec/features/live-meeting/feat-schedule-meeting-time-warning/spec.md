# Feature Specification: Lập lịch cảnh báo thời gian còn lại (Schedule Meeting Time Warning)

- **Feature ID**: UC-IMM-12
- **Feature Name**: Lập lịch cảnh báo thời gian còn lại
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-19
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md — Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md
  - Spec UC-IMM-01 (feat-start-meeting-session)
  - Spec UC-IMM-02 (feat-request-meeting-extension)
  - Spec UC-IMM-03 (feat-process-meeting-extension-request)
  - Spec UC-IMM-05 (feat-end-meeting-session)
  - Use Case nhập từ user: UC-IMM-12

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo spec lần đầu cho UC-IMM-12 Lập lịch cảnh báo thời gian còn lại | Toàn bộ file |
| 2026-06-19 | Cập nhật sau clarification Q1–Q5: AF2 dùng remainingMinutes thay duration, guard 60s buffer, enqueue non-blocking + BullMQ job options retry, best-effort + known limitation Outbox, skip case không tạo background_jobs chỉ ghi warning_scheduling_skipped event | Sections 1.2, 1.4, 3.1 FR-10/FR-12/FR-15/FR-17, 3.6 FR-19/FR-20, 4.2 NFR-05, 4.3 NFR-06/NFR-07, 5 BR4, 6.2, 6.4, 8.3 ERR-06/ERR-07, 9 Scenario 3/5, 10 |

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này viết theo EARS.
Keyword EARS giữ nguyên bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

| Keyword | Vai trò |
|---|---|
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| `WHEN` | Trigger/event xảy ra tại một thời điểm |
| `WHILE` | Hành vi đúng trong suốt một trạng thái |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng UC-IMM-12 thuộc nhóm In-Meeting Management, module `live-meeting`.

Sau khi phiên họp chuyển sang trạng thái `in_progress` (UC-IMM-01), hệ thống cần chủ động lập lịch một cơ chế cảnh báo sắp hết giờ để thông báo cho participants trước khi cuộc họp kết thúc. Cơ chế này cũng phải được cập nhật lại mỗi khi `meetings.end_time` thay đổi do gia hạn được duyệt (UC-IMM-03).

Hiện tại hệ thống chưa có cơ chế lập lịch cảnh báo thời gian còn lại. Feature này đặt nền tảng cho UC-IMM-13 (gửi cảnh báo thực sự) nhưng bản thân **chỉ phụ trách phần scheduling** — enqueue BullMQ delayed job và ghi nhận event — không tự gửi notification.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là:
- Sau khi phiên họp bắt đầu (`in_progress`), tự động tính thời điểm cảnh báo và enqueue một BullMQ delayed job sẽ kích hoạt ở đúng thời điểm đó.
- Khi `end_time` thay đổi (do gia hạn), hủy job cũ và lập lịch lại job mới với thời điểm cảnh báo được cập nhật.
- Khi meeting kết thúc sớm thủ công (UC-IMM-05), hủy hoàn toàn job để tránh cảnh báo giả.
- Khi thời gian còn lại không đủ để dùng config threshold, tự điều chỉnh dựa trên `remainingMinutes = end_time - now()` (AF2).
- Khi `warningScheduledAt ≤ now() + 60s` (quá gần để schedule có ý nghĩa), bỏ qua lập lịch và ghi event `warning_scheduling_skipped` để traceability, không tạo `background_jobs`.
- Ghi nhận `meeting_events` tương ứng sau mỗi kết quả scheduling.

### 1.3 Giá trị mang lại

- **Participants và Host**: Nhận được cảnh báo đúng thời điểm trước khi hết giờ, giúp chủ động kết thúc hoặc xin gia hạn.
- **Hệ thống**: Đảm bảo warning job luôn phản ánh đúng `end_time` hiện tại của meeting, kể cả sau gia hạn.
- **Vận hành**: Tránh tình trạng cảnh báo giả sau khi meeting đã được kết thúc thủ công.

### 1.4 Giả định

- BullMQ đã được cấu hình trong hệ thống (queue `live-meeting` hoặc tương đương).
- `system_configs` table đã có key `meeting_warning_before_minutes` với giá trị mặc định là `10` (phút).
- Server time là nguồn thời gian duy nhất; không dùng client time.
- UC-IMM-13 (UC-106) sẽ xử lý việc gửi notification thực sự khi BullMQ job được kích hoạt. Feature này **không** gửi notification.
- BullMQ `jobId` được dùng để dedupe: mỗi meeting chỉ có tối đa 1 warning job active tại một thời điểm.
- Retry khi job **execution** gặp lỗi được quản lý bởi BullMQ job options (`attempts`, `backoff`) — không phải application-level retry. Enqueue failure là non-blocking: log + continue.
- Consistency giữa BullMQ queue và bảng `background_jobs` là **best-effort**. Outbox Pattern không được áp dụng (known limitation — xem Out of Scope mục 10).

### 1.5 Cần làm rõ

Đã làm rõ và chốt quyết định ở các phần dưới. (Không còn câu hỏi mở.)

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| System / INTERNAL_SERVICE | Actor chính, toàn bộ logic chạy nội bộ | Không có HTTP actor trực tiếp cho UC-IMM-12 |
| live-meeting module | Trigger UC-IMM-12 sau UC-94 (start) và sau UC-97 (approve extension) | Gọi nội bộ, không qua HTTP endpoint riêng |
| BullMQ Queue | Nhận delayed job và kích hoạt job tại `warningScheduledAt` | Job processor thuộc UC-IMM-13 |

### 2.2 Role & Permission Rules

- UC-IMM-12 là **internal process** — không có HTTP endpoint riêng, không yêu cầu JWT user.
- Được trigger ngầm từ:
  - `POST /api/v1/live-meetings/{meetingId}/start` (UC-94 / UC-IMM-01) sau khi transaction commit thành công.
  - Logic xử lý approve extension trong UC-97 / UC-IMM-03 sau khi `meetings.end_time` được cập nhật.
  - `POST /api/v1/live-meetings/{meetingId}/end` (UC-98 / UC-IMM-05) để cancel job.

### 2.3 Actor Constraints

- Toàn bộ scheduling logic phải chạy **sau khi transaction của trigger UC đã commit** (best-effort sau commit, không chạy bên trong transaction chính của UC-94/UC-97/UC-98).
- Nếu enqueue BullMQ thất bại, hệ thống phải ghi log lỗi nhưng **không rollback** transaction UC trigger.

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-01: THE system SHALL đọc giá trị cấu hình `meeting_warning_before_minutes` từ bảng `system_configs` mỗi khi lập lịch warning job cho một meeting.

FR-02: THE system SHALL tính `warningScheduledAt = meetings.end_time - meeting_warning_before_minutes (phút)` làm giá trị khởi đầu.

FR-03: THE system SHALL enqueue một BullMQ delayed job với:
  - jobId = `meeting-time-warning:{meetingId}` (để dedupe/idempotency)
  - delay = warningScheduledAt - now() (ms, luôn dương vì skip guard đã lọc trước)
  - queue_name = `live-meeting-warnings` (hoặc giá trị được cấu hình)
  - payload chứa: meetingId, warningScheduledAt, endTime

FR-04: THE system SHALL ghi một bản ghi vào bảng `background_jobs` với:
  - job_type = `meeting_time_warning`
  - status = `scheduled`
  - scheduled_at = warningScheduledAt
  - related_entity_type = `meeting`
  - related_entity_id = meetingId
  - input_json = { meetingId, warningScheduledAt, endTime }
  - queue_name = `live-meeting-warnings`
  Lưu ý: background_jobs record chỉ được tạo khi enqueue thành công, KHÔNG tạo trong skip case.

FR-05: THE system SHALL tạo một bản ghi `meeting_events` với `event_type = warning_scheduled` sau khi enqueue BullMQ job thành công.
```

### 3.2 Event-driven Requirements

```text
FR-06: WHEN meeting chuyển sang trạng thái `in_progress` (UC-94 / UC-IMM-01), THE system SHALL trigger UC-IMM-12 để lập lịch warning job cho meeting đó.

FR-07: WHEN `meetings.end_time` thay đổi do extension được approved (UC-97 / UC-IMM-03 hoặc UC-IMM-02 auto-apply), THE system SHALL trigger UC-IMM-12 Alternative Flow AF1 để reset warning job.

FR-08: WHEN meeting kết thúc thủ công (UC-98 / UC-IMM-05), THE system SHALL trigger UC-IMM-12 Alternative Flow AF3 để hủy warning job.
```

### 3.3 State-driven Requirements

```text
FR-09: WHILE meeting đang ở trạng thái `in_progress`, THE system SHALL duy trì tối đa 1 warning job active (theo jobId dedupe) tại một thời điểm.

FR-10: WHILE `remainingMinutes` (= end_time - now()) nhỏ hơn hoặc bằng `meeting_warning_before_minutes`, THE system SHALL áp dụng AF2 để tính lại `warningScheduledAt` dựa trên thời gian còn lại thực tế, thay vì dùng config threshold cố định.
```

### 3.4 Alternative Flow Requirements

```text
FR-11: WHEN AF1 được trigger (sau approve extension hoặc auto-apply extension), THE system SHALL:
  1. Tìm và cancel BullMQ job cũ theo jobId `meeting-time-warning:{meetingId}`.
  2. Tính lại `warningScheduledAt` từ `end_time` mới (theo Normal Flow hoặc AF2 tùy remainingMinutes).
  3. Kiểm tra skip guard: nếu `warningScheduledAt ≤ now() + 60s`, ghi meeting_events type `warning_scheduling_skipped` và dừng.
  4. Nếu không skip: enqueue lại BullMQ job mới với cùng jobId.
  5. Upsert bản ghi `background_jobs` tương ứng.
  6. Tạo `meeting_events` với `event_type = warning_scheduled`.

FR-12: WHEN AF2 được trigger (remainingMinutes = end_time - now() ≤ meeting_warning_before_minutes), THE system SHALL:
  1. Tính `remainingMinutes = end_time - now()` (phút còn lại thực tế tại thời điểm trigger).
  2. Tính `adjustedWarningMinutes = floor(remainingMinutes / 2)`.
  3. Tính `warningScheduledAt = now() + adjustedWarningMinutes` (không dùng end_time - adjustedWarningMinutes).
  4. Tiếp tục áp dụng skip guard: nếu `warningScheduledAt ≤ now() + 60s`, chuyển sang skip flow (không enqueue, không tạo background_jobs).
  5. Nếu không skip: enqueue job bình thường.
  6. Ghi vào `background_jobs.input_json`: `{ ..., adjustedWarning: true, originalConfigMinutes: N, usedMinutes: M, remainingMinutes: R }`.

FR-13: WHEN AF3 được trigger (meeting kết thúc sớm thủ công), THE system SHALL:
  1. Tìm và remove hoàn toàn BullMQ job theo jobId `meeting-time-warning:{meetingId}` khỏi queue.
  2. Cập nhật bản ghi `background_jobs` tương ứng sang status = `cancelled` (nếu record tồn tại).
  3. Không tạo `meeting_events` mới cho hành động cancel này.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-14: IF `system_configs` không có key `meeting_warning_before_minutes`, THEN THE system SHALL dùng giá trị mặc định 10 phút và ghi log WARN.

FR-15: IF enqueue BullMQ job thất bại, THEN THE system SHALL ghi log ERROR chi tiết và tiếp tục (non-blocking). Transaction của UC trigger KHÔNG bị ảnh hưởng. Retry khi job execution là trách nhiệm của BullMQ job options, không phải application code.

FR-16: IF BullMQ job cũ không tồn tại khi AF1 cố gắng cancel, THEN THE system SHALL bỏ qua bước cancel và tiến hành enqueue job mới bình thường (idempotent behavior).

FR-17: IF `warningScheduledAt` được tính ra là nhỏ hơn hoặc bằng `now() + 60s` (quá gần hoặc đã qua, không còn ý nghĩa schedule), THEN THE system SHALL:
  - Không enqueue BullMQ job.
  - Không tạo bản ghi `background_jobs`.
  - Tạo `meeting_events` với `event_type = warning_scheduling_skipped`.
  - Ghi log WARN.
  - Kết thúc (không phải lỗi về UC trigger).

FR-18: IF meeting đã ở trạng thái `completed` hoặc `cancelled` tại thời điểm UC-IMM-12 được gọi, THEN THE system SHALL bỏ qua toàn bộ logic và ghi log WARN (guard check).
```

### 3.6 Workflow Requirements

```text
FR-19: WHEN UC-IMM-12 được trigger từ UC-94 (start meeting), THE system SHALL thực hiện tuần tự:
  1. Guard check: meeting status = in_progress, end_time không null.
  2. Đọc config `meeting_warning_before_minutes`.
  3. Tính `warningScheduledAt = end_time - configMinutes`.
  4. Kiểm tra AF2: nếu `remainingMinutes (= end_time - now()) ≤ configMinutes`, tính lại:
       warningScheduledAt = now() + floor(remainingMinutes / 2).
  5. Kiểm tra skip guard: nếu `warningScheduledAt ≤ now() + 60s`:
       → Ghi `meeting_events` type `warning_scheduling_skipped`.
       → Ghi log WARN.
       → Dừng (KHÔNG tạo background_jobs, KHÔNG enqueue).
  6. Enqueue BullMQ job với jobId dedupe.
  7. Upsert bản ghi `background_jobs`.
  8. Ghi `meeting_events` type `warning_scheduled`.
  9. Ghi log INFO (không blocking).

FR-20: WHEN UC-IMM-12 AF1 được trigger từ UC-97 hoặc UC-IMM-02 auto-apply (end_time thay đổi), THE system SHALL thực hiện tuần tự:
  1. Guard check: meeting status = in_progress.
  2. Cancel BullMQ job cũ theo jobId (bỏ qua nếu không tìm thấy).
  3. Đọc config `meeting_warning_before_minutes`.
  4. Tính `warningScheduledAt = end_time (mới) - configMinutes`.
  5. Kiểm tra AF2: nếu `remainingMinutes (= end_time mới - now()) ≤ configMinutes`, tính lại:
       warningScheduledAt = now() + floor(remainingMinutes / 2).
  6. Kiểm tra skip guard: nếu `warningScheduledAt ≤ now() + 60s`:
       → Ghi `meeting_events` type `warning_scheduling_skipped`.
       → Ghi log WARN.
       → Dừng (KHÔNG tạo/upsert background_jobs, KHÔNG enqueue).
  7. Enqueue lại BullMQ job mới.
  8. Upsert bản ghi `background_jobs`.
  9. Ghi `meeting_events` type `warning_scheduled`.
```

### 3.7 Data & State Requirements

```text
FR-21: WHEN warning job được enqueue thành công, THE system SHALL ghi `background_jobs.status = scheduled` và `background_jobs.scheduled_at = warningScheduledAt`.

FR-22: WHEN warning job bị cancel (AF3), THE system SHALL cập nhật `background_jobs.status = cancelled` nếu record tồn tại.

FR-23: WHEN warning job được re-enqueue (AF1), THE system SHALL upsert bản ghi `background_jobs` hiện có: cập nhật `scheduled_at`, `status = scheduled`, `input_json` với end_time mới.
```

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-01: THE system SHALL hoàn thành toàn bộ logic scheduling (đọc config, tính thời gian, enqueue BullMQ, ghi DB) trong vòng 500ms sau khi được trigger.

NFR-02: THE system SHALL không block response của UC-94 (start meeting) khi thực hiện warning scheduling; logic này chạy best-effort sau khi transaction của UC-94 đã commit.
```

### 4.2 Reliability & Idempotency

```text
NFR-03: THE system SHALL đảm bảo tính idempotency bằng cách dùng `jobId = meeting-time-warning:{meetingId}`: mỗi meeting chỉ có tối đa 1 warning job active tại một thời điểm, ngay cả khi UC-IMM-12 bị gọi nhiều lần liên tiếp.

NFR-04: THE system SHALL không để cảnh báo giả phát ra sau khi meeting đã `completed` hoặc `cancelled` (job phải bị cancel trước khi fired — xem AF3/BR2).

NFR-05: THE system SHALL xử lý enqueue BullMQ theo cách non-blocking: enqueue failure không được block UC trigger hoặc ném exception lên caller. Retry khi job **execution** gặp lỗi được cấu hình qua BullMQ job options (`attempts`, `backoff`) — không phải application-level retry logic. Enqueue failure → ghi log ERROR + continue.
```

### 4.3 Consistency

```text
NFR-06: THE system SHALL cố gắng đảm bảo `background_jobs.scheduled_at` phản ánh đúng `warningScheduledAt` đã enqueue vào BullMQ. Tuy nhiên, consistency giữa DB và queue là best-effort — Outbox Pattern không được áp dụng (xem Known Limitations trong Out of Scope mục 10).

NFR-07: THE system SHALL không ghi `meeting_events` type `warning_scheduled` nếu enqueue BullMQ thất bại, để tránh sự kiện giả trong timeline. Khi enqueue thất bại: chỉ ghi log lỗi, không tạo bất kỳ event hoặc background_jobs record nào.
```

### 4.4 Observability

```text
NFR-08: THE system SHALL ghi log đủ thông tin tại mỗi bước quan trọng: trigger source (start/extension/end), meetingId, warningScheduledAt được tính, AF2 có được áp dụng không, skip guard có kích hoạt không, BullMQ enqueue result.

NFR-09: THE system SHALL log WARN khi AF2 được áp dụng, ghi rõ `originalConfigMinutes`, `remainingMinutes`, và `usedMinutes`.
```

---

## 5. Business Rules

```text
BR1: Warning job phải được reset (cancel + re-enqueue) ngay lập tức mỗi khi `meetings.end_time` thay đổi. Không được để job cũ tiếp tục tồn tại với end_time không còn hợp lệ.

BR2: Nếu meeting bị kết thúc thủ công (UC-IMM-05) trước thời điểm warning job fired, warning job BẮT BUỘC phải bị cancel để tránh cảnh báo giả sau khi meeting đã `completed`.

BR3: Dedupe bằng `jobId = meeting-time-warning:{meetingId}` trong BullMQ. Mọi logic enqueue/cancel đều phải dùng jobId này. Đây là cơ chế idempotency chính của feature.

BR4: `warningScheduledAt` phải cách thời điểm hiện tại hơn 60 giây (`warningScheduledAt > now() + 60s`) thì mới được enqueue. Nếu `warningScheduledAt ≤ now() + 60s`, skip toàn bộ: không enqueue, không tạo `background_jobs`, chỉ ghi `meeting_events` type `warning_scheduling_skipped` (xem FR-17).

BR5: Giá trị `meeting_warning_before_minutes` từ `system_configs` được đọc tại thời điểm enqueue, không cache lâu dài. Mỗi lần trigger UC-IMM-12 phải đọc lại từ DB.

BR6: AF2 dùng `remainingMinutes = end_time - now()` (thời gian thực tế còn lại), không dùng tổng thời lượng họp (`end_time - start_time`). Điều này đảm bảo cảnh báo đúng ngay cả khi meeting đã bắt đầu muộn hoặc bị trigger lại giữa chừng.
```

---

## 6. Data Model

### 6.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng |
|---|---|
| `meetings` | Nguồn dữ liệu: đọc `end_time`, `status`, `actual_start_time` để tính `warningScheduledAt` và guard check |
| `background_jobs` | Lưu metadata của warning job khi enqueue thành công. Không tạo record trong skip case. |
| `system_configs` | Đọc `config_value` của key `meeting_warning_before_minutes` (default: 10) |
| `meeting_events` | Ghi timeline event: `warning_scheduled` (enqueue thành công) hoặc `warning_scheduling_skipped` (skip guard) |

### 6.2 Mapping field `background_jobs`

| Field | Giá trị |
|---|---|
| `job_type` | `meeting_time_warning` |
| `status` | `scheduled` (sau enqueue), `cancelled` (sau AF3), `completed` (sau job fired — cập nhật bởi UC-IMM-13) |
| `scheduled_at` | `warningScheduledAt` (timestamptz) |
| `related_entity_type` | `meeting` |
| `related_entity_id` | `meetingId` (UUID) |
| `queue_name` | `live-meeting-warnings` |
| `input_json` — Normal | `{ meetingId, warningScheduledAt, endTime }` |
| `input_json` — AF2 | `{ meetingId, warningScheduledAt, endTime, adjustedWarning: true, originalConfigMinutes: N, usedMinutes: M, remainingMinutes: R }` |

> **Lưu ý:** Bản ghi `background_jobs` **không được tạo** trong skip case (`warningScheduledAt ≤ now() + 60s`). Khi skip, chỉ có `meeting_events` type `warning_scheduling_skipped` được ghi.

### 6.3 Mapping field `system_configs`

| Field | Giá trị |
|---|---|
| `config_key` | `meeting_warning_before_minutes` |
| `config_value` | String số nguyên, ví dụ `"10"`. Parse sang integer khi dùng. |

### 6.4 Mapping field `meeting_events`

| Trường hợp | `event_type` | Ghi chú |
|---|---|---|
| Enqueue thành công (Normal / AF2) | `warning_scheduled` | Tạo sau khi BullMQ enqueue thành công |
| Skip guard kích hoạt (FR-17) | `warning_scheduling_skipped` | Tạo thay cho `warning_scheduled`; không có background_jobs tương ứng |

Các field chung:

| Field | Giá trị |
|---|---|
| `meeting_id` | `meetingId` |
| `event_time` | `now()` tại thời điểm xử lý |
| `metadata_json` | `{ warningScheduledAt, endTime, jobId, adjustedWarning?, remainingMinutes?, skipReason? }` (nếu schema hỗ trợ) |

### 6.5 BullMQ Job Schema

| Field | Giá trị |
|---|---|
| `jobId` | `meeting-time-warning:{meetingId}` |
| `queue` | `live-meeting-warnings` |
| `delay` | `warningScheduledAt - now()` ms (luôn dương vì skip guard đã lọc) |
| `data` | `{ meetingId, warningScheduledAt, endTime }` |
| `opts.attempts` | Cấu hình theo BullMQ job options (không phải application retry) |
| `opts.backoff` | Cấu hình theo BullMQ job options |

### 6.6 Dữ liệu đầu ra (không có HTTP response riêng)

UC-IMM-12 là internal process. Kết quả được phản ánh qua:
- `background_jobs` record được tạo/upsert (chỉ khi enqueue thành công, không phải skip case).
- `meeting_events` record mới (`warning_scheduled` hoặc `warning_scheduling_skipped`).
- Response của UC-94 (start meeting) trả thêm field `warningScheduledAt` nếu enqueue thành công, hoặc `warningSkipped: true` nếu skip.

---

## 7. Dependencies

### 7.1 Upstream dependencies (phải hoàn thành trước)

| Feature / UC | Lý do phụ thuộc |
|---|---|
| UC-94 / UC-IMM-01 (feat-start-meeting-session) | Cung cấp trigger chính: meeting chuyển sang `in_progress` → UC-IMM-12 được gọi sau khi commit |
| UC-97 / UC-IMM-03 (feat-process-meeting-extension-request) | Cung cấp trigger AF1: sau khi approve extension cập nhật `meetings.end_time` → UC-IMM-12 AF1 được gọi |
| UC-98 / UC-IMM-05 (feat-end-meeting-session) | Cung cấp trigger AF3: khi meeting kết thúc thủ công → UC-IMM-12 AF3 được gọi để cancel job |
| feat-request-meeting-extension (UC-IMM-02) | UC-IMM-02 có thể auto-apply extension (không cần UC-IMM-03), trường hợp này cũng cập nhật `meetings.end_time` và cần trigger UC-IMM-12 AF1 |

### 7.2 Downstream dependencies

| Feature / UC | Lý do phụ thuộc |
|---|---|
| UC-IMM-13 / UC-106 (Send Meeting Time Warning Notification) | Consumer của BullMQ job mà UC-IMM-12 enqueue. UC-IMM-13 là feature thực sự gửi notification — KHÔNG thuộc scope của UC-IMM-12. |

### 7.3 Infrastructure dependencies

| Infrastructure | Lý do phụ thuộc |
|---|---|
| BullMQ + Redis | Queue backend để enqueue và schedule delayed job |
| PostgreSQL | Lưu `background_jobs`, đọc `system_configs`, ghi `meeting_events` |

---

## 8. Error Handling

### 8.1 Configuration Errors

```text
ERR-01: IF `system_configs` không có key `meeting_warning_before_minutes`, THEN THE system SHALL dùng default 10 phút và ghi log WARN.

ERR-02: IF `config_value` của `meeting_warning_before_minutes` không parse được thành integer dương, THEN THE system SHALL dùng default 10 phút và ghi log ERROR.
```

### 8.2 Guard / State Errors

```text
ERR-03: IF meeting không tồn tại tại thời điểm UC-IMM-12 chạy, THEN THE system SHALL ghi log ERROR và dừng (no-op).

ERR-04: IF meeting.status không phải `in_progress` tại thời điểm UC-IMM-12 chạy (trừ AF3), THEN THE system SHALL bỏ qua và ghi log WARN.

ERR-05: IF meeting.end_time là null, THEN THE system SHALL bỏ qua và ghi log WARN.
```

### 8.3 Scheduling Errors

```text
ERR-06: IF `warningScheduledAt` ≤ `now() + 60s` (skip guard), THEN THE system SHALL:
  - Không enqueue BullMQ job.
  - Không tạo `background_jobs` record.
  - Tạo `meeting_events` với `event_type = warning_scheduling_skipped`.
  - Ghi log WARN với meetingId, warningScheduledAt, và lý do skip.
  - Kết thúc bình thường (không phải lỗi về UC trigger).

ERR-07: IF enqueue BullMQ thất bại, THEN THE system SHALL ghi log ERROR với meetingId và warningScheduledAt, KHÔNG ghi `meeting_events`, và tiếp tục (non-blocking). KHÔNG ảnh hưởng transaction của UC trigger. Retry khi job execution là trách nhiệm của BullMQ job options.

ERR-08: IF ghi `background_jobs` thất bại sau khi BullMQ enqueue thành công, THEN THE system SHALL ghi log ERROR. BullMQ job đã được enqueue vẫn giữ nguyên (best-effort inconsistency — known limitation).

ERR-09: IF ghi `meeting_events` thất bại, THEN THE system SHALL ghi log ERROR. BullMQ job và `background_jobs` đã được ghi vẫn giữ nguyên (eventually consistent).
```

### 8.4 Cancel Errors (AF3)

```text
ERR-10: IF BullMQ job không tìm thấy khi AF3 cố gắng remove (job đã fired hoặc chưa được enqueue), THEN THE system SHALL bỏ qua và ghi log INFO (idempotent).

ERR-11: IF cập nhật `background_jobs.status = cancelled` thất bại, THEN THE system SHALL ghi log ERROR (không blocking).
```

---

## 9. Acceptance Criteria

### Scenario 1 — Happy path: meeting bắt đầu, warning được lập lịch đúng

```gherkin
Given  một meeting `scheduled` với end_time = 14:00, now = 13:00 (remainingMinutes = 60 phút)
  And  system_configs.meeting_warning_before_minutes = 10
When   Host bắt đầu phiên họp (UC-IMM-01), meeting chuyển sang `in_progress`
  And  UC-IMM-12 được trigger sau khi transaction commit
Then   remainingMinutes (60) > configMinutes (10) → Normal Flow
  And  warningScheduledAt được tính = 14:00 - 10 phút = 13:50
  And  warningScheduledAt (13:50) > now() + 60s (13:01) → skip guard KHÔNG kích hoạt
  And  BullMQ job được enqueue với jobId = `meeting-time-warning:{meetingId}` và delay tương ứng
  And  background_jobs record được tạo với job_type=meeting_time_warning, status=scheduled, scheduled_at=13:50
  And  meeting_events record được tạo với event_type=warning_scheduled
  And  response của UC-IMM-01 trả về field warningScheduledAt = 13:50
```

### Scenario 2 — AF1: warning được lập lịch lại sau khi gia hạn được duyệt

```gherkin
Given  một meeting `in_progress` với end_time = 14:00, now = 13:40
  And  warning job đang active với warningScheduledAt = 13:50, jobId = `meeting-time-warning:{meetingId}`
  And  system_configs.meeting_warning_before_minutes = 10
When   Manager approve extension request, end_time được cập nhật thành 14:30
  And  UC-IMM-12 AF1 được trigger
Then   BullMQ job cũ (jobId = `meeting-time-warning:{meetingId}`) bị cancel/remove
  And  remainingMinutes (= 14:30 - 13:40 = 50 phút) > configMinutes (10) → Normal Flow
  And  warningScheduledAt mới = 14:30 - 10 phút = 14:20
  And  warningScheduledAt (14:20) > now() + 60s (13:41) → skip guard KHÔNG kích hoạt
  And  BullMQ job mới được enqueue với cùng jobId và delay tương ứng với 14:20
  And  background_jobs record được upsert với scheduled_at = 14:20, status = scheduled
  And  meeting_events record mới được tạo với event_type=warning_scheduled
```

### Scenario 3 — AF2: remainingMinutes ngắn hơn warning threshold

```gherkin
Given  một meeting `in_progress` với end_time = 14:08, now = 14:00 (remainingMinutes = 8 phút)
  And  system_configs.meeting_warning_before_minutes = 10
When   UC-IMM-12 được trigger (ví dụ meeting bắt đầu muộn)
Then   remainingMinutes (8) ≤ configMinutes (10) → AF2 kích hoạt
  And  adjustedWarningMinutes = floor(8 / 2) = 4 phút
  And  warningScheduledAt = now() + 4 phút = 14:04
  And  warningScheduledAt (14:04) > now() + 60s (14:01) → skip guard KHÔNG kích hoạt
  And  BullMQ job được enqueue với delay tương ứng (4 phút)
  And  background_jobs record được tạo với input_json chứa:
         { adjustedWarning: true, originalConfigMinutes: 10, usedMinutes: 4, remainingMinutes: 8 }
  And  meeting_events record được tạo với event_type=warning_scheduled
```

### Scenario 4 — AF3: meeting kết thúc sớm, warning job bị cancel

```gherkin
Given  một meeting `in_progress` với end_time = 14:00
  And  warning job đang active với warningScheduledAt = 13:50, jobId = `meeting-time-warning:{meetingId}`
When   Host kết thúc meeting thủ công lúc 13:45 (UC-IMM-05)
  And  UC-IMM-12 AF3 được trigger sau khi transaction commit của UC-IMM-05
Then   BullMQ job với jobId = `meeting-time-warning:{meetingId}` bị remove khỏi queue
  And  background_jobs record được cập nhật status = cancelled
  And  KHÔNG có meeting_events mới được tạo cho hành động cancel này
  And  KHÔNG có cảnh báo giả nào được gửi sau khi meeting đã completed
```

### Scenario 5 — Skip guard: warningScheduledAt quá gần now()

```gherkin
Given  một meeting `in_progress` với end_time = T+2 phút, now = T
  And  system_configs.meeting_warning_before_minutes = 10
When   UC-IMM-12 được trigger
Then   remainingMinutes (2) ≤ configMinutes (10) → AF2 kích hoạt
  And  adjustedWarningMinutes = floor(2 / 2) = 1 phút
  And  warningScheduledAt = now() + 1 phút = T + 60s
  And  warningScheduledAt (T + 60s) ≤ now() + 60s (T + 60s) → skip guard kích hoạt
  And  hệ thống KHÔNG enqueue BullMQ job
  And  KHÔNG có background_jobs record được tạo
  And  meeting_events record được tạo với event_type = warning_scheduling_skipped
  And  hệ thống ghi log WARN với meetingId và lý do skip
  And  KHÔNG có lỗi được ném về UC trigger
```

---

## 10. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature UC-IMM-12:

- **Gửi notification thực sự cho participants** — đây là trách nhiệm của UC-IMM-13 (UC-106, feat-send-meeting-time-warning-notification). UC-IMM-12 chỉ enqueue job; UC-IMM-13 sẽ xử lý khi job fired.
- **HTTP endpoint riêng cho UC-IMM-12** — không có. Feature này là internal process không có API surface.
- **Xử lý payload của BullMQ job khi fired** — thuộc UC-IMM-13.
- **Thay đổi schema database** — không thêm bảng mới. Chỉ sử dụng `background_jobs`, `system_configs`, `meeting_events`, `meetings` đã có trong DB v3.2 Compact.
- **Auto-extend meeting** — không thuộc scope. UC-IMM-12 chỉ lập lịch cảnh báo.
- **Pause/resume meeting và tác động đến warning schedule** — ngoài scope MVP. Nếu cần, sẽ xử lý trong phiên bản sau.
- **Cấu hình warning threshold per-meeting** — không thuộc scope MVP. Chỉ dùng global config từ `system_configs`.
- **Multiple warning levels** (ví dụ: cảnh báo 30 phút và 10 phút) — ngoài scope. Chỉ 1 warning level theo config.
- **Outbox Pattern** để đảm bảo atomic consistency giữa BullMQ queue và bảng `background_jobs` — **known limitation**. Trong trường hợp hệ thống crash sau khi enqueue BullMQ thành công nhưng trước khi ghi `background_jobs`, hai bên có thể không đồng bộ. Đây là trade-off được chấp nhận (best-effort). Nếu cần guaranteed delivery trong tương lai, Outbox Pattern có thể được xem xét thêm.
