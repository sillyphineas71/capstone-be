# Feature Specification: Đọc trạng thái tính năng AI Summarize cho FE (AI Draft Feature Availability)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo spec cho feature `feat-ai-draft-feature-flag` (MKM-AI-03). Tách từ GAP-4 đã ghi nhận khi phân tích AI Summarize: FE không có cách biết `system_configs['ai.minutes_summary'].enabled` trước khi bấm nút "Tạo bằng AI", dẫn tới ăn 403 AI_SUMMARY_DISABLED không cần thiết hoặc hiện nút sai ngữ cảnh | Toàn bộ file |

- **Feature ID**: MKM-AI-03
- **Feature Name**: AI Draft Feature Availability — expose an toàn feature flag AI Summarize cho FE
- **Module / Domain**: minutes (đọc `system_configs`) + meetings (ownership)
- **Created Date**: 2026-07-13
- **Status**: Draft
- **Source Documents**:
  - spec/features/minutes/feat-ai-meeting-minutes-draft/spec.md (MKM-AI-01 — mục 5.2.2 shape config, FR-014 fail-safe)
  - spec/features/minutes/feat-ai-minutes-review-integration/spec.md (MKM-AI-02 — pattern ownership Host/Admin cho endpoint đọc)
  - CLAUDE.md / AGENTS.md (convention backend)
  - Yêu cầu trực tiếp của Product Owner ngày 2026-07-13 (giải thích + yêu cầu implement GAP-4)

---

## 1. Context & Goal

### 1.1 Bối cảnh

MKM-AI-01 dùng `system_configs['ai.minutes_summary'].enabled` làm kill-switch vận hành cho toàn bộ tính năng AI Summarize (fail-safe: thiếu config hoặc `enabled=false` → từ chối tạo job, FR-014). Cờ này **chỉ được backend đọc nội bộ** — mỗi lần tạo job và mỗi lần worker chạy đều re-check, nhưng **không có endpoint nào expose nó ra FE**.

Hệ quả: FE không có cách biết trước tính năng có đang bật hay không, dẫn tới hai lựa chọn đều tệ — (a) luôn hiện nút "Tạo biên bản bằng AI" rồi để user ăn `403 AI_SUMMARY_DISABLED` khi bấm, hoặc (b) hard-code ẩn/hiện theo môi trường, dễ lệch với giá trị thật trong DB khi admin đổi flag mà không deploy lại FE.

Ngoài `enabled`, config còn có `requireHumanReview` — cờ nghiệp vụ xác nhận AI chỉ tạo draft, con người phải review trước khi ban hành (đúng tinh thần FR-001 của MKM-AI-01). FE cần cờ này để quyết định có luôn hiện banner "Bản nháp AI — cần review trước khi ban hành" hay không.

### 1.2 Mục tiêu

Cung cấp một endpoint đọc, scoped theo meeting, trả về **tập con an toàn** của config `ai.minutes_summary` (không lộ chi tiết vận hành nội bộ) để FE quyết định UI: hiện/ẩn nút tạo AI draft, hiện banner cần-review.

### 1.3 Giá trị mang lại

- FE không còn phải "bấm thử để biết" — tránh 403 vô nghĩa, tránh UI gây nhầm lẫn.
- Khi admin tắt flag tạm thời (vd Ollama down), FE hiện đúng trạng thái "tính năng tạm ngưng" thay vì nút chết.
- Cờ `requireHumanReview` giúp FE tự động gắn banner cảnh báo mà không cần hard-code business rule ở client.
- Không rò rỉ chi tiết hạ tầng AI (model, token limit, provider...) ra ngoài — chỉ trả đúng 2 field cần cho quyết định UI.

### 1.4 Giả định

- Key `system_configs['ai.minutes_summary']` và shape `AiMinutesSummaryConfig` đã tồn tại từ MKM-AI-01 (`enabled`, `provider`, `modelName`, `allowExternalProvider`, `requireHumanReview`, `maxInputTokens`, `temperature`, `retentionDays`, `logRawTranscript`). **Không thay đổi schema, không thêm config key mới.**
- Endpoint scoped theo `meetingId` (không phải endpoint global) để tái dùng ownership check nhất quán với `POST/GET .../ai-draft-jobs` (MKM-AI-01/02) — chỉ actor có thể trigger AI draft mới cần biết tính năng có khả dụng hay không.
- Fail-safe kế thừa đúng FR-014 của MKM-AI-01: thiếu config hoặc `is_active=false` → coi như `enabled=false`.

### 1.5 Cần làm rõ

- [NEEDS CLARIFICATION — không chặn BE] Có cần thêm field `hasEligibleTranscript` (meeting đã có transcript sẵn sàng cho AI hay chưa) vào cùng response để FE quyết định hiện nút trong 1 lần gọi? Đây là domain khác (transcription), tạm để **out of scope** (mục 8) — FE tự gọi API transcript hiện có nếu cần; có thể gộp sau nếu team FE yêu cầu.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Host (`meetings.host_id`) | Primary actor | Đọc trạng thái khả dụng của AI draft cho meeting mình trước khi quyết định hiện nút |
| System Admin / Business Admin | Secondary actor | Đọc cho mọi meeting (hỗ trợ vận hành/support) |

### 2.2 Role & Permission Rules

- **KHÔNG seed permission mới.** Dùng `JwtAuthGuard` + ownership check trong service (Host của meeting hoặc `SYSTEM_ADMIN`/`BUSINESS_ADMIN`) — **tái dùng nguyên `userHasAdminRole`** đã có từ MKM-AI-02, cùng pattern với `GET .../ai-draft-jobs`.
- Sửa flag vẫn chỉ qua cơ chế `system_configs` hiện có (chỉ `SYSTEM_ADMIN`, theo CLAUDE.md mục 4.2) — feature này **chỉ đọc**, không thêm endpoint ghi.

### 2.3 Actor Constraints

- Chưa đăng nhập → từ chối.
- Không phải Host của meeting và không phải Admin → 403 (nhất quán MKM-AI-02, không mở rộng ra participant vì chỉ actor có thể trigger job mới cần biết).

---

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)

- **FR-001**: THE system SHALL cung cấp endpoint `GET /api/v1/meetings/:meetingId/minutes/ai-draft-config` trả về tập con AN TOÀN của config `ai.minutes_summary`: `{ enabled: boolean, requireHumanReview: boolean }`.
- **FR-002**: THE system SHALL NOT expose các field vận hành nội bộ (`provider`, `modelName`, `allowExternalProvider`, `maxInputTokens`, `temperature`, `retentionDays`, `logRawTranscript`) qua endpoint này.

### 3.2 Event-driven Requirements

- **FR-003**: WHEN client gọi endpoint với `meetingId` hợp lệ và có quyền, THE system SHALL đọc config hiện tại từ `system_configs` (real-time, không cache) và trả kết quả tương ứng thời điểm gọi.

### 3.3 Unwanted Behavior Requirements

- **FR-004**: IF config `ai.minutes_summary` không tồn tại HOẶC `is_active=false`, THEN THE system SHALL trả `enabled=false, requireHumanReview=true` (fail-safe: coi như tắt và mặc định yêu cầu review — nhất quán FR-014 của MKM-AI-01, không throw lỗi).

### 3.4 Authorization Requirements

- **FR-005**: IF người dùng chưa đăng nhập, THEN THE system SHALL từ chối (401).
- **FR-006**: IF meeting không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả 404 `MEETING_NOT_FOUND`.
- **FR-007**: IF người gọi không phải Host của meeting và không phải Admin (SYSTEM_ADMIN/BUSINESS_ADMIN), THEN THE system SHALL trả 403 `PERMISSION_DENIED`.

### 3.5 Traceability

| Requirement ID | EARS Pattern | Nguồn | Ghi chú |
|---|---|---|---|
| FR-001, FR-002 | Ubiquitous | Yêu cầu PO 2026-07-13 (GAP-4) | Tập con an toàn, không lộ chi tiết vận hành |
| FR-003, FR-004 | Event/Unwanted | MKM-AI-01 FR-014 | Fail-safe nhất quán |
| FR-005, FR-006, FR-007 | Authorization | MKM-AI-02 (pattern listAiDraftJobs) | Tái dùng ownership Host/Admin |

---

## 4. Non-functional Requirements

- **NFR-001** (Performance): THE system SHALL trả response trong 1 query `system_configs` + 1 query `meetings` (+ 1 query role nếu cần check admin) — không thêm N+1.
- **NFR-002** (Security): THE system SHALL không log giá trị config (không nhạy cảm nhưng không cần thiết phải log).
- **NFR-003** (Consistency): THE system SHALL dùng đúng field `AiMinutesSummaryConfig` đã định nghĩa ở MKM-AI-01 — không định nghĩa lại shape config.
- **NFR-004** (Maintainability): THE system SHALL tái sử dụng `loadConfig()` và `userHasAdminRole()` hiện có trong `MinutesAiDraftService`, không tạo service/module mới.
- **NFR-005** (Testability): THE system SHALL có unit test cho: enabled=true, enabled=false (config tắt), config thiếu (fail-safe), meeting không tồn tại, non-owner/non-admin bị từ chối, Admin không phải Host vẫn xem được.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `system_configs` | Nguồn dữ liệu flag (`ai.minutes_summary`) | Chỉ đọc — đã tồn tại từ MKM-AI-01 |
| `meetings` | Kiểm tra tồn tại + ownership | Chỉ đọc |

**Không thay đổi schema DB. Không tạo bảng/cột/config key mới.**

### 5.2 API contract

**Endpoint**: `GET /api/v1/meetings/:meetingId/minutes/ai-draft-config`

Response `data`:

| Field | Type | Mô tả |
|---|---|---|
| `enabled` | boolean | `true` nếu tính năng AI draft đang bật cho toàn hệ thống |
| `requireHumanReview` | boolean | `true` nếu nghiệp vụ yêu cầu FE luôn hiện banner "cần review trước khi ban hành" |

```json
{
  "success": true,
  "message": "Trang thai tinh nang AI draft",
  "data": { "enabled": true, "requireHumanReview": true }
}
```

---

## 6. Error Handling

- **ERR-001**: IF `meetingId` không phải UUID hợp lệ, THEN 400 (ParseUUIDPipe hiện có).
- **ERR-002**: IF chưa đăng nhập, THEN 401.
- **ERR-003**: IF meeting không tồn tại/đã xóa mềm, THEN 404 `MEETING_NOT_FOUND`.
- **ERR-004**: IF không phải Host/Admin, THEN 403 `PERMISSION_DENIED`.

Định dạng lỗi theo exception filter chung: `{ success:false, message, error:{ code, details } }`.

---

## 7. Acceptance Criteria

```text
AC-001:
Given config ai.minutes_summary đang enabled=true, requireHumanReview=true, is_active=true,
When Host của meeting gọi GET /api/v1/meetings/:meetingId/minutes/ai-draft-config,
Then trả 200 với data={enabled:true, requireHumanReview:true}.

AC-002:
Given config ai.minutes_summary đang enabled=false,
When Host gọi endpoint,
Then trả 200 với data.enabled=false (KHÔNG phải lỗi — đây là trạng thái hợp lệ để FE ẩn nút).

AC-003:
Given config key ai.minutes_summary không tồn tại trong system_configs (hoặc is_active=false),
When Host gọi endpoint,
Then trả 200 với data={enabled:false, requireHumanReview:true} (fail-safe FR-004).

AC-004:
Given meeting không tồn tại hoặc đã xóa mềm,
When gọi endpoint,
Then trả 404 MEETING_NOT_FOUND.

AC-005:
Given người gọi không phải Host của meeting và không phải Admin,
When gọi endpoint,
Then trả 403 PERMISSION_DENIED.

AC-006:
Given người gọi là BUSINESS_ADMIN nhưng không phải Host của meeting,
When gọi endpoint,
Then trả 200 (Admin được bypass ownership, như MKM-AI-02).
```

### 7.1 Acceptance Criteria Traceability

| AC ID | Requirement ID | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-003 | Happy path enabled |
| AC-002 | FR-001 | Happy path disabled (không phải lỗi) |
| AC-003 | FR-004 | Fail-safe thiếu config |
| AC-004 | FR-006 | Meeting không tồn tại |
| AC-005 | FR-007 | Authz từ chối |
| AC-006 | FR-007 | Admin bypass ownership |

---

## 8. Out of Scope

- Field `hasEligibleTranscript` hoặc bất kỳ thông tin domain transcript nào (mục 1.5).
- Endpoint ghi/sửa flag qua API (vẫn dùng cơ chế `system_configs` nội bộ hiện có, chỉ SYSTEM_ADMIN).
- Cache/realtime push khi flag đổi (client tự gọi lại khi cần, vd mount lại trang meeting).
- Endpoint global không scoped theo meeting (giữ nhất quán ownership pattern MKM-AI-02).
- Expose các field vận hành khác của config (`provider`, `modelName`, `maxInputTokens`, `temperature`, `retentionDays`, `logRawTranscript`, `allowExternalProvider`).

### 8.1 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT tạo bảng/cột/config key DB mới.
OOS-002: THE system SHALL NOT expose field vận hành nội bộ (provider/modelName/maxInputTokens/temperature/retentionDays/logRawTranscript/allowExternalProvider) qua endpoint này.
OOS-003: THE system SHALL NOT thêm endpoint ghi/sửa system_configs trong feature này.
```
