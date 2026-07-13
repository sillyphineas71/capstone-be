# Feature Specification: Đưa kết quả AI ra Frontend để review, sửa tay & resume (AI Minutes Review Integration)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo spec cho feature `feat-ai-minutes-review-integration` (MKM-AI-02). Tách từ nhu cầu FE-integration còn thiếu của MKM-AI-01: hợp nhất schema giàu AI↔tay, expose `ai_summary_json`+`isAiGenerated`+typed decisions/actionItems ra GET detail, sửa tay trọn vẹn kết quả AI qua PATCH (giữ `meta`), badge AI trên list, endpoint list/latest AI draft job theo meeting để FE resume polling | Toàn bộ file |
| 2026-07-13 | Sửa khi implement R5: bảng `background_jobs` KHÔNG có cột `created_at` (chỉ `scheduled_at/started_at/completed_at`) → bỏ field `createdAt` khỏi response endpoint list job; đổi sắp xếp sang `COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST` (job vừa tạo lên đầu) | FR-008, mục 5.3.3, AC-007 |

- **Feature ID**: MKM-AI-02
- **Feature Name**: AI Minutes Review Integration (đưa kết quả AI ra FE để review/sửa/resume)
- **Module / Domain**: minutes (đọc/sửa `meeting_minutes`) + administration/background_jobs (đọc job)
- **Created Date**: 2026-07-13
- **Status**: Draft
- **Source Documents**:
  - spec/features/minutes/feat-ai-meeting-minutes-draft/spec.md (MKM-AI-01 — feature sinh AI draft, schema output mục 5.3)
  - spec/features/minutes/feat-create-draft-meeting-minutes/spec.md (UC-MKM-01), UC-MKM-02 (list), UC-MKM-03 (detail), UC-MKM-04 (update draft)
  - database_v3_2_compact_39_tables.md (bảng `meeting_minutes`, `background_jobs`)
  - CLAUDE.md / AGENTS.md (convention backend)
  - Yêu cầu trực tiếp của Product Owner ngày 2026-07-13 (danh sách 4 việc ưu tiên + sửa tay kết quả AI)

---

## 1. Context & Goal

### 1.1 Bối cảnh

MKM-AI-01 đã sinh được bản nháp biên bản họp bằng AI và lưu vào `meeting_minutes` (`minutes_content`, `decisions_json`, `action_items_json`, `ai_summary_json`). Tuy nhiên phần **đưa dữ liệu này ra Frontend** còn thiếu, khiến FE chưa thể dựng trải nghiệm review hoàn chỉnh:

- `GET /api/v1/meeting-minutes/:id` (UC-MKM-03) **không trả `ai_summary_json`** (keyPoints/risks/openQuestions/uncertainParts/meta) và **không có cờ phân biệt** nháp-AI với nháp-tay. Đây chính là phần "giá trị" của AI mà FE không lấy được.
- `decisions`/`action_items` trong response detail để kiểu `Record<string, unknown>` generic — FE không có contract để render `confidence`/`evidence`/`owner`/`deadline`.
- Luồng sửa tay (PATCH UC-MKM-04) trước đây dùng schema biên bản-tay (`{decision}`/`{title,assigneeUserId,dueDate}`), **lệch** với schema AI (`{text,confidence,evidence}`/`{task,owner,deadline,confidence}`) → gửi lại nguyên output AI bị 400 và **mất `confidence`/`evidence`**; các khối insight (keyPoints/risks/...) **không sửa được**.
- Danh sách biên bản (UC-MKM-02) **không đánh dấu** biên bản nào do AI tạo.
- `jobId` chỉ trả về đúng một lần ở HTTP 202 lúc tạo job; **reload trang là mất** — FE không có cách lấy lại jobId để tiếp tục theo dõi tiến độ (resume polling).

### 1.2 Mục tiêu

Bổ sung lớp "consumption + edit" cho AI minutes, giúp FE có một luồng trải nghiệm khép kín: xem đầy đủ kết quả AI (kèm độ tin cậy và insight), **sửa tay trọn vẹn** mọi phần AI sinh ra mà không mất dữ liệu, phân biệt nháp-AI trên danh sách, và **resume theo dõi** job AI sau khi reload.

### 1.3 Giá trị mang lại

- FE hiển thị được các khối insight AI (key points, risks, open questions, uncertain parts) + banner "AI sinh — cần review".
- Người dùng chỉnh sửa tay decisions/actionItems mà vẫn giữ `confidence`/`evidence`; sửa được cả các khối insight; provenance (`meta`) không bị ghi đè.
- Danh sách phân biệt nháp-AI để ưu tiên review.
- FE resume polling sau reload → trải nghiệm ổn định, không "mồ côi" job.

### 1.4 Giả định

- Cột `meeting_minutes.ai_summary_json` (jsonb, nullable) đã tồn tại từ MKM-AI-01: `NULL` = biên bản soạn tay; khác `NULL` = có nguồn gốc AI. **Không thay đổi schema DB trong feature này.**
- Các endpoint minutes hiện có (`GET /meeting-minutes`, `GET /meeting-minutes/:id`, `PATCH /meeting-minutes/:id`, `POST /meeting-minutes/:id/issue`) và endpoint poll job (`GET /background-jobs/:id`) đã hoạt động.
- Output LLM của MKM-AI-01 (`decisions[{text,confidence,evidence}]`, `actionItems[{task,owner,deadline,confidence}]`) là **tập con hợp lệ** của schema giàu thống nhất ở mục 5.2 → **không cần đổi worker/validator/prompt**.
- `background_jobs` của AI có `job_type = ai_meeting_summary`, `related_entity_type = 'meeting'`, `related_entity_id = <meetingId>`, dùng index `ix_background_jobs_related`.

### 1.5 Cần làm rõ

- [NEEDS CLARIFICATION — không chặn BE] Endpoint list AI job theo meeting nên trả **toàn bộ lịch sử job** hay **chỉ job mới nhất/đang chạy**? MVP: trả danh sách sắp xếp mới→cũ, FE tự lấy phần tử đầu / job active đầu tiên; có thể bổ sung filter `?status=active` sau nếu FE yêu cầu.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Host (`meetings.host_id`) | Primary actor | Xem chi tiết nháp AI, sửa tay trọn vẹn, resume theo dõi job AI của meeting mình |
| System Admin / Business Admin | Secondary actor | Xem/sửa theo quyền admin hiện có; xem job AI mọi meeting |
| Participant | Read actor | Xem biên bản theo quy tắc visibility hiện có (không mở rộng quyền) |

### 2.2 Role & Permission Rules

- **Đọc detail/list**: dùng đúng permission hiện có `meeting.minutes.read` + quy tắc visibility của UC-MKM-02/03 (feature này KHÔNG thêm quyền, KHÔNG mở rộng phạm vi xem).
- **Sửa tay**: dùng đúng `meeting.minutes.update` + ràng buộc UC-MKM-04 (chỉ Host/preparedBy hoặc Admin, chỉ khi `status = draft`).
- **List AI job theo meeting**: KHÔNG seed permission mới. Dùng `JwtAuthGuard` + kiểm tra ownership trong service (Host của meeting hoặc `SYSTEM_ADMIN`/`BUSINESS_ADMIN`) — nhất quán với pattern `GET /background-jobs/:id` (chỉ JwtAuthGuard, authorize owner/admin ở service).

### 2.3 Actor Constraints

- Không đăng nhập → từ chối mọi endpoint.
- Người không có quyền xem biên bản → không thấy `ai_summary_json` (đi qua đúng check visibility hiện có, feature này không tạo đường vòng).
- List AI job: người không phải Host của meeting và không phải Admin → 403.

---

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)

- **FR-001**: THE system SHALL expose khối insight AI trong response của `GET /api/v1/meeting-minutes/:id` gồm `aiSummary` (`keyPoints`, `risks`, `openQuestions`, `uncertainParts`, `meta`) và cờ boolean `isAiGenerated`, với `isAiGenerated = (ai_summary_json IS NOT NULL)`.
- **FR-002**: THE system SHALL trả `aiSummary = null` và `isAiGenerated = false` cho biên bản soạn tay (`ai_summary_json IS NULL`).
- **FR-003**: THE system SHALL type hóa `mainContent.decisions` và `mainContent.actionItems` trong response detail theo schema giàu thống nhất (mục 5.2) thay cho `Record<string, unknown>`.
- **FR-004**: THE system SHALL dùng MỘT schema giàu thống nhất cho `decisions_json`/`action_items_json`/`ai_summary_json` dùng chung cho cả nội dung AI sinh lẫn nội dung người dùng sửa tay (mục 5.2).

### 3.2 Event-driven Requirements

- **FR-005**: WHEN Host/Admin sửa `decisions`/`actionItems` qua `PATCH /api/v1/meeting-minutes/:id`, THE system SHALL chấp nhận schema giàu (`{text,confidence,evidence,responsibleUserId?}` / `{id?,task,owner?,assigneeUserId?,deadline?,priority?,confidence?}`) và lưu **giữ nguyên** `confidence`/`evidence` (không ép về schema tay, không làm mất dữ liệu AI).
- **FR-006**: WHEN Host/Admin gửi field `aiSummary` trong PATCH, THE system SHALL cập nhật (merge) các mảng `keyPoints`/`risks`/`openQuestions`/`uncertainParts` được cung cấp và **GIỮ NGUYÊN** `ai_summary_json.meta` (provider/model/promptVersion/generatedByJobId/generatedAt) — người dùng không được sửa provenance.
- **FR-007**: WHEN response của `PATCH /api/v1/meeting-minutes/:id` trả về, THE system SHALL bao gồm `aiSummaryJson` sau khi sửa để FE cập nhật state ngay không cần gọi lại GET.
- **FR-008**: WHEN client gọi `GET /api/v1/meetings/:meetingId/minutes/ai-draft-jobs`, THE system SHALL trả danh sách các background job AI (`job_type = ai_meeting_summary`) của meeting đó, sắp xếp theo timeline job `COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST` (job vừa tạo — mọi mốc NULL — nổi lên đầu; `background_jobs` không có cột `created_at`), mỗi phần tử gồm tối thiểu `jobId`, `status`, `scheduledAt`, `startedAt`, `completedAt`, `errorMessage`, `result` (từ `output_json`, chứa `minutesId` khi completed).

### 3.3 State-driven Requirements

- **FR-009**: WHILE danh sách biên bản (UC-MKM-02) được trả về, THE system SHALL đính kèm cờ `isAiGenerated` cho từng phần tử để FE hiển thị badge phân biệt nháp-AI với nháp-tay.
- **FR-010**: WHILE một AI draft job của meeting đang `queued`/`running`/`retrying`, THE system SHALL để endpoint FR-008 trả job đó (kèm status hiện tại) để FE resume polling.

### 3.4 Unwanted Behavior Requirements

- **FR-011**: IF client gửi field lạ ngoài schema giàu trong PATCH decisions/actionItems/aiSummary, THEN THE system SHALL từ chối với lỗi validation (giữ nguyên hành vi `forbidNonWhitelisted` của ValidationPipe UC-MKM-04).
- **FR-012**: IF biên bản không phải nguồn gốc AI (`ai_summary_json IS NULL`) và client gửi `aiSummary` trong PATCH, THEN THE system SHALL vẫn cho phép ghi (thêm khối insight thủ công) NHƯNG không tự bịa `meta`; `isAiGenerated` sau đó phản ánh đúng trạng thái mới (`ai_summary_json` khác NULL). *(Best-effort; không phải luồng chính — luồng chính là sửa nháp-AI.)*

### 3.5 Authorization Requirements

- **FR-013**: IF người dùng không có quyền xem biên bản theo quy tắc visibility hiện có, THEN THE system SHALL từ chối `GET /meeting-minutes/:id` (403), bao gồm cả việc không lộ `ai_summary_json`.
- **FR-014**: IF người gọi endpoint FR-008 không phải Host của meeting và không phải Admin, THEN THE system SHALL trả 403.

### 3.6 Traceability

| Requirement ID | EARS Pattern | Nguồn | Ghi chú |
|---|---|---|---|
| FR-001, FR-002, FR-003 | Ubiquitous | Yêu cầu PO 2026-07-13 (item 1,2) | Expose + type hóa detail |
| FR-004, FR-005, FR-006, FR-007, FR-011, FR-012 | Ubiquitous/Event/Unwanted | Yêu cầu PO 2026-07-13 (sửa tay) + UC-MKM-04 | Schema giàu + PATCH round-trip giữ meta |
| FR-008, FR-010, FR-014 | Event/State/Authz | Yêu cầu PO 2026-07-13 (item B4) | Endpoint list/latest AI job |
| FR-009 | State-driven | Yêu cầu PO 2026-07-13 (item 3) | Badge trên list |
| FR-013 | Authorization | UC-MKM-03 | Không mở rộng visibility |

---

## 4. Non-functional Requirements

- **NFR-001** (Performance): THE system SHALL không gây thêm truy vấn N+1 khi thêm `isAiGenerated` vào list — chấp nhận select thêm cột `ai_summary_json` trong cùng query list hiện có (page ≤ 20).
- **NFR-002** (Security): THE system SHALL không expose `input_json`/`metadata_json` của job qua endpoint FR-008 (chỉ status + `output_json` như DTO poll hiện có); không log nội dung nhạy cảm (kế thừa FR-025 của MKM-AI-01).
- **NFR-003** (Consistency): THE system SHALL đảm bảo `meta` của `ai_summary_json` bất biến qua các lần sửa tay (chỉ worker AI được ghi `meta`).
- **NFR-004** (Compatibility): THE system SHALL giữ output LLM MKM-AI-01 là tập con hợp lệ của schema giàu → không đổi worker/validator/prompt; không cần data migration cho dữ liệu cũ (feature còn ở giai đoạn WIP, chưa có dữ liệu production).
- **NFR-005** (Maintainability): THE system SHALL đặt schema giàu ở MỘT nơi dùng chung (`dto/minutes-content.dto.ts`) để cả DTO đọc (detail) lẫn ghi (update) tham chiếu.
- **NFR-006** (Testability): THE system SHALL có unit test cho: detail expose aiSummary+isAiGenerated (AI & non-AI), PATCH giữ confidence/evidence, PATCH merge aiSummary giữ meta, list gắn isAiGenerated, endpoint list job (owner/admin/forbidden, sắp xếp desc).

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meeting_minutes` | Đọc detail/list; ghi khi sửa tay (`decisions_json`, `action_items_json`, `ai_summary_json`) | `ai_summary_json` đã tồn tại (MKM-AI-01) |
| `background_jobs` | Đọc danh sách job AI theo meeting (FR-008) | Chỉ đọc; dùng index `ix_background_jobs_related` |
| `meetings` | Kiểm tra ownership cho FR-008 | Chỉ đọc |

**Không thay đổi schema DB. Không tạo bảng/cột mới.**

### 5.2 Schema giàu thống nhất (canonical — lưu jsonb, dùng chung AI + tay)

```jsonc
// decisions_json: DecisionItem[]
{
  "text": "string",                       // BẮT BUỘC — nội dung quyết định
  "confidence": "high | medium | low",    // tùy chọn — AI gán; sửa tay có thể bỏ
  "evidence": "string | null",            // tùy chọn — trích dẫn transcript (AI)
  "responsibleUserId": "uuid | null"      // tùy chọn — người chịu trách nhiệm (map tay)
}

// action_items_json: ActionItem[]
{
  "id": "uuid",                           // tự sinh khi lưu nếu thiếu
  "task": "string",                       // BẮT BUỘC — việc cần làm
  "owner": "string | null",               // tên người phụ trách dạng text (AI)
  "assigneeUserId": "uuid | null",        // map user hệ thống (tay)
  "deadline": "string | null",            // AI: text tự do; tay: ISO date
  "priority": "low | medium | high",      // tùy chọn
  "confidence": "high | medium | low"     // tùy chọn (AI)
}

// ai_summary_json (4 mảng sửa được + meta read-only)
{
  "keyPoints": ["string"],
  "risks": ["string"],
  "openQuestions": ["string"],
  "uncertainParts": ["string"],
  "meta": {                               // READ-ONLY — chỉ worker AI ghi
    "provider": "self_hosted_llm | mock",
    "modelName": "string",
    "promptVersion": "string",
    "generatedByJobId": "uuid",
    "generatedAt": "ISO-8601"
  }
}
```

> Output LLM MKM-AI-01 (`{text,confidence,evidence}` / `{task,owner,deadline,confidence}`) là tập con → không cần đổi `ai-output-validator.ts`.

### 5.3 API contract

#### 5.3.1 `GET /api/v1/meeting-minutes/:id` (bổ sung field)

Thêm vào `data` của response hiện có:

| Field | Type | Mô tả |
|---|---|---|
| `isAiGenerated` | boolean | `true` nếu `ai_summary_json` khác NULL |
| `aiSummary` | object \| null | `{ keyPoints[], risks[], openQuestions[], uncertainParts[], meta }` hoặc `null` |
| `mainContent.decisions` | `DecisionItem[]` \| null | Type hóa theo mục 5.2 (đổi từ `Record`) |
| `mainContent.actionItems` | `ActionItem[]` \| null | Type hóa theo mục 5.2 |

#### 5.3.2 `PATCH /api/v1/meeting-minutes/:id` (mở rộng body)

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `versionNo` | int | Có | Optimistic lock (UC-MKM-04) |
| `title` | string | Không | (như cũ) |
| `minutesContent` | string | Không | Đoạn summary (như cũ) |
| `decisionsJson` | `DecisionItem[]` | Không | Schema giàu (mục 5.2) |
| `actionItemsJson` | `ActionItem[]` | Không | Schema giàu (mục 5.2) |
| `aiSummary` | `{ keyPoints?, risks?, openQuestions?, uncertainParts? }` | Không | Merge 4 mảng; `meta` giữ nguyên |

Response `data` bổ sung `aiSummaryJson` (FR-007).

#### 5.3.3 `GET /api/v1/meetings/:meetingId/minutes/ai-draft-jobs` (mới)

- Auth: `JwtAuthGuard` + ownership (Host meeting hoặc Admin) ở service.
- Response `data`: mảng job AI, sắp xếp `createdAt` desc.

| Field mỗi phần tử | Type | Mô tả |
|---|---|---|
| `jobId` | uuid | ID background_job |
| `status` | string | `queued\|running\|retrying\|completed\|failed\|cancelled\|scheduled` |
| `scheduledAt` | date-time \| null | |
| `startedAt` | date-time \| null | |
| `completedAt` | date-time \| null | |
| `errorMessage` | string \| null | Chỉ khi failed |
| `result` | object \| null | `output_json` (chứa `minutesId`) khi completed |

> Sắp xếp: `COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST`. Do FR-011 (MKM-AI-01) chỉ cho 1 job active/meeting nên không nhập nhằng giữa nhiều job đang chờ.

#### 5.3.4 `GET /api/v1/meeting-minutes` (list — bổ sung field)

Mỗi phần tử `data[]` thêm: `isAiGenerated: boolean`.

### 5.4 Data Constraints

- `meta` của `ai_summary_json` chỉ do worker AI ghi; mọi luồng sửa tay phải bảo toàn (NFR-003).
- `isAiGenerated` là suy ra runtime (`ai_summary_json IS NOT NULL`), KHÔNG lưu cột riêng.

---

## 6. Error Handling

- **ERR-001**: IF `id`/`meetingId` không phải UUID hợp lệ, THEN 400 (ParseUUIDPipe hiện có).
- **ERR-002**: IF không có quyền xem biên bản, THEN 403 `MEETING_MINUTES_ACCESS_DENIED` (UC-MKM-03).
- **ERR-003**: IF biên bản không tồn tại, THEN 404 `MEETING_MINUTES_NOT_FOUND`.
- **ERR-004**: IF PATCH gửi field lạ ngoài schema, THEN 400 validation (FR-011).
- **ERR-005**: IF PATCH sai `versionNo`, THEN 409 `MINUTES_VERSION_CONFLICT` (UC-MKM-04, giữ nguyên).
- **ERR-006**: IF endpoint list job: meeting không tồn tại → 404 `MEETING_NOT_FOUND`; người gọi không phải Host/Admin → 403 `PERMISSION_DENIED`.
- **ERR-007**: IF endpoint list job không có job AI nào cho meeting, THEN trả 200 với `data = []` (không phải lỗi).

Định dạng lỗi theo exception filter chung: `{ success:false, message, error:{ code, details } }`.

---

## 7. Acceptance Criteria

### 7.1 Detail expose

```text
AC-001:
Given một biên bản có nguồn gốc AI (ai_summary_json khác NULL) mà user có quyền xem,
When gọi GET /api/v1/meeting-minutes/:id,
Then response.data.isAiGenerated = true và response.data.aiSummary chứa keyPoints/risks/openQuestions/uncertainParts + meta; mainContent.decisions[i] có text/confidence/evidence, mainContent.actionItems[i] có task/owner/deadline/confidence.

AC-002:
Given một biên bản soạn tay (ai_summary_json IS NULL),
When gọi GET detail,
Then isAiGenerated = false và aiSummary = null.
```

### 7.2 Sửa tay round-trip

```text
AC-003:
Given nháp AI có decisions[{text,confidence:'high',evidence:'...'}] và versionNo=1,
When Host PATCH decisionsJson gửi lại nguyên object đó (sửa text),
Then lưu thành công, decision giữ nguyên confidence='high' và evidence (không mất), versionNo=2.

AC-004:
Given nháp AI có ai_summary_json.meta = {provider:'mock', modelName:'x', generatedByJobId:'job-1'},
When Host PATCH aiSummary = { keyPoints:['đã sửa'], risks:['R1'] },
Then keyPoints/risks được cập nhật, meta GIỮ NGUYÊN, response.data.aiSummaryJson phản ánh kết quả mới.

AC-005:
Given PATCH gửi decisionsJson có field lạ (vd 'foo'),
When Host gửi request,
Then 400 validation error, không ghi DB.
```

### 7.3 List badge

```text
AC-006:
Given danh sách gồm 1 nháp AI và 1 nháp tay mà user có quyền xem,
When gọi GET /api/v1/meeting-minutes,
Then phần tử nháp AI có isAiGenerated=true, phần tử nháp tay có isAiGenerated=false.
```

### 7.4 List/latest AI job (resume)

```text
AC-007:
Given meeting đã có 2 AI draft job (1 completed cũ có completed_at, 1 running mới có started_at) mà người gọi là Host,
When gọi GET /api/v1/meetings/:meetingId/minutes/ai-draft-jobs,
Then trả mảng 2 phần tử sắp xếp theo COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST; phần tử đầu status=running; phần tử completed có result.minutesId.

AC-008:
Given người gọi không phải Host của meeting và không phải Admin,
When gọi endpoint list job,
Then 403 PERMISSION_DENIED.

AC-009:
Given meeting chưa từng chạy AI job,
When gọi endpoint list job (bởi Host),
Then 200 với data = [].
```

### 7.5 Acceptance Criteria Traceability

| AC ID | Requirement ID | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-003 | Detail nháp AI |
| AC-002 | FR-002 | Detail nháp tay |
| AC-003 | FR-005 | PATCH giữ confidence/evidence |
| AC-004 | FR-006, FR-007, NFR-003 | PATCH merge aiSummary giữ meta |
| AC-005 | FR-011 | Validation field lạ |
| AC-006 | FR-009 | Badge list |
| AC-007 | FR-008, FR-010 | List job resume |
| AC-008 | FR-014 | Authz list job |
| AC-009 | ERR-007 | List job rỗng |

---

## 8. Out of Scope

- Realtime/WebSocket thông báo khi AI draft sẵn sàng (client vẫn poll).
- Endpoint đọc feature-flag `ai.minutes_summary.enabled` cho FE (để hiện/ẩn nút "Tạo bằng AI") — tách feature riêng nếu FE yêu cầu.
- Diff/history nội dung nháp AID trước-sau khi sửa (không giữ history — kế thừa UC-MKM-04/MKM-AI-01).
- Map `owner` (text AI) ↔ `assigneeUserId` (user hệ thống) tự động; feature này chỉ cung cấp cả 2 field, việc map do FE/người dùng.
- Data migration chuẩn hóa dữ liệu decisions/actionItems cũ (không có dữ liệu production; feature MKM-AI-01 vẫn WIP).
- Thay đổi luồng issue/delete/attachment minutes.

### 8.1 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT tạo bảng/cột DB mới; isAiGenerated là suy ra từ ai_summary_json IS NOT NULL.
OOS-002: THE system SHALL NOT cho phép sửa tay ghi đè ai_summary_json.meta.
OOS-003: THE system SHALL NOT đổi schema output LLM hay validator của MKM-AI-01.
OOS-004: THE system SHALL NOT mở rộng quy tắc visibility xem biên bản hiện có.
```
