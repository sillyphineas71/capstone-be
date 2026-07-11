# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới spec cho UC-SM-02 — Chọn khung giờ họp tối ưu, sau khi phân tích đối chiếu UC gốc (Copy Uc.md), code hiện có (UC-SM-01, UC-SM-04) và chốt 4 quyết định thiết kế với team | Toàn bộ file |

---

# Feature Specification: Chọn khung giờ họp tối ưu (Optimal Time Slot Suggestion)

- **Feature ID**: UC-SM-02 (đã được UC-SM-01 spec đặt trước route dưới tên nội bộ UC-51)
- **Feature Name**: Chọn khung giờ họp tối ưu
- **Module / Domain**: Scheduling Management (`scheduling`)
- **Created Date**: 2026-07-10
- **Status**: Draft
- **Source Documents**:
  - `AGENTS.md` / `CLAUDE.md` (Backend Agent Guide v1.1)
  - `FE_SmarTracking/src/docs/Copy Uc.md` — UC-SM-02 gốc (mục 6.2)
  - `capstone-be/spec/features/scheduler/feat-scheduling-room-suggestions/spec.md` — UC-SM-01 (khuôn mẫu kiến trúc, đã reserve route `POST /api/v1/scheduling/time-suggestions` dưới tên UC-51)
  - `capstone-be/src/modules/scheduling/services/participant-conflict.service.ts` — UC-SM-04 (nguồn logic free/busy tái sử dụng)

---

## 1. Context & Goal

### 1.1 Bối cảnh

UC-SM-02 thuộc module Scheduling Management, hoạt động như một trợ lý lịch trình thông minh khi người tổ chức cần lên lịch một cuộc họp đông người, liên phòng ban hoặc có sự tham gia của cấp quản lý bận rộn. Thay vì phải nhắn tin hỏi từng người rảnh giờ nào, hệ thống tự động rà soát lịch làm việc (`meetings` + `meeting_participants`) của toàn bộ khách mời trong một khoảng thời gian được khoanh vùng, và đề xuất các khung giờ khả thi nhất, xếp hạng theo mức độ "rảnh" của nhóm.

Tính năng này khác biệt với hai tính năng liền kề đã tồn tại trong cùng module:
- **UC-SM-01** (đã implement) gợi ý **phòng** cho một khung giờ đã biết trước.
- **UC-SM-04** (đã implement) kiểm tra xung đột lịch cho **một** khung giờ do người dùng tự chọn (validate 1 điểm).
- **UC-SM-02** (feature này) tìm kiếm và **xếp hạng nhiều khung giờ ứng viên** trong một khoảng ngày rộng hơn (search/ranking, không phải validate 1 điểm).

Tính năng nằm ở giai đoạn **trước cuộc họp** (pre-meeting), độc lập với việc chọn phòng — người dùng chọn giờ trước bằng UC-SM-02, sau đó dùng UC-SM-01 để tìm phòng cho giờ đã chọn (quyết định thiết kế đã chốt: **không gộp chung 1 API**).

### 1.2 Mục tiêu

Cho phép **Internal Employee** nhập danh sách khách mời (phân loại Bắt buộc/Tùy chọn) và một khoảng thời gian mong muốn, để hệ thống tự động trả về danh sách khung giờ đề xuất đã xếp hạng, giảm thao tác thủ công dò lịch từng người.

### 1.3 Giá trị mang lại

- **Người tổ chức**: Không cần nhắn tin hỏi lịch từng người; tiết kiệm thời gian điều phối cuộc họp đông người/liên phòng ban.
- **Người tham dự**: Giảm khả năng bị mời vào giờ trùng lịch, giữ được quyền riêng tư (chỉ lộ trạng thái rảnh/bận, không lộ nội dung).
- **Vận hành**: Giảm số lần phải đổi giờ họp sau khi đã gửi lời mời (giảm tải cho luồng UPDATE_TIME ở `meeting-booking-api-flow.md`).

### 1.4 Giả định

- Dữ liệu bận được suy ra hoàn toàn từ `meetings` + `meeting_participants` nội bộ hệ thống; **không có tích hợp calendar ngoài** (Google/Outlook) trong v1.
- Người gọi API (organizer) luôn được tính là một **Required participant ngầm định**, kể cả khi không có mặt trong `requiredParticipantUserIds`.
- Giờ hành chính/khung giờ hợp lệ để đề xuất không bị giới hạn cứng trong v1 (không áp dụng business-hours filter); có thể bổ sung qua `system_configs` ở phiên bản sau.
- Kết quả là snapshot tại thời điểm query; giống UC-SM-01, không giữ chỗ lịch của bất kỳ ai.

### 1.5 Quyết định thiết kế đã chốt (Design Decisions)

Bốn quyết định sau đã được xác nhận trước khi viết spec này, dùng làm nguồn sự thật khi có mâu thuẫn với UC gốc:

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Giữ nguyên phân loại **Required/Optional** với trọng số theo BR2 của UC gốc (không đơn giản hoá) | Cột `meeting_participants.is_required` đã tồn tại sẵn trong DB, map thẳng không cần schema mới |
| D2 | "Bận" chỉ tính trên meeting có `status IN ('scheduled', 'in_progress')` | Nhất quán với UC-SM-04 đã implement; loại `pending_approval` (chưa chốt) và `draft` |
| D3 | Xây **FreeBusyService** mới dùng thuật toán merge-interval (O(n log n)), không lặp gọi `ParticipantConflictService` theo từng slot rời rạc | Hiệu quả hơn khi search range rộng (nhiều ngày); tránh N×M query rời rạc |
| D4 | **Tách biệt hoàn toàn khỏi UC-SM-01** — API này chỉ trả khung giờ, không kèm phòng | Đúng với Trigger/Description của UC gốc; giữ single responsibility cho từng API |

### 1.6 Định hướng tương lai (Future Enhancements)

- Business-hours filter (config qua `system_configs`), timezone-aware scheduling cho nhân sự đa múi giờ.
- Tích hợp calendar ngoài (nếu roadmap yêu cầu) — hiện tại **không** implement.
- Gộp gợi ý phòng ngay trong response (nếu UX cần "one-click": chọn giờ → tự động kèm phòng).

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee | Người tổ chức cần tìm khung giờ họp chung | Gọi API đề xuất giờ, chọn 1 khung giờ để điền vào biểu mẫu đặt lịch |
| Manager | Quản lý tổ chức họp liên phòng ban | Tương tự Internal Employee |
| Business Admin / System Admin | Quản trị viên | Tương tự Internal Employee |

### 2.2 Role & Permission Rules

- Permission yêu cầu: `scheduling.suggest.times` (đặt tên nhất quán với `scheduling.suggest.rooms` đã có).
- Không giới hạn theo phòng ban — user authenticated có permission được xem trạng thái rảnh/bận (nhị phân) của bất kỳ user nội bộ nào được liệt kê làm khách mời.

### 2.3 Actor Constraints

- Phải đăng nhập (authenticated).
- Phải có quyền `scheduling.suggest.times`.
- Tài khoản phải ở trạng thái active.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

```text
FR-001: THE system SHALL luôn coi user gọi API (organizer, lấy từ JWT) là một Required participant ngầm định, kể cả khi organizer không có trong requiredParticipantUserIds.
FR-002: THE system SHALL merge các khoảng bận (busy interval) chồng lấn của cùng một user trước khi tính free/busy (thuật toán merge-interval, tái sử dụng logic đã có trong ParticipantConflictService.mergeBusySlots).
FR-003: THE system SHALL tính khung giờ rảnh của một user là phần bù (complement) của các khoảng bận đã merge trong ranh giới [searchRangeStart, searchRangeEnd].
FR-004: THE system SHALL chỉ đề xuất các khung giờ ứng viên có 100% Required participants (bao gồm organizer) đều rảnh — đây là điều kiện lọc cứng (hard filter), không phải chỉ là trọng số ưu tiên.
FR-005: THE system SHALL trả về kết quả dưới dạng snapshot tại thời điểm query, không giữ chỗ hay khoá lịch của bất kỳ participant nào.
```

### 3.2 Event-driven Requirements

```text
FR-006: WHEN người dùng gửi POST tới `/api/v1/scheduling/time-suggestions` với body hợp lệ, THE system SHALL validate input trước khi chạy thuật toán tìm khung giờ.
FR-007: WHEN hệ thống tính được ít nhất 1 khung giờ ứng viên thoả FR-004 và đủ độ dài >= durationMinutes, THE system SHALL chấm điểm (matchScore) và xếp hạng toàn bộ ứng viên trước khi trả kết quả.
FR-008: WHEN externalParticipantEmails được truyền, THE system SHALL trả trạng thái `unknown` cho các email này và KHÔNG dùng chúng để tính matchScore hay lọc slot (nhất quán với UC-SM-04 Exception E1).
```

### 3.3 State-driven Requirements

```text
FR-009: WHILE một meeting có status thuộc {'draft', 'pending_approval', 'completed', 'cancelled'} HOẶC đã bị soft-delete (`deleted_at IS NOT NULL`), THE system SHALL KHÔNG tính meeting đó là khoảng bận (Quyết định D2).
FR-010: WHILE một meeting có status thuộc {'scheduled', 'in_progress'} VÀ overlap với search range, THE system SHALL tính khoảng [start_time, end_time] của meeting đó là bận cho toàn bộ user có mặt trong `meeting_participants` với `meeting_id` tương ứng.
```

### 3.4 Optional Feature Requirements

```text
FR-011: WHERE optionalParticipantUserIds được truyền, THE system SHALL tính optionalFreeCount cho từng slot ứng viên và dùng làm tiêu chí xếp hạng phụ (secondary ranking), KHÔNG dùng để loại slot (Quyết định D1/BR2).
FR-012: WHERE excludeMeetingId được truyền, THE system SHALL loại trừ chính meeting đó khỏi việc tính bận (dùng cho luồng đổi giờ của một meeting đã tồn tại), và THE system SHALL kiểm tra quyền truy cập meeting đó trước khi xử lý (tái sử dụng logic `validateExcludeMeetingAccess` của UC-SM-04).
FR-013: WHERE maxSuggestions được truyền, THE system SHALL giới hạn số lượng kết quả trả về theo giá trị này (tối đa 10, mặc định 5 nếu không truyền).
```

### 3.5 Unwanted Behavior Requirements

```text
FR-014: IF searchRangeStart hoặc searchRangeEnd không đúng định dạng ISO-8601 có timezone hoặc thiếu, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `VALIDATION_ERROR`.
FR-015: IF searchRangeEnd <= searchRangeStart, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `VALIDATION_ERROR`.
FR-016: IF searchRangeStart nằm trong quá khứ, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `VALIDATION_ERROR`.
FR-017: IF khoảng cách (searchRangeEnd - searchRangeStart) lớn hơn 30 ngày, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `SCHEDULING_SEARCH_RANGE_TOO_LONG` và message "Khoảng thời gian tìm kiếm không được vượt quá 30 ngày." (giới hạn chi phí tính toán; tương tự tinh thần FR-015 của UC-SM-01 giới hạn 24h cho phòng, nhưng nới rộng hơn vì đây là search nhiều slot chứ không phải 1 khung giờ).
FR-018: IF durationMinutes không được cung cấp, không phải số nguyên dương, nhỏ hơn 15 hoặc lớn hơn 480, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `VALIDATION_ERROR`.
FR-019: IF requiredParticipantUserIds + optionalParticipantUserIds (sau khi cộng organizer ngầm định) có tổng số user nội bộ nhỏ hơn 2, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `VALIDATION_ERROR`, message tương ứng Precondition PRE-2 của UC gốc ("Cần ít nhất 2 người tham gia").
FR-020: IF một userId trong requiredParticipantUserIds hoặc optionalParticipantUserIds không tồn tại hoặc đã bị xoá, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `VALIDATION_ERROR` (tái sử dụng `validateUsersExist` của UC-SM-04).
FR-021: IF một userId xuất hiện đồng thời ở cả requiredParticipantUserIds và optionalParticipantUserIds, THEN THE system SHALL từ chối yêu cầu với HTTP 422, error code `VALIDATION_ERROR`, message "Một người dùng không thể vừa là khách mời bắt buộc vừa là tùy chọn."
FR-022: IF không có bất kỳ khung giờ nào trong toàn bộ search range thoả FR-004 với độ dài >= durationMinutes, THEN THE system SHALL trả về HTTP 200 với danh sách rỗng và message "Không tìm thấy khung giờ chung nào phù hợp. Vui lòng thử mở rộng khoảng thời gian tìm kiếm hoặc giảm bớt số lượng khách mời." (Exception E1 của UC gốc — không trả 404).
FR-023: IF người dùng chưa đăng nhập hoặc token hết hạn, THEN THE system SHALL trả về HTTP 401.
FR-024: IF người dùng không có quyền `scheduling.suggest.times`, THEN THE system SHALL trả về HTTP 403.
```

### 3.6 Authorization Requirements

```text
FR-025: IF the user is not authenticated, THEN THE system SHALL reject access to this feature with HTTP 401.
FR-026: IF the user does not have permission `scheduling.suggest.times`, THEN THE system SHALL reject the request with HTTP 403.
```

### 3.7 Data & State Requirements

```text
FR-027: THE system SHALL tính overlap giữa meeting và search range bằng logic: `meeting.start_time < :searchRangeEnd AND meeting.end_time > :searchRangeStart` (cùng dạng overlap logic đã dùng ở UC-SM-01/UC-SM-04).
FR-028: THE system SHALL tính matchScore cho mỗi slot ứng viên theo công thức: `round((requiredFreeCount + optionalFreeCount) / totalInternalParticipants * 100)`, trong đó requiredFreeCount luôn bằng requiredTotal (do FR-004 là hard filter).
FR-029: THE system SHALL xếp hạng danh sách slot theo thứ tự: 1. matchScore DESC (tương đương optionalFreeCount DESC), 2. startTime ASC.
FR-030: THE system SHALL trả về busyParticipants (chỉ gồm optional participants đang bận, vì required luôn rảnh theo FR-004) dưới dạng userId + busyFrom + busyTo, KHÔNG kèm tiêu đề/nội dung meeting (Business Rule BR1).
FR-031: THE system SHALL giới hạn số slot trả về tối đa theo `maxSuggestions` (mặc định 5, tối đa 10).
```

### 3.8 Requirement Notes

- Feature này hoàn toàn read-only, không ghi bản ghi nào vào DB (trừ audit log nếu convention team yêu cầu).
- Không tạo bảng mới — dùng lại `meetings`, `meeting_participants`, `users`.
- Không tự động kèm gợi ý phòng — người dùng dùng `GET /api/v1/scheduling/room-suggestions` (UC-SM-01) sau khi đã chọn giờ (Quyết định D4).
- BusyParticipants trong response chỉ để phục vụ AF1 (hiển thị "ai đang bận" khi người dùng click vào 1 slot không hoàn hảo) — không hiển thị mặc định trên danh sách rút gọn, tránh lộ thông tin không cần thiết ngay từ đầu.

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-SM-02, PRE-2 | Organizer implicit required |
| FR-002 | Ubiquitous | UC-SM-04 (reuse) | Merge busy interval |
| FR-003 | Ubiquitous | UC-SM-02, Normal Flow 5 | Free = complement of busy |
| FR-004 | Ubiquitous | UC-SM-02, BR2 (D1) | Required = hard filter |
| FR-005 | Ubiquitous | UC-SM-01 (pattern) | Snapshot, không giữ chỗ |
| FR-006 | Event-driven | UC-SM-02 | Validate input |
| FR-007 | Event-driven | UC-SM-02, Normal Flow 5-6 | Chấm điểm & xếp hạng |
| FR-008 | Event-driven | UC-SM-04, E1 (reuse) | External participant unknown |
| FR-009 | State-driven | UC-SM-02 (D2) | Trạng thái meeting không tính bận |
| FR-010 | State-driven | UC-SM-02 (D2) | Trạng thái meeting tính bận |
| FR-011 | Optional Feature | UC-SM-02, BR2 | Optional = secondary ranking |
| FR-012 | Optional Feature | UC-SM-04 (reuse) | excludeMeetingId |
| FR-013 | Optional Feature | UC-SM-02 | maxSuggestions |
| FR-014–FR-021 | Unwanted Behavior | UC-SM-02, E1 / PRE-2 | Validation input |
| FR-022 | Unwanted Behavior | UC-SM-02, E1 | Empty result |
| FR-023–FR-024 | Unwanted Behavior | UC-SM-02 | 401/403 |
| FR-025–FR-026 | Authorization | UC-SM-02 | 401/403 |
| FR-027 | Data & State | UC-SM-01/04 (pattern) | Overlap logic |
| FR-028 | Data & State | UC-SM-02, BR2 | Match score formula |
| FR-029 | Data & State | UC-SM-02, Normal Flow 6 | Sort logic |
| FR-030 | Data & State | UC-SM-02, BR1 / AF1 | Busy participants (no event detail) |
| FR-031 | Data & State | UC-SM-02 | Result limit |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL trả về kết quả trong vòng 5 giây với search range tối đa 30 ngày và tối đa 50 participants (yêu cầu cao hơn UC-SM-01 do phải quét nhiều ngày, không phải 1 khung giờ).
NFR-002: THE system SHALL giới hạn tổng số participants (required + optional) tối đa 50 người mỗi request, trả HTTP 422 nếu vượt quá (tránh truy vấn quá nặng).
```

### 4.2 Security

```text
NFR-003: THE system SHALL require authentication trước khi cho phép truy cập tính năng.
NFR-004: THE system SHALL enforce authorization qua permission `scheduling.suggest.times`.
NFR-005: THE system SHALL NOT trả tiêu đề, mô tả, hay bất kỳ chi tiết nội dung meeting nào của participant khác trong response (chỉ busyFrom/busyTo) — Business Rule BR1.
```

### 4.3 Reliability & Consistency

```text
NFR-006: THE system SHALL đảm bảo toàn bộ dữ liệu bận được query trong cùng một snapshot thời điểm (tránh race giữa các participant khác nhau cho ra kết quả không nhất quán).
```

### 4.4 Usability

```text
NFR-007: THE system SHALL trả error message và response theo đúng convention chung của dự án (success/message/data/meta).
NFR-008: THE system SHALL dùng field names camelCase nhất quán với API contract hiện có.
```

### 4.5 Observability

```text
NFR-009: THE system SHALL log lỗi và các trường hợp xử lý thất bại quan trọng cho feature này.
```

### 4.6 Maintainability

```text
NFR-010: THE system SHALL đặt logic tìm khung giờ trong module `scheduling`, dưới service mới `FreeBusyService`/`TimeSuggestionService`, tái sử dụng thuật toán merge-interval hiện có trong `ParticipantConflictService` (extract thành shared helper nếu hợp lý, không copy-paste trùng logic).
NFR-011: THE system SHALL có test cho: happy path, validation failures, authorization failures, hard-filter Required, ranking theo Optional, empty result, excludeMeetingId, external participant.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meetings` | Nguồn xác định khoảng thời gian bận | Dùng `start_time`, `end_time`, `status`, `deleted_at`; chỉ tính bận khi `status IN ('scheduled','in_progress')` |
| `meeting_participants` | Xác định meeting nào thuộc về user nào | Dùng `meeting_id`, `user_id`; KHÔNG dùng `invitation_status` để lọc (một lời mời `pending` của một meeting `scheduled` vẫn tính là bận, vì thời gian đã bị chiếm trên lịch dù participant chưa accept) |
| `users` | Validate participant tồn tại | Dùng `id`, `deleted_at IS NULL` |

### 5.2 Dữ liệu đầu vào (Request Body — `SuggestTimeSlotDto`)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---:|---|---|
| `requiredParticipantUserIds` | uuid[] | Không (có thể rỗng, organizer luôn required ngầm định) | Danh sách khách mời bắt buộc | Không trùng nhau, không trùng với optionalParticipantUserIds, mỗi id phải tồn tại |
| `optionalParticipantUserIds` | uuid[] | Không | Danh sách khách mời tùy chọn | Tương tự trên |
| `externalParticipantEmails` | string[] | Không | Khách mời ngoài tổ chức | Không dùng để lọc/chấm điểm, chỉ trả `unknown` |
| `searchRangeStart` | string (ISO-8601) | Có | Bắt đầu khoảng tìm kiếm | >= now(), đúng định dạng |
| `searchRangeEnd` | string (ISO-8601) | Có | Kết thúc khoảng tìm kiếm | > searchRangeStart, khoảng cách <= 30 ngày |
| `durationMinutes` | integer | Có | Thời lượng cuộc họp dự kiến | 15 <= x <= 480 |
| `excludeMeetingId` | uuid | Không | Loại trừ 1 meeting khỏi tính bận (dùng khi đổi giờ meeting đã tồn tại) | Phải tồn tại, requester phải có quyền truy cập |
| `maxSuggestions` | integer | Không | Số lượng slot tối đa trả về | 1 <= x <= 10, mặc định 5 |

### 5.3 Dữ liệu đầu ra

Response `data` (mảng `TimeSuggestionItemDto`):

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `startTime` | ISO-8601 | Bắt đầu slot đề xuất |
| `endTime` | ISO-8601 | Kết thúc slot đề xuất (= startTime + durationMinutes) |
| `matchScore` | number (0-100) | Điểm phù hợp, xem FR-028 |
| `requiredFreeCount` / `requiredTotal` | integer | Luôn bằng nhau (hard filter FR-004) |
| `optionalFreeCount` / `optionalTotal` | integer | Dùng hiển thị dạng "8/10 người rảnh" (cộng cả required) |
| `busyParticipants` | array | Chỉ optional participants đang bận: `{ userId, busyFrom, busyTo }` |

Response `meta`: `{ searchRangeStart, searchRangeEnd, durationMinutes, totalCandidatesEvaluated, resultLimit }`.

### 5.4 State / Status Model

| Status | Ý nghĩa | Tính là bận? |
|---|---|:---:|
| `draft` | Chưa gửi duyệt | Không |
| `pending_approval` | Đang chờ duyệt | Không (Quyết định D2) |
| `scheduled` | Đã duyệt/xác nhận | Có |
| `in_progress` | Đang diễn ra | Có |
| `completed` | Đã kết thúc | Không |
| `cancelled` | Đã hủy | Không |

### 5.5 Data Constraints

- `meetings.deleted_at IS NULL` bắt buộc khi tính bận.
- `requiredParticipantUserIds` và `optionalParticipantUserIds` không được giao nhau (FR-021).
- Tổng participants nội bộ (bao gồm organizer) tối thiểu 2 (FR-019), tối đa 50 (NFR-002).

### 5.6 Data Lifecycle

- Read-only, không tạo/cập nhật bản ghi nào ngoài audit log tuỳ policy.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF searchRangeStart/searchRangeEnd missing hoặc sai định dạng, THEN HTTP 422, `VALIDATION_ERROR`.
ERR-002: IF searchRangeEnd <= searchRangeStart, THEN HTTP 422, `VALIDATION_ERROR`.
ERR-003: IF searchRangeStart trong quá khứ, THEN HTTP 422, `VALIDATION_ERROR`.
ERR-004: IF khoảng tìm kiếm > 30 ngày, THEN HTTP 422, `SCHEDULING_SEARCH_RANGE_TOO_LONG`.
ERR-005: IF durationMinutes invalid (thiếu, không phải int, <15 hoặc >480), THEN HTTP 422, `VALIDATION_ERROR`.
ERR-006: IF tổng participants nội bộ < 2, THEN HTTP 422, `VALIDATION_ERROR`.
ERR-007: IF tổng participants nội bộ > 50, THEN HTTP 422, `VALIDATION_ERROR`.
ERR-008: IF một userId không tồn tại/đã xoá, THEN HTTP 422, `VALIDATION_ERROR`.
ERR-009: IF một userId trùng ở cả required và optional, THEN HTTP 422, `VALIDATION_ERROR`.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-010: IF chưa đăng nhập, THEN HTTP 401, `TOKEN_EXPIRED` hoặc `TOKEN_REVOKED`.
ERR-011: IF không có quyền `scheduling.suggest.times`, THEN HTTP 403, `PERMISSION_DENIED`.
```

### 6.3 Business Rule Errors

```text
ERR-012: IF không tìm thấy khung giờ nào thoả FR-004 với đủ độ dài, THEN HTTP 200, data rỗng, message "Không tìm thấy khung giờ chung nào phù hợp. Vui lòng thử mở rộng khoảng thời gian tìm kiếm hoặc giảm bớt số lượng khách mời." (không trả 404).
ERR-013: IF excludeMeetingId không tồn tại, THEN HTTP 404, `RESOURCE_NOT_FOUND`.
ERR-014: IF requester không có quyền truy cập excludeMeetingId (không phải organizer/participant), THEN HTTP 403, `PERMISSION_DENIED`.
```

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001: [Happy Path — Có slot hoàn hảo]
Given tất cả Required participants (kể cả organizer) đều rảnh trong một khoảng >= durationMinutes,
When người dùng gửi POST request hợp lệ tới `/api/v1/scheduling/time-suggestions`,
Then the system trả HTTP 200 với ít nhất 1 slot có matchScore = 100.

AC-002: [Happy Path — Nhiều slot, xếp hạng đúng]
Given có 3 slot ứng viên hợp lệ với optionalFreeCount khác nhau,
When hệ thống xử lý,
Then the system trả về danh sách sort theo matchScore DESC, startTime ASC khi bằng điểm.
```

### 7.2 Validation Cases

```text
AC-003: [Validation — Thiếu searchRangeStart/End]
Given thiếu 1 trong 2 field,
When gửi request,
Then HTTP 422, `VALIDATION_ERROR`.

AC-004: [Validation — Khoảng tìm kiếm > 30 ngày]
Given searchRangeEnd - searchRangeStart > 30 ngày,
When gửi request,
Then HTTP 422, `SCHEDULING_SEARCH_RANGE_TOO_LONG`.

AC-005: [Validation — durationMinutes ngoài khoảng 15-480]
Given durationMinutes = 5 hoặc 600,
When gửi request,
Then HTTP 422, `VALIDATION_ERROR`.

AC-006: [Validation — Tổng participants < 2]
Given chỉ có organizer, không có participant nào khác,
When gửi request,
Then HTTP 422, `VALIDATION_ERROR`.

AC-007: [Validation — userId trùng ở cả required và optional]
Given cùng 1 userId xuất hiện ở cả 2 danh sách,
When gửi request,
Then HTTP 422, `VALIDATION_ERROR`.
```

### 7.3 Authorization Cases

```text
AC-008: [Auth — Chưa đăng nhập] → HTTP 401.
AC-009: [Auth — Không đủ quyền `scheduling.suggest.times`] → HTTP 403.
```

### 7.4 Business Rule Cases

```text
AC-010: [Business Rule — Required là hard filter]
Given 1 Required participant bận trong toàn bộ search range,
When hệ thống xử lý,
Then the system KHÔNG trả bất kỳ slot nào chứa khoảng bận đó của Required participant (dù Optional participants đều rảnh).

AC-011: [Business Rule — Optional chỉ ảnh hưởng ranking]
Given slot A có 100% Optional rảnh, slot B có 50% Optional rảnh, cả 2 đều thoả Required,
When hệ thống xếp hạng,
Then slot A có matchScore cao hơn slot B và đứng trước trong danh sách; slot B vẫn xuất hiện trong kết quả (không bị loại).

AC-012: [Business Rule — Trạng thái meeting không tính bận]
Given một meeting của participant đang ở status `pending_approval` trùng giờ,
When hệ thống xử lý,
Then meeting đó KHÔNG được tính là khoảng bận (D2).

AC-013: [Business Rule — Organizer ngầm định Required]
Given organizer không có trong requiredParticipantUserIds nhưng đang bận trong 1 khoảng,
When hệ thống xử lý,
Then khoảng đó KHÔNG được đề xuất là slot.

AC-014: [Business Rule — External participant]
Given có externalParticipantEmails được truyền,
When hệ thống xử lý,
Then response trả `unknown` cho các email đó và KHÔNG dùng để tính matchScore hay loại slot.

AC-015: [Business Rule — Không lộ chi tiết meeting]
Given một Optional participant đang bận vì một meeting có tiêu đề nhạy cảm,
When hệ thống trả busyParticipants,
Then response CHỈ chứa userId + busyFrom + busyTo, KHÔNG chứa title/description/roomId của meeting đó.
```

### 7.5 Empty Result Cases

```text
AC-016: [Empty — Không tìm thấy slot]
Given không có khoảng nào trong search range mà toàn bộ Required rảnh đủ durationMinutes,
When hệ thống xử lý,
Then HTTP 200, data rỗng, message "Không tìm thấy khung giờ chung nào phù hợp. Vui lòng thử mở rộng khoảng thời gian tìm kiếm hoặc giảm bớt số lượng khách mời."
```

### 7.6 Result Limit Cases

```text
AC-017: [Limit — maxSuggestions]
Given có 20 slot hợp lệ và maxSuggestions = 5,
When hệ thống xử lý,
Then the system chỉ trả 5 slot tốt nhất sau khi sort.
```

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-004, FR-007, FR-028 | Happy path perfect slot |
| AC-002 | FR-029 | Sort by matchScore/startTime |
| AC-003 | FR-014, ERR-001 | Missing time range |
| AC-004 | FR-017, ERR-004 | Range > 30 days |
| AC-005 | FR-018, ERR-005 | duration invalid |
| AC-006 | FR-019, ERR-006 | < 2 participants |
| AC-007 | FR-021, ERR-009 | Duplicate userId across lists |
| AC-008 | FR-025, ERR-010 | Unauthenticated |
| AC-009 | FR-026, ERR-011 | Unauthorized |
| AC-010 | FR-004 | Required hard filter |
| AC-011 | FR-011, FR-028, FR-029 | Optional secondary ranking |
| AC-012 | FR-009 | pending_approval not busy |
| AC-013 | FR-001 | Organizer implicit required |
| AC-014 | FR-008 | External unknown |
| AC-015 | FR-030, NFR-005 | No event detail leak |
| AC-016 | FR-022, ERR-012 | Empty result |
| AC-017 | FR-013, FR-031 | maxSuggestions limit |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- **Không tạo meeting/meeting_request/room_booking**: chỉ trả gợi ý.
- **Không giữ chỗ tạm thời**: kết quả là snapshot.
- **Không gợi ý phòng họp**: tách biệt khỏi UC-SM-01 (Quyết định D4).
- **Không tích hợp calendar ngoài** (Google/Outlook) cho external participants.
- **Không áp dụng business-hours filter** trong v1 (đề xuất cả ngoài giờ hành chính nếu đúng rảnh).
- **Không hỗ trợ timezone khác nhau giữa participants** trong v1 — giả định toàn bộ dùng chung timezone server.
- **Không thêm bảng mới** — dùng lại `meetings`, `meeting_participants`, `users`.

### 8.2 Có thể xem xét ở feature khác

- Gộp gợi ý giờ + phòng trong 1 lần gọi (nếu UX cần "one-click scheduling").
- Business-hours / working-hours config qua `system_configs`.
- Timezone-aware suggestion khi công ty có site đa vùng.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT create any meeting, meeting_request, or room_booking record as part of this feature.
OOS-002: THE system SHALL NOT hold or lock any participant's calendar as part of the suggestion query.
OOS-003: THE system SHALL NOT include room availability in the response of this feature.
OOS-004: THE system SHALL NOT integrate with any external calendar provider in v1.
OOS-005: THE system SHALL NOT expose meeting title, description, or roomId of other participants' busy events.
```
