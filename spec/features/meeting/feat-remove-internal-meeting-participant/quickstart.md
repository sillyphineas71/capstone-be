# Quickstart: Remove Internal Meeting Participant

- **Feature ID**: UC-MM-08
- **Target**: `DELETE /api/v1/meetings/{meetingId}/participants/{participantUserId}`

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Host removes internal participant | 1. Create meeting (scheduled)<br>2. Add participant<br>3. DELETE with Host auth | 200 OK, participant removed, event/audit/notification/job created |
| 2 | Organizer removes internal participant | Same as #1 but as Organizer | 200 OK |
| 3 | Admin removes internal participant | Same as #1 but as Admin with permission | 200 OK |
| 4 | Remove with optional reason | Include `{ "reason": "Sai phòng ban" }` | 200 OK, reason stored in event metadata |

### Authorization Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 5 | Unauthenticated | DELETE without JWT | 401 UNAUTHENTICATED |
| 6 | Regular participant tries to remove | Auth as attendee | 403 FORBIDDEN |
| 7 | Unauthorized user (not Host/Organizer/Admin) | Auth as different user | 403 FORBIDDEN |
| 8 | Admin tries to remove Host | Auth as Admin, target = Host | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| 9 | Admin tries to remove Organizer | Auth as Admin, target = Organizer | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| 10 | Host tries to remove self | Auth as Host, target = self | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| 11 | Organizer tries to remove self | Auth as Organizer, target = self | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |

### Validation Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 12 | Invalid meetingId UUID | DELETE with "not-a-uuid" | 400 INVALID_UUID |
| 13 | Invalid participantUserId UUID | DELETE with "not-a-uuid" | 400 INVALID_UUID |
| 14 | Reason > 1000 chars | Include long reason | 400 VALIDATION_ERROR |
| 15 | Meeting not found | DELETE with non-existent UUID | 404 MEETING_NOT_FOUND |
| 16 | Participant not in meeting | DELETE with valid UUID not in participants | 404 PARTICIPANT_NOT_IN_MEETING |

### State Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 17 | Meeting in_progress | Create meeting, start it, then DELETE | 409 MEETING_NOT_REMOVABLE |
| 18 | Meeting completed | Complete meeting, then DELETE | 409 MEETING_NOT_REMOVABLE |
| 19 | Meeting cancelled | Cancel meeting, then DELETE | 409 MEETING_NOT_REMOVABLE |

### Business Rule Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 20 | Participant owns agenda items | Create agenda with participant as owner, then DELETE | 409 PARTICIPANT_OWNS_AGENDA_ITEMS (kèm agendaItemIds) |
| 21 | Series-wide removal request | Cố gắng remove từ entire recurring series | 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED |

### Concurrency & Edge Cases

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 22 | Duplicate remove | DELETE twice for same participant | 1st: 200, 2nd: 404 PARTICIPANT_NOT_IN_MEETING |
| 23 | Concurrent remove | Send 2 DELETE requests simultaneously | 1st: 200, 2nd: 404 |
| 24 | Meeting with null host_id | Meeting has no host, remove via organizer | 200 OK |
| 25 | All invitation_status variants | Remove participant with pending/accepted/declined | 200 OK — all statuses removable |

## Verification Notes

- [ ] Check `meeting_participants` row is hard deleted (not soft)
- [ ] Check `meeting_events` has record with event_type = `participant_removed`
- [ ] Check `audit_logs` has record with action = `remove_participant`
- [ ] Check `notifications` has record with notification_type = `meeting_participant_removed`
- [ ] Check `background_jobs` has record with job_type = `send_email`
- [ ] Check response contains notificationId and backgroundJobId
- [ ] Check if meeting is recurring instance, other occurrences are unaffected
- [ ] Verify no .ics file is generated
- [ ] Verify transaction rollback on error (participant not removed if notification creation fails)