# Feature Specification: Biên bản họp thủ công song song với biên bản AI (Manual Minutes Parallel to AI)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-19 | Khởi tạo spec. Feature mới, KHÔNG có nguồn gốc từ Feature Table gốc (giống cách MKM-AI-01/MKM-AI-02 cũng là bổ sung sau) — đặt mã **MKM-MANUAL-01**. Bối cảnh: AI summarize/STT (MKM-AI-01/MKM-AI-02) đã hoàn thiện nhưng chưa đủ chính xác cho môi trường production, cần thêm luồng cho Host tự soạn biên bản thủ công **song song, độc lập** với biên bản AI (không hợp nhất vào 1 bản như MKM-AI-02 đang làm), kèm khả năng xem cả 2 bản cạnh nhau. Đã khảo sát code thật và thảo luận chốt scope trước khi viết spec — xem `KE_HOACH_BE_BIEN_BAN_HOP_THU_CONG_SONG_SONG_2026-08-19.md` ở repo root cho lịch sử quyết định đầy đủ. | Toàn bộ file |

> Nguồn gốc: không có UC gốc trong Feature Table — đây là yêu cầu bổ sung trực tiếp từ Product Owner (Thiếu Chủ), tương tự cách MKM-AI-01/MKM-AI-02 được bổ sung sau bản Feature Table gốc. Feature này **mở rộng** UC-MKM-01 (tạo biên bản nháp) và **tương tác** với MKM-AI-01 (tạo bản nháp AI)/MKM-AI-02 (sửa tay lên bản AI), nhưng không thay thế bất kỳ feature nào trong số đó.

## 1. Context & Goal

### 1.1 Bối cảnh
Hệ thống hiện có 1 bản ghi `meeting_minutes` duy nhất cho mỗi meeting (rule "tối đa 1 minutes active/meeting" nằm ở 3 nơi: tạo tay, enqueue AI job, ghi kết quả AI job — xem `research.md`/`plan.md` mục khảo sát). Cột `ai_summary_json` (nullable) hiện được dùng để **suy luận ngầm** nguồn gốc bản ghi (NULL = thủ công, khác NULL = AI), nhưng bản ghi vẫn chỉ có 1 dòng/meeting — nếu Host sửa tay lên bản AI (MKM-AI-02) thì nội dung bị hợp nhất vào cùng 1 dòng, không giữ được 2 phiên bản độc lập để đối chiếu.

### 1.2 Mục tiêu
Cho phép 1 meeting có đồng thời **tối đa 2 bản ghi `meeting_minutes` active**: 1 bản `source=ai` (do MKM-AI-01/02 quản lý, giữ nguyên hành vi) và 1 bản `source=manual` (do Host tự soạn từ đầu, độc lập, không bị AI ghi đè). Bổ sung khả năng xem cả 2 bản cạnh nhau (so sánh đơn giản, không diff nội dung ở v1). Khi cần xác định "biên bản chính thức" của meeting (export, thông báo), hệ thống ưu tiên bản `source=manual` nếu có.

### 1.3 Giá trị mang lại
- Đáp ứng nhu cầu production cần độ chính xác cao hơn AI hiện tại có thể đảm bảo — Host có toàn quyền kiểm soát 1 bản biên bản độc lập, không phụ thuộc/không bị AI can thiệp.
- Vẫn giữ được bản AI làm tài liệu tham chiếu/đối chiếu, đặt nền cho tính năng AI gợi ý bổ sung ở tương lai (xem mục 8.2).
- Không phá vỡ hành vi 2 feature đã có (MKM-AI-01, MKM-AI-02) — 2 luồng cùng tồn tại độc lập.

### 1.4 Giả định
- Bảng `meeting_minutes` đã tồn tại; feature này chỉ thêm 1 cột (`source`) + 1 index, không tạo bảng mới (đúng nguyên tắc add-only của CLAUDE.md mục 5.4).
- Chỉ có 1 Host duy nhất/meeting (`meetings.host_id`), theo đúng giả định của UC-MKM-01.
- Việc chỉnh sửa nội dung bản thủ công sau khi tạo (autosave, PATCH nội dung) tái dùng đúng API/luồng đã có ở `feat-update-draft-meeting-minutes`, `feat-issue-meeting-minutes`, `feat-delete-draft-meeting-minutes` — feature này chỉ định nghĩa phần **tạo song song + phân biệt nguồn + xác định bản chính thức + xem so sánh**, không viết lại các luồng update/issue/delete đã có (chúng tự động hoạt động đúng cho bản `source=manual` vì dùng chung entity/status).

### 1.5 Cần làm rõ
- [NEEDS CLARIFICATION] Tính năng AI quét đối chiếu 2 bản + transcript/audio để gợi ý bổ sung cho bản thủ công là ý tưởng đã được Product Owner chốt hướng nhưng **đánh dấu FUTURE** — xem mục 8.2, không thiết kế chi tiết trong spec này.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host của cuộc họp (`meetings.host_id`) — giống hệt UC-MKM-01.
- Secondary Actor: AI draft job (system actor, MKM-AI-01) — tương tác gián tiếp qua việc chia sẻ cùng `meeting_id` nhưng khác `source`.

### 2.2 Role & Permission Rules
- Không tạo permission mới. Tái dùng nguyên vẹn:
  - `meeting.minutes.create` — cho việc tạo bản thủ công (endpoint đã có sẵn từ UC-MKM-01).
  - `meeting.minutes.read` — cho endpoint so sánh mới (`GET /meeting-minutes/compare`).
- Resource ownership (Host của chính meeting đó) vẫn là điều kiện bắt buộc cho việc tạo, giống UC-MKM-01.

### 2.3 Actor Constraints
- Người không phải Host không được tạo bản thủ công — giống hệt UC-MKM-01 (FR-012 của spec đó), không nới thêm.
- AI draft job không bao giờ được phép đọc/ghi vào bản ghi `source=manual` — ranh giới cứng giữa 2 nguồn.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép tồn tại tối đa **2** bản ghi `meeting_minutes` đang hoạt động (chưa xóa mềm) cho mỗi `meeting_id`: tối đa 1 bản `source='ai'` VÀ tối đa 1 bản `source='manual'`.
- **FR-002**: THE system SHALL gán `source` cho mọi bản ghi `meeting_minutes` tại thời điểm tạo: `'manual'` khi tạo qua endpoint tạo tay hiện có (`POST /meetings/:meetingId/minutes`), `'ai'` khi tạo bởi AI draft processor (MKM-AI-01) — client KHÔNG được tự chọn giá trị `source` qua request body.
- **FR-003**: THE system SHALL áp dụng đúng vòng đời trạng thái `draft → published → archived` (và `deleted` khi xóa mềm) hiện có cho bản ghi `source='manual'`, không định nghĩa trạng thái mới riêng cho nguồn thủ công.
- **FR-004**: THE system SHALL KHÔNG chặn việc tạo/chạy AI draft job vì lý do đã tồn tại bản ghi `source='manual'` cho cùng meeting, VÀ KHÔNG chặn việc tạo bản ghi thủ công vì lý do đã tồn tại bản ghi `source='ai'` — 2 nguồn độc lập hoàn toàn với nhau.

### 3.2 Event-driven Requirements
- **FR-005**: WHEN Host gọi API tạo biên bản thủ công cho một meeting **đã có** bản ghi `source='manual'` active, THE system SHALL từ chối với 409 `MINUTES_ALREADY_EXISTS` (kèm `existingMinutesId`, `source: 'manual'` trong `details`).
- **FR-006**: WHEN AI draft job (MKM-AI-01) hoàn tất và ghi kết quả (`persistDraft`), THE system SHALL chỉ tìm và (nếu cần) ghi đè bản ghi có `source='ai'` của đúng `meetingId` đó — không được đọc hoặc ghi vào bản ghi `source='manual'` của cùng meeting.
- **FR-007**: WHEN client gọi `GET /meeting-minutes/compare?meetingId=X`, THE system SHALL trả về trong cùng 1 response cả bản ghi `source='manual'` (hoặc `null` nếu chưa có) VÀ bản ghi `source='ai'` (hoặc `null` nếu chưa có) của meeting đó.

### 3.3 State-driven Requirements
- **FR-008**: WHILE tồn tại bản ghi `source='manual'` chưa xóa mềm cho một meeting, THE system SHALL ưu tiên chọn bản ghi đó làm "biên bản chính thức" ở mọi nơi cần 1 bản duy nhất đại diện cho meeting (export PDF/DOCX, nội dung đính kèm notification, hiển thị mặc định ở trang chi tiết meeting).
- **FR-009**: WHILE KHÔNG tồn tại bản ghi `source='manual'` chưa xóa mềm cho meeting, THE system SHALL fallback dùng bản ghi `source='ai'` (nếu có) làm biên bản chính thức — đúng hành vi hiện tại trước khi có feature này.

### 3.4 Optional Feature Requirements
- **FR-010**: WHERE Host chưa cung cấp `visibilityLevel` khi tạo biên bản thủ công, THE system SHALL mặc định `visibilityLevel='private'` (nhất quán với hành vi AI draft hiện có ở MKM-AI-01) — Host tự nới ra `participants`/`department`/`public_internal` sau đó qua API cập nhật đã có (`feat-update-draft-meeting-minutes`), không phải API của feature này.

### 3.5 Unwanted Behavior Requirements
- **FR-011**: IF Host cố tạo bản ghi thủ công thứ 2 cho cùng meeting khi bản thứ 1 vẫn active, THEN THE system SHALL từ chối 409 `MINUTES_ALREADY_EXISTS`, KHÔNG tạo bản ghi mới.
- **FR-012**: IF người gọi API tạo bản thủ công không phải Host của meeting, THEN THE system SHALL từ chối 403 `NOT_MEETING_HOST` — tái dùng nguyên vẹn rule ownership của UC-MKM-01, không thêm ngoại lệ.
- **FR-013**: IF `meetingId` truyền vào endpoint so sánh không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả 404 `MEETING_NOT_FOUND`.

### 3.6 Workflow Requirements
- **FR-014**: THE system SHALL thực hiện việc tạo bản ghi `meeting_minutes` thủ công trong 1 transaction có `pessimistic_write` lock trên dòng `meeting` tương ứng — đối xứng với cơ chế lock đã có sẵn trong AI draft processor (MKM-AI-01) — nhằm tránh race condition khi 2 luồng tạo minutes (thủ công và AI) chạy gần như đồng thời cho cùng meeting.

### 3.7 Data & State Requirements
- **FR-015**: THE system SHALL thêm cột `source` (kiểu enum ứng dụng, lưu dạng `varchar`: `'ai'` | `'manual'`, NOT NULL) vào bảng `meeting_minutes` qua 1 migration duy nhất, kèm backfill dữ liệu hiện có theo quy tắc: `ai_summary_json IS NULL → 'manual'`, ngược lại `→ 'ai'`.
- **FR-016**: THE system SHALL thêm partial unique index `(meeting_id, source) WHERE deleted_at IS NULL` trên bảng `meeting_minutes`, đảm bảo ràng buộc "tối đa 1 bản active/nguồn/meeting" được thực thi ở tầng DB, không chỉ dựa vào kiểm tra tầng application (rút kinh nghiệm từ rủi ro thiếu unique constraint đã từng gặp ở `system_configs.config_key`).
- **FR-017**: THE system SHALL KHÔNG thay đổi ý nghĩa/hành vi hiện có của cột `ai_summary_json` — cột này tiếp tục lưu nội dung tóm tắt AI (keyPoints/risks/openQuestions/uncertainParts + meta provenance) đúng như MKM-AI-01/02 đã định nghĩa, chỉ không còn được dùng làm căn cứ suy luận nguồn gốc (thay bằng cột `source` tường minh).

### 3.8 Notification / Audit Requirements
- **FR-018**: THE system SHALL ghi 1 bản ghi `audit_logs` khi tạo bản ghi thủ công thành công (`action_type='meeting_minutes_draft_created'`, `entity_type='meeting_minutes'`, giống hành vi hiện có của UC-MKM-01, bổ sung `source='manual'` trong metadata để phân biệt khi tra cứu).
- **FR-019**: THE system SHALL NOT gửi notification cho participants khi tạo bản ghi thủ công (giữ đúng hành vi UC-MKM-01 — bản draft chỉ Host nhìn thấy do `visibilityLevel=private`).

### 3.9 Complex / Combined Requirements
- **FR-020**: IF Host tạo bản ghi thủ công cho một meeting VÀ tại thời điểm đó đã tồn tại bản ghi `source='ai'` active (do MKM-AI-01 tạo trước đó), THEN THE system SHALL cho phép tạo bản thủ công thành công (2 bản cùng tồn tại độc lập), VÀ ngay sau đó endpoint `GET /meeting-minutes/compare?meetingId=X` SHALL trả về đủ cả 2 bản trong cùng 1 response.

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-011, FR-016 | Quyết định 2.1 trong `KE_HOACH_BE_BIEN_BAN_HOP_THU_CONG_SONG_SONG_2026-08-19.md` |
| FR-003, FR-010 | Quyết định 2.2 |
| FR-008, FR-009 | Quyết định 2.3 |
| FR-007, FR-013 | Quyết định 2.4, 2.6 |
| FR-004, FR-006, FR-020 | Quyết định 2.5 |
| FR-002, FR-015, FR-017 | Khảo sát 1.1/1.2 (schema `aiSummaryJson` suy luận ngầm → thay bằng `source` tường minh) |
| FR-014 | Khảo sát 1.2c (lock có sẵn trong AI processor) |
| FR-012, FR-018, FR-019 | Tái dùng nguyên vẹn UC-MKM-01 (không đổi) |

## 4. Non-functional Requirements

### 4.1 Performance
API tạo bản thủ công và API compare phải phản hồi < 500ms ở điều kiện bình thường — cùng độ phức tạp thao tác với UC-MKM-01 gốc (không thêm join/query nặng).

### 4.2 Security
Không mở thêm bề mặt tấn công mới — tái dùng nguyên vẹn `JwtAuthGuard`, `PermissionsGuard`, ownership check đã có. Endpoint compare chỉ đọc, permission `meeting.minutes.read` đã áp đúng phạm vi hiển thị (Host xem bản nháp của mình, participant/admin xem theo `visibilityLevel`/role — logic hiển thị hiện có của `findMinutesList`/`findOne` được tái dùng, không viết lại).

### 4.3 Reliability & Consistency
- Idempotency tự nhiên (ARCH-03): gọi lại API tạo bản thủ công khi đã có bản active trả 409 thay vì tạo trùng.
- Partial unique index (FR-016) là lớp bảo vệ cuối cùng chống race condition ở tầng DB, bổ sung cho lock ở tầng application (FR-014) — 2 lớp phòng thủ độc lập.

### 4.4 Usability
Response của endpoint compare trả đủ dữ liệu để FE render 2 panel cạnh nhau ngay, không cần gọi thêm API riêng lẻ cho từng bản.

### 4.5 Observability
Log rõ `meetingId`, `userId`, `source` cho mọi thao tác tạo/ghi đè minutes, giúp debug khi có tranh chấp giữa 2 nguồn.

### 4.6 Maintainability
Toàn bộ logic vẫn nằm trong `MinutesService`/`MinutesAiDraftService`/`MinutesAiDraftProcessor` hiện có — không tạo service mới, giữ đúng module boundary `minutes`.

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — **thêm 1 cột mới** `source`, không tạo bảng mới.
- `MeetingEntity` — đọc + lock (`pessimistic_write`) khi tạo bản thủ công.
- `AuditLogEntity` — ghi audit khi tạo bản thủ công.
- `BackgroundJobEntity` — không đổi, MKM-AI-01 vẫn dùng nguyên vẹn qua `background_jobs`.

### 5.2 Thay đổi Entity
```ts
export enum MeetingMinutesSource {
  AI = 'ai',
  MANUAL = 'manual',
}

// Thêm vào MeetingMinutesEntity, cạnh cột status hiện có:
@Column({ type: 'varchar', length: 10 })
source: MeetingMinutesSource;
```

### 5.3 Dữ liệu đầu ra — endpoint mới `GET /meeting-minutes/compare?meetingId=X`
```jsonc
{
  "success": true,
  "message": "So sanh bien ban thu cong va AI",
  "data": {
    "manual": { /* MinutesListItemDto | null, nếu chưa có bản thủ công */ },
    "ai": { /* MinutesListItemDto | null, nếu chưa có bản AI */ }
  }
}
```

### 5.4 State / Status Model
Không đổi — `meeting_minutes.status`: `draft → published → archived` (+ `deleted`). Áp dụng như nhau cho cả `source='ai'` và `source='manual'`.

### 5.5 Data Constraints
- Unique nghiệp vụ MỚI: tối đa 1 bản active theo **từng** `(meeting_id, source)`, thực thi bằng partial unique index ở DB (FR-016) — nâng cấp so với rule cũ (unique theo `meeting_id` không xét `source`, chỉ kiểm tra tầng application).
- `source` là NOT NULL, không có giá trị mặc định ở tầng DB — bắt buộc service set tường minh khi insert.

### 5.6 Data Lifecycle
Không đổi so với các feature đã có (`feat-create-draft-meeting-minutes` → `feat-update-draft-meeting-minutes` → `feat-issue-meeting-minutes` → archive/`feat-delete-draft-meeting-minutes`) — áp dụng độc lập cho từng dòng theo `source`, 2 vòng đời chạy song song không phụ thuộc nhau.

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-002, FR-015, FR-016, FR-017.

## 6. Error Handling

### 6.1 Validation Errors
- `meetingId` không phải UUID hợp lệ → 400 (`ParseUUIDPipe`), áp dụng cho cả endpoint tạo (đã có) và endpoint compare (mới).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → 401.
- Thiếu permission `meeting.minutes.create` (tạo) hoặc `meeting.minutes.read` (compare) → 403 `FORBIDDEN`.
- Có permission nhưng không phải Host (chỉ áp dụng cho endpoint tạo) → 403 `NOT_MEETING_HOST`.

### 6.3 Business Rule Errors
Không đổi so với UC-MKM-01 cho endpoint tạo (`MEETING_HOST_NOT_ASSIGNED`, `MEETING_NOT_STARTED`, `MEETING_CANCELLED`).

### 6.4 Conflict Errors
- Đã có bản `source='manual'` active → 409 `MINUTES_ALREADY_EXISTS` (kèm `existingMinutesId`, `source`).
- (Race condition hiếm) 2 request tạo đồng thời cùng vượt qua check tầng application → partial unique index ở DB chặn insert thứ 2 → service bắt lỗi unique violation, map về cùng 409 `MINUTES_ALREADY_EXISTS`.

### 6.5 Integration / External Service Errors
Không có (feature này không gọi external service mới).

### 6.6 Error Response Expectations
Theo đúng format chuẩn dự án (xem CLAUDE.md mục 8.2), không thay đổi.

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN meeting `M` (`status=in_progress`, `hostId=U`) chưa có bản ghi minutes nào, WHEN `U` gọi tạo bản thủ công, THEN hệ thống trả 201 với `source='manual'`, `status='draft'`.
- **AC-002**: GIVEN meeting `M` đã có bản `source='ai'` active (do MKM-AI-01 tạo), WHEN Host `U` gọi tạo bản thủ công cho `M`, THEN hệ thống trả 201 thành công (KHÔNG bị chặn bởi bản AI đã có — FR-004/FR-020).
- **AC-003**: GIVEN meeting `M` đã có bản `source='manual'` active, WHEN Host bấm tạo bản nháp AI (enqueue job MKM-AI-01) cho `M`, THEN job được enqueue và chạy thành công, tạo bản `source='ai'` mới, KHÔNG bị chặn bởi bản thủ công đã có (FR-004).

### 7.2 Authorization Cases
- **AC-004**: GIVEN người gọi không phải Host của meeting, WHEN gọi API tạo bản thủ công, THEN trả 403 `NOT_MEETING_HOST` — giống hệt UC-MKM-01, không đổi.

### 7.3 Business Rule Cases
- **AC-005**: GIVEN meeting `M` đã có bản `source='manual'` active, WHEN Host gọi lại API tạo bản thủ công cho `M`, THEN trả 409 `MINUTES_ALREADY_EXISTS` với `details.source='manual'`.

### 7.4 Compare Endpoint Cases
- **AC-006**: GIVEN meeting `M` có cả bản `source='manual'` và `source='ai'` active, WHEN gọi `GET /meeting-minutes/compare?meetingId=M`, THEN response trả cả 2 object không null.
- **AC-007**: GIVEN meeting `M` chỉ có bản `source='ai'`, chưa có bản thủ công, WHEN gọi compare, THEN `data.manual = null`, `data.ai` chứa dữ liệu bản AI.
- **AC-008**: GIVEN `meetingId` không tồn tại, WHEN gọi compare, THEN trả 404 `MEETING_NOT_FOUND`.

### 7.5 Official Minutes Resolution Cases
- **AC-009**: GIVEN meeting `M` có cả 2 bản active, WHEN hệ thống cần xác định biên bản chính thức (export/notification/trang chi tiết meeting), THEN bản `source='manual'` được chọn (FR-008).
- **AC-010**: GIVEN meeting `M` chỉ có bản `source='ai'`, WHEN hệ thống cần xác định biên bản chính thức, THEN bản `source='ai'` được chọn (fallback, FR-009).

### 7.6 Notification / Audit Cases
- **AC-011**: GIVEN tạo bản thủ công thành công, THEN có đúng 1 bản ghi `audit_logs` mới với `action_type='meeting_minutes_draft_created'` và metadata chứa `source='manual'`.
- **AC-012**: GIVEN tạo bản thủ công thành công, THEN KHÔNG có notification nào được tạo/queue — giống UC-MKM-01.

### 7.7 Concurrency Cases
- **AC-013**: GIVEN 2 request tạo bản thủ công đồng thời cho cùng `meetingId` (race condition), WHEN cả 2 gần như đồng thời, THEN chỉ 1 request thành công (201), request còn lại nhận 409 `MINUTES_ALREADY_EXISTS` — đảm bảo bằng cả lock tầng application (FR-014) VÀ partial unique index tầng DB (FR-016) làm lớp bảo vệ cuối.
- **AC-014**: GIVEN 1 request tạo bản thủ công VÀ 1 AI draft job cùng chạy gần như đồng thời cho cùng `meetingId` (khác `source`), WHEN cả 2 hoàn tất, THEN CẢ HAI đều thành công, tạo ra 2 bản ghi riêng biệt (không có race condition chéo nguồn — khác với AC-013 vốn là race condition CÙNG nguồn).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-001, FR-002, FR-010 |
| AC-002, AC-003 | FR-004, FR-020 |
| AC-004 | FR-012 |
| AC-005 | FR-011 |
| AC-006, AC-007, AC-008 | FR-007, FR-013 |
| AC-009, AC-010 | FR-008, FR-009 |
| AC-011, AC-012 | FR-018, FR-019 |
| AC-013, AC-014 | FR-001, FR-014, FR-016 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Diff/highlight nội dung khác biệt giữa 2 bản — v1 chỉ hiển thị song song thô (2 object riêng biệt trong response compare), việc render/so sánh trực quan là việc của FE.
- Chỉnh sửa nội dung bản thủ công sau khi tạo (autosave, PATCH) — tái dùng nguyên vẹn `feat-update-draft-meeting-minutes` đã có, entity dùng chung nên tự hoạt động đúng, không cần code thêm.
- Ban hành (issue/publish), xóa, chia sẻ, đính kèm file cho bản thủ công — tái dùng nguyên vẹn các feature đã có (`feat-issue-meeting-minutes`, `feat-delete-draft-meeting-minutes`, `feat-share-meeting-minutes`, `feat-attach-minutes-document`), không viết lại.
- Tạo role/permission mới.
- Cho phép người không phải Host (kể cả Admin) tạo bản thủ công hộ Host.

### 8.2 FUTURE — không thiết kế chi tiết ở spec này
**AI Gap Analysis (đề xuất bổ sung cho bản thủ công)**: sau khi có cả 2 bản, AI sẽ quét đối chiếu bản thủ công + bản AI + transcript/audio gốc, đề xuất phần bản thủ công còn thiếu (kèm nguồn trích dẫn), Host chấp nhận/từ chối từng đề xuất, AI không tự sửa. Đây là **mở rộng AI pipeline mới**, theo CLAUDE.md mục 0/23 phải chờ yêu cầu rõ ràng mới triển khai — chỉ ghi nhận ý tưởng tại `KE_HOACH_BE_BIEN_BAN_HOP_THU_CONG_SONG_SONG_2026-08-19.md` mục 4, sẽ có spec riêng (`feat-ai-minutes-gap-analysis` hoặc tên tương đương) khi được xác nhận triển khai.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT tự động chọn/xóa 1 trong 2 bản khi cả 2 cùng tồn tại — cả 2 luôn song song cho đến khi Host/AI job tự archive/xóa từng bản riêng.
- **FR-OOS-002**: THE system SHALL NOT cung cấp bất kỳ endpoint/job nào thực hiện AI gap-analysis trong phạm vi feature này.
- **FR-OOS-003**: THE system SHALL NOT tạo bảng mới cho feature này (chỉ thêm cột + index trên `meeting_minutes` đã có).

## Assumptions
Xem mục 1.4.
