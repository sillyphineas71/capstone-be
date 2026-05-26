# Quickstart: AUTH-001 Login

## Goal
Verify the login flow behavior end-to-end against the clarified spec.

## Main Scenarios
1. Success with valid `email` + `password`, active account, session created, tokens returned.
2. `400 VALIDATION_ERROR` when request contains extra field.
3. `400 VALIDATION_ERROR` when email format invalid.
4. `401 AUTH_INVALID_CREDENTIALS` when account not found.
5. `401 AUTH_INVALID_CREDENTIALS` when password incorrect.
6. `403 AUTH_ACCOUNT_INACTIVE` when account inactive.
7. `423 AUTH_ACCOUNT_LOCKED` when account locked.
8. `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED` when account has unsupported status.
9. `429 AUTH_TOO_MANY_ATTEMPTS` when rate limit exceeded.
10. `500 AUTH_SESSION_CREATE_FAILED` when session insert fails.
11. Success still returned if `last_login_at` update fails after core success path.
12. Success still returned if audit log write fails after core success path.

## Verification Notes
- Response success must not expose `password_hash` or `refresh_token_hash`.
- Request body must only include `email` and `password`.
- Token issuance must only happen after session persistence success.
