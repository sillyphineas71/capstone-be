# Data Model: Delete Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo data-model cho feat-delete-draft-meeting-minutes | Toàn bộ file |

## 1. Bảng liên quan (không có bảng/cột mới)

### 1.1 `meeting_minutes` (đọc + ghi, entity đã tồn tại: `MeetingMinutesEntity`)
| Column | Feature này | Ghi chú |
| :--- | :--- | :--- |
| `id` | Đọc (điều kiện WHERE) | Path param `:id` |
| `meeting_id` | Đọc | Join `meetings` để lấy `hostId` |
| `status` | Đọc + Ghi | Điều kiện: chỉ xóa khi `= draft`; ghi `= deleted` sau khi xóa |
| `deleted_at` | Ghi | Set `now()` cùng lúc với `status = deleted` |
| `prepared_by` | Đọc (ownership + notification recipient) | Không đổi |
| `title`, `version_no` | Đọc (audit snapshot) | Không đổi |

### 1.2 `meetings` (chỉ đọc, entity: `MeetingEntity`)
Đọc `host_id` cho ownership check. Không ghi.

### 1.3 `media_files` (bulk ghi, entity: `MediaFileEntity`)
| Column | Feature này | Ghi chú |
| :--- | :--- | :--- |
| `related_entity_type` | Đọc (điều kiện WHERE = `'meeting_minutes'`) | Không đổi |
| `related_entity_id` | Đọc (điều kiện WHERE = `:minutesId`) | Không đổi |
| `deleted_at` | Ghi (bulk, chỉ các dòng đang `IS NULL`) | Cascade soft-delete, KHÔNG xóa file vật lý |

### 1.4 `audit_logs` (chỉ ghi, entity: `AuditLogEntity`)
1 dòng/lần xóa thành công: `action_type=meeting_minutes_deleted`, `entity_type=meeting_minutes`, `entity_id=<minutesId>`, `old_value_json={title, versionNo, meetingId, preparedBy}`.

### 1.5 `notifications` (ghi có điều kiện, entity: `NotificationEntity`)
0 hoặc 1 dòng — chỉ khi actor là Admin và không phải owner:
| Field | Giá trị |
| :--- | :--- |
| `notification_type` | `minutes_deleted_by_admin` (giá trị enum mới, xem mục 2) |
| `channel` | `in_app` |
| `content` | `Bien ban hop "<title>" da bi xoa boi quan tri vien` |
| `related_entity_type` | `meeting_minutes` |
| `related_entity_id` | `<minutesId>` |
| `recipient_scope` | `user_list` |
| `recipient_user_ids_json` | `[<preparedBy>]` |
| `created_by` | `<authUser.userId>` (Admin thực hiện xóa) |

## 2. Thay đổi code cần thiết (không phải migration DB)

### 2.1 `NotificationType` enum — thêm giá trị mới
File: `src/modules/notifications/entities/notification.entity.ts`
```ts
export enum NotificationType {
  // ... 20 giá trị hiện có ...
  MINUTES_DELETED_BY_ADMIN = 'minutes_deleted_by_admin', // MỚI — UC-MKM-05
}
```
Không cần migration vì cột `notification_type` là `varchar(60)` không CHECK constraint (xem research.md mục 3.1).

## 3. Response Shape

```ts
interface DeleteDraftMinutesResponseData {
  deleted: true;
  minutesId: string;
  deletedAt: string; // ISO datetime
  cascadedAttachmentCount: number;
}
```

## 4. State Diagram
```text
draft --(xóa qua feature này)--> deleted   [terminal — không có transition ngược]
draft --(ngoài phạm vi: feat-issue-meeting-minutes)--> published
```
`deleted` là trạng thái cuối (terminal) trong phạm vi dự án hiện tại — không có UC nào cho phép khôi phục.

## 5. Không có migration schema cho bảng nghiệp vụ
Chỉ có 1 migration seed permission `meeting.minutes.delete` (xem plan.md mục 4.3) — không `ALTER TABLE` nào trên `meeting_minutes`/`media_files`/`notifications`.
