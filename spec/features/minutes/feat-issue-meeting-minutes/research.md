# Research: Issue Meeting Minutes (UC-MKM-09)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo research, ghi lại Q&A đã chốt với Product Owner | Toàn bộ file |

## 1. Nguồn UC gốc và wording không khớp entity thật

UC-MKM-09 (Feature Table gốc, người dùng cung cấp trực tiếp) dùng wording `DRAFT`/`OFFICIAL` cho trạng thái biên bản. Entity thật (`MeetingMinutesStatus`) chỉ có 4 giá trị: `draft`, `published`, `archived`, `deleted` — không có `OFFICIAL`. Đã xác nhận với Product Owner: `OFFICIAL` (UC) = `published` (DB), không tạo giá trị enum mới.

Feature này đã được 3 spec trước đó (`feat-create-draft-meeting-minutes` mục 8.2, `feat-view-meeting-minutes-detail` mục 8.2, `feat-attach-minutes-document` mục 8.2) nhắc tới bằng đúng tên `feat-issue-meeting-minutes` trong "Có thể xem xét ở feature khác" — xác nhận tên thư mục này đúng chuẩn đã dự kiến từ trước.

## 2. Phát hiện quan trọng: `NotificationType.MINUTES_DISTRIBUTION` đã tồn tại sẵn nhưng chưa từng dùng

Đọc `src/modules/notifications/entities/notification.entity.ts`, enum `NotificationType` có sẵn giá trị `MINUTES_DISTRIBUTION = 'minutes_distribution'` từ trước (không phải do feature này thêm vào — khác hẳn `feat-delete-draft-meeting-minutes` phải thêm giá trị `MINUTES_DELETED_BY_ADMIN` mới). Giá trị này rõ ràng được thiết kế sẵn cho đúng tình huống "phân phối biên bản đã ban hành cho participant" — chưa có feature nào dùng tới vì đây là feature đầu tiên trong module `minutes` khiến nội dung biên bản "mở" ra khỏi phạm vi riêng tư của người soạn (`draft` → chỉ `preparedBy`/Admin thấy; `published` → host/participant đều thấy được, theo scope rule đã có ở `feat-list-meeting-minutes` FR-015).

## 3. Q&A đã chốt với Product Owner

| # | Câu hỏi | Quyết định cuối cùng |
| :--- | :--- | :--- |
| 1 | "Host" nghĩa là gì? | OR-rule, giống hệt `feat-update-draft-meeting-minutes`/`feat-delete-draft-meeting-minutes`: `prepared_by === userId OR meeting.hostId === userId`. |
| 2 | System Admin có ngang Business Admin không? | Có (theo đề xuất mặc định) — nhất quán RBAC toàn module. |
| 3 | Mapping `OFFICIAL` → trạng thái entity nào? | `MeetingMinutesStatus.PUBLISHED` (`'published'`) — không tạo enum mới. |
| 4 | PRE-3 ("nội dung đã điền đầy đủ") có enforce ở BE không? | **Không** — không có tiêu chí khách quan để kiểm tra (`minutesContent` luôn có khung mặc định không rỗng ngay từ lúc tạo draft). Coi là gợi ý UX cho FE. |
| 5 | Có bắt buộc `meeting.status = completed` không? | **Có** — rào an toàn hợp lý bổ sung (UC gốc không nhắc), tránh chốt chính thức biên bản khi cuộc họp chưa kết thúc. |
| 6 | Có set `approved_by`/`approved_at` không? | **Không** — 2 cột này dành cho 1 bước duyệt riêng biệt (nếu có), ngoài phạm vi UC-MKM-09 vốn không mô tả bước duyệt tách biệt khỏi ban hành. |
| 7 | `visibility_level` có đổi khi publish không? | **Không đổi** — field này hiện không được bất kỳ logic phân quyền nào đọc tới (đã xác nhận qua research của `feat-list-meeting-minutes`), đổi hay không cũng không ảnh hưởng chức năng thực tế. |
| 8 | Có gửi notification khi publish không? | **Có** — dùng `NotificationType.MINUTES_DISTRIBUTION` đã có sẵn, gửi cho toàn bộ participant trừ actor. |
| 9 | Nguồn danh sách người nhận notification? | Query trực tiếp `meeting_participants` tại thời điểm publish (KHÔNG dùng `attendees_snapshot_json` đã đóng băng, có thể lỗi thời nếu chưa từng được refresh). |

## 4. Mâu thuẫn kỹ thuật cần theo dõi (không sửa trong phạm vi feature này)

`feat-view-meeting-minutes-detail/spec.md` (UC-MKM-03, FR-017) đã định nghĩa:
```text
permissions.canIssue = (status === draft) AND (isAdmin OR preparedBy === userId)
```
Giống hệt vấn đề đã flag ở `canEdit` khi làm `feat-update-draft-meeting-minutes` — công thức này **thiếu nhánh `meeting.hostId`**. Với quyết định #1 ở trên (OR-rule đầy đủ 2 nhánh), công thức đúng phải là:
```text
permissions.canIssue = (status === draft) AND (preparedBy === userId OR meeting.hostId === userId OR isAdmin)
```
Vì `feat-view-meeting-minutes-detail` chưa có controller implement trong code (chỉ có spec), rủi ro thực tế còn thấp, nhưng cần cập nhật khi feature đó được code sau — nằm ngoài phạm vi worktree hiện tại (chỉ được sửa `feat-issue-meeting-minutes/`).

## 5. Có cần bảng/cột/enum mới không?
**Không.** `meeting_minutes.status/issued_by/issued_at` đã có sẵn trong baseline. `NotificationType.MINUTES_DISTRIBUTION` đã có sẵn (không cần sửa entity notification, khác `feat-delete-draft-meeting-minutes`). Chỉ cần thêm 1 permission mới (`meeting.minutes.issue`, qua migration).

## 6. Rủi ro & quyết định thiết kế
| Rủi ro | Quyết định |
| :--- | :--- |
| Ownership-or-admin check 3 nhánh dễ viết sai | Tái sử dụng cấu trúc test đã viết ở `feat-delete-draft-meeting-minutes` (owner-only, host-thay-thế, admin-bypass, không-thỏa) |
| Quên điều kiện `meeting.status=completed`, chỉ check `minutes.status=draft` | Đặt check `meeting.status` ngay sau check `minutes.status` trong service, test riêng AC-009/AC-010 |
| Notification tự gửi cho chính actor nếu actor cũng là participant | Filter rõ ràng `recipientUserIds = participants.filter(id => id !== actorId)`, test riêng AC-016 |
| Notification lỗi làm fail cả response dù DB đã publish xong | try/catch quanh notification, best-effort, không raise (xem plan.md mục 9.3) |
| Dùng nhầm `attendees_snapshot_json` (đã đóng băng) thay vì query `meeting_participants` mới nhất | Ghi rõ trong FR-005/quyết định #9, test riêng đảm bảo dùng đúng bảng |

## 7. Kết luận
Không có unknown nào chặn việc viết plan.md/tasks.md. Toàn bộ quyết định đã được Product Owner xác nhận trực tiếp qua Q&A, không còn `[NEEDS CLARIFICATION]` nào mở trong spec.md.
