# Research: Xem danh sach diem danh (UC-APM-02)

**Created**: 2026-06-16

## Codebase Analysis

### Attendance module
- Module da co: attendance.module.ts, AttendanceRecordEntity, AttendanceEventEntity
- Entity co day du field: meetingId, userId, checkInTime, attendanceStatus, attendanceSource, isLate, lateMinutes, leftEarly
- Enums co san: AttendanceRecordStatus (PRESENT, ABSENT, LATE, LEFT_EARLY, INVALIDATED, PENDING_REVIEW)
- Thieu: controller, service, DTO cho attendance list

### Meetings module
- Co san controller, service, MeetingEntity, MeetingParticipantEntity
- meetings.module.ts import AttendanceModule

### Accounts module
- UserEntity (fullName, avatarUrl, departmentId, positionTitle, directManagerId)
- DepartmentEntity (departmentName)

### API Contract
- Endpoint attendance list chua co, can them moi: GET /api/v1/meetings/{meetingId}/attendance
- Permission attendance.read co san

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | attendance/ | Module ton tai, add controller+service+dto |
| ORM | TypeORM | Project constraint |
| Auth | JwtAuthGuard | Project convention |
| Validation | class-validator + ValidationPipe | Project convention |
| DB changes | None | Read-only, chi SELECT |

## Risks

| Risk | Mitigation |
|---|---|
| Duplicate attendance_records | Fallback ORDER BY updated_at DESC, created_at DESC LIMIT 1 |
| Performance with >200 participants | Pagination + indexes |
| Field-level authorization leak | Enforce in service layer, not just controller |
