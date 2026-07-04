# Quickstart: Issue Meeting Minutes (UC-MKM-09)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo quickstart cho feat-issue-meeting-minutes | Toàn bộ file |

## 1. Chuẩn bị dữ liệu test

1. Có 4 user: người soạn biên bản (A), 2 participant (B, C), Business Admin (D) — mỗi người login lấy JWT riêng.
2. Có 1 `meeting` với `host_id = A`, `status = completed`, `meeting_participants` gồm A, B, C.
3. Tạo 1 `meeting_minutes` qua API `feat-create-draft-meeting-minutes` (`preparedBy = A`), ghi lại `minutesId`.
4. (Tùy chọn, để test host-thay-thế) Cập nhật thủ công `meetings.host_id` sang user khác:
   ```sql
   UPDATE meetings SET host_id = '<userIdE>' WHERE id = '<meetingId>';
   ```

## 2. Chạy migration seed permission

```bash
npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```
Migration `SeedMeetingMinutesIssuePermission...` thêm permission `meeting.minutes.issue`, gán cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.

## 3. Test kịch bản Happy Path

### 3.1 preparedBy tự publish (AC-001)
```bash
curl -X POST http://localhost:3000/api/v1/meeting-minutes/<minutesId>/issue \
  -H "Authorization: Bearer <aJwt>"
```
Kỳ vọng: `200`, `data.status=published`, `data.issuedBy=A`, `data.issuedAt` được set, `data.notifiedParticipantCount=2` (B và C, trừ A).

Kiểm tra DB:
```sql
SELECT status, issued_by, issued_at, approved_by, visibility_level FROM meeting_minutes WHERE id = '<minutesId>';
-- status='published', issued_by=A, issued_at not null, approved_by vẫn NULL, visibility_level vẫn 'private'
SELECT notification_type, recipient_user_ids_json FROM notifications WHERE related_entity_id = '<minutesId>';
-- notification_type='minutes_distribution', recipient_user_ids_json chứa đúng [B, C], KHÔNG chứa A
```

### 3.2 Business Admin publish hộ (AC-003)
Tạo lại 1 minutes mới (draft khác), rồi:
```bash
curl -X POST http://localhost:3000/api/v1/meeting-minutes/<minutesId2>/issue \
  -H "Authorization: Bearer <dJwt>"
```
Kỳ vọng: `200` (Admin bypass ownership).

## 4. Test kịch bản lỗi

| Kịch bản | Cách tạo | Kỳ vọng |
| :--- | :--- | :--- |
| Participant không có quyền | B (không phải preparedBy/host/admin) gọi issue | `403 NOT_MINUTES_OWNER` |
| Không có permission | JWT chưa gán role có `meeting.minutes.issue` | `403 FORBIDDEN` |
| Biên bản không tồn tại | `minutesId` ngẫu nhiên hợp lệ UUID | `404 MINUTES_NOT_FOUND` |
| Publish lại bản đã publish | Gọi lại issue cho `minutesId` đã publish ở bước 3.1 | `409 MINUTES_NOT_DRAFT` |
| Meeting chưa completed | Set `meetings.status='in_progress'` bằng SQL rồi gọi issue | `409 MEETING_NOT_COMPLETED` |
| Meeting đã cancelled | Set `meetings.status='cancelled'` bằng SQL rồi gọi issue | `409 MEETING_NOT_COMPLETED` |
| `id` không phải UUID | `POST /api/v1/meeting-minutes/abc/issue` | `400` |

## 5. Kiểm tra khóa chỉnh sửa/xóa sau khi publish (AC-013)

```bash
curl -X PATCH http://localhost:3000/api/v1/meeting-minutes/<minutesId>/... # (endpoint update của feat-update-draft-meeting-minutes)
curl -X DELETE http://localhost:3000/api/v1/meeting-minutes/<minutesId>
```
Kỳ vọng: cả 2 đều trả `409 MINUTES_NOT_DRAFT` — xác nhận guard có sẵn (không phải code mới của feature này) hoạt động đúng sau khi trạng thái đã chuyển `published`.

## 6. Kiểm tra không tạo notification khi không có participant khác (AC-014)

1. Tạo 1 meeting chỉ có đúng 1 participant (chính preparedBy A), `status=completed`.
2. Tạo minutes, publish.
3. Kỳ vọng: `data.notifiedParticipantCount=0`, KHÔNG có dòng `notifications` nào mới với `related_entity_id = <minutesId>` đó.

## 7. Verification checklist sau khi implement

- [ ] Chỉ `preparedBy`, `meeting.hostId` hiện tại, hoặc Business/System Admin publish được; Participant khác đều 403.
- [ ] `status` chuyển đúng `draft → published`, `issued_by`/`issued_at` được set.
- [ ] `approved_by`/`approved_at`/`visibility_level` KHÔNG bị đổi.
- [ ] Không publish được khi `meeting.status != completed`, kể cả với Admin.
- [ ] Không publish lại được bản đã `published`, kể cả với Admin (409, không phải 200 lặp).
- [ ] Notification `minutes_distribution` được tạo đúng, loại trừ actor, không tạo nếu participant rỗng.
- [ ] Sau khi publish, `PATCH`/`DELETE`/`POST attachments` đều bị chặn bởi guard có sẵn (409 MINUTES_NOT_DRAFT).
- [ ] Có đúng 1 `audit_logs` mới (`action_type=meeting_minutes_issued`) mỗi lần publish thành công.
