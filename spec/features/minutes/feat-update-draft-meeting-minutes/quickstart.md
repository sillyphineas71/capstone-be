# Quickstart: Update Draft Meeting Minutes (UC-MKM-04)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo quickstart cho feat-update-draft-meeting-minutes | Toàn bộ file |

## 1. Chuẩn bị dữ liệu test

1. Có 2 user: Host gốc/người soạn biên bản (A), Participant thường (B) — mỗi người login lấy JWT riêng.
2. Có 1 `meeting` với `host_id = A`, `status = in_progress` hoặc `completed`.
3. Tạo 1 `meeting_minutes` qua API của `feat-create-draft-meeting-minutes`:
   ```bash
   curl -X POST http://localhost:3000/api/v1/meetings/<meetingId>/minutes \
     -H "Authorization: Bearer <hostJwt>" -H "Content-Type: application/json" \
     -d '{}'
   ```
   Ghi lại `id` (minutesId) và `versionNo` (mặc định `1`) trong response.
4. (Để test AC-002 — host đổi) Cập nhật thủ công `meetings.host_id` sang user khác (C) bằng SQL, giữ nguyên `meeting_minutes.prepared_by = A`:
   ```sql
   UPDATE meetings SET host_id = '<userIdC>' WHERE id = '<meetingId>';
   ```

## 2. Chạy migration seed permission

```bash
npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```
Migration `SeedMeetingMinutesUpdatePermission...` sẽ thêm permission `meeting.minutes.update` và gán cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.

## 3. Test kịch bản Happy Path

### 3.1 Host (preparedBy) cập nhật nội dung (AC-001)
```bash
curl -X PATCH http://localhost:3000/api/v1/meeting-minutes/<minutesId> \
  -H "Authorization: Bearer <hostJwt>" -H "Content-Type: application/json" \
  -d '{
    "versionNo": 1,
    "minutesContent": "1. Thanh phan tham du...\n2. Ket luan: approved budget Q3"
  }'
```
Kỳ vọng: `200`, `data.versionNo = 2`, `data.status = draft`.

### 3.2 Cập nhật decisions + action items
```bash
curl -X PATCH http://localhost:3000/api/v1/meeting-minutes/<minutesId> \
  -H "Authorization: Bearer <hostJwt>" -H "Content-Type: application/json" \
  -d '{
    "versionNo": 2,
    "decisionsJson": [{"decision": "Trien khai module X vao Q3", "responsibleUserId": "<userIdB>"}],
    "actionItemsJson": [{"title": "Setup CI/CD pipeline", "assigneeUserId": "<userIdB>", "dueDate": "2026-08-01", "priority": "high"}]
  }'
```
Kỳ vọng: `200`, `data.versionNo = 3`, `data.actionItemsJson[0].id` là 1 UUID được server tự sinh (request không gửi `id`).

### 3.3 Người thay thế làm Host (không phải preparedBy) vẫn sửa được (AC-002)
```bash
curl -X PATCH http://localhost:3000/api/v1/meeting-minutes/<minutesId> \
  -H "Authorization: Bearer <hostCJwt>" -H "Content-Type: application/json" \
  -d '{"versionNo": 3, "title": "Bien ban hop - final"}'
```
Kỳ vọng: `200` (C được phép vì là `meeting.hostId` hiện tại, dù không phải `preparedBy`).

## 4. Test kịch bản lỗi

| Kịch bản | Cách tạo | Kỳ vọng |
| :--- | :--- | :--- |
| Không phải preparedBy/host | Participant B gọi PATCH | `403 NOT_MINUTES_OWNER` |
| Không có permission | JWT chưa gán role có `meeting.minutes.update` | `403 FORBIDDEN` |
| Biên bản không tồn tại | `minutesId` ngẫu nhiên hợp lệ UUID | `404 MINUTES_NOT_FOUND` |
| Biên bản không phải draft | Set thủ công `status='published'` bằng SQL rồi gọi PATCH | `409 MINUTES_NOT_DRAFT` |
| `versionNo` cũ (đã bị dùng) | Gọi lại PATCH với `versionNo=1` sau khi đã update lên `versionNo=2` | `409 MINUTES_VERSION_CONFLICT` kèm `currentVersionNo=2` |
| Không có field nào update | `{"versionNo": 2}` (không kèm field khác) | `400 VALIDATION_ERROR (NO_UPDATE_FIELD)` |
| `minutesContent` quá dài | Chuỗi > 20000 ký tự | `400 VALIDATION_ERROR` |
| `actionItemsJson` thiếu `title` | `[{"assigneeUserId": "..."}]` | `400 VALIDATION_ERROR` |
| Thiếu `versionNo` | `{"title": "abc"}` | `400 VALIDATION_ERROR` |

## 5. Test refresh `attendeesSnapshotJson`

1. Tạo minutes khi `meeting.status = in_progress` (một số participant chưa check-in).
2. Update meeting thành `completed` + cập nhật `meeting_participants.attendance_status` cho vài người (SQL trực tiếp, giả lập điểm danh muộn):
   ```sql
   UPDATE meetings SET status = 'completed', actual_end_time = now() WHERE id = '<meetingId>';
   UPDATE meeting_participants SET attendance_status = 'present', joined_at = now() WHERE meeting_id = '<meetingId>' AND user_id = '<userIdB>';
   ```
3. Gọi PATCH bất kỳ field nào (ví dụ `title`).
4. Kỳ vọng: `data.attendeesSnapshotJson` phản ánh `attendance_status = present` mới nhất cho B (không còn `not_checked_in`).
5. So sánh với việc gọi PATCH khi `meeting.status` vẫn `in_progress` → `attendeesSnapshotJson` KHÔNG đổi so với lần tạo ban đầu.

## 6. Verification checklist sau khi implement

- [ ] Chỉ `preparedBy` hoặc `meeting.hostId` hiện tại sửa được; Participant/Organizer/Admin khác đều bị 403.
- [ ] `versionNo` tăng đúng 1 sau mỗi lần update thành công.
- [ ] Gọi PATCH với `versionNo` cũ luôn trả 409, không bao giờ ghi đè âm thầm.
- [ ] Field không gửi trong request giữ nguyên giá trị cũ (partial update thật sự).
- [ ] `status` luôn giữ `draft` sau update (không tự chuyển `published`).
- [ ] `attendeesSnapshotJson` chỉ refresh khi `meeting.status = completed`, giữ nguyên khi `in_progress`.
- [ ] Có đúng 1 `audit_logs` mới (`action_type=meeting_minutes_updated`) mỗi lần update thành công.
- [ ] Không có notification nào được tạo khi update.
- [ ] 2 request PATCH gửi gần như đồng thời cùng `versionNo` → chỉ 1 request thành công.
