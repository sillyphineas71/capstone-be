# Research: Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp (UC-IMM-03)

**Phase**: 0 — Research & Codebase Analysis
**Date**: 2026-06-16
**Feature Directory**: spec/features/live-meeting/feat-process-meeting-extension-request

---

## 1. Codebase Analysis

### 1.1 Existing Module: `live-meeting`

Module đã có sẵn với các thành phần:
- `live-meeting.module.ts` — Module registration
- `live-meeting.controller.ts` — Controller với endpoint start + extension request (UC-IMM-02)
- `live-meeting.service.ts` — Service với startMeeting() + requestExtension()
- `constants/meeting-extension-error.constant.ts` — Error codes cho UC-IMM-02
- `constants/meeting-start-error.constant.ts` — Error codes cho UC-IMM-01
- `dto/extension-request.dto.ts`, `extension-request-response.dto.ts` — DTO cho UC-IMM-02
- `dto/start-meeting-response.dto.ts`, `start-meeting-response.dto.spec.ts` — DTO cho UC-IMM-01
- `types/extension-policy.type.ts` — ExtensionPolicy interface + default
- `types/device-start-meeting-params.type.ts` — Device params type
- `tests/live-meeting.service.spec.ts` — Service tests (UC-IMM-01, UC-IMM-02)
- `tests/live-meeting.controller.spec.ts` — Controller tests

### 1.2 Existing Patterns

| Pattern | Implementation | Ghi chú |
|---|---|---|
| Module | `@Module({ imports: [...], controllers: [...], providers: [...], exports: [...] })` | Chuẩn NestJS |
| Controller | `@Controller()` với prefix base từ app module (global prefix `/api/v1`) | Dùng path tương đối: `meetings/:meetingId/extension-requests` |
| Transaction | `this.dataSource.transaction(async (manager) => { ... })` | Dùng TypeORM DataSource |
| Locking | `manager.createQueryBuilder().setLock('pessimistic_write').whereInIds(id).getOne()` | SELECT FOR UPDATE |
| Permission | `@RequirePermissions('permission.code')` | Custom guard |
| Error handling | Custom error constants + NestJS exceptions (NotFoundException, ConflictException, etc.) | Throw từ service |
| Response format | `{ success: true, message: string, data: object }` | Chuẩn API contract |
| Notification | Inject `NotificationsService` hoặc tương tự (chưa rõ implementation) | Cần confirm injection pattern |
| Audit log | Inject `AuditLogService` hoặc tương tự (chưa rõ implementation) | Cần confirm injection pattern |

### 1.3 Database Entity Status

Các entity liên quan đã có TypeORM entity:
- `meeting_requests` — Entity có sẵn, dùng cho UC-IMM-02
- `meetings` — Entity có sẵn
- `room_bookings` — Entity có sẵn
- `room_booking_usages` — Entity có sẵn
- `meeting_events` — Entity có sẵn
- `audit_logs` — Entity có sẵn
- `notifications` — Entity có sẵn

Không cần thêm migration mới. UC-IMM-03 chỉ UPDATE/INSERT, không thêm cột/bảng.

---

## 2. Technology Decisions

| Decision | Lựa chọn | Rationale |
|---|---|---|
| Framework | NestJS + TypeScript | Codebase hiện tại |
| ORM | TypeORM (DataSource pattern) | Codebase hiện tại |
| Transaction | `dataSource.transaction()` với QueryRunner | Pattern hiện tại |
| Locking | `pessimistic_write` lock trên meeting_requests, meetings, room_bookings | FR-035 yêu cầu SELECT FOR UPDATE |
| Permission | `meeting.session.extension.decide` (normal) + `meeting.session.extension.override` (override) | Spec clarify: override cần explicit permission |
| Notifications | Inject NotificationsService | Cần confirm injection pattern từ codebase |
| Audit | Inject AuditLogService | Cần confirm injection pattern từ codebase |
| WebSocket | Socket.IO qua WebsocketService | Pattern từ UC-IMM-01 |
| Re-validation | Dynamic query từ room_bookings | Không dùng bảng schedule_conflicts |
| Event type | `extension_approved`, `extension_rejected` | Cần thêm vào MeetingEventType enum |

---

## 3. Dependency Analysis

### 3.1 Dependencies trên các module

| Module | Dependency | Mục đích |
|---|---|---|
| live-meeting | meetings | Đọc/UPDATE meetings |
| live-meeting | rooms | Đọc rooms (qua meetings.room_id) |
| live-meeting | accounts (users) | Kiểm tra approver list |
| live-meeting | notifications | Gửi notification cho Host |
| live-meeting | administration (audit) | Ghi audit_logs |
| live-meeting | auth | JWT guard, PermissionsGuard |
| live-meeting | meetings (meeting_events) | Ghi meeting_events |

### 3.2 Phụ thuộc vào UC-IMM-02

UC-IMM-03 **bắt buộc** UC-IMM-02 đã hoàn thành vì:
- UC-IMM-02 tạo `meeting_requests` với `request_type = extend_meeting`, `approval_status = pending`
- UC-IMM-03 xử lý các pending request đó
- UC-IMM-02 định nghĩa `MEETING_EXTENSION_ERRORS` constant
- UC-IMM-02 định nghĩa `ExtensionPolicy` interface
- UC-IMM-02 thêm `extension_requested` vào MeetingEventType enum

---

## 4. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Inject pattern của NotificationsService/AuditLogService chưa rõ | High | Medium | Plan sẽ ghi rõ "contribute to existing service" pattern để implementer inspect codebase |
| Transaction conflict giữa approve và end meeting | High | Low | Lock cả 3 bảng + re-check state sau lock |
| Quên seed permission `meeting.session.extension.decide` và `extension.override` | High | Low | Đưa seed task vào Phase 1 Foundation |
| Re-validation conflict query sai logic | High | Medium | Unit test với nhiều edge case (pending/approved/active booking) |
| Chưa có `extension_approved`/`extension_rejected` trong MeetingEventType enum | Medium | Low | Thêm enum trong Phase 1 |

---

## 5. Unresolved Clarifications

- *(Không còn unresolved clarifications. Spec đã clarify override permission, lock strategy, và re-validation rules.)*
