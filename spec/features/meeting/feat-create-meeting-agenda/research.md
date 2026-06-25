# Research: Tạo chương trình họp (UC-MM-09)

## Codebase Analysis

- `MeetingAgendaEntity` đã có đầy đủ (id, meetingId, agendaOrder, title, description, ownerId, plannedDurationMinutes, status, created_by, updated_by)
- `MeetingsService` đã có sẵn transaction pattern (dùng `DataSource`)
- `AuditLogService` có sẵn trong module administration
- JWtAuthGuard và PermissionsGuard có sẵn trong common

## Technology Decisions

| Decision | Choice | Lý do |
|---|---|---|
| ORM | TypeORM | Chuẩn dự án |
| Auth | JwtAuthGuard + custom permission check | Chuẩn dự án |
| Transaction | DataSource.transaction | Pattern hiện có trong MeetingsService |
| Idempotency | No-op detection bằng so sánh payload với DB | Không dùng Redis, không dùng Idempotency-Key |
| Audit | AuditLogService (table audit_logs) | Đã có sẵn |
| Notification | Không implement | Deferred theo spec |
| Validation | class-validator + service-level checks | Chuẩn dự án |

## Risks

- Không có rủi ro lớn vì feature không thay đổi schema và reuse pattern có sẵn
- Race condition khi 2 user cùng PUT agenda cần SELECT FOR UPDATE
