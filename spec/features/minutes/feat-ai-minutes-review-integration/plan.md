# Implementation Plan: AI Minutes Review Integration (MKM-AI-02)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo plan cho feat-ai-minutes-review-integration dựa trên spec.md (2026-07-13). Ghi nhận R1–R3 (schema giàu thống nhất + expose detail + PATCH round-trip giữ meta) ĐÃ implement trước khi viết doc; R4 (badge list) và R5 (endpoint list AI job) là phần còn lại | Toàn bộ file |
| 2026-07-13 | Sửa mục 4.5 sau khi implement R5: `background_jobs` không có `created_at` → sort theo `COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST`; DTO dùng `scheduledAt` thay `createdAt`; helper `userHasAdminRole` query trực tiếp qua `dataSource.query` | Mục 4.5 |

**Branch**: `feat-ai-minutes-review-integration` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

---

## 1. Feature Summary

Bổ sung lớp đọc/sửa cho AI minutes để FE dùng được:
1. **Schema giàu thống nhất** (`dto/minutes-content.dto.ts`) cho decisions/actionItems/aiSummary — dùng chung AI + tay.
2. **Expose** `aiSummary` + `isAiGenerated` + typed decisions/actionItems trong `GET /meeting-minutes/:id`.
3. **PATCH round-trip**: sửa tay trọn vẹn kết quả AI (giữ `confidence`/`evidence`), sửa được khối insight, `meta` bất biến; response trả `aiSummaryJson`.
4. **Badge**: `isAiGenerated` trong list (UC-MKM-02).
5. **Endpoint mới** `GET /meetings/:meetingId/minutes/ai-draft-jobs` để FE resume polling.

Không thay đổi DB, không seed mới, không đổi worker AI.

## 2. Technical Context

### 2.1 Tech Stack

- NestJS + TypeORM + PostgreSQL (baseline CLAUDE.md, không Prisma).
- class-validator/class-transformer cho DTO (ValidationPipe `whitelist + forbidNonWhitelisted + transform` như UC-MKM-04).
- Không thêm thư viện mới.

### 2.2 Existing Codebase Analysis (đã xác minh 2026-07-13)

| Thành phần có sẵn | Đường dẫn | Vai trò tái sử dụng |
|---|---|---|
| `MinutesService.findMinutesDetail` | `src/modules/minutes/services/minutes.service.ts` | Thêm build `aiSummary` + `isAiGenerated`, type hóa decisions/actionItems |
| `MinutesService.updateDraft` | như trên | Thêm `aiSummary` vào updatableFields + merge giữ meta; trả `aiSummaryJson` |
| `MinutesService.findMinutesList` | như trên | Select thêm `aiSummaryJson`, map `isAiGenerated` |
| `MinutesDetailResponseDto` | `dto/minutes-detail-response.dto.ts` | Thêm `MinutesAiSummaryDto`, `aiSummary`, `isAiGenerated`, type decisions/actionItems |
| `UpdateDraftMinutesDto` | `dto/update-draft-minutes.dto.ts` | Dùng schema giàu + field `aiSummary` |
| `MinutesListItemDto` | `dto/minutes-list-item.dto.ts` | Thêm `isAiGenerated` |
| `MinutesAiDraftService` / `MinutesAiDraftController` | `services|controllers/minutes-ai-draft.*` | Thêm method + endpoint list AI job |
| `BackgroundJobEntity` (+ index `ix_background_jobs_related`) | `src/modules/administration/entities/background-job.entity.ts` | Query job AI theo meeting |
| `AiDraftJobResponseDto` / pattern `BackgroundJobStatusResponseDto` | `dto/*` | Tham chiếu shape cho DTO job list mới |

### 2.3 Patterns to Follow

- Controller: response `{ success, message, data }`; exception `{ success:false, message, error:{ code, details } }`.
- Ownership check pattern: `userIsSystemAdmin` đã có trong `MinutesAiDraftService`; mở rộng cho Host-hoặc-admin khi list job.
- List query: giữ `.select([...])` + `getManyAndCount()`; thêm `'minutes.aiSummaryJson'` vào select, tính `isAiGenerated` khi map (chấp nhận load jsonb, page ≤ 20 — NFR-001).
- FR-025 (MKM-AI-01) vẫn áp dụng: log chỉ id/status.

### 2.4 Cấu hình mới

Không có env/system_configs/seed/migration mới.

## 3. Scope Confirmation

### 3.1 In Scope

- Schema giàu thống nhất (R1), expose detail (R2), PATCH round-trip (R3), badge list (R4), endpoint list AI job (R5).
- Unit test cho toàn bộ AC mục 7 spec.

### 3.2 Out of Scope

Xem spec.md mục 8 (realtime, endpoint feature-flag, history/diff, auto-map owner, data migration).

### 3.3 Constitution Gate Check

| Gate | Kết quả |
| :--- | :--- |
| DB Gate | PASS — 0 bảng/cột mới; `isAiGenerated` suy ra runtime |
| Security Gate | PASS — không mở rộng visibility; endpoint list job authorize Host/Admin; không expose input_json; không log nhạy cảm |
| Scope Gate | PASS — yêu cầu tường minh của PO 2026-07-13; khóa scope bằng OOS-001→004 |
| Module Gate | PASS — code trong module `minutes`; đọc `background_jobs` qua entity/repository, không import chéo service mới |
| API Gate | PASS — endpoint theo convention `/api/v1/meetings/:meetingId/minutes/ai-draft-jobs`, response chuẩn |
| Auth Gate | PASS — JwtAuthGuard + ownership; permission đọc/sửa dùng lại node hiện có |
| Test Gate | Áp dụng — mục 6 |

## 4. Design

### 4.1 Schema giàu thống nhất (R1)

File `src/modules/minutes/dto/minutes-content.dto.ts`:
- `MinutesDecisionItemDto { text*, confidence?, evidence?, responsibleUserId? }`
- `MinutesActionItemDto { id?, task*, owner?, assigneeUserId?, deadline?, priority?, confidence? }`
- `MinutesAiSummaryEditDto { keyPoints?, risks?, openQuestions?, uncertainParts? }`
- interface `MinutesDecisionItem`, `MinutesActionItem` cho response typing.

Lý do superset: output LLM là tập con → không đổi validator/worker; sửa tay không mất `confidence`/`evidence` (khác biệt cốt lõi so với trước).

### 4.2 Detail expose (R2)

Trong `findMinutesDetail`:
```ts
const aiJson = (minutes.aiSummaryJson ?? null) as Record<string, unknown> | null;
const isAiGenerated = aiJson !== null;
const aiSummary = aiJson
  ? new MinutesAiSummaryDto({ keyPoints, risks, openQuestions, uncertainParts, meta })
  : null;
```
`mainContent.decisions/actionItems` cast sang typed arrays. Guard dùng `?? null` để chịu cả `undefined` (mock test) lẫn `null` (DB).

### 4.3 PATCH round-trip (R3)

`updateDraft`:
- `updatableFields` thêm `'aiSummary'`.
- decisions/actionItems: giữ logic id-gen action item; lưu nguyên schema giàu.
- `aiSummary`: `merged = { ...existingAiJson }` rồi override 4 mảng có gửi → **meta được giữ** vì spread existing trước.
- Response thêm `aiSummaryJson`.

### 4.4 Badge list (R4)

`findMinutesList`: thêm `'minutes.aiSummaryJson'` vào `.select([...])`; khi map `new MinutesListItemDto(...)` truyền `isAiGenerated = minutes.aiSummaryJson != null`. `MinutesListItemDto` thêm field `isAiGenerated` (constructor positional — thêm tham số cuối, cập nhật mọi nơi khởi tạo).

### 4.5 Endpoint list AI job (R5)

- Controller `MinutesAiDraftController`: `@Get('meetings/:meetingId/minutes/ai-draft-jobs')`, `@UseGuards(JwtAuthGuard)`.
- Service `MinutesAiDraftService.listAiDraftJobs(meetingId, authUser)`:
  1. Load meeting; không có → 404 `MEETING_NOT_FOUND`.
  2. Ownership: Host meeting hoặc SYSTEM_ADMIN/BUSINESS_ADMIN; sai → 403 `PERMISSION_DENIED`.
  3. Query `background_jobs` where `relatedEntityType='meeting'`, `relatedEntityId=meetingId`, `jobType=AI_MEETING_SUMMARY`, order `COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST` (bảng không có `created_at`).
  4. Map sang `AiDraftJobSummaryDto` (jobId/status/scheduledAt/startedAt/completedAt/errorMessage/result=outputJson).
- DTO mới `dto/ai-draft-job-summary.dto.ts`.
- Ownership helper: bổ sung `userHasAdminRole` (SYSTEM_ADMIN hoặc BUSINESS_ADMIN) tái dùng pattern `userIsSystemAdmin` sẵn có; list job cho phép cả BUSINESS_ADMIN (đọc, rộng hơn create).

## 5. File Change Map

| File | Loại | Nội dung |
|---|---|---|
| `dto/minutes-content.dto.ts` | mới | Schema giàu thống nhất (R1) |
| `dto/update-draft-minutes.dto.ts` | sửa | Dùng schema giàu + `aiSummary` (R3) |
| `dto/update-draft-minutes-response.dto.ts` | sửa | `+aiSummaryJson` (R3) |
| `dto/minutes-detail-response.dto.ts` | sửa | `+MinutesAiSummaryDto`, `aiSummary`, `isAiGenerated`, type decisions/actionItems (R2) |
| `dto/minutes-list-item.dto.ts` | sửa | `+isAiGenerated` (R4) |
| `dto/ai-draft-job-summary.dto.ts` | mới | Item DTO cho endpoint list job (R5) |
| `services/minutes.service.ts` | sửa | `findMinutesDetail`/`updateDraft`/`findMinutesList` (R2/R3/R4) |
| `services/minutes-ai-draft.service.ts` | sửa | `+listAiDraftJobs` + `userHasAdminRole` (R5) |
| `controllers/minutes-ai-draft.controller.ts` | sửa | `+GET .../ai-draft-jobs` (R5) |
| `services/minutes.service.spec.ts` | sửa | test R2/R3/R4 |
| `services/minutes-ai-draft.service.spec.ts` | sửa | test R5 |

## 6. Test Strategy

Ánh xạ AC → test (NFR-006):

| AC | Test |
|---|---|
| AC-001/002 | `findMinutesDetail`: nháp AI trả aiSummary+isAiGenerated=true; nháp tay trả null/false |
| AC-003 | `updateDraft`: decisions giữ confidence/evidence |
| AC-004 | `updateDraft`: merge aiSummary giữ meta; response có aiSummaryJson |
| AC-005 | validation field lạ (controller/pipe level — smoke, đã bảo đảm bởi forbidNonWhitelisted) |
| AC-006 | `findMinutesList`: item AI có isAiGenerated=true |
| AC-007 | `listAiDraftJobs`: sort desc, map result.minutesId |
| AC-008 | `listAiDraftJobs`: non-owner → 403 |
| AC-009 | `listAiDraftJobs`: rỗng → [] |

Chạy: `npx jest src/modules/minutes`. Build: `npx tsc --noEmit -p tsconfig.build.json`.

## 7. Rollout / Risk

- **Risk 1** — đổi tên field decisions/actionItems (`decision`→`text`, `title`→`task`, `dueDate`→`deadline`) là breaking cho dữ liệu cũ. **Giảm thiểu**: `createDraft` tay không ghi 2 cột này (để null) và feature MKM-AI-01 còn WIP, chưa có dữ liệu production → không cần migration (NFR-004). Ghi rõ để reviewer nắm.
- **Risk 2** — `MinutesListItemDto` constructor positional: thêm tham số phải cập nhật mọi nơi khởi tạo (chỉ `findMinutesList` + `searchMinutesByPerson` nếu có). Kiểm tra grep trước khi sửa.
- **Risk 3** — select thêm `aiSummaryJson` vào list làm tăng payload query. Chấp nhận (page ≤ 20, NFR-001); tối ưu bằng projection boolean là enhancement sau.

## 8. Definition of Done

- Toàn bộ AC mục 7 spec có test pass.
- `npx jest src/modules/minutes` xanh; `tsconfig.build.json` build sạch.
- Docs (spec/plan/tasks/quickstart) đầy đủ + CHANGELOG.
- Không đổi DB/seed/worker; không log nhạy cảm.
- WIP local — KHÔNG tự push (kế thừa ràng buộc MKM-AI-01).
