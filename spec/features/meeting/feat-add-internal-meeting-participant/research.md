# Research: Thêm thành viên nội bộ cuộc họp thủ công

- **Feature ID**: MEET-ADD-PARTICIPANT-001
- **Created**: 2026-06-10
- **Status**: Complete

---

## 1. Codebase Analysis

### 1.1 Meetings Module Structure

Module `meetings` tại `src/modules/meetings/` đã có infrastructure đầy đủ:

| Component | Path | Ghi chú |
|-----------|------|---------|
| Controller | `controllers/meetings.controller.ts` | 8 endpoints, dùng `JwtAuthGuard` + `PermissionsGuard` |
| Service | `services/meetings.service.ts` | 2189 dòng, transaction pattern rõ ràng |
| Entities | `entities/` | 8 entities (meeting, participant, request, agenda, event, note, external-participant, recurrence-rule) |
| DTOs | `dto/` | 15 DTO files |
| Module | `meetings.module.ts` | Import `AccountsModule`, `NotificationsModule`, `AdministrationModule`, `AuthModule` |

### 1.2 Patterns hiện có

**a) 2-step Warning Confirmation pattern (quan trọng nhất)**:
- `requiresConfirmation: true` flag trong error response (dùng ở `updateMeetingRoom`, `updateMeetingTime`)
- Frontend nhận 422/409 → hiển thị warning → gọi lại API với flag confirm
- **Hiện tại không dùng `warningToken`** — chỉ dùng simple boolean flag

**b) Participant creation**:
- Method `create()` (lines 476-515) tạo `MeetingParticipantEntity` với `participant_role='attendee'`, `invitation_status='pending'`, `invited_by`
- Sử dụng `em.create()` + `em.save()` trong transaction

**c) Transaction pattern**:
- Dùng `dataSource.transaction(async (em) => { ... })` với `pessimistic_write` lock
- Notification + BackgroundJob tạo **bên ngoài** transaction (best-effort, không throw nếu fail)
- Audit log tạo **bên trong** transaction

**d) Permission checking**:
- Dùng `PermissionsGuard` với `@RequirePermissions('permission.name')`
- Service có method `checkUserPermission()` để query RBAC

### 1.3 Các thành phần có thể reuse

| Thành phần | File | Cách reuse |
|------------|------|------------|
| `checkParticipantConflicts()` | `meetings.service.ts:187-230` | Kiểm tra xung đột lịch cho user được mời |
| `getAttendeeCount()` | `meetings.service.ts:1173-1183` | Đếm số lượng participant hiện tại |
| `MeetingParticipantEntity` | `entities/meeting-participant.entity.ts` | Entity đã có `invited_by` field |
| `RoomEntity.capacity` | `../../rooms/entities/room.entity.ts` | capacity là integer NOT NULL |
| `NotificationEntity` | `../../notifications/entities/notification.entity.ts` | Đã có `MEETING_INVITE` type |
| `AuditLogEntity` | `../../administration/entities/audit-log.entity.ts` | Đã có pattern đầy đủ |
| `BackgroundJobEntity` | `../../administration/entities/background-job.entity.ts` | Đã có `SEND_EMAIL` type |
| `SystemConfigEntity` | `../../administration/entities/system-config.entity.ts` | Dùng để query `meeting.capacity_policy` |
| `JwtAuthGuard` | `../../auth/guards/jwt-auth.guard.ts` | Chuẩn cho mọi protected endpoint |
| `PermissionsGuard` | `../../auth/guards/permissions.guard.ts` | Chuẩn cho permission check |
| `@RequirePermissions` | `../../auth/decorators/require-permissions.decorator.ts` | Chuẩn decorator |

### 1.4 Các thành phần phải tạo mới

| Thành phần | Lý do |
|------------|-------|
| `AddInternalParticipantDto` | DTO mới với `userId`, `overrideWarnings`, `warningToken` |
| `WarningTokenService` (hoặc util) | Spec yêu cầu `warningToken` JWT/opaque — pattern mới |
| Controller method mới | `postAddInternalParticipant()` |
| Service method mới | `addInternalParticipant()` |
| Unit tests (DTO + Service + Controller) | Test coverage bắt buộc |
| Seed permission `meeting.participant.add.internal` | Cần permission mới nếu chưa có |

---

## 2. Technology Decisions

### Decision: warningToken implementation

- **Chosen**: JWT short-lived token (5 phút), ký bằng `JwtService` với secret riêng biệt `WARNING_TOKEN_SECRET`
- **Rationale**:
  - Codebase đã dùng `JwtService` và `JwtModule`
  - JWT tự chứa signed payload `{ meetingId, userId, warnings[] }`, chống giả mạo
  - Không cần cache/token store — stateless verification
  - 5 phút TTL đủ cho luồng UI confirm
- **Alternatives**: Opaque token trong Redis (cần thêm cache dependency, phức tạp hơn)

### Decision: Capacity policy checking

- **Chosen**: Đọc `meeting.capacity_policy` từ `system_configs` mỗi request (không cache)
- **Rationale**: Pattern đã có sẵn trong codebase (ví dụ `resolveApproverIds`)
- **Alternatives**: Cache trong memory (chưa cần vì config hiếm khi thay đổi)

### Decision: Transaction boundary

- **Chosen**: Atomic transaction cho `meeting_participants` + `audit_logs`; Notification + BackgroundJob tạo ngoài transaction (best-effort)
- **Rationale**: Giống pattern hiện tại (`updateMeetingRoom`, `cancelMeeting`)
  - NFR-002 yêu cầu atomic cho participant data — đảm bảo bằng transaction
  - FR-005/FE-007 cho phép notification/device sync fail without rollback
  - Không lock lâu → tránh contention

### Decision: Unique constraint enforcement

- **Chosen**: Pre-check ở service layer + DB unique constraint `(meeting_id, user_id)` để catch race condition
- **Rationale**: FR-013 yêu cầu, DB bảo vệ final boundary

### Decision: Private meeting enforcement

- **Chosen**: Check `visibility_level='private'` trong service, chỉ cho phép `organizer_id`/`host_id`/Admin
- **Rationale**: FR-004 yêu cầu rõ, dùng `checkUserPermission()` pattern có sẵn

---

## 3. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `warningToken` bị lộ/intercept | Attacker có thể bypass warnings | JWT short-lived (5 phút), kèm signature, scope gắn với meetingId + userId cụ thể |
| Race condition duplicate participant | Duplicate data hoặc 500 error | Pre-check + DB unique constraint + handle 409 response |
| Capacity check inconsistent với concurrent adds | Over-capacity nếu nhiều request cùng lúc | Pessimistic lock trên meeting row trong transaction |
| Notification service chưa có worker | Email không được gửi | Pattern hiện tại: tạo record QUEUED, worker sau pick up |
