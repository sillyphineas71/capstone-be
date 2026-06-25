# Research: Xem danh sach nguoi tham du dang co mat (UC-IMM-07)

**Phase 0 output** | **Date**: 2026-06-17

---

## 1. Codebase Analysis

### Module live-meeting hien tai

| File | Role | Ghi chu |
|---|---|---|
| live-meeting.controller.ts | REST endpoints | Da co start, end, extension-request, decide-extension |
| live-meeting.service.ts | Business logic | Da co startMeeting, endMeeting, requestExtension, decideExtension |
| dto/ | Request/Response DTOs | 6 DTO files |
| constants/ | Error codes | meeting-start-error, meeting-end-error, meeting-extension-error |
| types/ | TypeScript types | device-start-meeting-params, extension-policy |

### Pattern reuse

- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.presence.read')`
- User extraction: `request['user'] as { userId: string }`
- Error response: `throw new NotFoundException({ success: false, message, error: { code, details } })`
- Audit log: `em.create(AuditLogEntity, ...)` + `em.save(AuditLogEntity, ...)`

### Clarifications da resolve (tu spec.md)

1. PresenceStatus chi 5 trang thai: present, maybe_present, left, absent, unknown
2. Khong co Manager scope: Chi Host + Business Admin + System Admin
3. Error code: FORBIDDEN_LIVE_PARTICIPANTS_ACCESS
4. joinedAt priority: attendance_records.check_in_time > attendance_events.event_time > meeting_participants.joined_at
5. Grace window: [start_time, end_time + 30m] cho meeting scheduled
6. Field: lastSeenAt thay vi lastDetectedAt, them confidenceScore

---

## 2. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| REST endpoint | GET /api/v1/live-meetings/{meetingId}/present-attendees | Theo UC-100 API contract |
| Permission | meeting.presence.read | Da co trong permission list |
| Auth check | Service layer ownership check (Host/Admin) | Need explicit Host vs Admin vs Participant separation |
| Field-level auth | Service maps fields after query | Security enforced at backend |
| Audit log | Non-blocking (fire-and-forget) | Khong anh huong response time |
| Query approach | TypeORM QueryBuilder + LEFT JOINs | Need joins attendance_records + presence_snapshots (latest) |
| No transaction | Khong can | Read-only operation |
| No lock | Khong can | Read-only, eventual consistency OK |

---

## 3. Risks

1. presence_snapshots index: Can dam bao index tren (room_id, user_id, snapshot_time)
2. attendance_records duplicate: Co the co duplicate cho cung user/meeting — dung DISTINCT ON
3. Large presence_snapshots: Room voi nhieu camera sinh nhieu snapshot/sec — can LIMIT 1 subquery
4. Host definition: meetings.host_id vs meeting_participants.participant_role — uu tien meetings.host_id, fallback participant_role

---

## 4. Alternatives Considered

| Approach | Rejected Because |
|---|---|
| WebSocket push realtime | Out of scope (OOS-002). Client polling la du. |
| Them bang moi live_participants | Vi pham No-New-Table rule |
| SQL view cho presence | Phuc tap khong can, QueryBuilder du xu ly |
