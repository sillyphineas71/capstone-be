# API Contract: Send Check-in Alerts (UC-APM-10)

**Date**: 2026-06-16 | **Module**: attendance, notifications | **Spec**: UC-92 (API_CONTRACT_v1.0)

## Endpoint: Trigger Late Check-in Alerts (Internal)

Triggered by scheduler directly; internal HTTP endpoint for manual/test trigger only.

### POST /api/v1/internal/meetings/{meetingId}/late-checkin-alerts

**Purpose**: Manually trigger check-in alert processing for a specific meeting.

**Auth**: Service-to-service API key via `X-API-Key` header.  
**Permission**: `internal.system.notification`  
**System Role**: `INTERNAL_SERVICE`

### Request

**Path Parameters**:
| Field | Type | Required | Description |
|---|---|---|---|
| `meetingId` | UUID | Yes | Meeting ID |

**Headers**:
| Header | Value | Required |
|---|---|---|
| `X-API-Key` | `string` | Yes |
| `Content-Type` | `application/json` | Yes |

**Body**: None (empty JSON object `{}`)

### Response: 202 Accepted

```json
{
  "success": true,
  "message": "Check-in alert processing initiated for meeting",
  "data": {
    "meetingId": "uuid",
    "status": "processing",
    "totalParticipantsChecked": 0,
    "alertsSent": 0,
    "hostAlertSent": false,
    "partialFailures": []
  }
}
```

### Response: 400 Bad Request

```json
{
  "success": false,
  "message": "Invalid meeting ID format",
  "error": {
    "code": "INVALID_MEETING_ID",
    "details": {}
  },
  "timestamp": "2026-06-16T10:00:00.000Z",
  "path": "/api/v1/internal/meetings/{meetingId}/late-checkin-alerts"
}
```

### Response: 401 Unauthorized

```json
{
  "success": false,
  "message": "Invalid or missing API key",
  "error": {
    "code": "UNAUTHORIZED",
    "details": {}
  },
  "timestamp": "2026-06-16T10:00:00.000Z",
  "path": "/api/v1/internal/meetings/{meetingId}/late-checkin-alerts"
}
```

### Response: 403 Forbidden

```json
{
  "success": false,
  "message": "Insufficient permissions",
  "error": {
    "code": "FORBIDDEN",
    "details": {}
  },
  "timestamp": "2026-06-16T10:00:00.000Z",
  "path": "/api/v1/internal/meetings/{meetingId}/late-checkin-alerts"
}
```

### Response: 404 Not Found

```json
{
  "success": false,
  "message": "Meeting not found",
  "error": {
    "code": "MEETING_NOT_FOUND",
    "details": {}
  },
  "timestamp": "2026-06-16T10:00:00.000Z",
  "path": "/api/v1/internal/meetings/{meetingId}/late-checkin-alerts"
}
```

### Response: 409 Conflict

```json
{
  "success": false,
  "message": "Meeting is not in progress",
  "error": {
    "code": "MEETING_NOT_IN_PROGRESS",
    "details": {
      "currentStatus": "scheduled"
    }
  },
  "timestamp": "2026-06-16T10:00:00.000Z",
  "path": "/api/v1/internal/meetings/{meetingId}/late-checkin-alerts"
}
```

## No Public Endpoints

This feature has NO public end-user API endpoints.  
All functionality is internal (scheduler-triggered or internal HTTP endpoint for test/admin).
