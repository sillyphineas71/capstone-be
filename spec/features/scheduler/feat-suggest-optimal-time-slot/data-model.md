# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới data-model.md cho UC-SM-02 | Toàn bộ file |

---

# Data Model: UC-SM-02 — Chọn khung giờ họp tối ưu

## 1. Entities Involved

### 1.1 `meetings` (MeetingEntity)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id` | uuid PK | Loại trừ qua `excludeMeetingId` nếu có |
| `start_time` | timestamptz | Overlap check + nguồn khoảng bận |
| `end_time` | timestamptz | Overlap check + nguồn khoảng bận |
| `status` | varchar(30) | Chỉ tính bận nếu `scheduled`/`in_progress` (FR-009/FR-010) |
| `organizer_id` | uuid FK | Dùng để xác nhận quyền truy cập khi có `excludeMeetingId` |
| `deleted_at` | timestamptz | Required: `deleted_at IS NULL` |

### 1.2 `meeting_participants` (MeetingParticipantEntity)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `meeting_id` | uuid FK | Join với `meetings` |
| `user_id` | uuid FK | Xác định khoảng bận thuộc về user nào |
| `is_required` | boolean | **Không dùng để tính bận** — Required/Optional trong UC-SM-02 do CLIENT khai báo qua `requiredParticipantUserIds`/`optionalParticipantUserIds` của request, độc lập với cờ `is_required` nội bộ của một meeting khác mà user đó đang bận. |
| `invitation_status` | varchar(30) | **Không lọc theo status này** — một lời mời `pending` của meeting `scheduled` vẫn chiếm giờ trên lịch, nên vẫn tính là bận. |

### 1.3 `users` (UserEntity)

| Field | Type | Vai trò trong feature |
|---|---|---|
| `id` | uuid PK | Validate participant tồn tại (FR-020) |
| `deleted_at` | timestamptz | Required: `deleted_at IS NULL` |

## 2. Query Pattern

### 2.1 Core Query: Lấy toàn bộ busy interval của N user trong search range (1 query duy nhất)

```sql
SELECT mp.user_id, m.start_time, m.end_time
FROM meeting_participants mp
JOIN meetings m ON m.id = mp.meeting_id
WHERE mp.user_id = ANY($1::uuid[])
  AND m.deleted_at IS NULL
  AND m.status IN ('scheduled', 'in_progress')
  AND m.start_time < $2  -- searchRangeEnd
  AND m.end_time > $3    -- searchRangeStart
  AND ($4::uuid IS NULL OR m.id != $4)  -- excludeMeetingId
ORDER BY mp.user_id, m.start_time ASC;
```

> Lưu ý: params đặt tên theo thứ tự `$1..$4` chỉ để minh hoạ — khi implement PHẢI dùng đúng positional placeholder tương ứng với mảng params thực tế (đây là điểm mà `ParticipantConflictService` hiện tại đang bị lỗi, xem `research.md` mục 1 "Bug phát hiện" — không lặp lại lỗi này ở service mới).

### 2.2 Merge-interval + Free-gap pseudocode (`FreeBusyService`)

```typescript
// 1. Group rows theo user_id
const busyByUser: Map<string, {start: Date; end: Date}[]> = groupBy(rows, 'user_id');

// 2. Merge overlap trong từng user (1-pass, rows đã sort theo start_time ASC)
for (const [userId, intervals] of busyByUser) {
  busyByUser.set(userId, mergeOverlapping(intervals));
}

// 3. Free-interval của 1 user = complement trong [searchRangeStart, searchRangeEnd]
function complement(busy, rangeStart, rangeEnd) {
  const free = [];
  let cursor = rangeStart;
  for (const b of busy) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = max(cursor, b.end);
  }
  if (cursor < rangeEnd) free.push({ start: cursor, end: rangeEnd });
  return free;
}

// 4. Intersect free-interval của toàn bộ Required user (bao gồm organizer)
//    Sweep qua tất cả free-interval của tất cả Required user, tìm đoạn overlap chung cho TẤT CẢ.
const requiredFreeWindows = intersectAll(requiredUserIds.map(id => complement(busyByUser.get(id) ?? [], start, end)));

// 5. Sinh candidate slot từ các window đủ dài
const candidates = requiredFreeWindows
  .filter(w => (w.end - w.start) >= durationMinutes * 60_000)
  .flatMap(w => sliceIntoCandidates(w, durationMinutes, granularityMinutes = 15));

// 6. Chấm điểm Optional cho mỗi candidate (point-check overlap, không cần intersect)
for (const c of candidates) {
  c.optionalFreeCount = optionalUserIds.filter(id => !overlapsAny(busyByUser.get(id) ?? [], c)).length;
}
```

## 3. Data Constraints

- `requiredParticipantUserIds ∩ optionalParticipantUserIds = ∅` (FR-021).
- Tổng participants nội bộ (organizer + required + optional, distinct) trong khoảng `[2, 50]` (FR-019, NFR-002).
- `searchRangeEnd - searchRangeStart <= 30 ngày` (FR-017).
- `15 <= durationMinutes <= 480` (FR-018).

## 4. Không có thay đổi Schema

UC-SM-02 không cần migration mới — toàn bộ dữ liệu cần thiết đã có sẵn trong `meetings`, `meeting_participants`, `users` của DB v3.2 Compact.
