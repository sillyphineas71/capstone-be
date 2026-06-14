# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Tạo quickstart lần đầu | Toàn bộ file |
| 2026-06-08 | Consistency fixes: audit log field names → actionType, entityType, metadataJson | Test 21, Verification 9 |

# Quickstart: Tạo cuộc họp mới thủ công

**Feature**: MEETING-CREATE-MANUAL-001
**Date**: 2026-06-08

---

## Kịch bản test chính

### Happy Path

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 1 | Tạo yêu cầu họp đầy đủ | POST /api/v1/meetings với title, start/end time, room_id, 3 internal participants, 1 external | 201 + meeting status = pending_approval + booking status = pending + 4 participant records + notification queued |
| 2 | Tạo yêu cầu không có host_id | POST không gửi host_id | host_id defaults to authenticated user; host auto-added to participants |
| 3 | Tạo yêu cầu không có participant nội bộ | POST với participant_user_ids = [] | Chỉ có host trong participants + external participants (nếu có) |
| 4 | Tạo yêu cầu có external participants | POST với external_participants array | Records in meeting_external_participants |

### Validation Errors

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 5 | Title trống | POST với title = "" | 400 + VALIDATION_ERROR |
| 6 | end_time < start_time | POST với end_time trước start_time | 400 + VALIDATION_ERROR |
| 7 | start_time trong quá khứ | POST với start_time < now | 400 + VALIDATION_ERROR |
| 8 | Email external không hợp lệ | POST với email sai format | 400 + VALIDATION_ERROR |
| 9 | participant_user_ids chứa UUID không tồn tại | POST với fake UUID | 400 + VALIDATION_ERROR |

### Authorization Errors

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 10 | Không có JWT | POST không gửi Bearer token | 401 + UNAUTHENTICATED |
| 11 | Thiếu permission | POST với user không có `meeting.create` | 403 + FORBIDDEN |

### Business Rule Errors

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 12 | Room double-booking | Tạo 2 meetings cùng room, cùng time range | Lần 1: 201; Lần 2: 409 + ROOM_CONFLICT |
| 13 | Capacity exceeded | Room capacity=10, participants=12, capacity_override_confirmed=false | 422 + CAPACITY_EXCEEDED |
| 14 | Capacity override | Same as #13 but capacity_override_confirmed=true | 201 + audit log records override |
| 15 | Room không tồn tại | POST với room_id = fake UUID | 404 + ROOM_NOT_FOUND |
| 16 | Room inactive | POST với room đã bị deactivate | 404 + ROOM_NOT_FOUND |

### Data Integrity

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 17 | Transaction rollback | Mock DB failure after meeting insert but before participant insert | No records created; request fails |
| 18 | meeting_code uniqueness | Tạo 2 meetings cùng ngày | Codes are MT-YYYYMMDD-001, MT-YYYYMMDD-002 |
| 19 | booking_code uniqueness | Same as above | BK-YYYYMMDD-001, BK-YYYYMMDD-002 |
| 20 | Host auto-add | POST not including host in participant_user_ids | Host appears in meeting_participants with role='host' |

### Audit & Notification

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 21 | Audit log created | Tạo meeting thành công | Audit log with actionType='create', entityType='meeting_request', entityId=request.id, metadataJson={meetingId, bookingId} |
| 22 | Notification created | Tạo meeting thành công | Notification record with delivery_status='queued', recipient = approver |

---

## Verification Notes

### Sau khi implement, kiểm tra:

1. **Entity mapping**: Tất cả fields trong spec đều được map đúng với entity hiện có (không tạo field mới)
2. **Transaction**: Mọi DB write nằm trong cùng một `DataSource.transaction()`, không có partial write khi fail
3. **Authorization**: Endpoint được bảo vệ bởi `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.create')`
4. **Validation**: DTO có đủ decorators class-validator cho tất cả fields bắt buộc
5. **Code generation**: meeting_code và booking_code được sinh tự động, unique
6. **Overlap check**: Query đúng với booking có status pending/approved/active (không chỉ approved)
7. **Host auto-add**: Host luôn được thêm vào meeting_participants dù không nằm trong participant_user_ids
8. **Notification record**: Chỉ tạo record (delivery_status = 'queued'), không gửi email thực tế
9. **Audit log**: actionType = 'create', entityType = 'meeting_request', metadataJson chứa cả meetingId và bookingId
10. **Capacity override**: Ghi nhận vào audit log khi capacity_override_confirmed = true
