# API Contract: Extension Decide API

**Feature**: UC-IMM-03 — Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp
**Base URL**: `/api/v1`

---

## Decide Extension Request

Phê duyệt hoặc từ chối một yêu cầu gia hạn phiên họp đang pending.

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/live-meetings/{meetingId}/extension-requests/{requestId}/decide` |
| Permission | `meeting.session.extension.decide` (normal) hoặc `meeting.session.extension.override` (override) |
| System Role | `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Async | No |

### Request Body

```json
{
  "decision": "approved",
  "reason": "Đồng ý gia hạn thêm 15 phút"
}
```

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| `decision` | string | Có | `approved` hoặc `rejected` | Chỉ chấp nhận 2 giá trị |
| `reason` | string | Không | Lý do nếu reject | Tối đa 500 ký tự |

### Response 200 — Approve thành công

```json
{
  "success": true,
  "message": "Extension request approved successfully",
  "data": {
    "requestId": "uuid",
    "decision": "approved",
    "status": "applied",
    "oldEndTime": "2026-06-16T10:00:00+07:00",
    "newEndTime": "2026-06-16T10:15:00+07:00",
    "extensionMinutes": 15,
    "decisionAt": "2026-06-16T10:05:00+07:00",
    "message": "Yêu cầu gia hạn đã được phê duyệt. Thời gian kết thúc mới: 10:15."
  }
}
```

### Response 200 — Reject thành công

```json
{
  "success": true,
  "message": "Extension request rejected",
  "data": {
    "requestId": "uuid",
    "decision": "rejected",
    "status": "rejected",
    "rejectionReason": "Phòng cần được giải phóng cho cuộc họp tiếp theo",
    "decisionAt": "2026-06-16T10:05:00+07:00",
    "message": "Yêu cầu gia hạn đã bị từ chối."
  }
}
```

### Error Codes

| HTTP | Error Code | Mô tả |
|---:|---|---|
| 401 | `UNAUTHORIZED` | Chưa đăng nhập |
| 403 | `PERMISSION_DENIED` | Không đủ quyền hoặc không trong approver list |
| 404 | `RESOURCE_NOT_FOUND` | Request không tồn tại |
| 409 | `REQUEST_ALREADY_PROCESSED` | Request đã được xử lý trước đó (idempotency) |
| 409 | `MEETING_NOT_ACTIVE` | Meeting không còn in_progress |
| 409 | `ROOM_CONFLICT` | Re-validation phát hiện room conflict |
| 422 | `VALIDATION_ERROR` | Decision value không hợp lệ |
| 500 | `INTERNAL_ERROR` | Lỗi server |

### Error Response Example (409 — Request already processed)

```json
{
  "success": false,
  "message": "Request has already been processed",
  "error": {
    "code": "REQUEST_ALREADY_PROCESSED",
    "details": {
      "requestId": "uuid",
      "currentStatus": "applied",
      "processedAt": "2026-06-16T10:00:00+07:00",
      "decisionBy": "uuid"
    }
  },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/live-meetings/{meetingId}/extension-requests/{requestId}/decide"
}
```

### Authorization Flow

1. User must have JWT Bearer token.
2. User must have AT LEAST ONE of:
   - `meeting.session.extension.decide` AND be in `meeting_requests.rule_snapshot_json.approverIds`
   - `meeting.session.extension.override` (admin override — Proposed, cần đồng bộ API contract)
3. If user has `meeting.session.extension.decide` but is NOT in approverIds → 403 PERMISSION_DENIED.
4. If user tries override but lacks `meeting.session.extension.override` → 403 PERMISSION_DENIED.
