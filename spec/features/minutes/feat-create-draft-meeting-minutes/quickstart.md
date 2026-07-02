# Quickstart: Create Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo quickstart cho feat-create-draft-meeting-minutes | Toàn bộ file |

## 1. Chuẩn bị dữ liệu test
1. Có 1 user với role có quyền làm Host (`INTERNAL_USER` trở lên) đã login lấy JWT.
2. Có 1 `meeting` với `host_id` = user đó, `status = in_progress` (hoặc `completed`).
3. Có ít nhất 1-2 `meeting_participants` gắn với meeting đó để kiểm tra snapshot.

## 2. Chạy seed permission (thủ công, bắt buộc trước khi test)
Seed permission `meeting.minutes.create` KHÔNG tự động chạy (repo hiện không có seed runner tự động — pattern chung của toàn bộ `src/database/seeds/`). Chạy thủ công bằng một script ts-node ngắn, ví dụ:

```ts
// scratch-run-seed.ts (tạo tạm, không commit)
import { AppDataSource } from './src/database/data-source';
import { seedMeetingMinutesCreatePermission } from './src/database/seeds/20260702000001-SeedMeetingMinutesCreatePermission';

AppDataSource.initialize().then(async (ds) => {
  await seedMeetingMinutesCreatePermission(ds);
  await ds.destroy();
});
```

```bash
npx ts-node scratch-run-seed.ts
```

## 3. Test kịch bản Happy Path (meeting đang diễn ra)
```bash
curl -X POST http://localhost:3000/api/v1/meetings/<meetingId>/minutes \
  -H "Authorization: Bearer <hostJwt>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Kỳ vọng: `201`, `data.status = "draft"`, `data.visibilityLevel = "private"`, `data.meetingSnapshot.attendees` khớp participants đã seed.

## 4. Test kịch bản lỗi
| Kịch bản | Cách tạo | Kỳ vọng |
| :--- | :--- | :--- |
| Không phải Host | Gọi bằng JWT của user khác (không phải `host_id`) | `403 NOT_MEETING_HOST` |
| Meeting chưa bắt đầu | Meeting có `status = scheduled` | `409 MEETING_NOT_STARTED` |
| Meeting đã hủy | Meeting có `status = cancelled` | `409 MEETING_CANCELLED` |
| Đã có biên bản | Gọi API 2 lần liên tiếp cho cùng meeting | Lần 2: `409 MINUTES_ALREADY_EXISTS` |
| Host chưa gán | Meeting có `host_id = NULL` | `409 MEETING_HOST_NOT_ASSIGNED` |
| Title quá dài | `title` > 255 ký tự | `400 VALIDATION_ERROR` |

## 5. Verification checklist sau khi implement
- [ ] `SELECT * FROM meeting_minutes WHERE meeting_id = '<id>'` trả đúng 1 dòng, `status='draft'`, `visibility_level='private'`.
- [ ] `attendees_snapshot_json` chứa đúng số lượng participants và đúng `attendance_status` tại thời điểm gọi.
- [ ] `SELECT * FROM audit_logs WHERE entity_id = '<minutesId>'` có đúng 1 dòng `action_type='meeting_minutes_draft_created'`.
- [ ] Không có dòng nào được insert vào `notifications`.
- [ ] Gọi lại API lần 2 → nhận `409 MINUTES_ALREADY_EXISTS`, không có dòng `meeting_minutes` thứ 2.
