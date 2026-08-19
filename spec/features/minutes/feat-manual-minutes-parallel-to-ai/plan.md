# Implementation Plan: Manual Minutes Parallel to AI

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-19 | Khởi tạo plan cho feat-manual-minutes-parallel-to-ai (MKM-MANUAL-01), dựa trên khảo sát code thật + quyết định đã chốt tại `KE_HOACH_BE_BIEN_BAN_HOP_THU_CONG_SONG_SONG_2026-08-19.md` | Toàn bộ file |

## 1. Feature Summary
Thêm cột `source` (`ai`|`manual`) vào `meeting_minutes`, nới rule "1 minutes/meeting" thành "1 minutes/nguồn/meeting" ở **3 call site** hiện có (tạo tay, enqueue AI job, ghi kết quả AI job), thêm 1 endpoint đọc `GET /meeting-minutes/compare?meetingId=X` để xem 2 bản song song, và 1 helper `resolveOfficialMinutes()` để mọi nơi cần "biên bản chính thức" đều ưu tiên đúng bản thủ công.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL, đúng baseline CLAUDE.md. Không dùng Prisma. 1 migration thêm cột (không tạo bảng mới).

### 2.2 Existing Codebase Analysis
- [meeting-minutes.entity.ts](../../../../src/modules/minutes/entities/meeting-minutes.entity.ts) — entity hiện có, có sẵn `aiSummaryJson` (nullable, đang bị dùng để suy luận ngầm nguồn gốc) và `visibilityLevel`. Không có `@Unique`/`@Index` nào ràng buộc 1 dòng/`meetingId` ở tầng DB.
- [minutes.service.ts:215-231](../../../../src/modules/minutes/services/minutes.service.ts) — `createDraft`, chứa check trùng đầu tiên (`{meetingId, deletedAt: IsNull()}`).
- [minutes-ai-draft.service.ts:194-238](../../../../src/modules/minutes/services/minutes-ai-draft.service.ts) — enqueue AI job, có dedup check riêng cho background job (theo `relatedEntityId`+`jobType`) VÀ check trùng minutes riêng (cùng pattern `{meetingId, deletedAt: IsNull()}`), chặn trừ khi `forceRerun=true`.
- [minutes-ai-draft.processor.ts:213-284](../../../../src/modules/minutes/processors/minutes-ai-draft.processor.ts) — `persistDraft`, dùng `pessimistic_write` lock trên `meeting` (comment gốc: "chống race với UC-MKM-01 tạo minutes tay"), rồi tìm `existing` theo `{meetingId, deletedAt: IsNull()}`; nếu có thì chỉ ghi đè khi `forceRerun && existing.aiSummaryJson !== null && existing.status === DRAFT`, không có thì `INSERT` mới với `visibilityLevel: PRIVATE` mặc định.
- [minutes-list.controller.ts:63-132](../../../../src/modules/minutes/controllers/minutes-list.controller.ts) (`findAll`) — route thật là `GET /meeting-minutes` (không lồng theo `/meetings/:id/minutes`), đã hỗ trợ filter `meetingId` qua query, trả `MinutesListItemDto[]` có phân trang. Route mới `compare` nên đặt cùng controller này để nhất quán.
- `spec/features/minutes/feat-ai-minutes-review-integration/spec.md` (MKM-AI-02) — luồng sửa tay lên bản AI hiện có, giữ nguyên không đổi bởi feature này (2 luồng độc lập, xem spec.md mục 1.4).
- `spec/features/minutes/feat-create-draft-meeting-minutes/` (UC-MKM-01) — nguồn của endpoint tạo tay đang được tái dùng/mở rộng thêm `source`.

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`, dùng `@RequirePermissions()` đúng permission có sẵn.
- Transaction qua `this.dataSource.transaction(async (manager) => {...})`, lock bằng `.setLock('pessimistic_write')` hoặc `lock: { mode: 'pessimistic_write' }` (đúng pattern đã dùng trong `minutes-ai-draft.processor.ts:224-229`).
- Exception payload `{ success: false, message, error: { code, details } }`.

## 3. Scope Confirmation

### 3.1 In Scope
- Migration + entity: thêm `source`.
- Sửa 3 call site chống trùng (mục 2.2) theo `source`.
- Helper `resolveOfficialMinutes(meetingId)`.
- 1 endpoint mới: `GET /meeting-minutes/compare?meetingId=X`.
- Audit renderer export dùng đúng helper.
- Lock đối xứng cho luồng tạo tay.
- Unit test cho toàn bộ nhánh mới/sửa.

### 3.2 Out of Scope
Xem spec.md mục 8 — đặc biệt: KHÔNG làm AI gap-analysis (future), KHÔNG diff nội dung, KHÔNG bảng mới, KHÔNG role/permission mới.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — không xử lý secret |
| SEC-02 (auth bắt buộc) | PASS — tái dùng `JwtAuthGuard`+`PermissionsGuard`+ownership check đã có |
| SEC-03 (input validation) | PASS — `ParseUUIDPipe` cho `meetingId`, DTO whitelist |
| DATA-01 (soft-delete) | PASS — không hard-delete, `source` không ảnh hưởng cơ chế soft-delete hiện có |
| ARCH-01 (module boundary) | PASS — toàn bộ thay đổi nằm trong module `minutes`, không import chéo module khác ngoài phạm vi đã có |
| ARCH-02 (async cho >2s) | PASS — thao tác đồng bộ, nhanh; AI job vẫn qua `background_jobs` như cũ, không đổi |
| ARCH-03 (idempotency) | PASS — gọi lại API tạo khi đã có bản active (cùng source) trả 409 thay vì tạo trùng; partial unique index là lớp bảo vệ bổ sung |
| ENG-01 (test coverage) | Áp dụng — mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — cập nhật `@ApiOperation`/`@ApiResponse` cho endpoint compare |
| ENG-03 (error không lộ stack trace) | PASS — dùng exception filter chung hiện có |
| CLAUDE.md 5.4 (add-only, không bảng mới) | PASS — chỉ 1 cột + 1 index trên bảng đã có |

### 3.4 Complexity Tracking
Điểm phức tạp chính: sửa đồng thời 3 call site chống trùng phải nhất quán logic `source`, tránh sót 1 chỗ làm hệ thống rơi vào trạng thái không nhất quán (vd: tạo được 2 bản `manual` do 1 chỗ quên filter `source`). Giảm thiểu bằng: (1) partial unique index ở DB làm lưới an toàn cuối cùng (FR-016), (2) test riêng cho từng call site + 1 test tích hợp tạo cả 2 nguồn cùng lúc (AC-014). Không cần ADR riêng — độ phức tạp nằm ở việc sửa đúng-đủ 3 nơi, không phải kiến trúc mới.

## 4. Data Model Impact
Xem spec.md mục 5. Tóm tắt: 0 bảng mới, **1 cột mới** (`source`) + **1 partial unique index** mới trên `meeting_minutes`, 0 permission mới.

### 4.1 Bảng bị ảnh hưởng (ALTER, không tạo mới)
`meeting_minutes` — thêm cột `source varchar(10) NOT NULL`, thêm index `ux_meeting_minutes_meeting_source_active`.

### 4.2 Bảng được INSERT
Không đổi so với hiện tại (`meeting_minutes`, `audit_logs`) — chỉ thêm field `source` vào payload insert.

### 4.3 Migration
1 migration mới: `AddSourceColumnToMeetingMinutes` — thêm cột (cho phép nullable tạm thời để backfill an toàn, sau đó set NOT NULL), backfill theo `ai_summary_json IS NULL → 'manual'` / khác → `'ai'`, rồi tạo partial unique index. Có `down()` đầy đủ (xóa index, xóa cột).

## 5. API / Contract Plan

### 5.1 Endpoint hiện có, mở rộng ngữ nghĩa (không đổi contract path/method)
`POST /api/v1/meetings/:meetingId/minutes` — response thêm field `source: 'manual'` (luôn cố định giá trị này ở endpoint này).

### 5.2 Endpoint mới
`GET /api/v1/meeting-minutes/compare?meetingId=X`

### 5.3 Request (endpoint mới)
Query: `meetingId` (UUID, bắt buộc).

### 5.4 Success Response (endpoint mới)
`200 OK` — xem spec.md mục 5.3.

### 5.5 Error Responses (endpoint mới)
`400 VALIDATION_ERROR` (meetingId không phải UUID), `401 Unauthorized`, `403 FORBIDDEN`, `404 MEETING_NOT_FOUND`.

### 5.6 Full Contract
Không tạo file `contracts/` riêng cho feature này (theo đúng precedent của các feature cross-cutting nhẹ như `feat-link-minutes-resources` — chỉ có spec/plan/tasks) — contract đầy đủ nằm ở spec.md mục 5.

## 6. Authorization Plan

### 6.1 Permission Design
Không tạo permission mới. `meeting.minutes.create` (endpoint tạo, đã có), `meeting.minutes.read` (endpoint compare mới, tái dùng).

### 6.2 Authorization Flow
Endpoint tạo: không đổi so với UC-MKM-01 (JwtAuthGuard → PermissionsGuard(`meeting.minutes.create`) → ownership check `hostId===userId` trong service).
Endpoint compare: `JwtAuthGuard` → `PermissionsGuard(meeting.minutes.read)` → service lọc theo đúng phạm vi hiển thị hiện có của `findMinutesList`/`findOne` (Host thấy bản nháp của mình; participant/admin thấy theo `visibilityLevel`/role) — **tái dùng logic hiển thị đã có**, không viết lại rule mới.

### 6.3 Error
Không đổi so với pattern hiện có.

## 7. Business Logic Plan

### 7.1 Transaction Boundary — sửa `createDraft` (tạo tay)
```text
BEGIN TRANSACTION
  1. SELECT meeting FOR UPDATE (pessimistic_write) — MỚI, đối xứng với AI processor
  2. Validate meeting tồn tại, chưa xóa mềm, hostId===authUser.userId, status hợp lệ (không đổi)
  3. SELECT meeting_minutes WHERE meeting_id=:id AND source='manual' AND deleted_at IS NULL
     -> nếu có -> 409 MINUTES_ALREADY_EXISTS { existingMinutesId, source: 'manual' }   [SỬA: thêm điều kiện source]
  4. Snapshot participants (không đổi)
  5. INSERT meeting_minutes (..., source: 'manual')   [SỬA: thêm field source]
  6. INSERT audit_logs (metadata thêm source: 'manual')
COMMIT
```

### 7.2 Transaction Boundary — sửa enqueue AI job (`minutes-ai-draft.service.ts`)
```text
Bước dedup minutes (dòng ~222-238):
  SELECT meeting_minutes WHERE meeting_id=:id AND source='ai' AND deleted_at IS NULL   [SỬA: thêm điều kiện source]
  -> nếu có VÀ !forceRerun -> 409 MINUTES_ALREADY_EXISTS
  (KHÔNG còn xét bản source='manual' — FR-004)
```

### 7.3 Transaction Boundary — sửa `persistDraft` (ghi kết quả AI job)
```text
Trong transaction đã có (pessimistic_write lock trên meeting):
  existing = SELECT meeting_minutes WHERE meeting_id=:id AND source='ai' AND deleted_at IS NULL   [SỬA: thêm điều kiện source]
  IF existing:
    overwritable = forceRerun AND existing.source === 'ai' AND existing.status === DRAFT   [SỬA: existing.aiSummaryJson!==null -> existing.source==='ai']
    IF !overwritable: throw MINUTES_ALREADY_EXISTS
    ...cập nhật như cũ...
  ELSE:
    INSERT meeting_minutes (..., source: 'ai')   [SỬA: thêm field source]
```

### 7.4 `resolveOfficialMinutes(meetingId)` — MỚI
```text
async resolveOfficialMinutes(meetingId):
  manual = findOne({ meetingId, source: 'manual', deletedAt: IsNull() })
  if (manual) return manual
  ai = findOne({ meetingId, source: 'ai', deletedAt: IsNull() })
  return ai ?? null
```
Dùng ở: `meeting-minutes-{docx,pdf}-renderer.ts` (export), nội dung notification outcome (nếu có nơi nào đang lấy minutes theo meeting), trang chi tiết meeting (nếu BE có endpoint trả kèm minutes summary).

### 7.5 `GET /meeting-minutes/compare?meetingId=X` — MỚI
```text
async compare(meetingId):
  meeting = findOne(meeting, { id: meetingId, deletedAt: IsNull() })
  if (!meeting) throw NotFoundException(MEETING_NOT_FOUND)
  manual = findOne({ meetingId, source: 'manual', deletedAt: IsNull() })
  ai = findOne({ meetingId, source: 'ai', deletedAt: IsNull() })
  # áp lại đúng logic lọc hiển thị hiện có (private -> chỉ preparedBy/host thấy) cho từng bản trước khi trả
  return { manual: toDto(manual) ?? null, ai: toDto(ai) ?? null }
```

### 7.6 State Machine
Không đổi — 2 vòng đời `(không tồn tại) → draft → published → archived` chạy độc lập song song theo `source`.

### 7.7 Key Business Rules Implemented
FR-001, FR-004, FR-008, FR-009, FR-014, FR-016, FR-020 (xem spec.md mục 3).

## 8. Validation Plan

### 8.1 Input Validation (DTO)
Endpoint tạo: không đổi (đã có ở UC-MKM-01), KHÔNG thêm field `source` vào DTO nhận từ client (server tự set).
Endpoint compare: `meetingId` qua `@Query('meetingId', ParseUUIDPipe)`.

### 8.2 Business Validation (Service)
Theo đúng thứ tự mục 7.1-7.3 — điểm khác biệt duy nhất so với code hiện tại là thêm điều kiện `source` vào 3 câu query chống trùng.

## 9. Error Handling Plan

### 9.1 Exception Mapping (phần thay đổi/thêm mới)
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Đã có bản `source='manual'` active | `ConflictException` | `MINUTES_ALREADY_EXISTS` (kèm `source` trong details) |
| Đã có bản `source='ai'` active, enqueue job không `forceRerun` | `ConflictException` | `MINUTES_ALREADY_EXISTS` (không đổi behavior, chỉ đổi điều kiện query) |
| `meetingId` không tồn tại (endpoint compare) | `NotFoundException` | `MEETING_NOT_FOUND` |
| Race condition vượt qua application check (hiếm) | Bắt lỗi unique violation từ Postgres (mã lỗi `23505`), map lại thành | `ConflictException` `MINUTES_ALREADY_EXISTS` |

### 9.2 Transaction Error Handling
Không đổi — lỗi nghiệp vụ throw trong transaction tự rollback (TypeORM).

### 9.3 Notification Error (Non-blocking)
Không áp dụng.

## 10. Testing Strategy

### 10.1 Unit Tests
- `minutes.service.spec.ts`: thêm case tạo bản `manual` khi đã có bản `ai` (AC-002), tạo trùng `manual` khi đã có `manual` (AC-005), `resolveOfficialMinutes` ưu tiên đúng (AC-009/AC-010), `compare` trả đúng 2 bản/1 bản/404 (AC-006/007/008).
- `minutes-ai-draft.service.spec.ts`: case enqueue AI job thành công dù đã có bản `manual` (AC-003), vẫn chặn đúng khi đã có bản `ai` khác và `!forceRerun` (hành vi cũ giữ nguyên nhưng phạm vi query đổi).
- `minutes-ai-draft.processor.spec.ts`: case `persistDraft` chỉ đọc/ghi đúng bản `source='ai'`, không đụng bản `manual` (FR-006), điều kiện overwrite dùng `source==='ai'` thay vì `aiSummaryJson!==null`.

### 10.2 Integration Test Ideas
(Ghi chú cho tương lai) Tạo meeting thật + gọi API tạo `manual` + trigger AI job → assert 2 dòng riêng biệt trong DB, đúng `source` mỗi dòng, export dùng đúng bản `manual`.

### 10.3 Migration Test
Không bắt buộc unit test riêng cho migration (theo pattern hiện có của repo) — verify thủ công qua `npm run migration:run` trên DB dev + kiểm tra backfill đúng theo mục 4.3.

## 11. Implementation Phases

### Phase 1: Schema
Migration + cập nhật `MeetingMinutesEntity`.

### Phase 2: Sửa 3 call site chống trùng
`minutes.service.ts` (createDraft), `minutes-ai-draft.service.ts` (enqueue), `minutes-ai-draft.processor.ts` (persistDraft).

### Phase 3: Helper + endpoint mới
`resolveOfficialMinutes`, `GET /meeting-minutes/compare`.

### Phase 4: Audit renderer + tests
Cập nhật renderer export dùng `resolveOfficialMinutes`, viết đủ test, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Sửa sót 1 trong 3 call site chống trùng → hệ thống cho phép tạo >1 bản cùng `source` | Partial unique index ở DB (FR-016) là lưới an toàn cuối; viết test riêng cho từng call site (mục 10.1) |
| Migration backfill sai (`ai_summary_json` không phản ánh đúng nguồn thực tế cho dữ liệu cũ/edge case) | Backfill rule đơn giản, khớp đúng comment gốc trong code (`meeting-minutes.entity.ts` dòng 67-71); kiểm tra thủ công số dòng trước/sau migration trên DB dev trước khi áp production |
| `resolveOfficialMinutes` bị bỏ sót ở 1 nơi nào đó đang lấy minutes theo cách cũ (query trực tiếp không qua helper) | Audit toàn bộ chỗ gọi `MeetingMinutesEntity`/`minutesRepo.findOne({ where: { meetingId, ... } })` trong repo trước khi merge — liệt kê rõ trong task riêng (xem tasks.md T0xx) |
| Race condition giữa lock tầng application (mới thêm cho luồng tạo tay) và transaction của AI processor (đã có lock) gây deadlock nếu thứ tự lock không nhất quán | Cả 2 luồng đều lock đúng 1 dòng `meeting` theo `id` — cùng thứ tự, cùng kiểu lock (`pessimistic_write`) → không có deadlock do lock ordering khác nhau |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md` (không tạo `research.md`/`data-model.md`/`contracts/`/`quickstart.md` riêng — theo đúng precedent của các feature cross-cutting nhẹ tương tự như `feat-link-minutes-resources`, nội dung tương đương đã gộp đủ trong spec.md mục 5 và plan.md mục 4/7).
