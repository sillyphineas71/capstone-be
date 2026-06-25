| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo research cho tính năng gỡ bỏ khách mời bên ngoài | Toàn bộ file |

# Research: Remove External Meeting Participant

- **Feature ID**: MEET-REMOVE-EXTERNAL-PARTICIPANT-001
- **Created**: 2026-06-25
- **Status**: Complete

---

## Codebase Analysis

### Entity liên quan trực tiếp

| Entity | File | Field chính |
|---|---|---|
| `MeetingExternalParticipantEntity` | `entities/meeting-external-participant.entity.ts` | id (PK, dùng làm route param thay vì userId), meetingId, fullName, email (nullable), participantRole, invitationStatus, createdAt — **không có** `deletedAt`, `createdBy`, `invitedBy` |
| `MeetingEntity` | `entities/meeting.entity.ts` | status, organizerId, hostId — KHÔNG có liên kết trực tiếp nào tới `meeting_external_participants` ngoài `meeting_id` FK |
| `MeetingAgendaEntity` | `entities/meeting-agenda.entity.ts` | `owner_id` chỉ là `@Column({ type: 'uuid', nullable: true })` với `@ManyToOne(() => UserEntity, ...)` — **xác nhận chỉ tham chiếu `users.id`**, không có FK tới `meeting_external_participants`, nên khách mời ngoài không bao giờ có thể là agenda owner |
| `MeetingEventEntity` | `entities/meeting-event.entity.ts` | eventType (varchar(60), không enum DB) |

### Existing implementation đã có sẵn để tái sử dụng/đối chiếu

`MeetingsService.removeParticipant()` ([meetings.service.ts:3064](../../../../src/modules/meetings/services/meetings.service.ts:3064)) là baseline chính, nhưng có 2 bước **không áp dụng** cho external participant và phải bỏ qua khi viết `removeExternalParticipant()`:

1. **Host/Organizer protection** ([:3128-3143](../../../../src/modules/meetings/services/meetings.service.ts:3128)): so sánh `meeting.hostId === participantUserId` / `meeting.organizerId === participantUserId`. Vì `meetings.organizer_id`/`meetings.host_id` là FK tới `users.id` (xác nhận trong `meeting.entity.ts:64-68`), một row trong `meeting_external_participants` (có PK riêng, không phải `users.id`) không thể nào khớp với `organizer_id`/`host_id`. Bước này vô nghĩa và phải loại bỏ hoàn toàn khỏi flow, không phải "luôn pass".
2. **Agenda owner check** ([:3146-3165](../../../../src/modules/meetings/services/meetings.service.ts:3146)): query `meeting_agendas WHERE owner_id = :participantUserId`. Tương tự, `owner_id` là FK `users.id`, external participant ID không bao giờ khớp. Bỏ qua hoàn toàn.

Các bước khác từ `removeParticipant()` **giữ nguyên logic, đổi entity/field**:
- `checkUserPermission()` ([:3027](../../../../src/modules/meetings/services/meetings.service.ts:3027)) — dùng lại nguyên vẹn với permission code mới
- Pessimistic lock pattern trên `meetings` row trong transaction ([:3187](../../../../src/modules/meetings/services/meetings.service.ts:3187))
- Recurring scope check (`RemoveScope.INSTANCE`/`SERIES`) ([:3168-3179](../../../../src/modules/meetings/services/meetings.service.ts:3168)) — tái sử dụng `RemoveScope` type đã có ở `types/remove-scope.type.ts`

### Notification — điểm khác biệt quan trọng

`removeParticipant()` (internal) luôn có `participantUserId`, nên luôn `resolveUserEmails([participantUserId], ...)` để lấy email và luôn enqueue được. Với external participant, **email đã có sẵn trực tiếp trên record** (`meeting_external_participants.email`), không cần resolve qua bảng `users`, nhưng **có thể là `null`** — đây là điểm khác biệt cốt lõi cần xử lý:

```ts
// Internal (hiện tại):
const emailMap = await this.resolveUserEmails([participantUserId], manager);
const userEmail = emailMap.get(participantUserId);
if (userEmail) { /* enqueue */ }

// External (mới, đơn giản hơn — không cần resolveUserEmails):
if (target.email) { /* enqueue */ } else { /* skip, notificationQueued = false */ }
```

### Transaction Pattern

Giống `addInternalParticipant()`/`removeParticipant()` hiện có: transaction chỉ bọc các bước ghi DB cốt lõi (delete + insert event + insert audit_log), KHÔNG bọc notification. Notification được tạo sau transaction, trong try/catch riêng, best-effort.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Transaction scope | Chỉ DELETE + meeting_event + audit_log | Mirror pattern thực tế của `removeParticipant()` |
| Notification timing | Post-transaction, best-effort, có điều kiện theo `email != null` | Khác biệt cốt lõi so với internal (luôn có email qua `users` table) |
| Host/Organizer protection | **Bỏ hoàn toàn** | Không applicable — external participant không thể giữ vai trò này (xác nhận qua FK schema) |
| Agenda owner check | **Bỏ hoàn toàn** | Không applicable — `meeting_agendas.owner_id` chỉ tham chiếu `users.id` |
| Target identifier trong route | `externalParticipantId` (PK của `meeting_external_participants`), không phải `userId` | External participant không có `user_id` |
| Recurring scope | Tái sử dụng `RemoveScope` type đã có | Giữ nhất quán với luồng remove internal |
| Notification type | `NotificationType.MEETING_PARTICIPANT_REMOVED` (tái dùng enum có sẵn) | Đã tồn tại, dùng chung với luồng remove internal |
| Event type mới | `external_participant_removed` (giá trị mới trong `MeetingEventType`) | Cột `varchar(60)`, không cần migration |
| Permission mới | `meeting.participant.remove.external` | Mirror naming `meeting.participant.add.external` |
| Hard delete | DELETE FROM meeting_external_participants | Không có `deleted_at`, lịch sử qua `meeting_events`/`audit_logs` |

## Risks Identified

1. `MeetingEventType` chưa có `external_participant_removed` — cần thêm enum value
2. Permission `meeting.participant.remove.external` chưa tồn tại — cần seed migration mới
3. Route hiện tại của remove internal participant (`DELETE /:meetingId/participants/:participantUserId`, KHÔNG có prefix `/meetings/` — xác nhận trong `meetings.controller.ts:494`) khác hẳn route mới đề xuất (`DELETE /meetings/:meetingId/participants/external/:externalParticipantId`, có prefix đầy đủ). Cần lưu ý khi review để không tạo nhầm route convention, dù route mới tự nó nhất quán và rõ ràng hơn route cũ.
4. Nếu code không kiểm tra `email != null` trước khi gọi notification, có thể gây lỗi runtime không mong muốn (gọi `enqueueEmailNotification` với `toEmails: [null]`) — phải test riêng case này

## Dependencies

- `notificationsService.enqueueEmailNotification()` đã tồn tại — không cần thêm dependency mới
- `RemoveScope` type đã có ở `src/modules/meetings/types/remove-scope.type.ts` — tái dùng trực tiếp
- Permission seed phải chạy trước khi Meeting Manager dùng được tính năng (Organizer/Host không phụ thuộc seed này)
