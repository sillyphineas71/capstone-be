# Quickstart: Xem danh sach nguoi tham du dang co mat

**Feature**: UC-IMM-07 | **Phase 1 output**

---

## Test Scenarios

### S1: Happy path - Host xem danh sach

Steps:
1. Tao meeting scheduled (host = userA)
2. Start meeting -> in_progress
3. Tao attendance_records cho userB (present), userC (late)
4. Tao presence_snapshots cho userD (present, room_camera)
5. Login bang userA
6. Call GET /api/v1/live-meetings/{meetingId}/present-attendees

Expect:
- 200 OK
- occupancyCount = 3 (userB present, userC present, userD present)
- presentUsers length >= 4 (ca userA host)
- userA thay full fields

### S2: Participant thuong xem

Steps:
1. Meeting in_progress, userA (host), userB (attendee)
2. Login bang userB
3. Call GET /api/v1/live-meetings/{meetingId}/present-attendees

Expect:
- 200 OK
- userB thay presenceSource, checkInTime cua chinh minh
- userB KHONG thay presenceSource, confidenceScore, checkInTime, lastSeenAt cua userA (cac field = null)
- userB khong thay confidenceScore cua ai ca

### S3: Forbidden (khong phai Host/Admin)

Steps:
1. UserC (role = attendee, khong phai host, khong phai admin)
2. Login bang userC
3. Call API

Expect: 403 FORBIDDEN_LIVE_PARTICIPANTS_ACCESS

### S4: Meeting not found

Call voi UUID khong ton tai -> 404 MEETING_NOT_FOUND

### S5: Meeting not in progress

Meeting scheduled + now = start_time - 1h -> 409 MEETING_NOT_IN_PROGRESS

### S6: Grace window

Meeting scheduled + now = start_time + 5m -> 200 OK

### S7: Search

Call ?search=Nguyen -> chi tra ve participants co ten/email chua "Nguyen"

### S8: Department filter

Call ?departmentId=<IT-dept-uuid> -> chi tra ve IT department participants

### S9: Audit log

Host xem thanh cong -> co record audit_logs action_type = read_live_participants

---

## Verification Checklist

- [ ] Response shape dung spec (success, data, meta)
- [ ] occupancyCount dem dung present + maybe_present
- [ ] Host thay day du fields, Participant bi che fields
- [ ] search khong phan biet hoa thuong
- [ ] departmentId filter hoat dong
- [ ] Pagination hoat dong (page, limit, total, totalPages)
- [ ] sortBy allowlist enforced
- [ ] Grace window [start_time, end_time + 30m] hoat dong
- [ ] Audit log ghi non-blocking
- [ ] Error codes dung (401, 403, 404, 409, 500)
- [ ] Khong co side effect (read-only)
