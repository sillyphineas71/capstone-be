# Data Model: Issue Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo data-model cho feat-issue-meeting-minutes | Toàn bộ file |

## 1. Bảng liên quan (không có bảng/cột/enum mới)

### 1.1 `meeting_minutes` (đọc + ghi, entity đã tồn tại: `MeetingMinutesEntity`)
| Column | Feature này | Ghi chú |
| :--- | :--- | :--- |
| `id` | Đọc (điều kiện WHERE) | Path param `:id` |
| `meeting_id` | Đọc | Join `meetings`/`meeting_participants` |
| `status` | Đọc + Ghi | Điều kiện: chỉ publish khi `= draft`; ghi `= published` sau khi publish |
| `issued_by` | Ghi | `= authUser.userId` |
| `issued_at` | Ghi | `= now()` |
| `prepared_by` | Đọc (ownership) | Không đổi |
| `approved_by`, `approved_at` | KHÔNG đụng | Giữ nguyên `NULL` (dành cho feature approval riêng, ngoài phạm vi) |
| `visibility_level` | KHÔNG đụng | Giữ nguyên `private` (field hiện không dùng cho phân quyền) |
| `version_no`, `title`, `minutes_content`, `decisions_json`, `action_items_json` | KHÔNG đụng | Publish không thay đổi nội dung |

### 1.2 `meetings` (chỉ đọc, entity: `MeetingEntity`)
Đọc `host_id` (ownership check) và `status` (điều kiện `= completed`). Không ghi.

### 1.3 `meeting_participants` (chỉ đọc, entity: `MeetingParticipantEntity`)
Đọc `user_id` (DISTINCT) tại thời điểm publish để dựng danh sách nhận notification — KHÔNG dùng `meeting_minutes.attendees_snapshot_json` (có thể lỗi thời).

### 1.4 `audit_logs` (chỉ ghi, entity: `AuditLogEntity`)
1 dòng/lần publish thành công: `action_type=meeting_minutes_issued`, `entity_type=meeting_minutes`, `entity_id=<minutesId>`, `old_value_json={status:'draft'}`, `new_value_json={status:'published', issuedBy, issuedAt}`.

### 1.5 `notifications` (ghi có điều kiện, entity: `NotificationEntity`)
0 hoặc 1 dòng — chỉ khi có ít nhất 1 participant khác actor:
| Field | Giá trị |
| :--- | :--- |
| `notification_type` | `minutes_distribution` (**đã có sẵn** trong enum, không cần sửa entity) |
| `channel` | `in_app` |
| `content` | `Bien ban hop "<title>" da duoc ban hanh chinh thuc` |
| `related_entity_type` | `meeting_minutes` |
| `related_entity_id` | `<minutesId>` |
| `recipient_scope` | `user_list` |
| `recipient_user_ids_json` | `[participant userIds, trừ actor]` |
| `created_by` | `<authUser.userId>` |

## 2. Không có thay đổi code cho entity/enum
Khác với `feat-delete-draft-meeting-minutes` (phải thêm giá trị enum mới), feature này **không cần sửa** `notification.entity.ts` — `MINUTES_DISTRIBUTION` đã tồn tại sẵn.

## 3. Response Shape
```ts
interface IssueMinutesResponseData {
  id: string;
  meetingId: string;
  title: string;
  status: 'published';
  versionNo: number;
  issuedBy: string;
  issuedAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  notifiedParticipantCount: number;
}
```

## 4. State Diagram
```text
draft --(publish qua feature này, ĐK: meeting.status=completed)--> published
draft --(ngoài phạm vi: feat-delete-draft-meeting-minutes)--> deleted   [nhánh loại trừ lẫn nhau]
published --(ngoài phạm vi: feat-archive-meeting-minutes)--> archived
```
`published` KHÔNG có transition ngược lại `draft` trong phạm vi dự án hiện tại (không có UC "rút biên bản").

## 5. Không có migration schema
Chỉ có 1 migration seed permission `meeting.minutes.issue` (xem plan.md mục 4.3) — không `ALTER TABLE` nào, không cần sửa entity `notification.entity.ts`.
