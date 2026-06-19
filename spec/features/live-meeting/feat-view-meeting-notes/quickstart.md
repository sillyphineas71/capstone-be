# Quickstart: Xem ghi chú trong cuộc họp (View Meeting Notes — UC-IMM-10)

## CHANGELOG

| Ngày | Tóm tắt |
|------|---------|
| 2026-06-18 | Tạo quickstart cho View Meeting Notes |

---

## Test Scenarios

### A. Host xem notes — Happy Paths

1. **Host GET meeting `in_progress`** → 200, tất cả notes hợp lệ kể cả `private` của participant, `host_note`, sorted `created_at ASC`. (AC-001, AC-004)
2. **Host GET meeting `completed`** → 200, tất cả notes hợp lệ của meeting đã kết thúc. (AC-002)
3. **Host GET — không có note nào** → 200, `data=[]`, `total=0`, `message = "Cuộc họp này không có ghi chú nào được lưu lại."` (AC-014)
4. **Host GET — note đã soft-delete (`deleted_at IS NOT NULL`) không xuất hiện** → 200, chỉ trả notes có `deleted_at IS NULL`. (AC-003)
5. **Mỗi note item có `author.id` và `author.fullName`** → confirm JOIN users. (AC-004)

### B. Participant xem notes — Visibility Filter

6. **Participant GET** → 200, chỉ trả:
   - Ghi chú của chính Participant (bất kể `visibility_level`).
   - Ghi chú `visibility_level = 'participants'`.
   - Ghi chú `visibility_level = 'public_internal'`.
   - Ghi chú `visibility_level = 'department'` (cùng phòng ban với author). (AC-005)
7. **Private note (`visibility_level = 'private'`, `author != participant`)** → KHÔNG xuất hiện trong response Participant. (AC-006)
8. **`host_note` với `visibility_level = 'private'`** → KHÔNG xuất hiện trong response Participant. (AC-007)
9. **Participant GET với `?visibility=private`** → chỉ nhận private notes của **chính mình** (INVARIANT-4 — không thấy private của người khác). (spec EC-010)

### C. Filter Params

10. **`?noteType=in_meeting`** → chỉ trả ghi chú loại `in_meeting`, sau khi áp visibility filter. (AC-008)
11. **`?pinned=true`** → chỉ trả ghi chú đã ghim. (AC-009)
12. **`?from=2026-06-18T08:00:00Z&to=2026-06-18T10:00:00Z`** → chỉ trả note trong khoảng thời gian. (AC-010)
13. **Chỉ `?from=2026-06-18T08:00:00Z`** (không có `to`) → trả note `created_at >= from`. (CD-003)
14. **Chỉ `?to=2026-06-18T10:00:00Z`** (không có `from`) → trả note `created_at <= to`. (CD-003)
15. **`?visibility=participants`** → áp SAU role filter; Participant không thấy private note người khác dù filter này. (AC-011)
16. **Kết hợp nhiều filter**: `?noteType=in_meeting&pinned=true&from=T1` → giao của tất cả điều kiện. (spec §6 Scenario 4)

### D. Sort

17. **Mặc định (không `sort`)** → `created_at ASC`. (AC-012)
18. **`?sort=timeline_desc`** → `created_at DESC`. (AC-013)

### E. Pagination

19. **`?page=1&limit=5`** → 5 items đầu, `meta.page=1`, `meta.limit=5`. (AC-015)
20. **`?page=2&limit=5`** → 5 items tiếp theo (nếu có), `meta.page=2`. (AC-015)
21. **`meta.totalPages = Math.ceil(total/limit)`** → verify công thức. (AC-016)
22. **`limit = 100`** → hợp lệ, trả tối đa 100 items. (BR-014)

### F. Opt-in Enrichment (`includeSourceEvent`)

23. **`?includeSourceEvent=true` + note có `source_event_id` + `meeting_events` tồn tại** → response có `sourceEventTime` và `sourceEventType` cho note đó. (FR-017, CD-001)
24. **`?includeSourceEvent=true` + `meeting_events` không tồn tại** → response trả note bình thường với `sourceEventTime=null`, `sourceEventType=null`. (EC-006)
25. **Không truyền `includeSourceEvent`** (default `false`) → response **không có** field `sourceEventTime`/`sourceEventType`. (CD-001)
26. **Response luôn có `noteTimestamp`** (không phải `createdAt`) trong mọi trường hợp. (FR-021, CD-001)

### G. Authorization & Guard

27. **Chưa đăng nhập (không có JWT)** → 401 `UNAUTHORIZED`. (AC-017)
28. **Thiếu permission `meeting.note.read`** → 403 `PERMISSION_DENIED`. (AC-018)
29. **User không phải Host hay Participant của meeting cụ thể này** → 403 `NOT_A_MEETING_PARTICIPANT`. (AC-019)
30. **System Admin không phải Participant của meeting** → 403 `NOT_A_MEETING_PARTICIPANT` (không bypass). (CD-002, BR-016)

### H. Error Cases — Business Validation

31. **`meetingId` sai format UUID** → 400 `VALIDATION_ERROR`. (spec FR-003)
32. **Meeting không tồn tại** → 404 `MEETING_NOT_FOUND`. (AC-020)
33. **Meeting ở trạng thái `scheduled`** → 422 `MEETING_STATUS_NOT_VIEWABLE`. (AC-021)
34. **Meeting ở trạng thái `cancelled`** → 422 `MEETING_STATUS_NOT_VIEWABLE`. (AC-021)
35. **`from` sai format (không phải ISO datetime)** → 400 `VALIDATION_ERROR`. (AC-022)
36. **`from > to` (cả hai được cung cấp)** → 400 `INVALID_DATE_RANGE`. (AC-023)
37. **`limit > 100`** → 400 `VALIDATION_ERROR`. (AC-024)
38. **`noteType` ngoài allowlist** → 400 `VALIDATION_ERROR`. (FR-011)
39. **`sort` ngoài allowlist** → 400 `VALIDATION_ERROR`. (FR-010)

---

## Verification Checklist

- [ ] Response dùng `noteTimestamp` (không phải `createdAt`) cho timestamp chính của note (CD-001).
- [ ] Host thấy **tất cả** notes hợp lệ kể cả `private` của người khác (BR-004, INVARIANT-1 chỉ áp dụng Participant).
- [ ] Participant **không** thấy `visibility_level = 'private'` của người khác dù filter `?visibility=private` (INVARIANT-4).
- [ ] Participant **không** thấy `host_note` với `visibility_level = 'private'` (INVARIANT-2).
- [ ] Notes `deleted_at IS NOT NULL` **không bao giờ** xuất hiện (INVARIANT-3).
- [ ] `?from=T` không có `to` → hợp lệ, filter `created_at >= T` (CD-003).
- [ ] `?to=T` không có `from` → hợp lệ, filter `created_at <= T` (CD-003).
- [ ] `?from > to` → `INVALID_DATE_RANGE` (không phải `VALIDATION_ERROR`) (CD-003).
- [ ] `?includeSourceEvent=true` → JOIN `meeting_events`; field `sourceEventTime`/`sourceEventType` xuất hiện trong response (CD-001).
- [ ] Không truyền `includeSourceEvent` → **không có** `sourceEventTime`/`sourceEventType` trong response (CD-001).
- [ ] System Admin không phải Participant → 403 `NOT_A_MEETING_PARTICIPANT` (CD-002).
- [ ] Meeting `completed` → 200 (hợp lệ), không phải 422 (BR-001).
- [ ] Meeting `scheduled` → 422 `MEETING_STATUS_NOT_VIEWABLE` (BR-001).
- [ ] Empty state → 200 với message rõ ràng, không phải 404 (BR-012).
- [ ] Filter `?visibility=X` áp **SAU** role visibility predicate (BR-015).
- [ ] `meta.totalPages = Math.ceil(total/limit)`, không bao giờ nhỏ hơn 0 (FR-016).
- [ ] **Không** có INSERT/UPDATE/DELETE nào xảy ra trong toàn bộ operation (BR-011, FR-020).
- [ ] **Không** broadcast WebSocket, không ghi `audit_logs`, không ghi `meeting_events` (spec §15).

---

## Mapping Acceptance Criteria → Scenario

| AC | Scenario |
|----|----------|
| AC-001 | A1 |
| AC-002 | A2 |
| AC-003 | A4 |
| AC-004 | A5 |
| AC-005 | B6 |
| AC-006 | B7 |
| AC-007 | B8 |
| AC-008 | C10 |
| AC-009 | C11 |
| AC-010 | C12 |
| AC-011 | C15 |
| AC-012 | D17 |
| AC-013 | D18 |
| AC-014 | A3 |
| AC-015 | E19, E20 |
| AC-016 | E21 |
| AC-017 | G27 |
| AC-018 | G28 |
| AC-019 | G29 |
| AC-020 | H32 |
| AC-021 | H33, H34 |
| AC-022 | H35 |
| AC-023 | H36 |
| AC-024 | H37 |
