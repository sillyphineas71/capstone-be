# Research: Delete Draft Meeting Minutes (UC-MKM-05)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo research, ghi lại Q&A đã chốt với Product Owner | Toàn bộ file |

## 1. Nguồn UC gốc và đối chiếu với UC-133

UC-MKM-05 (Feature Table gốc, người dùng cung cấp trực tiếp) khớp nghiệp vụ với UC-133 "Xóa biên bản họp nháp" trong `docs/API_CONTRACT_v1.0_with_system_roles.md` (dòng 4402-4419): `DELETE`, chỉ xóa được khi `status='draft'`, soft delete (`deleted_at`). UC-133 dùng path `/api/v1/minutes/{minutesId}` — feature này tiếp tục đi theo convention `meeting-minutes` đã áp dụng xuyên suốt 4 spec `minutes` trước (create/list/view-detail/attach/update), không theo literal path của contract (cùng deviation đã ghi ở `feat-update-draft-meeting-minutes`).

## 2. Q&A đã chốt với Product Owner

| # | Câu hỏi | Quyết định cuối cùng |
| :--- | :--- | :--- |
| 1 | "Host" nghĩa là gì (chỉ `meeting.hostId`, hay cả `prepared_by`)? | **OR-rule**, giống hệt `feat-update-draft-meeting-minutes`: `prepared_by === userId OR meeting.hostId === userId`. |
| 2 | Xóa biên bản có cascade xóa file đính kèm không? | **Có, cascade ở tầng DB** (soft-delete `media_files` liên quan) để tránh rác dữ liệu trong database — quyết định đảo ngược đề xuất ban đầu của tôi ("không cascade"), theo yêu cầu rõ ràng của Product Owner. KHÔNG xóa file vật lý trên storage (giữ đơn giản, không cần `StorageService` trong transaction này). |
| 3 | System Admin có được xóa không (UC gốc chỉ ghi Business Admin)? | **Có** (theo đề xuất mặc định) — bổ sung để nhất quán RBAC toàn module `minutes`. |
| 4 | `status='deleted'` hay chỉ `deleted_at`? | **Cả hai** (theo đề xuất mặc định) — set đồng thời để tương thích với 2 kiểu filter đang tồn tại song song trong code (`deletedAt IS NULL` ở hầu hết feature, `status != deleted` ở `feat-list-meeting-minutes` FR-004). |
| 5 | Có notification khi Admin xóa hộ không? | **Có** (theo đề xuất mặc định) — chỉ khi actor là Admin VÀ không đồng thời là owner (preparedBy/hostId), gửi in-app cho `preparedBy`. Tự xóa của chính mình thì không gửi. |
| 6 | `versionNo` có áp dụng cho xóa không? | **Không** (theo đề xuất mặc định) — chỉ lock row (`pessimistic_write`) khi xử lý, không cần optimistic lock vì xóa không có khái niệm "ghi đè nội dung". |

## 3. Điểm kỹ thuật cần xác nhận khi implement

### 3.1 Enum `NotificationType` cần thêm giá trị mới
Đọc `src/modules/notifications/entities/notification.entity.ts` — enum `NotificationType` hiện có 20 giá trị (`MEETING_INVITE`, `REMINDER`,... `TRANSCRIPT_READY`), **không có** giá trị nào phù hợp cho "biên bản bị Admin xóa hộ". Cột `notification_type` trong DB là `varchar(60) NOT NULL`, không có CHECK constraint ràng buộc theo enum ở tầng DB (enum chỉ tồn tại ở tầng TypeScript) — nghĩa là thêm giá trị mới `MINUTES_DELETED_BY_ADMIN = 'minutes_deleted_by_admin'` chỉ cần sửa file entity, KHÔNG cần migration ALTER TABLE.

### 3.2 Cách tạo notification — chưa xác nhận `NotificationsService` có method tiện lợi
Đã xác nhận entity `NotificationEntity` có đủ field cần thiết (`notificationType`, `channel`, `content`, `relatedEntityType`, `relatedEntityId`, `recipientScope`, `recipientUserIdsJson`, `createdBy`), nhưng **chưa đọc `notifications.service.ts`** để xác nhận có method `createSingleRecipientNotification`-kiểu-vậy hay không (nằm ngoài phạm vi research này vì phải đọc code thật lúc implement). Plan.md đã ghi fallback: nếu không có method tiện lợi, insert trực tiếp qua `manager.getRepository(NotificationEntity)`, giống cách `AuditLogEntity` từng được insert trực tiếp trong `addAttachment` (feature `feat-attach-minutes-document`) trước khi `AuditLogsService.logAction/logEntityChange` được xác nhận là cách chuẩn.

### 3.3 Cascade delete — không dùng `TypeORM softDelete()` mặc định
`MediaFileEntity` cascade cần bulk `UPDATE ... WHERE relatedEntityType = 'meeting_minutes' AND relatedEntityId = :minutesId AND deletedAt IS NULL` — dùng `manager.getRepository(MediaFileEntity).update({relatedEntityType: 'meeting_minutes', relatedEntityId: minutesId, deletedAt: IsNull()}, {deletedAt: now})`, tương tự cách `removeAttachment` (feature `feat-attach-minutes-document`) đã soft-delete từng file đơn lẻ, chỉ khác là áp dụng cho toàn bộ thay vì 1 `fileId`.

## 4. Có cần bảng/cột mới không?
**Không.** `meeting_minutes.status`/`deleted_at`, `media_files.deleted_at` đều đã có sẵn trong baseline. Chỉ cần thêm 1 permission (`meeting.minutes.delete`, qua migration) và 1 giá trị enum TypeScript (`NotificationType.MINUTES_DELETED_BY_ADMIN`, không migration).

## 5. Rủi ro & quyết định thiết kế
| Rủi ro | Quyết định |
| :--- | :--- |
| Ownership-or-admin check 3 nhánh dễ viết sai | Unit test riêng cho từng nhánh (owner-only, host-thay-thế, admin-bypass, không-thỏa) |
| Cascade bulk update xóa nhầm attachment của minutes khác nếu `WHERE relatedEntityId` sai | Test riêng 2 minutes độc lập, xác nhận cascade chỉ ảnh hưởng đúng 1 bên |
| Notification lỗi làm fail cả response dù DB đã xóa xong | try/catch quanh notification, best-effort, không raise (xem plan.md mục 9.3) |
| Quên đồng bộ `status`/`deletedAt` khi xóa | Test assert cả 2 field sau khi xóa thành công |

## 6. Kết luận
Không có unknown nào chặn việc viết plan.md/tasks.md. 2 điểm kỹ thuật ở mục 3 (API thật của `NotificationsService`, cấu trúc thật của `minutes.service.ts`) cần Codex tự xác nhận bằng cách đọc code thật ngay trước khi implement — đã ghi rõ fallback cho cả 2 trường hợp.
