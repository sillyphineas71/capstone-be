# Quickstart: Delete Draft Meeting Minutes (UC-MKM-05)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo quickstart cho feat-delete-draft-meeting-minutes | Toàn bộ file |

## 1. Chuẩn bị dữ liệu test

1. Có 3 user: người soạn biên bản (A), Business Admin (C), Participant thường (D) — mỗi người login lấy JWT riêng.
2. Có 1 `meeting` với `host_id = A`.
3. Tạo 1 `meeting_minutes` qua API `feat-create-draft-meeting-minutes` (`preparedBy = A`), ghi lại `minutesId`.
4. Upload 2 file đính kèm qua API `feat-attach-minutes-document` cho `minutesId` trên (để test cascade).
5. (Để test host-thay-thế) Cập nhật thủ công `meetings.host_id` sang user khác (B):
   ```sql
   UPDATE meetings SET host_id = '<userIdB>' WHERE id = '<meetingId>';
   ```

## 2. Chạy migration seed permission

```bash
npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
```
Migration `SeedMeetingMinutesDeletePermission...` sẽ thêm permission `meeting.minutes.delete` và gán cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.

## 3. Test kịch bản Happy Path

### 3.1 preparedBy tự xóa (AC-001)
```bash
curl -X DELETE http://localhost:3000/api/v1/meeting-minutes/<minutesId> \
  -H "Authorization: Bearer <aJwt>"
```
Kỳ vọng: `200`, `data.deleted=true`, `data.cascadedAttachmentCount=2`.
Kiểm tra DB: `meeting_minutes.status='deleted'`, `deleted_at` không null; 2 dòng `media_files` liên quan cũng có `deleted_at` không null; `notifications` KHÔNG có dòng mới (AC-012).

### 3.2 Host thay thế (B) xóa biên bản của A (AC-002)
Tạo lại 1 minutes mới (bước 3.1 đã xóa cái cũ), rồi:
```bash
curl -X DELETE http://localhost:3000/api/v1/meeting-minutes/<minutesId2> \
  -H "Authorization: Bearer <bJwt>"
```
Kỳ vọng: `200` (B được phép vì là `meeting.hostId` hiện tại, dù `preparedBy` vẫn là A).

### 3.3 Business Admin xóa hộ (AC-003, AC-013)
Tạo lại minutes mới (`preparedBy=A`), rồi:
```bash
curl -X DELETE http://localhost:3000/api/v1/meeting-minutes/<minutesId3> \
  -H "Authorization: Bearer <cJwt>"
```
Kỳ vọng: `200`. Kiểm tra DB: có đúng 1 dòng `notifications` mới, `notification_type='minutes_deleted_by_admin'`, `recipient_user_ids_json` chứa `userIdA`.

## 4. Test kịch bản lỗi

| Kịch bản | Cách tạo | Kỳ vọng |
| :--- | :--- | :--- |
| Participant không có quyền | D (không phải preparedBy/host/admin) gọi DELETE | `403 NOT_MINUTES_OWNER` |
| Không có permission | JWT chưa gán role có `meeting.minutes.delete` | `403 FORBIDDEN` |
| Biên bản không tồn tại | `minutesId` ngẫu nhiên hợp lệ UUID | `404 MINUTES_NOT_FOUND` |
| Xóa lại bản đã xóa | Gọi lại DELETE cùng `minutesId` đã xóa ở bước 3.1 | `404 MINUTES_NOT_FOUND` (không phải 200 lặp) |
| Biên bản không phải draft | Set thủ công `status='published'` bằng SQL rồi gọi DELETE (kể cả bằng Admin) | `409 MINUTES_NOT_DRAFT` |
| `id` không phải UUID | `DELETE /api/v1/meeting-minutes/abc` | `400` |

## 5. Kiểm tra cascade không ảnh hưởng minutes khác

1. Tạo 2 minutes độc lập (`M1`, `M2`), mỗi cái có 1 attachment.
2. Xóa `M1`.
3. Gọi `GET meeting-minutes/M2/attachments` (API của `feat-attach-minutes-document`) bằng JWT của owner `M2`.
4. Kỳ vọng: vẫn thấy đúng 1 attachment của `M2`, không bị ảnh hưởng bởi việc xóa `M1`.

## 6. Verification checklist sau khi implement

- [ ] Chỉ `preparedBy`, `meeting.hostId` hiện tại, hoặc Business/System Admin xóa được; Participant khác đều 403.
- [ ] `status` VÀ `deleted_at` đều được set sau khi xóa (không chỉ 1 trong 2).
- [ ] Toàn bộ `media_files` liên quan bị cascade soft-delete đúng số lượng, không ảnh hưởng minutes khác.
- [ ] File vật lý trên storage KHÔNG bị xóa (chỉ soft-delete DB).
- [ ] Không xóa được biên bản `published`/`archived`, kể cả với Admin.
- [ ] Gọi lại DELETE cho bản đã xóa trả `404`, không trả `200` lặp lại.
- [ ] Notification chỉ được tạo khi Admin xóa hộ (không phải owner), không tạo khi tự Host xóa.
- [ ] Có đúng 1 `audit_logs` mới (`action_type=meeting_minutes_deleted`) mỗi lần xóa thành công.
