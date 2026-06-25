| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo research cho tính năng thêm khách mời bên ngoài | Toàn bộ file |

# Research: Add External Meeting Participant

- **Feature ID**: MEET-ADD-EXTERNAL-PARTICIPANT-001
- **Created**: 2026-06-25
- **Status**: Complete

---

## Codebase Analysis

### Entity Patterns (TypeORM)

Tất cả entity trong `meetings` module đi theo convention chung:
- `PrimaryGeneratedColumn('uuid')` cho id
- `CreateDateColumn`/`UpdateDateColumn` cho timestamp (riêng `MeetingExternalParticipantEntity` chỉ có `created_at`, không có `updated_at`/`deleted_at`)
- `ManyToOne` + `JoinColumn` cho relationship
- Named export với suffix `Entity`

### Entity liên quan trực tiếp

| Entity | File | Field chính |
|---|---|---|
| `MeetingExternalParticipantEntity` | `entities/meeting-external-participant.entity.ts` | id, meetingId, fullName, email (nullable), phoneNumber (nullable), organizationName (nullable), participantRole (default 'attendee'), invitationStatus (default 'pending'), responseAt, notes, metadataJson, createdAt |
| `MeetingEntity` | `entities/meeting.entity.ts` | status (enum `MeetingStatus`), organizerId, hostId, roomId, visibilityLevel (enum `MeetingVisibilityLevel`) |
| `MeetingParticipantEntity` | `entities/meeting-participant.entity.ts` | dùng để count internal participants cho capacity check |
| `MeetingEventEntity` | `entities/meeting-event.entity.ts` | eventType (enum `MeetingEventType`, cột `varchar(60)` — không có DB enum constraint) |
| `RoomEntity` | (module rooms) | capacity, dùng để so sánh sức chứa |
| `SystemConfigEntity` | (module administration) | configKey='meeting.capacity_policy', configValue ('block'\|'warning') |

### Existing implementation đã có sẵn để tái sử dụng

`MeetingsService.addInternalParticipant()` ([meetings.service.ts:2252](../../../../src/modules/meetings/services/meetings.service.ts:2252)) đã implement đầy đủ:
- `getAttendeeCount(meetingId)` ([:1332](../../../../src/modules/meetings/services/meetings.service.ts:1332)) — đã cộng cả `MeetingParticipantEntity.count()` và `MeetingExternalParticipantEntity.count()`, dùng được trực tiếp không cần sửa
- `WarningTokenUtil.generateToken/verifyToken` ([utils/warning-token.util.ts](../../../../src/modules/meetings/utils/warning-token.util.ts)) — JWT ngắn hạn (TTL 300s), payload có `meetingId`, `userId`, `warnings[]`. **Phát hiện quan trọng**: signature cố định dùng tên field `userId`, nhưng không validate kiểu dữ liệu — có thể truyền `email` vào vị trí này khi tái sử dụng cho external participant mà không cần sửa util.
- `checkUserPermission(userId, permissionCode)` ([:3027](../../../../src/modules/meetings/services/meetings.service.ts:3027)) — query RBAC qua `user_roles`/`role_permissions`/`permissions`, dùng được trực tiếp với permission code mới
- `notificationsService.enqueueEmailNotification()` — đã được dùng cho external participant trong `meeting-request-review.service.ts:374-386` khi approve meeting request (gửi `MEETING_INVITE` tới `result.externalEmails`), xác nhận pattern email-only cho external participant đã có precedent rõ ràng trong codebase

### Notification module

| Field | Giá trị dùng |
|---|---|
| `NotificationType.MEETING_INVITE` | đã tồn tại (`notification.entity.ts:12`), tái sử dụng |
| `NotificationChannel.EMAIL` | đã tồn tại, tái sử dụng |
| `notifications.recipient_emails_json` | cột đã có trong schema, hỗ trợ gửi email không cần `user_id` |

### Transaction Pattern

Dự án dùng `DataSource.transaction(async (em) => {...})`. Trong `addInternalParticipant()`, transaction CHỈ bao gồm: lock meeting row (pessimistic_write) + insert participant + insert audit_log. Notification (email/in-app) được tạo **sau** transaction, trong try/catch riêng, best-effort — KHÔNG nằm trong transaction chính. Đây là pattern thực tế cần follow đúng, khác với cách diễn đạt lý thuyết ở một số spec cũ (vd. `feat-remove-internal-meeting-participant/spec.md` ghi "notification trong cùng transaction" nhưng code thực tế của `removeParticipant()` lại tạo notification sau transaction).

### Authorization Pattern

- `JwtAuthGuard` ở controller level, lấy `req.user.userId` (không dùng `@CurrentUser()` ở các endpoint cũ hơn, dùng `request['user']`)
- Ownership check (Organizer/Host) thực hiện trong service layer bằng so sánh `meeting.organizerId`/`meeting.hostId` với `authUser.userId`, KHÔNG dùng PermissionsGuard riêng cho ownership — `@RequirePermissions()` decorator chỉ check permission, owner-bypass code tự viết trong service

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transaction scope | Chỉ participant + meeting_event + audit_log | Mirror đúng pattern thực tế của `addInternalParticipant()`, không phải pattern lý thuyết |
| Notification timing | Post-transaction, best-effort | Mirror `addInternalParticipant()` thực tế; tránh notification provider chậm làm transaction treo |
| Capacity check reuse | Dùng lại `getAttendeeCount()` không sửa | Hàm đã cộng cả internal + external, đúng nhu cầu |
| Warning token reuse | Dùng lại `WarningTokenUtil`, truyền `email` vào slot `userId` | Không cần sửa util, giảm rủi ro breaking change cho luồng internal đang dùng |
| Duplicate check | Application-level (pre-check + re-check trong transaction với pessimistic lock) | Bảng `meeting_external_participants` không có unique constraint DB; thêm constraint mới ngoài phạm vi spec |
| Notification type/channel | `MEETING_INVITE` / `EMAIL` (tái dùng enum có sẵn) | Đã có precedent ở `meeting-request-review.service.ts` cho external participant |
| Event type mới | `external_participant_added` (giá trị mới trong `MeetingEventType`) | Cột `varchar(60)`, không cần migration |
| Permission mới | `meeting.participant.add.external` | Mirror naming `meeting.participant.add.internal` đã có |
| UUID validation | `class-validator @IsUUID('4')` qua `ParseUUIDPipe` ở path param | Convention toàn dự án |
| Response format | `{ success, message, data }` | Theo API convention chuẩn của dự án |

## Risks Identified

1. `MeetingEventType` chưa có `external_participant_added` — cần thêm enum value (không cần migration vì cột là `varchar`)
2. Permission `meeting.participant.add.external` chưa tồn tại — cần seed migration mới, cần xác nhận role nào được gán (ADMIN/MANAGER/EMPLOYEE — mirror seed của `.add.internal`, hoặc thu hẹp hơn, cần hỏi team)
3. `WarningTokenUtil` không có khái niệm "subject type" (internal vs external) — nếu sau này có nhu cầu phân biệt rõ trong payload, cần đánh giá lại; với scope hiện tại dùng `email` vào field `userId` là đủ vì `verifyToken` chỉ so khớp giá trị, không quan tâm ý nghĩa
4. Không có DB unique constraint trên `(meeting_id, email)` → rủi ro duplicate hiếm gặp khi có race condition cực hẹp giữa pre-check và transaction insert nếu pessimistic lock bị bỏ qua khi code — cần đảm bảo implementation đúng theo Business Logic Plan (lock meeting row trước khi re-check)
5. `getAttendeeCount()` là `private` method trong `MeetingsService` — không cần export, method mới `addExternalParticipant()` nằm cùng class nên gọi được trực tiếp

## Dependencies

- `notificationsService.enqueueEmailNotification()` đã tồn tại trong `NotificationsService` — không cần thêm dependency mới
- `system_configs` table phải có sẵn key `meeting.capacity_policy` (đã được seed cho luồng add internal participant — dùng chung)
- Permission seed phải chạy trước khi feature có thể test qua API thực tế (nếu seed không chạy, `PermissionsGuard` sẽ luôn từ chối Meeting Manager — nhưng Organizer/Host vẫn hoạt động được vì check ownership không phụ thuộc permission)
