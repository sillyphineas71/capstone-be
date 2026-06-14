# API Contract: Departments — Create

**Base URL**: /api/v1
**Module**: accounts
**Feature**: UC-AM-03 Khởi tạo phòng ban mới

---

## POST /api/v1/departments

Create a new department.

### Permission
- department.create (assigned to ADMIN, MANAGER roles)

### Authorization
- Requires JWT Bearer token in `Authorization` header.
- Requires permission `department.create`.

### Idempotency (Optional)
- Supports `Idempotency-Key` header: `<client-generated-uuid>`
- If same `Idempotency-Key` with same payload is sent again by same authenticated user, return original 201 response (no duplicate created).
- If same `Idempotency-Key` with different payload, return 409 `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.
- If no `Idempotency-Key` header, request proceeds normally; uniqueness still enforced by DB unique constraint.

### Request Body

`json
{
  "departmentCode": "IT",
  "departmentName": "Phòng Công nghệ thông tin",
  "parentDepartmentId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "managerUserId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "description": "Mô tả phòng ban"
}
`

### Field Validation

| Field | Type | Required | Validation |
|---|---|---|---|
| departmentCode | string | Yes | Trim → uppercase, regex ^[A-Z0-9][A-Z0-9_-]{1,49}$, 2–50 chars, unique non-deleted |
| departmentName | string | Yes | Trim, 2–150 chars, unique non-deleted, safe charset, no emoji/control |
| parentDepartmentId | uuid | No | FK → departments.id, active, non-deleted, no circular ref, depth ≤ 5 |
| managerUserId | uuid | No | FK → users.id, account_status=active, non-deleted |
| description | string | No | Empty/whitespace → null |

### Response 201 — Created

`json
{
  "success": true,
  "message": "Khởi tạo phòng ban thành công",
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "departmentCode": "IT",
    "departmentName": "Phòng Công nghệ thông tin",
    "parentDepartmentId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "managerUserId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "description": "Mô tả phòng ban",
    "isActive": true,
    "createdAt": "2026-06-08T08:00:00+07:00",
    "updatedAt": "2026-06-08T08:00:00+07:00"
  }
}
`

### Response 400 — Validation Error (Missing Required)

`json
{
  "success": false,
  "message": "Mã phòng ban là bắt buộc",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Mã phòng ban là bắt buộc"
  },
  "requestId": "req_xxx",
  "timestamp": "2026-06-08T08:00:00+07:00",
  "path": "/api/v1/departments"
}
`

### Response 401 — Unauthorized

`json
{
  "success": false,
  "message": "Unauthorized",
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Unauthorized"
  },
  "requestId": "req_xxx",
  "timestamp": "2026-06-08T08:00:00+07:00",
  "path": "/api/v1/departments"
}
`

### Response 403 — Forbidden

`json
{
  "success": false,
  "message": "Không đủ quyền",
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Không đủ quyền"
  },
  "requestId": "req_xxx",
  "timestamp": "2026-06-08T08:00:00+07:00",
  "path": "/api/v1/departments"
}
`

### Response 404 — Not Found (Reference)

`json
{
  "success": false,
  "message": "Phòng ban cha không tồn tại hoặc không hoạt động",
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Phòng ban cha không tồn tại hoặc không hoạt động",
    "details": { "field": "parentDepartmentId" }
  },
  "requestId": "req_xxx",
  "timestamp": "2026-06-08T08:00:00+07:00",
  "path": "/api/v1/departments"
}
`

### Response 409 — Conflict (Duplicate)

`json
{
  "success": false,
  "message": "Mã phòng ban này đã được sử dụng",
  "error": {
    "code": "DEPARTMENT_ALREADY_EXISTS",
    "message": "Mã phòng ban này đã được sử dụng",
    "details": { "field": "departmentCode" }
  },
  "requestId": "req_xxx",
  "timestamp": "2026-06-08T08:00:00+07:00",
  "path": "/api/v1/departments"
}
`

### Response 422 — Validation Error (Format/Business Rule)

`json
{
  "success": false,
  "message": "Mã phòng ban không đúng định dạng. Chỉ chấp nhận chữ in hoa, số, gạch dưới và gạch ngang.",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": { "field": "departmentCode", "pattern": "^[A-Z0-9][A-Z0-9_-]{1,49}$" }
  },
  "timestamp": "2026-06-08T08:00:00+07:00",
  "path": "/api/v1/departments"
}
`

### Response 500 — Internal Server Error

`json
{
  "success": false,
  "message": "Internal server error",
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error"
  },
  "requestId": "req_xxx",
  "timestamp": "2026-06-08T08:00:00+07:00",
  "path": "/api/v1/departments"
}
`

### Error Codes Summary

| HTTP | Error Code | Trigger |
|---|---|---|
| 400 | VALIDATION_ERROR | Missing/empty/whitespace required field |
| 401 | UNAUTHORIZED | No/invalid JWT |
| 403 | PERMISSION_DENIED | Missing department.create |
| 404 | RESOURCE_NOT_FOUND | parentDepartmentId/managerUserId not found |
| 409 | DEPARTMENT_ALREADY_EXISTS | Duplicate code/name (app or DB constraint) |
| 422 | VALIDATION_ERROR | Regex fail, length, circular ref, depth > 5, emoji/control |
| 500 | INTERNAL_ERROR | Server error |


