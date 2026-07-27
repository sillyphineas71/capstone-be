# API Contract: View Meeting Attendance (UC-IMM-08)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | [P1 BE-05] Đổi path `GET /api/v1/meetings/{meetingId}/attendance` → `GET /api/v1/live-meetings/{meetingId}/attendance` để hết trùng với route `GET /api/v1/meetings/{meetingId}/attendance` của `AttendanceController` (UC-APM-02, danh sách điểm danh chung có phân trang, không cùng nghiệp vụ). Chi tiết: `PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md` §2B. | Toàn bộ |

**Base URL**: /api/v1

## GET /api/v1/live-meetings/{meetingId}/attendance

### Path Params
meetingId: UUID (required)

### Query Params
status, q, page, pageSize, sortBy, sortOrder (see spec for details)

### Response 200
JSON with meetingId, meetingStatus, participants array (userId, fullName,
attendanceStatus, checkInTime, isProvisional, participantState), meta.

### Error Codes
422 VALIDATION_ERROR (invalid input)
401 UNAUTHORIZED (no auth)
403 PERMISSION_DENIED (lacks attendance.read)
403 FORBIDDEN_ATTENDANCE_ACCESS (not Host nor Admin)
404 MEETING_NOT_FOUND (not found)
409 MEETING_NOT_ACTIVE_OR_COMPLETED (wrong status)
500 INTERNAL_ERROR (server error)
