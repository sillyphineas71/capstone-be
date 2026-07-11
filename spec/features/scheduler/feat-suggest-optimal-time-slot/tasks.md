# Tasks: UC-SM-02 — Chọn khung giờ họp tối ưu (Optimal Time Slot Suggestion)

**Feature ID**: UC-SM-02
**Module**: `scheduling`
**Endpoint**: `POST /api/v1/scheduling/time-suggestions`
**Spec**: `spec/features/scheduler/feat-suggest-optimal-time-slot/spec.md`
**Plan**: `spec/features/scheduler/feat-suggest-optimal-time-slot/plan.md`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md

> Format: `- [ ] TXXX [P] Description with file path`
> `[P]` = có thể chạy song song (khác file, không dependency)

---

## Phase 1: Setup

**Dependency**: Không phụ thuộc phase nào khác.

- [ ] T001 Seed permission mới `scheduling.suggest.times` (migration/seed script theo convention hiện có của module `administration`/`accounts`)
- [ ] T002 [P] Tạo folder `services/` mới nếu cần (đã tồn tại sẵn trong `src/modules/scheduling/`, chỉ cần thêm file mới, không tạo lại structure)

## Phase 2: DTO & Validation Layer

**Dependency**: Cần Phase 1 hoàn thành.

- [ ] T003 [P] Tạo `SuggestTimeSlotDto` trong `src/modules/scheduling/dto/suggest-time-slot.dto.ts` với fields: `requiredParticipantUserIds` (uuid[], optional), `optionalParticipantUserIds` (uuid[], optional), `externalParticipantEmails` (string[], optional), `searchRangeStart` (ISO8601, required), `searchRangeEnd` (ISO8601, required), `durationMinutes` (int 15-480, required), `excludeMeetingId` (uuid, optional), `maxSuggestions` (int 1-10, optional default 5)
- [ ] T004 [P] Tạo `TimeSuggestionItemDto` trong `src/modules/scheduling/dto/time-suggestion-item.dto.ts` theo spec.md mục 5.3
- [ ] T005 [P] Tạo `TimeSuggestionResponseDto` trong `src/modules/scheduling/dto/time-suggestion-response.dto.ts`
- [ ] T006 Custom validation: `searchRangeEnd > searchRangeStart`, `searchRangeStart >= now()`, khoảng cách `<= 30 ngày` (`SCHEDULING_SEARCH_RANGE_TOO_LONG`), `requiredParticipantUserIds ∩ optionalParticipantUserIds = ∅`, tổng participants nội bộ trong `[2, 50]` — tích hợp vào `SuggestTimeSlotDto` (FR-014 → FR-021 của spec.md)

## Phase 3: Core Algorithm — FreeBusyService

**Dependency**: Cần Phase 2 hoàn thành (DTO đã có).

- [ ] T007 Tạo `src/modules/scheduling/services/free-busy.service.ts`: query 1 lần lấy busy interval của N user (theo `data-model.md` mục 2.1), group theo user_id
- [ ] T008 Implement merge-interval 1-pass cho từng user trong `FreeBusyService` (có thể tái sử dụng ý tưởng thuật toán của `ParticipantConflictService.mergeBusySlots`, viết độc lập — KHÔNG import/sửa `ParticipantConflictService` hiện có, tránh phá vỡ UC-SM-04 đang chạy và bug SQL placeholder đã biết của file đó)
- [ ] T009 Implement `complement()` — tính free-interval của 1 user trong `[searchRangeStart, searchRangeEnd]`
- [ ] T010 Implement `intersectAll()` — giao các free-interval của toàn bộ Required participants (bao gồm organizer ngầm định, FR-001)
- [ ] T011 Implement `sliceIntoCandidates()` — sinh candidate slot từ mỗi free window đủ dài (`>= durationMinutes`)
- [ ] T012 Unit test `FreeBusyService`: merge overlap, complement, intersect 2-3 user, slice candidate — theo `data-model.md` mục 2.2

## Phase 4: Orchestration — TimeSuggestionService

**Dependency**: Cần Phase 3 hoàn thành.

- [ ] T013 Tạo `src/modules/scheduling/services/time-suggestion.service.ts`: validate input, resolve organizer từ JWT làm Required ngầm định (FR-001), validate user tồn tại (tái sử dụng pattern `validateUsersExist` của `ParticipantConflictService` — copy logic tương đương, không import chéo service khác domain concern)
- [ ] T014 Implement xử lý `excludeMeetingId` (validate tồn tại + quyền truy cập, tương tự `validateExcludeMeetingAccess`)
- [ ] T015 Implement chấm điểm `matchScore` cho từng candidate theo FR-028, đếm `optionalFreeCount`/`busyParticipants`
- [ ] T016 Implement sort theo FR-029 (matchScore DESC, startTime ASC) và giới hạn `maxSuggestions` (FR-031)
- [ ] T017 Xử lý `externalParticipantEmails` → trả `unknown`, không dùng để tính điểm (FR-008)
- [ ] T018 Xử lý empty result → message chuẩn theo FR-022/ERR-012
- [ ] T019 Unit test `TimeSuggestionService`: happy path, hard-filter Required, ranking Optional, empty result, excludeMeetingId, external participant

## Phase 5: Controller & Wiring

**Dependency**: Cần Phase 4 hoàn thành.

- [ ] T020 Thêm endpoint `POST scheduling/time-suggestions` vào `src/modules/scheduling/scheduling.controller.ts` (sửa file hiện có — thêm method mới, không đổi 2 endpoint đã có) với `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('scheduling.suggest.times')` + `ValidationPipe`
- [ ] T021 Đăng ký `FreeBusyService`, `TimeSuggestionService` vào `providers` của `src/modules/scheduling/scheduling.module.ts`
- [ ] T022 Integration test controller: 401/403/422 cases (AC-003 → AC-009), happy path (AC-001, AC-002), empty result (AC-016), limit (AC-017)

## Phase 6: Documentation Sync

**Dependency**: Cần Phase 5 hoàn thành và pass toàn bộ test.

- [ ] T023 Cập nhật CHANGELOG ở đầu `spec.md`, `plan.md`, `research.md`, `data-model.md`, `tasks.md` với dòng log hoàn thành implement (theo RULE TỐI THƯỢNG 2 của CLAUDE.md)
- [ ] T024 [P] Cập nhật `meeting-booking-api-flow.md` (nếu team maintain file này như tài liệu tổng hợp API) để thêm mục endpoint mới, tránh tài liệu bị lệch với code thật
