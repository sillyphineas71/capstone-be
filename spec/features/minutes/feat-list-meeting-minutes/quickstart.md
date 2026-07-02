# Quickstart: List Meeting Minutes (UC-MKM-02)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo quickstart cho feat-list-meeting-minutes | Toàn bộ file |
| 2026-07-02 | Sửa 422 → 400 cho kịch bản status không hợp lệ | Mục 4 |

## 1. Chuẩn bị dữ liệu test

1. Có 3 user: Host (A), Participant (B), Business Admin (C) — mỗi người login lấy JWT riêng.
2. Có 1 `meeting` với `host_id = A`, `status = completed`, có `meeting_participants` gồm B.
3. Có 1 `meeting_minutes` với `meeting_id` trên, `status = draft`, `prepared_by = A` (tạo qua API `feat-create-draft-meeting-minutes`).
4. (Tùy chọn để test AC-003) Cập nhật thủ công 1 bản ghi `meeting_minutes` khác sang `status = published` bằng SQL trực tiếp (chưa có feature publish):
   ```sql
   UPDATE meeting_minutes SET status = 'published' WHERE id = '<minutesId2>';
   ```

## 2. Chạy migration seed permission

```bash
npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```

Migration `SeedMeetingMinutesReadPermission...` sẽ thêm permission `meeting.minutes.read` và gán cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.

## 3. Test kịch bản Happy Path

### 3.1 Host xem được draft của mình (AC-001)
```bash
curl -X GET http://localhost:3000/api/v1/meeting-minutes \
  -H "Authorization: Bearer <hostJwt>"
```
Kỳ vọng: `200`, `data` chứa biên bản `status=draft` vừa tạo.

### 3.2 Participant KHÔNG thấy draft của Host (AC-002)
```bash
curl -X GET http://localhost:3000/api/v1/meeting-minutes \
  -H "Authorization: Bearer <participantJwt>"
```
Kỳ vọng: `200`, `data` KHÔNG chứa biên bản draft ở bước 3.1 (chỉ thấy nếu đã published/archived và B là participant).

### 3.3 Business Admin xem toàn bộ (AC-004)
```bash
curl -X GET http://localhost:3000/api/v1/meeting-minutes \
  -H "Authorization: Bearer <adminJwt>"
```
Kỳ vọng: `200`, `data` chứa CẢ biên bản draft của Host lẫn bản published.

### 3.4 Filter + search
```bash
curl -X GET "http://localhost:3000/api/v1/meeting-minutes?status=published&q=Sprint&sortBy=actual_start_time&sortOrder=asc" \
  -H "Authorization: Bearer <hostJwt>"
```

## 4. Test kịch bản lỗi

| Kịch bản | Cách tạo | Kỳ vọng |
| :--- | :--- | :--- |
| Không có permission | JWT của user chưa được gán role có `meeting.minutes.read` | `403 FORBIDDEN` |
| limit vượt max | `?limit=50` | `400 VALIDATION_ERROR` |
| status không hợp lệ | `?status=foo` | `400 VALIDATION_ERROR` |
| roomId không phải UUID | `?roomId=abc` | `400 VALIDATION_ERROR` |
| from > to | `?from=2026-07-10&to=2026-07-01` | `400 VALIDATION_ERROR` |
| Không có biên bản trong scope | User mới, chưa từng host/tham dự meeting nào | `200` với `data=[]` |

## 5. Verification checklist sau khi implement

- [ ] Host thấy đúng biên bản draft của chính mình, không thấy draft của Host khác.
- [ ] Participant thấy biên bản `published`/`archived` của meeting mình tham dự, không thấy draft của người khác.
- [ ] Business Admin và System Admin thấy y hệt nhau, thấy toàn bộ (trừ `deleted`).
- [ ] Biên bản `status=deleted` (nếu có, soft-delete thủ công để test) không xuất hiện với bất kỳ role nào, kể cả admin.
- [ ] Meeting online (`room_id = null`) trả `meeting.room = null`, không lỗi 500.
- [ ] `meta.total`/`meta.totalPages` khớp số lượng thực tế trong scope + filter.
- [ ] Response KHÔNG chứa `minutesContent`, `decisionsJson`, `actionItemsJson`, `attendeesSnapshotJson`.
