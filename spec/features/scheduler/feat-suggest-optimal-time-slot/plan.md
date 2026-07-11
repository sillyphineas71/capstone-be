# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới plan.md cho UC-SM-02 | Toàn bộ file |

---

# Implementation Plan: UC-SM-02 — Chọn khung giờ họp tối ưu

> **Feature ID**: UC-SM-02 (nội bộ code từng gọi UC-51 trong spec UC-SM-01)
> **Module**: `scheduling`
> **Endpoint**: `POST /api/v1/scheduling/time-suggestions`
> **Permission**: `scheduling.suggest.times` (permission mới — cần seed)
> **Spec**: `spec/features/scheduler/feat-suggest-optimal-time-slot/spec.md`
> **Research**: `spec/features/scheduler/feat-suggest-optimal-time-slot/research.md`

---

## 1. Feature Summary

UC-SM-02 cung cấp API `POST /api/v1/scheduling/time-suggestions` — quét lịch bận (`meetings` + `meeting_participants`) của danh sách khách mời (Required/Optional) trong một khoảng ngày, trả về danh sách khung giờ đề xuất đã xếp hạng theo mức độ rảnh. Read-only, không tạo/giữ chỗ gì, tách biệt hoàn toàn khỏi gợi ý phòng (UC-SM-01).

---

## 2. Technical Context

### 2.1 Module hiện tại
- `scheduling` module đã có `SchedulingController`, `SchedulingService`, `ParticipantConflictService` — cần bổ sung service mới, không sửa 2 service hiện có (tránh phá vỡ UC-SM-01/UC-SM-04 đang chạy).
- `meetings` module có `MeetingEntity`, `MeetingParticipantEntity` — dùng qua `TypeOrmModule.forFeature` hoặc raw query qua `EntityManager` (theo convention module `scheduling` đã dùng).

### 2.2 Thành phần cần tạo mới
| File | Vai trò |
|---|---|
| `src/modules/scheduling/dto/suggest-time-slot.dto.ts` | Request body DTO |
| `src/modules/scheduling/dto/time-suggestion-item.dto.ts` | Response item DTO |
| `src/modules/scheduling/dto/time-suggestion-response.dto.ts` | Response wrapper DTO |
| `src/modules/scheduling/services/free-busy.service.ts` | Core: tính busy interval, merge, intersect Required, tính free gap |
| `src/modules/scheduling/services/time-suggestion.service.ts` | Orchestrator: validate → gọi `FreeBusyService` → generate candidate → score → rank → limit |
| `src/modules/scheduling/scheduling.controller.ts` | Thêm endpoint `POST scheduling/time-suggestions` (sửa file hiện có, không tạo controller mới) |

### 2.3 Thuật toán cốt lõi (`FreeBusyService`)

```text
1. Input: requiredUserIds (đã cộng organizer), optionalUserIds, searchRangeStart, searchRangeEnd, durationMinutes.
2. Query 1 lần: lấy toàn bộ (user_id, start_time, end_time) của meetings status IN ('scheduled','in_progress'),
   deleted_at IS NULL, overlap [searchRangeStart, searchRangeEnd], user_id IN (required ∪ optional),
   loại trừ excludeMeetingId nếu có.
3. Group theo user_id → merge-interval mỗi user (thuật toán 1-pass, tương tự ParticipantConflictService.mergeBusySlots).
4. Với nhóm Required: tính free-interval của từng user = complement trong [searchRangeStart, searchRangeEnd],
   sau đó intersect toàn bộ free-interval của các Required user (sweep line qua các mốc start/end đã sort)
   → ra danh sách "requiredFreeWindows".
5. Với mỗi window trong requiredFreeWindows có length >= durationMinutes:
   sinh candidate slot [windowStart, windowStart + durationMinutes] (và có thể thêm few slot cách nhau
   granularity 15 phút trong cùng window nếu window dài hơn nhiều lần duration, để có đa dạng lựa chọn).
6. Với mỗi candidate: đếm optionalFreeCount bằng cách check overlap với busy-interval đã merge của từng
   optional user (không cần intersect, chỉ point-check).
7. Tính matchScore, sort, cắt theo maxSuggestions.
```

### 2.4 Pattern sử dụng
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('scheduling.suggest.times')`.
- Response: `{ success, message, data, meta }`.
- Validation: DTO + `class-validator`, `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })`.
- Tái sử dụng (không copy-paste): cân nhắc extract `mergeBusySlots` từ `ParticipantConflictService` thành shared util nếu `FreeBusyService` cần logic giống hệt — quyết định cụ thể để lúc code review, không bắt buộc trong spec.

---

## 3. Scope Confirmation

### 3.1 In Scope
- `POST /api/v1/scheduling/time-suggestions` endpoint + DTOs.
- `FreeBusyService` (merge-interval, intersection theo Required, free-gap calculation).
- `TimeSuggestionService` (orchestration, scoring, ranking, limit).
- Seed permission `scheduling.suggest.times`.
- Validate input theo FR-014 → FR-021 của spec.md.
- Unit test cho: happy path, hard-filter Required, ranking Optional, empty result, excludeMeetingId, external participant, validation errors.

### 3.2 Out of Scope (theo spec.md mục 8)
- Không tạo meeting/meeting_request/room_booking.
- Không giữ chỗ lịch.
- Không kèm gợi ý phòng (tách biệt UC-SM-01).
- Không tích hợp calendar ngoài.
- Không business-hours/timezone filter trong v1.
- Không sửa `ParticipantConflictService` hiện có (bug SQL placeholder đã tách task riêng, không nằm trong scope UC-SM-02).

---

## 4. Open Items cho Code Review (không phải blocker viết spec)

- Quyết định cuối: có extract `mergeBusySlots` thành shared helper hay để `FreeBusyService` tự viết lại logic tương tự (trade-off: shared code vs. tránh sửa file đang chạy UC-SM-04).
- Xác nhận permission name `scheduling.suggest.times` với Phụ lục A của API Contract (nếu file đó có bảng permission tổng, cần seed đúng theo format hiện có).
