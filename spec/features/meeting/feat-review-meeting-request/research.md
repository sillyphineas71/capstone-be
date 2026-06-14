# Research: Duyệt hoặc từ chối yêu cầu cuộc họp

## Codebase Analysis

### 1. Module hiện tại

| Module | Trạng thái | Liên quan |
|--------|-----------|-----------|
| `meetings/` | Đã implement (controller + service + 8 entities) | **Chứa toàn bộ entities cần thiết** |
| `approvals/` | Module rỗng (`@Module({})`) | Có thể dùng nhưng không bắt buộc |
| `scheduling/` | Module rỗng (`@Module({})`) | Kiểm tra conflict có thể đặt ở đây |
| `notifications/` | Entity có sẵn, chưa có service | Cần tạo NotificationService hoặc dùng EntityManager |
| `administration/` | AuditLogEntity có sẵn | Dùng trực tiếp |

### 2. Entities đã tồn tại và có thể dùng ngay

- **MeetingRequestEntity**: Đã có đầy đủ fields (`approvalStatus`, `decisionBy`, `decisionAt`, `rejectionReason`, `conflictCheckStatus`, `conflictSummaryJson`, `appliedAt`, `requestType`, `notes`)
- **MeetingEntity**: Đã có `status`, `cancellationReason`, `updatedBy`
- **RoomBookingEntity**: Đã có `status`, `approvedBy`, `approvedAt`, `cancellationReason`
- **MeetingEventEntity**: Đã có `eventType` — dùng `meeting_request_approved`, `meeting_request_rejected`
- **NotificationEntity**: Đã có `notificationType` (MEETING_INVITE, MEETING_REQUEST_CREATED hiện có), `recipientUserIdsJson`, `channel`, `deliveryStatus`
- **AuditLogEntity**: Đã có `actionType`, `entityType`, `entityId`, `oldValueJson`, `newValueJson`, `metadataJson`

### 3. Patterns có sẵn

| Pattern | Implementation |
|---------|---------------|
| Transaction | `dataSource.transaction(async (em) => { ... })` |
| Pessimistic Lock | Chưa có — cần implement bằng `em.findOne(Entity, { where: { id }, lock: { mode: 'pessimistic_write' } })` |
| Auth | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('meeting_request.approve')` |
| Permission check | `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)` — raw SQL query |
| User extraction | `@Req() request` + `request['user'].userId` |
| Response format | `{ success, message, data }` — object literal |
| Error format | NestJS exceptions with `{ success, message, error: { code, details } }` |
| Audit logging | Trong transaction — `em.create(AuditLogEntity, ...)` + `em.save()` |

### 4. Không có

- **Không có** MeetingRequestsController riêng — hiện tại tất cả qua MeetingsController
- **Không có** NotificationService — chỉ tạo entity trực tiếp
- **Không có** ApprovalsService — module approvals rỗng
- **Không có** Conflict checking service riêng — logic gộp trong MeetingsService

---

## Technology Decisions

| Decision | Chọn | Rationale |
|----------|------|-----------|
| **Module placement** | meetings module | Sát với entity, imports sẵn accounts/notifications/administration |
| **Transaction** | `DataSource.transaction()` | Pattern có sẵn trong codebase |
| **Pessimistic Lock** | `lock: { mode: 'pessimistic_write' }` trên MeetingRequestEntity | Spec yêu cầu, TypeORM support |
| **Conflict checking** | Query `room_bookings` trong transaction | Dùng `em.getRepository(RoomBookingEntity).find()` với overlap logic |
| **Permissions** | `@RequirePermissions('meeting_request.approve')` | Pattern có sẵn |
| **Self-approval check** | Service layer — so sánh `request.requestedBy` với `authUser.userId` | Simple, hiệu quả |
| **Notifications** | Tạo entity trực tiếp trong transaction | NotificationService chưa tồn tại |
| **Audit** | `em.create(AuditLogEntity, ...)` trong transaction | Pattern có sẵn |
| **Error codes** | `ROOM_CONFLICT`, `SELF_APPROVAL_NOT_ALLOWED`, `REQUEST_ALREADY_PROCESSED`, `UNSUPPORTED_REQUEST_TYPE` | Pattern hiện tại dùng SCREAMING_SNAKE_CASE |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Race condition (double approval) | Pessimistic Lock + status check sau lock |
| Transaction timeout | Giữ transaction ngắn — chỉ DB operations, không gọi external API |
| Notification delivery failure | Async xử lý sau; không ảnh hưởng đến approve/reject |
| Conflict checking khác biệt giữa các phiên | Re-check tại thời điểm approve, không dùng cached data |
| Audit log lỗi làm rollback | Spec yêu cầu rollback — mặc định hiện tại |

## Unresolved Questions (không cần clarification)

Không có — spec đã clarify tất cả các điểm chính trong session 2026-06-08.
