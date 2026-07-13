# Task List: AI Minutes Review Integration (MKM-AI-02)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Khởi tạo tasks cho feat-ai-minutes-review-integration theo plan.md (2026-07-13) — 8 task, 3 phase. Đánh dấu T001–T004 (schema giàu + expose detail + PATCH round-trip) ĐÃ hoàn thành trước khi viết doc; T005–T008 (badge list + endpoint list AI job + test) còn lại | Toàn bộ file |
| 2026-07-13 | ✅ Hoàn thành T005–T008: badge `isAiGenerated` trên list (2 query select + 2 call site + DTO), DTO `AiDraftJobSummaryDto`, `listAiDraftJobs` (ownership Host/Admin, sort timeline DESC NULLS FIRST), controller `GET /meetings/:meetingId/minutes/ai-draft-jobs`, +6 unit test. `npx jest src/modules/minutes` = 9 suites / 151 tests pass; build `tsconfig.build.json` sạch. **FEATURE MKM-AI-02 HOÀN TẤT 8/8 TASK** | Checklist T005–T008, DoD |

**Input**: [spec.md](./spec.md) (2026-07-13), [plan.md](./plan.md) (2026-07-13)

## Checklist

- [x] T001 [R1] Schema giàu thống nhất → `src/modules/minutes/dto/minutes-content.dto.ts`
- [x] T002 [R3] PATCH dùng schema giàu + `aiSummary`; response `+aiSummaryJson` → `dto/update-draft-minutes.dto.ts`, `dto/update-draft-minutes-response.dto.ts`, `services/minutes.service.ts` (`updateDraft` merge giữ meta)
- [x] T003 [R2] Expose detail: `MinutesAiSummaryDto` + `aiSummary` + `isAiGenerated` + type decisions/actionItems → `dto/minutes-detail-response.dto.ts`, `services/minutes.service.ts` (`findMinutesDetail`)
- [x] T004 [R2/R3] Unit test detail expose + PATCH round-trip (giữ confidence/evidence; merge aiSummary giữ meta) → `services/minutes.service.spec.ts`
- [x] T005 [R4] Badge `isAiGenerated` trên list → `dto/minutes-list-item.dto.ts`, `services/minutes.service.ts` (`findMinutesList` + `searchMinutesByPerson` select + map)
- [x] T006 [R5] DTO + service `listAiDraftJobs` (ownership Host/Admin, sort timeline DESC NULLS FIRST) → `dto/ai-draft-job-summary.dto.ts`, `services/minutes-ai-draft.service.ts`
- [x] T007 [R5] Controller `GET /meetings/:meetingId/minutes/ai-draft-jobs` → `controllers/minutes-ai-draft.controller.ts`
- [x] T008 [R4/R5] Unit test badge list + listAiDraftJobs (owner/admin/forbidden/empty/sort) → `services/minutes-list.service.spec.ts`, `services/minutes-ai-draft.service.spec.ts`

> **Điểm dừng an toàn**: sau T004 — FE đã đọc & sửa tay được kết quả AI (luồng review khép kín). T005–T008 hoàn thiện badge + resume-poll.

---

## Tổng quan Phase

### Phase A — Read/Edit core (T001–T004) — ✅ HOÀN THÀNH 2026-07-13

**Mục tiêu**: FE đọc đầy đủ kết quả AI và sửa tay trọn vẹn không mất dữ liệu.

| Nhiệm vụ | Task |
|---|---|
| Schema giàu thống nhất dùng chung AI + tay | T001 |
| PATCH nhận schema giàu + `aiSummary`, merge giữ `meta`, trả `aiSummaryJson` | T002 |
| Expose `aiSummary`/`isAiGenerated`/typed decisions/actionItems ở GET detail | T003 |
| Unit test detail + PATCH round-trip | T004 |

**Checkpoint (đạt)**: `npx jest src/modules/minutes` = 9 suites / 143 tests pass (gồm 2 test mới); `tsconfig.build.json` build sạch.

### Phase B — List badge (T005) — ✅ HOÀN THÀNH 2026-07-13

**Mục tiêu**: Danh sách biên bản phân biệt nháp-AI.

| Nhiệm vụ | Task |
|---|---|
| `MinutesListItemDto.isAiGenerated` + select `aiSummaryJson` trong `findMinutesList` | T005 |

**Checkpoint**: list trả `isAiGenerated` đúng cho item AI và tay; test list cũ vẫn pass (constructor positional cập nhật đủ chỗ).

### Phase C — Resume poll endpoint (T006–T008) — ✅ HOÀN THÀNH 2026-07-13

**Mục tiêu**: FE lấy lại job AI theo meeting để tiếp tục theo dõi sau reload.

| Nhiệm vụ | Task |
|---|---|
| DTO `AiDraftJobSummaryDto` + `listAiDraftJobs` (ownership, sort desc, map result) | T006 |
| Controller `GET /meetings/:meetingId/minutes/ai-draft-jobs` | T007 |
| Unit test badge + listAiDraftJobs (owner/admin/forbidden/empty/sort) | T008 |

**Checkpoint**: endpoint trả mảng job desc; 403 khi non-owner; `[]` khi chưa có job; build + test xanh.

---

## Definition of Done (toàn feature)

- [x] Tất cả AC (spec mục 7) có test pass.
- [x] `npx jest src/modules/minutes` xanh (9 suites / 151 tests); build `tsconfig.build.json` sạch.
- [x] 4 file docs đầy đủ + CHANGELOG cập nhật.
- [x] Không đổi DB/seed/worker AI; không log nhạy cảm.
- [ ] WIP local — không tự push (kế thừa MKM-AI-01).
