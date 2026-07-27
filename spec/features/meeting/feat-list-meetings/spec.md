# BE-02 — GET /api/v1/meetings (List cuộc họp, admin)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo spec lần đầu cho BE-02 (endpoint list meetings còn thiếu — `meetings.controller.ts` chỉ có `GET meetings/:meetingId`, không có `GET meetings`). | Toàn bộ file |

---

## 1. Bối cảnh

FE admin cần màn danh sách tất cả cuộc họp (không giới hạn theo participant như `GET /meetings/my-schedule`), nhưng backend chưa có endpoint này. Đây là endpoint list-level đầu tiên cho resource `meetings`, tách biệt hoàn toàn với `schedule.read.self` (chỉ xem lịch của chính mình, `meetings.controller.ts` route `my-schedule`).

## 2. Functional Requirements (EARS)

```text
FR-001: THE system SHALL cung cấp GET /api/v1/meetings yêu cầu permission meeting.read.all (RBAC — BUSINESS_ADMIN, SYSTEM_ADMIN).

FR-002: THE system SHALL hỗ trợ phân trang page/limit (limit mặc định 20, tối đa 100) theo chuẩn §8.4 CLAUDE.md.

FR-003: THE system SHALL hỗ trợ sort qua sortBy (allowlist: created_at, start_time, title, status) + sortOrder (asc/desc); KHÔNG nối trực tiếp giá trị client vào SQL (map qua allowlist cố định).

FR-004: THE system SHALL hỗ trợ filter status, roomId, organizerId, from/to (theo start_time), search (theo title, ILIKE).

FR-005: IF from > to, THEN THE system SHALL trả 400 (INVALID_DATE_RANGE).

FR-006: THE system SHALL trả response chuẩn {success, message, data: MeetingListItemDto[], meta: {page, limit, total, totalPages}}.

FR-007: Response item KHÔNG lộ dữ liệu nhạy cảm (không trả cancellationReason, không trả toàn bộ user object của organizer — chỉ organizerId + organizerName).
```

## 3. Acceptance Criteria

- AC-001: Given không truyền filter nào, When gọi `GET /meetings` với quyền `meeting.read.all`, Then trả 200 với danh sách meeting chưa xóa mềm (`deleted_at IS NULL`), sort mặc định `created_at DESC`.
- AC-002: Given `sortBy=xyz` không nằm trong allowlist, When gọi endpoint, Then validation pipe trả 400 (class-validator `@IsIn`) — không tới được tầng query builder.
- AC-003: Given `from` sau `to`, When gọi endpoint, Then trả 400 `INVALID_DATE_RANGE`.
- AC-004: Given user không có permission `meeting.read.all`, When gọi endpoint, Then trả 403.
- AC-005: Given `roomId`/`organizerId` không map meeting nào, Then trả `data: []`, `meta.total = 0` (không lỗi).

## 4. Ngoài phạm vi

- Không gộp logic vào `meetings.service.ts` (đã 5000+ dòng) — dùng service riêng `MeetingListService` (§15 CLAUDE.md, module boundary).
- Không thêm cache/Redis cho list này trong đợt P0 (over-engineering cho 1 endpoint chưa đo tải thực tế).
