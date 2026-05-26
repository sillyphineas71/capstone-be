# Contract: POST /api/v1/auth/login

## Request

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "user@company.com",
  "password": "raw-password"
}
```

## Success Response

```json
{
  "success": true,
  "data": {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": 3600,
    "user": {
      "id": "uuid",
      "email": "user@company.com",
      "fullName": "Nguyen Van A",
      "avatarUrl": null,
      "departmentId": "uuid-or-null",
      "roles": [],
      "permissions": []
    }
  },
  "meta": {}
}
```

## Error Responses
- `400 VALIDATION_ERROR`
- `401 AUTH_INVALID_CREDENTIALS`
- `403 AUTH_ACCOUNT_INACTIVE`
- `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`
- `423 AUTH_ACCOUNT_LOCKED`
- `429 AUTH_TOO_MANY_ATTEMPTS`
- `500 AUTH_SESSION_CREATE_FAILED`
