# Quickstart: Thêm ghi chú trong cuộc họp (UC-IMM-09 / UC-102/103/104)

## CHANGELOG

| Ngày | Tóm tắt |
|------|---------|
| 2026-06-18 | Tạo quickstart cho In-Meeting Notes |

---

## Test Scenarios

### A. Tạo ghi chú — Happy paths (UC-102)

1. **Host tạo `in_meeting` (không gửi visibility)** → 201, `visibilityLevel='participants'`, `createdAt` server-gen (AC-001, AC-004).
2. **`createdAt` server-gen**: client gửi `createdAt` → bị reject/strip; response `createdAt` ≠ giá trị client (AC-002).
3. **Host tạo `host_note` (không gửi visibility)** → 201, `visibilityLevel='private'` (AC-003, BR-005).
4. **User tạo `private`** → 201, `visibilityLevel='private'` (AC-005, BR-007).

### B. Authorization & Guard

5. **Non-host gửi `host_note`** → 403 `NOTE_HOST_ONLY` (AC-007, FR-006).
6. **Bất kỳ actor gửi `system_note`** → 422 `NOTE_SYSTEM_TYPE_FORBIDDEN` (AC-008, FR-005).
7. **Thiếu permission `meeting.note.create`** → 403 `PERMISSION_DENIED`.
8. **Chưa xác thực** → 401 `UNAUTHORIZED`.
9. **Non-host gửi `pinned=true`** → 201, `pinned` ép về `false` (BR-009).

### C. Business Rule & Validation

10. **Meeting `completed`/`cancelled`** → 409 `MEETING_NOT_IN_PROGRESS` (AC-009).
11. **`content` rỗng/whitespace** → 400 `VALIDATION_ERROR` (AC-010, FR-009).
12. **`visibilityLevel` ngoài allowlist** → 400 `VALIDATION_ERROR` (FR-008).
13. **`meetingId` sai UUID** → 400/422 `VALIDATION_ERROR`.
14. **Meeting không tồn tại** → 404 `MEETING_NOT_FOUND`.
15. **Sanitize XSS**: `content` chứa `<script>…</script>` → lưu chuỗi đã làm sạch (NFR-005).

### D. Edge Case — Race với End Meeting

16. **POST khi meeting vừa chuyển `completed`** → 409 `MEETING_NOT_IN_PROGRESS` (EC-001, AC-014). `pessimistic_read` lock trên meeting trong transaction.

### E. Xem & Tìm kiếm (UC-103/104)

17. **GET `?noteType=in_meeting&pinned=true`** → chỉ trả note hợp visibility của user hiện tại (AC-011, FR-015).
18. **GET `?q=triển khai`** → full-text search (GIN), kết hợp visibility filter, không trả note không có quyền đọc (AC-012, FR-017/018).
19. **Visibility `private`**: user khác (không phải author) không thấy note `private` (BR-008, NFR-002).
20. **Note `deleted_at IS NOT NULL`** → không xuất hiện trong GET (AC-013, FR-016).
21. **Pagination**: `page`/`limit` (max 100) → response có `meta { page, limit, total, totalPages }`.

---

## Verification Checklist

- [ ] `author_id` lấy từ JWT, **không** nhận từ body (FR-003).
- [ ] `created_at` do DB sinh, immutable, không nhận từ client (BR-002, FR-004).
- [ ] `system_note` luôn bị từ chối với user actor (BR-003).
- [ ] `host_note` chỉ Host tạo được; non-host → 403 (BR-004).
- [ ] Default `visibility_level` đúng theo `note_type` khi client không gửi (BR-005/006/007).
- [ ] Transaction kiểm tra `status = in_progress` trong cùng tx với INSERT (đóng EC-001).
- [ ] `content` được sanitize trước khi lưu; không lưu tag HTML nguy hiểm (NFR-005).
- [ ] GET filter nghiêm ngặt theo visibility; không lộ note `private` (BR-008, NFR-002).
- [ ] GET không trả note đã soft delete (BR-010).
- [ ] Full-text search dùng GIN index, kết hợp visibility filter (FR-017/018).
- [ ] Permission `meeting.note.create` / `meeting.note.read` đã seed cho đúng role.
- [ ] **Không** broadcast WebSocket cho note (Out of Scope).
- [ ] **Không** tạo PATCH/DELETE/share/pin endpoint (Out of Scope).

---

## Mapping Acceptance Criteria → Scenario

| AC | Scenario |
|----|----------|
| AC-001 | A1 |
| AC-002 | A2 |
| AC-003 | A3 |
| AC-004 | A1 |
| AC-005 | A4 |
| AC-007 | B5 |
| AC-008 | B6 |
| AC-009 | C10 |
| AC-010 | C11 |
| AC-011 | E17 |
| AC-012 | E18 |
| AC-013 | E20 |
| AC-014 | D16 |

> AC-006 (tag phân loại): Out of Scope (clarification #2) — không trace.
