## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Cập nhật di chuyển sang cơ chế stateless JWT dùng claim `jti` thay vì bảng `user_sessions`. | Toàn bộ file |

# Implementation Plan: AUTH-001 Login

**Branch**: `tai-branch` | **Date**: 2026-05-26 | **Spec**: [spec.md](/home/duktai/Desktop/capstone-be/spec/features/auth/feat-login/spec.md)
**Input**: Feature specification from `/spec/features/auth/feat-login/spec.md`

## 1. Feature Summary

Feature này triển khai `UC-AUTH-01` cho phép người dùng nội bộ đăng nhập hệ thống qua `POST /api/v1/auth/login` bằng `email` và `password`. Luồng cốt lõi đã được chốt rõ: strict validate body, validate email, giữ nguyên raw password, kiểm tra rate limit theo IP/email, tìm user theo email đã normalize, verify password, kiểm tra `account_status`, sinh một UUID duy nhất làm `jti`, tạo `accessToken` và `refreshToken` chứa claim `jti`, cập nhật `users.last_login_at`, ghi `audit_logs`, rồi trả response thành công theo API contract. Nếu cập nhật `last_login_at` hoặc ghi audit log thất bại thì không fail login, chỉ log lỗi nội bộ.

## 2. Technical Context

**Language/Version**: TypeScript 5.x on NestJS 11  
**Primary Dependencies**: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `rxjs`; testing bằng `jest`, `supertest`, `@nestjs/testing`  
**Storage**: PostgreSQL theo database baseline v3.2 Compact; feature dùng `users`, `user_roles`, `roles`, `role_permissions`, `permissions`, `audit_logs`, `system_configs`  
**Testing**: Jest unit tests, Nest integration tests, Supertest e2e cho endpoint login  
**Target Platform**: Linux server backend API  
**Project Type**: Backend web-service (NestJS modular monolith)  
**Performance Goals**: Login success/fail phản hồi trong vòng 3 giây ở điều kiện tải thông thường  
**Constraints**: Không trả dữ liệu nhạy cảm; body chỉ cho phép `email`, `password`; nếu có `rememberDevice` hoặc field lạ phải trả `400 VALIDATION_ERROR`; rate limit phải diễn ra trước password verification; không mở rộng sang logout/refresh/reset password/SSO  
**Scale/Scope**: 1 endpoint login, 1 auth flow đồng bộ, tác động trực tiếp tới identity/audit tables

## 3. Scope Confirmation

Trong scope:
- `POST /api/v1/auth/login` theo `UC-AUTH-01`.
- Request body chỉ gồm `email` và `password`.
- Strict validation cho body, email format, required fields.
- Email được trim + lowercase trước khi tra cứu.
- Password được verify bằng raw input, không trim.
- Check rate limit theo IP/email trước bước tra cứu account và verify password.
- Kiểm tra `users.account_status` với các trạng thái: `active`, `inactive`, `locked`, và fallback cho status khác.
- Sinh UUID duy nhất làm `jti` để gán vào token.
- Tạo `accessToken`, `refreshToken` gắn với `jti` vừa sinh.
- Cập nhật `users.last_login_at` theo cơ chế non-blocking.
- Ghi `audit_logs` cho login success theo cơ chế non-blocking.
- Trả response success chuẩn của dự án với token + user summary + roles/permissions.

Ngoài scope:
- `rememberDevice` như request field hợp lệ cho login hiện tại; field này phải bị reject do strict validation.
- `mustChangePassword`.
- Logout, refresh token endpoint.
- Forgot password, reset password, change password.
- Lockout policy chi tiết ngoài kết quả rate limit đã chốt.
- SSO, OAuth, face login, social login.
- Thay đổi schema database baseline hoặc thêm bảng mới.

## 4. Data Model Impact

**Database impact**

Tác động chính:
- `users`
  - Read theo `email` đã normalize.
  - Read `password_hash`, `account_status`, `last_login_at`, `department_id`, profile fields cho response.
  - Update `last_login_at` sau login success; lỗi update không rollback login.
- `user_roles`
  - Read role assignments còn hiệu lực của user.
- `roles`
  - Read role metadata còn hiệu lực để trả `roles[]`.
- `role_permissions`
  - Read mapping role-permission.
- `permissions`
  - Read permission metadata để trả `permissions[]`.
- `audit_logs`
  - Insert login success audit record sau khi login success đã sẵn sàng; nếu fail chỉ log nội bộ.
- `system_configs`
  - Read cấu hình thời hạn session hoặc auth-related settings nếu implementation cần chuẩn bị cho logic session TTL.

**Schema/constraint impact cần xác nhận trong implementation**
- `users.email` là unique để tra cứu trực tiếp và ổn định.
- `users.account_status` phải support ít nhất `active`, `inactive`, `locked`.

**Transaction boundary**

Boundary tối thiểu cần giữ nhất quán:
- Trước transaction/persist:
  - strict validate body
  - normalize email
  - rate limit check
  - user lookup
  - password verification
  - account status check
- Ngoài transaction critical path hoặc non-blocking path:
  - sinh `jti` và generate access token / refresh token
  - update `users.last_login_at`
  - insert `audit_logs`

Ghi chú thiết kế:
- `last_login_at` và `audit_logs` là best-effort side effects, không phải blockers.
- Nếu token generation fail, implementation cần xử lý trả về lỗi.

## 5. API / Contract Plan

**Primary endpoint**
- `POST /api/v1/auth/login`

**Request contract direction**
- Request body thực thi theo clarification cuối cùng:
```json
{
  "email": "user@company.com",
  "password": "raw-password"
}
```
- Không chấp nhận `rememberDevice` trong request body ở scope hiện tại, dù API quick reference trước đó có nêu field này.
- Không chấp nhận field lạ.

**Success response direction**
- `200 OK` theo API contract chuẩn:
```json
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
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

**Error contract direction**
- `400 VALIDATION_ERROR`
  - body có field ngoài `email`, `password`
  - thiếu `email` / `password`
  - sai email format
- `401 AUTH_INVALID_CREDENTIALS`
  - không tìm thấy account
  - password sai
- `403 AUTH_ACCOUNT_INACTIVE`
  - `users.account_status = inactive`
- `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`
  - status khác ngoài `active`, `inactive`, `locked`
- `423 AUTH_ACCOUNT_LOCKED`
  - `users.account_status = locked`
- `429 AUTH_TOO_MANY_ATTEMPTS`
  - vượt rate limit theo IP/email
- `500 AUTH_TOKEN_GENERATION_FAILED`
  - không tạo được token
- `500` system error chuẩn của dự án
  - unexpected DB/internal error

**Contract consistency notes**
- User clarification override một phần quick reference: `rememberDevice` không còn là accepted input trong feature này.
- Không có `mustChangePassword` trong response của scope hiện tại.

## 6. Authorization Plan

- Endpoint login là `public`, không có auth guard yêu cầu access token trước request.
- Không có permission gate trước khi xử lý login.
- Authorization của feature này chỉ nằm ở bước tổng hợp `roles[]` và `permissions[]` của user sau khi xác thực thành công.
- Chỉ role assignment và permission mapping còn hiệu lực mới được trả về response.
- Nếu user không có role hoặc permission hiệu lực, login vẫn thành công nếu account hợp lệ; response trả dữ liệu thực tế không tự suy diễn quyền.

## 7. Business Logic Plan

Luồng xử lý đề xuất:
1. Nhận request `POST /api/v1/auth/login`.
2. Strict validate body:
   - chỉ cho phép `email`, `password`
   - reject mọi field lạ với `400 VALIDATION_ERROR`
3. Validate và normalize email:
   - required
   - valid email format
   - trim + lowercase
4. Validate password:
   - required
   - không trim, giữ nguyên raw input
5. Check rate limit theo IP/email:
   - nếu vượt -> `429 AUTH_TOO_MANY_ATTEMPTS`
6. Tìm user theo email đã normalize:
   - nếu không thấy -> `401 AUTH_INVALID_CREDENTIALS`
7. Verify password với `users.password_hash` bằng raw password input:
   - nếu sai -> `401 AUTH_INVALID_CREDENTIALS`
8. Check `users.account_status`:
   - `active` -> tiếp tục
   - `inactive` -> `403 AUTH_ACCOUNT_INACTIVE`
   - `locked` -> `423 AUTH_ACCOUNT_LOCKED`
   - status khác -> `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`
9. Load role/permission data hiệu lực cho response.
10. Sinh UUID duy nhất làm `jti`.
11. Generate `accessToken` và `refreshToken` gắn với `jti` vừa tạo.
12. Nếu token generation fail:
   - fail login với `500 AUTH_TOKEN_GENERATION_FAILED`
13. Update `users.last_login_at`:
   - nếu fail -> không fail login, chỉ log lỗi nội bộ
14. Ghi `audit_logs` cho login success:
   - nếu fail -> không fail login, chỉ log lỗi nội bộ
15. Trả response login thành công theo contract.

Quyết định nghiệp vụ cần phản ánh rõ trong code/design:
- `rememberDevice` không phải request field hợp lệ trong scope này.
- `AUTH_INVALID_CREDENTIALS` dùng chung cho user not found và wrong password.
- Sinh `jti` là bước bắt buộc trước token issuance.
- `last_login_at` và `audit_logs` là best-effort side effects, không phải blockers.

## 8. Validation Plan

**Allowed fields**
- `email`
- `password`

**Rejected fields**
- `rememberDevice`
- bất kỳ field lạ nào khác

**Required fields**
- `email`
- `password`

**Format/normalization rules**
- `email`
  - must be present
  - must be valid email format
  - trim trước khi dùng
  - lowercase trước khi tra cứu
- `password`
  - must be present
  - không trim
  - giữ nguyên raw input để verify

**Rate limit validation**
- Key logic: theo IP và email
- Rate limit check diễn ra trước user lookup và password verification
- Kết quả rate limit vi phạm map sang `429 AUTH_TOO_MANY_ATTEMPTS`

**Consistency checks**
- DTO/payload layer fail sớm với `400 VALIDATION_ERROR`
- Service layer enforce field whitelist và normalization rules
- Auth service phải bảo đảm cùng một error code cho not-found và wrong-password

## 9. Error Handling Plan

**Validation errors**
- `400 VALIDATION_ERROR`
  - missing `email`
  - missing `password`
  - invalid email format
  - extra field present

**Authentication errors**
- `401 AUTH_INVALID_CREDENTIALS`
  - user not found
  - wrong password

**Account status errors**
- `403 AUTH_ACCOUNT_INACTIVE`
- `423 AUTH_ACCOUNT_LOCKED`
- `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`

**Rate limit errors**
- `429 AUTH_TOO_MANY_ATTEMPTS`

**Token/session errors**
- `500 AUTH_TOKEN_GENERATION_FAILED`
  - token generation fail
- generic system error
  - unexpected internal failures

**Non-blocking side-effect failures**
- `users.last_login_at` update fail:
  - không fail response login
  - log nội bộ với trace context
- `audit_logs` insert fail:
  - không fail response login
  - log nội bộ với trace context

**Consistency safeguard**
- Bảo đảm token được sinh an toàn với jti.


## 10. Testing Strategy

**Unit tests**
- Login request validation service/DTO:
  - reject extra fields
  - reject missing email/password
  - reject invalid email format
  - normalize email đúng rule
  - preserve raw password
- Rate limit guard/service:
  - allow dưới ngưỡng
  - reject vượt ngưỡng với `AUTH_TOO_MANY_ATTEMPTS`
- Auth service:
  - user not found -> `AUTH_INVALID_CREDENTIALS`
  - wrong password -> `AUTH_INVALID_CREDENTIALS`
  - inactive -> `AUTH_ACCOUNT_INACTIVE`
  - locked -> `AUTH_ACCOUNT_LOCKED`
  - unsupported status -> `AUTH_ACCOUNT_STATUS_NOT_ALLOWED`
  - token generation fail -> `AUTH_TOKEN_GENERATION_FAILED`
  - last_login_at fail không làm fail login
  - audit log fail không làm fail login
- Role/permission aggregation:
  - chỉ trả role/permission hiệu lực

**Integration tests**
- Repository/service integration cho:
  - lookup `users` bằng normalized email
  - read `user_roles` + `roles` + `role_permissions` + `permissions`
  - update `last_login_at`
  - insert `audit_logs`

**E2E/API tests**
- `POST /api/v1/auth/login` success case
- `400 VALIDATION_ERROR` cho extra fields
- `400 VALIDATION_ERROR` cho invalid email
- `401 AUTH_INVALID_CREDENTIALS` cho user not found
- `401 AUTH_INVALID_CREDENTIALS` cho wrong password
- `403 AUTH_ACCOUNT_INACTIVE`
- `423 AUTH_ACCOUNT_LOCKED`
- `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`
- `429 AUTH_TOO_MANY_ATTEMPTS`
- `500 AUTH_TOKEN_GENERATION_FAILED`
- success response shape không chứa dữ liệu nhạy cảm

**Coverage intent**
- Tập trung vào contract behavior, security behavior, và acceptance criteria trong spec.

## 11. Implementation Phases

### Phase 0 - Research & Design Consolidation
- Xác nhận cấu trúc module NestJS phù hợp cho `auth` trong repo hiện tại.
- Chốt cơ chế rate limit implementation phù hợp với codebase hiện có hoặc tối thiểu adapter tạm thời cho scope feature.

### Phase 1 - Foundations
- Tạo module/domain skeleton cho `auth` theo structure NestJS.
- Tạo shared error codes, DTO validation, response mapping cho login.
- Tạo data access abstractions tối thiểu cho `users`, role/permission graph, `audit_logs`, `system_configs`.

### Phase 2 - Core Login Flow
- Implement strict body validation và email normalization.
- Implement rate limit check.
- Implement user lookup + password verification + account status evaluation.
- Implement token generation gắn với `jti`.

### Phase 3 - Side Effects & Response Assembly
- Implement role/permission aggregation.
- Implement `last_login_at` non-blocking update.
- Implement login success audit log non-blocking write.
- Implement final response mapper theo API contract.

### Phase 4 - Verification
- Unit tests cho validation, auth logic, status mapping.
- Integration tests cho repositories/services.
- E2E tests cho endpoint contract và acceptance scenarios.
- Lint/test run để bảo đảm plan sẵn sàng cho tasks/implementation.

## 12. Risks & Mitigations

- **Risk**: API quick reference từng nêu `rememberDevice`, nhưng clarified spec cấm field này.
  - **Mitigation**: Treat clarified spec as source of truth; map any presence of field to `400 VALIDATION_ERROR` và ghi rõ trong tests.
- **Risk**: Repo hiện gần như chưa có auth module foundation.
  - **Mitigation**: Phase 1 tạo minimal auth skeleton và shared abstractions trước khi đi vào endpoint.
- **Risk**: Rate limit implementation choice có thể kéo thêm dependency ngoài scope.
  - **Mitigation**: Ưu tiên giải pháp tối thiểu phù hợp codebase; nếu cần adapter/in-memory placeholder cho scope local test thì giới hạn rõ ở implementation plan/tasks.
- **Risk**: `last_login_at` và `audit_logs` là non-blocking, dễ gây inconsistency trong assert test nếu không chốt rõ.
  - **Mitigation**: Tách riêng blocking vs non-blocking assertions trong unit/integration/e2e tests.

## 13. Acceptance Criteria Traceability

| Acceptance Criteria từ spec | Plan coverage |
|---|---|
| Login success trả `accessToken`, `refreshToken`, `expiresIn`, `user` | Mục 5, 7, 10 |
| Extra field bị reject với `400 VALIDATION_ERROR` | Mục 5, 8, 9, 10 |
| Invalid email bị reject với `400 VALIDATION_ERROR` | Mục 5, 8, 9, 10 |
| Rate limit bị reject với `429 AUTH_TOO_MANY_ATTEMPTS` | Mục 7, 8, 9, 10 |
| User not found -> `401 AUTH_INVALID_CREDENTIALS` | Mục 7, 9, 10 |
| Wrong password -> `401 AUTH_INVALID_CREDENTIALS` | Mục 7, 9, 10 |
| `inactive` -> `403 AUTH_ACCOUNT_INACTIVE` | Mục 5, 7, 9, 10 |
| `locked` -> `423 AUTH_ACCOUNT_LOCKED` | Mục 5, 7, 9, 10 |
| Unsupported status -> `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED` | Mục 5, 7, 9, 10 |
| Không trả dữ liệu nhạy cảm | Mục 5, 9, 10 |
| Login success chỉ khi token tạo thành công | Mục 4, 7, 9, 10 |
| `last_login_at`/audit fail không fail login | Mục 4, 7, 9, 10 |

