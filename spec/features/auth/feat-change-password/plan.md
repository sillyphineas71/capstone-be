# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Khởi tạo plan.md cho feat-change-password từ spec.md đã clarify đầy đủ | Toàn bộ tài liệu |

# Implementation Plan: feat-change-password

- **Feature ID**: AUTH-CHPWD-004
- **Plan Version**: 1.0
- **Spec Source**: [spec.md](./spec.md)
- **Status**: Ready for Tasks
- **Created Date**: 2026-05-27

---

## 1. Feature Summary

Tính năng cho phép **người dùng đang đăng nhập** thay đổi mật khẩu của chính mình bằng cách xác minh mật khẩu cũ và nhập mật khẩu mới. Khác với luồng OTP reset (UC-AUTH-03), không có email hay OTP — toàn bộ luồng xảy ra trong một request `PATCH /api/v1/auth/change-password` duy nhất có JWT.

**Các điểm kỹ thuật cốt lõi đã chốt qua Clarification:**
- JWT invalidation là **passive** qua `auth:user:{userId}:invalid_after` trong Redis (cơ chế đã có sẵn trong `JwtAuthGuard`).
- E5 check (mật khẩu mới trùng cũ) bắt buộc ở **server** bằng `bcrypt.compare`.
- `must_change_password = true` kích hoạt **guard chặn API nghiệp vụ** — chỉ cho phép `/auth/me`, `/auth/change-password`, `/auth/logout`.
- **maxLength = 72** cho mọi trường password (giới hạn bcrypt).
- **Rate-limit v1**: 5 lần sai `currentPassword` / 15 phút / user → block 15 phút, lưu Redis.
- DB update dùng **transaction + row-level lock** (`SELECT ... FOR UPDATE`).

---

## 2. Technical Context

### 2.1 Framework & Stack

| Thành phần | Hiện trạng trong codebase |
|---|---|
| Framework | NestJS — modular monolith, `@Controller('auth')` |
| Language | TypeScript strict |
| ORM / DB access | TypeORM `DataSource` + raw SQL (không dùng Entity decorator cho query) |
| Auth Guard | `JwtAuthGuard` — đã có cơ chế `invalid_after` (dòng 55–71 của guard) |
| Cache | `@nestjs/cache-manager` + Redis, inject qua `CACHE_MANAGER` |
| Password hashing | `bcryptjs` (đã dùng trong `password-reset.service.ts`) |
| Audit log | `auth-audit.repository.ts` (pattern INSERT trực tiếp vào `audit_logs`) |
| Rate-limit pattern | `PasswordResetCacheService` — pattern increment counter + block key trong Redis |
| Validation | `class-validator` + `ValidationPipe` |
| Swagger | `@nestjs/swagger` decorators |

### 2.2 Codebase hiện tại — Auth Module

```
src/modules/auth/
├── auth.module.ts
├── controllers/
│   └── auth.controller.ts          ← Thêm endpoint PATCH change-password
├── dto/
│   ├── login.dto.ts
│   ├── confirm-reset.dto.ts
│   └── request-otp.dto.ts
├── guards/
│   ├── jwt-auth.guard.ts           ← Đã có invalid_after check — CẦN THÊM must_change_password guard
│   └── rate-limit.guard.ts
├── repositories/
│   ├── auth-audit.repository.ts    ← Pattern ghi audit log
│   ├── users-reset.repository.ts   ← Pattern update password + transaction
│   └── users-auth.repository.ts
├── services/
│   ├── password-reset.service.ts   ← Pattern mẫu cho change-password service
│   ├── password-reset-cache.service.ts  ← Pattern Redis rate-limit
│   └── rate-limit.service.ts       ← (in-memory, không dùng Redis — KHÔNG reuse)
└── types/, constants/, utils/, presenters/
```

### 2.3 Điểm khác biệt với `password-reset.service.ts`

| Khía cạnh | Password Reset (UC-AUTH-03) | Change Password (UC-AUTH-04) |
|---|---|---|
| Yêu cầu auth | Không cần JWT | **Bắt buộc JWT** |
| Xác minh danh tính | OTP 6 số | `bcrypt.compare(currentPassword, hash)` |
| Rate limit key | `email-based` | **`userId-based`** |
| DB transaction | Không có row-level lock | **SELECT ... FOR UPDATE** |
| Kiểm tra account status | Trước khi gửi OTP | **Trong DB transaction** |
| E5 check (trùng mật khẩu) | Không áp dụng | **Bắt buộc server-side** |

### 2.4 Cơ chế JWT invalidation đã có sẵn

`JwtAuthGuard` (dòng 55–71) đã check key `auth:user:{userId}:invalid_after` trong Redis.
`PasswordResetCacheService.invalidateUserTokens()` đã implement set key này.

→ **Reuse hoàn toàn**: Sau khi đổi mật khẩu thành công, gọi `cacheService.invalidateUserTokens(userId, ttlMs)` là xong — Auth Guard tự động reject JWT cũ ở mọi request tiếp theo.

---

## 3. Scope Confirmation

### 3.1 IN Scope (phải implement)

- [x] `PATCH /api/v1/auth/change-password` endpoint (protected by `JwtAuthGuard`)
- [x] `ChangePasswordDto` với 3 fields + validation (required, maxLength 72, complexity cho `newPassword`)
- [x] `ChangePasswordService` — business logic chính
- [x] `UsersChangePasswordRepository` — SELECT FOR UPDATE + UPDATE transaction
- [x] `ChangePasswordCacheService` (hoặc mở rộng từ pattern hiện có) — rate-limit counter + block key per userId
- [x] `MustChangePasswordGuard` — chặn API nghiệp vụ khi `must_change_password = true`
- [x] `ChangePasswordAuditRepository` (hoặc mở rộng `AuthAuditRepository`) — ghi `PASSWORD_CHANGE_SUCCESS` và `PASSWORD_CHANGE_RATE_LIMITED`
- [x] JWT passive invalidation qua `auth:user:{userId}:invalid_after` (reuse cơ chế có sẵn)
- [x] Unit tests cho service, DTO, và guard
- [x] Swagger documentation

### 3.2 OUT of Scope (không implement)

- ❌ Gửi email thông báo sau khi đổi mật khẩu
- ❌ Admin đổi mật khẩu hộ người dùng khác
- ❌ Active JWT revocation (Redis blacklist theo jti)
- ❌ Lịch sử đổi mật khẩu
- ❌ Multi-language support
- ❌ Async job queue

---

## 4. Data Model Impact

### 4.1 Database — Không thêm bảng mới

Tính năng này **chỉ update** bảng `users` hiện có và **insert** vào `audit_logs`.

#### Bảng `users` — các column được sử dụng

| Column | Kiểu | Thao tác | Ghi chú |
|---|---|---|---|
| `id` | `uuid` | READ | Lấy từ JWT payload (`sub`) |
| `password_hash` | `varchar` | READ + UPDATE | bcrypt hash. Đọc để compare, update sau khi đổi thành công |
| `password_updated_at` | `timestamptz` | UPDATE | Set `NOW()` — trigger passive JWT invalidation |
| `must_change_password` | `boolean` | READ + UPDATE | Đọc để check guard; set `false` sau khi đổi thành công |
| `account_status` | `varchar` | READ (trong transaction) | Kiểm tra `= 'active'` trước khi update |
| `deleted_at` | `timestamptz` | READ (implicit) | NULL nếu tài khoản chưa bị soft delete |
| `updated_at` | `timestamptz` | UPDATE | Set `NOW()` cùng với password update |

> **Không cần migration** — tất cả các column này đã tồn tại trong Database v3.2 Compact.

#### Bảng `audit_logs` — pattern INSERT hiện có

Reuse pattern trong `auth-audit.repository.ts`:

```sql
INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
VALUES ($1, $2, 'users', $3, $4, $5, $6, 'info', $7::jsonb)
```

| action_type | Khi nào |
|---|---|
| `password_change_success` | Đổi mật khẩu thành công |
| `password_change_rate_limited` | User bị block do vượt rate-limit |

#### Redis — Ephemeral state (không persist vào PostgreSQL)

| Key | Value | TTL | Mô tả |
|---|---|---|---|
| `change_password:failed:{userId}` | integer (counter) | 15 phút | Số lần nhập sai `currentPassword` |
| `change_password:block:{userId}` | `true` | 15 phút | Flag block người dùng |
| `auth:user:{userId}:invalid_after` | timestamp (ms) | 7 ngày | Timestamp để Guard check JWT invalidation (đã có) |

### 4.2 SQL cho UPDATE transaction (với row-level lock)

```sql
-- Step 1: Lock và read trong transaction
SELECT id, password_hash, account_status, must_change_password, deleted_at
FROM users
WHERE id = $1
FOR UPDATE;

-- Step 2: Update (chỉ chạy sau khi verify thành công)
UPDATE users
SET password_hash = $2,
    password_updated_at = NOW(),
    must_change_password = false,
    updated_at = NOW()
WHERE id = $1
  AND deleted_at IS NULL;
```

---

## 5. API / Contract Plan

### 5.1 Endpoint

```
PATCH /api/v1/auth/change-password
```

- **Authentication**: Bearer JWT (bắt buộc, qua `JwtAuthGuard`)
- **Authorization**: Bất kỳ role nào với JWT hợp lệ — không cần permission riêng
- **HTTP Method**: `PATCH` (partial update của user resource)
- **Content-Type**: `application/json`

### 5.2 Request Body — `ChangePasswordDto`

```typescript
class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&\-_#^()+={}\[\]|\\:;<>,.?\/`~'"])[A-Za-z\d@$!%*?&\-_#^()+={}\[\]|\\:;<>,.?\/`~'"]{8,72}$/)
  newPassword: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  confirmPassword: string;
}
```

> **Lưu ý**: `user_id` KHÔNG nhận từ body — lấy từ `request.user.userId` (JWT payload).

### 5.3 Success Response (HTTP 200)

```json
{
  "success": true,
  "message": "Thay đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới."
}
```

### 5.4 Error Responses

| HTTP Code | error.code | Trường hợp |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Thiếu trường, vượt maxLength, empty |
| `400` | `PASSWORD_POLICY_VIOLATION` | `newPassword` không đạt complexity |
| `400` | `CONFIRM_PASSWORD_MISMATCH` | `newPassword !== confirmPassword` |
| `400` | `CURRENT_PASSWORD_INCORRECT` | `currentPassword` sai (+ tăng rate-limit counter) |
| `401` | `UNAUTHORIZED` | Không có JWT / JWT hết hạn / JWT bị invalidate |
| `403` | `ACCOUNT_RESTRICTED` | Tài khoản `locked` hoặc `inactive` (phát hiện trong transaction) |
| `422` | `SAME_AS_CURRENT_PASSWORD` | `newPassword` trùng với mật khẩu hiện tại |
| `429` | `CHANGE_PASSWORD_RATE_LIMITED` | Đã sai `currentPassword` >= 5 lần trong 15 phút |
| `500` | `INTERNAL_SERVER_ERROR` | DB transaction thất bại / Redis error |

### 5.5 Thứ tự xử lý trong service

```
1. Kiểm tra Redis block flag (change_password:block:{userId})
   → Nếu tồn tại → HTTP 429 ngay
2. Validate DTO (ValidationPipe đã chạy trước)
   → Kiểm tra required, maxLength, complexity, confirmPassword match
   → Nếu sai → HTTP 400
3. Mở DB transaction + SELECT FOR UPDATE trên users WHERE id = userId
4. Kiểm tra account_status và deleted_at trong transaction
   → Nếu locked/inactive/deleted → rollback + HTTP 403
5. bcrypt.compare(currentPassword, user.password_hash)
   → Nếu sai → increment Redis counter → HTTP 400 (CURRENT_PASSWORD_INCORRECT)
   → Nếu counter >= 5 → set block flag → HTTP 400 (vẫn trả về CURRENT_PASSWORD_INCORRECT ở lần thứ 5)
6. bcrypt.compare(newPassword, user.password_hash)
   → Nếu khớp → rollback transaction + HTTP 422 (SAME_AS_CURRENT_PASSWORD)
7. bcrypt.hash(newPassword, salt)
8. UPDATE users SET password_hash, password_updated_at, must_change_password=false, updated_at
9. Commit transaction
10. cacheService.invalidateUserTokens(userId, 7 ngày TTL) — set auth:user:{userId}:invalid_after
11. [Fire-and-forget] Ghi audit_logs PASSWORD_CHANGE_SUCCESS
12. Return HTTP 200
```

---

## 6. Authorization Plan

### 6.1 `JwtAuthGuard` — Đã có, reuse

Áp dụng `@UseGuards(JwtAuthGuard)` cho endpoint. Guard đã handle:
- Token missing → 401
- Token invalid/expired → 401
- Token blacklisted (jti) → 401
- Token issued before `invalid_after` → 401

**Không cần thay đổi `JwtAuthGuard`**.

### 6.2 `MustChangePasswordGuard` — Cần tạo mới

Guard mới kiểm tra `must_change_password` của user trong DB (hoặc từ JWT payload nếu đã encode vào claim).

**Quyết định implementation**: Load thông tin từ DB một lần per-request để đảm bảo freshness (tránh stale JWT claim).

```
Luồng MustChangePasswordGuard:
1. Lấy userId từ request.user (đã được JwtAuthGuard populate)
2. Query users WHERE id = userId → lấy must_change_password
3. Nếu must_change_password = false → allow
4. Nếu must_change_password = true:
   - Kiểm tra route: nếu là /auth/me, /auth/change-password, /auth/logout → allow
   - Còn lại → HTTP 403 + MUST_CHANGE_PASSWORD
```

**Nơi áp dụng**: Global guard hoặc áp dụng ở `AppModule` cho toàn bộ route nghiệp vụ. Endpoint `/auth/change-password` phải được **whitelist** (skip guard hoặc guard tự allow).

### 6.3 Rate-limit Guard cho Change Password — Implement trong Service

Rate-limit logic (5 lần sai / 15 phút / userId) được xử lý **trong `ChangePasswordService`**, không phải trong Guard riêng, vì:
- Rate-limit chỉ trigger khi `currentPassword` **sai** (không phải mọi request)
- Cần biết kết quả `bcrypt.compare` trước khi quyết định tăng counter

### 6.4 Permission Matrix

| Action | Guard cần | Điều kiện |
|---|---|---|
| `PATCH /auth/change-password` | `JwtAuthGuard` | JWT hợp lệ |
| `PATCH /auth/change-password` | `MustChangePasswordGuard` | Whitelist — luôn allowed |
| Các API nghiệp vụ khác | `MustChangePasswordGuard` | `must_change_password = false` |

---

## 7. Business Logic Plan

### 7.1 `ChangePasswordService.changePassword(userId, dto, context)`

```
Input:
  - userId: string (từ JWT, không từ body)
  - dto: { currentPassword, newPassword, confirmPassword }
  - context: { ipAddress, userAgent, requestId }

Luồng chính (chi tiết):

[BL-1] Pre-check rate-limit block
  → Redis GET change_password:block:{userId}
  → Nếu tồn tại → throw TooManyRequestsException(CHANGE_PASSWORD_RATE_LIMITED)

[BL-2] Validate confirmPassword match (nếu chưa bắt bởi DTO)
  → if dto.newPassword !== dto.confirmPassword → throw BadRequestException(CONFIRM_PASSWORD_MISMATCH)
  → NOTE: Bước này có thể đặt trong DTO custom validator hoặc service

[BL-3] Mở DB transaction (DataSource.transaction())
  → SELECT id, password_hash, account_status, must_change_password, deleted_at
     FROM users WHERE id = $1 FOR UPDATE
  → Nếu user không tìm thấy hoặc deleted_at IS NOT NULL → throw ForbiddenException(ACCOUNT_RESTRICTED)
  → Nếu account_status IN ('locked', 'inactive') → throw ForbiddenException(ACCOUNT_RESTRICTED)

[BL-4] Verify currentPassword
  → bcrypt.compare(dto.currentPassword, user.password_hash)
  → Nếu false:
    - Redis INCR change_password:failed:{userId} (TTL 15 phút)
    - Nếu counter >= 5: Redis SET change_password:block:{userId} (TTL 15 phút) + log RATE_LIMITED audit
    - throw BadRequestException(CURRENT_PASSWORD_INCORRECT)
    (Không rollback transaction — transaction chưa có thay đổi gì)

[BL-5] Check new ≠ current
  → bcrypt.compare(dto.newPassword, user.password_hash)
  → Nếu true → throw UnprocessableEntityException(SAME_AS_CURRENT_PASSWORD)

[BL-6] Hash new password
  → const salt = await bcrypt.genSalt(10)
  → const newHash = await bcrypt.hash(dto.newPassword, salt)

[BL-7] UPDATE trong transaction
  → UPDATE users SET password_hash=$2, password_updated_at=NOW(), must_change_password=false, updated_at=NOW()
     WHERE id=$1 AND deleted_at IS NULL
  → Commit transaction

[BL-8] Invalidate JWT tokens (Redis)
  → cacheService.invalidateUserTokens(userId, 7 ngày)
  → Set key: auth:user:{userId}:invalid_after = Date.now()

[BL-9] Audit log (fire-and-forget)
  → auditRepository.logChangePasswordSuccess({ userId, ipAddress, userAgent, requestId })
  → .catch() → log error nhưng không throw

[BL-10] Return success response
```

### 7.2 Transaction Boundary

```
Transaction START
  ├─ SELECT ... FOR UPDATE (lock user row)
  ├─ Check account_status
  ├─ bcrypt.compare(currentPassword) [read-only, trong transaction]
  ├─ bcrypt.compare(newPassword) [E5 check]
  ├─ bcrypt.hash(newPassword) [compute hash]
  └─ UPDATE users ... → COMMIT
```

> **Lưu ý**: bcrypt operations (compare + hash) xảy ra **trong transaction**. Điều này giữ lock lâu hơn nhưng đảm bảo atomicity. Có thể tối ưu sau bằng cách đọc password_hash trước, đóng transaction, rồi mở lại khi UPDATE — nhưng phức tạp hơn. **Giữ nguyên transaction-bao-tất-cả cho v1**.

### 7.3 `MustChangePasswordGuard`

```typescript
// Whitelist routes không cần check
const ALLOWED_ROUTES = ['/api/v1/auth/me', '/api/v1/auth/change-password', '/api/v1/auth/logout'];

async canActivate(context) {
  const request = context.switchToHttp().getRequest();
  const userId = request.user?.userId;
  if (!userId) return true; // JwtAuthGuard đã handle trước đó

  // Skip check cho whitelisted routes
  if (ALLOWED_ROUTES.some(r => request.path.startsWith(r))) return true;

  const user = await usersRepository.findMustChangePassword(userId);
  if (user?.mustChangePassword) {
    throw new ForbiddenException({ code: 'MUST_CHANGE_PASSWORD', ... });
  }
  return true;
}
```

---

## 8. Validation Plan

### 8.1 DTO Validation (`ChangePasswordDto`)

| Field | Decorators | Error khi vi phạm |
|---|---|---|
| `currentPassword` | `@IsString()`, `@IsNotEmpty()`, `@MaxLength(72)` | `400 VALIDATION_ERROR` |
| `newPassword` | `@IsString()`, `@IsNotEmpty()`, `@MinLength(8)`, `@MaxLength(72)`, `@Matches(regex)` | `400 VALIDATION_ERROR` / `PASSWORD_POLICY_VIOLATION` |
| `confirmPassword` | `@IsString()`, `@IsNotEmpty()`, `@MaxLength(72)` | `400 VALIDATION_ERROR` |

### 8.2 Cross-field Validation

`newPassword === confirmPassword` — kiểm tra trong service (hoặc custom class validator `@MatchesField('newPassword')` trên `confirmPassword`).

> **Quyết định**: Implement trong **service** để đơn giản hóa DTO, nhất quán với pattern hiện có. Service throw `BadRequestException(CONFIRM_PASSWORD_MISMATCH)` nếu không khớp.

### 8.3 Business Logic Validation (Server-side, sau DTO)

| STT | Check | Vị trí | Kết quả khi fail |
|---|---|---|---|
| 1 | Rate-limit block flag | Service (trước transaction) | HTTP 429 |
| 2 | confirmPassword match | Service (trước transaction) | HTTP 400 |
| 3 | account_status active | Repository (trong transaction) | HTTP 403 |
| 4 | `currentPassword` bcrypt compare | Service (trong transaction) | HTTP 400 + counter |
| 5 | `newPassword` ≠ current | Service (trong transaction) | HTTP 422 |
| 6 | DB update success | Repository | HTTP 500 nếu lỗi |

### 8.4 Lý do maxLength = 72

bcrypt chỉ xử lý **72 byte đầu tiên** của input. Chuỗi dài hơn 72 ký tự (ASCII) sẽ có phần bị cắt bỏ → hai mật khẩu khác nhau (chỉ khác ở ký tự thứ 73 trở đi) tạo ra cùng một hash. Ngoài ra, chuỗi rất dài → bcrypt cost tăng → nguy cơ DoS. **maxLength = 72 là best practice bắt buộc khi dùng bcrypt**.

---

## 9. Error Handling Plan

### 9.1 Exception mapping

| Trường hợp lỗi | Exception class NestJS | HTTP | error.code |
|---|---|---|---|
| DTO validation fail | `BadRequestException` (tự động qua `ValidationPipe`) | 400 | `VALIDATION_ERROR` |
| confirmPassword không khớp | `BadRequestException` | 400 | `CONFIRM_PASSWORD_MISMATCH` |
| currentPassword sai | `BadRequestException` | 400 | `CURRENT_PASSWORD_INCORRECT` |
| newPassword trùng current | `UnprocessableEntityException` | 422 | `SAME_AS_CURRENT_PASSWORD` |
| Tài khoản bị khóa/inactive | `ForbiddenException` | 403 | `ACCOUNT_RESTRICTED` |
| Đang bị block rate-limit | `HttpException` (429) | 429 | `CHANGE_PASSWORD_RATE_LIMITED` |
| JWT không hợp lệ | `UnauthorizedException` (từ Guard) | 401 | `UNAUTHORIZED` |
| DB transaction thất bại | `InternalServerErrorException` | 500 | `INTERNAL_SERVER_ERROR` |
| Redis error | Log + `InternalServerErrorException` | 500 | `INTERNAL_SERVER_ERROR` |

### 9.2 Rate-limit Error Flow

```
Request đến → Check Redis block flag
  ├─ Block flag EXISTS → HTTP 429 ngay (không query DB, không bcrypt)
  └─ Block flag NOT EXISTS → Tiếp tục xử lý
       └─ currentPassword SAI:
            → INCR change_password:failed:{userId} (TTL 15 phút)
            → Nếu counter >= 5:
                SET change_password:block:{userId} (TTL 15 phút)
                [Fire-and-forget] Log PASSWORD_CHANGE_RATE_LIMITED audit
            → Throw 400 CURRENT_PASSWORD_INCORRECT
              (Không trả về 429 ở lần thứ 5 — vẫn trả 400. Request tiếp theo mới nhận 429)
```

### 9.3 Audit log và lỗi Redis

Audit log được ghi **fire-and-forget** (`.catch(() => {})`). Nếu Redis hoặc DB audit fail → log error, không rollback business transaction. Đây là pattern nhất quán với `password-reset.service.ts`.

### 9.4 Transaction rollback

Nếu bất kỳ bước nào trong transaction (`SELECT FOR UPDATE`, `UPDATE`) throw exception → TypeORM tự động rollback. Service catch exception và re-throw sau khi đảm bảo cleanup.

---

## 10. Testing Strategy

### 10.1 Unit Tests — `change-password.service.spec.ts`

| Test Case | FR liên quan | AC liên quan |
|---|---|---|
| Đổi mật khẩu thành công — happy path đầy đủ | FR-CHPWD-005..009, 023 | AC-001 |
| `must_change_password = true` được reset về false | FR-CHPWD-012 | AC-002 |
| Block flag tồn tại → HTTP 429 ngay, không query DB | FR-CHPWD-029 | AC-013 |
| `confirmPassword` không khớp `newPassword` → HTTP 400 | FR-CHPWD-016 | AC-005 |
| `currentPassword` sai → tăng counter, trả HTTP 400 | FR-CHPWD-014, FR-CHPWD-028 | AC-007 |
| `currentPassword` sai lần thứ 5 → set block flag | FR-CHPWD-027, FR-CHPWD-028 | AC-012 |
| `newPassword` trùng với current → HTTP 422 | FR-CHPWD-017 | AC-008 |
| account_status = 'locked' trong transaction → HTTP 403 | FR-CHPWD-011 | — |
| DB transaction thất bại → rollback + HTTP 500 | FR-CHPWD-024 | — |
| `invalidateUserTokens` được gọi sau khi đổi thành công | FR-CHPWD-008 | AC-009 |
| Audit log được gọi (fire-and-forget, không block) | FR-CHPWD-009, FR-CHPWD-025 | AC-010 |

### 10.2 Unit Tests — `change-password.dto.spec.ts`

| Test Case | FR liên quan |
|---|---|
| `currentPassword` empty → validation error | FR-CHPWD-013 |
| `currentPassword` > 72 ký tự → validation error | FR-CHPWD-002 (Q-VR-01) |
| `newPassword` < 8 ký tự → validation error | FR-CHPWD-002 |
| `newPassword` > 72 ký tự → validation error | FR-CHPWD-002 |
| `newPassword` không có chữ hoa → validation error | FR-CHPWD-002 |
| `newPassword` không có ký tự đặc biệt → validation error | FR-CHPWD-002 |
| Tất cả fields hợp lệ → pass | FR-CHPWD-005 |

### 10.3 Unit Tests — `must-change-password.guard.spec.ts`

| Test Case | FR liên quan | AC liên quan |
|---|---|---|
| `must_change_password = false` → allow request | FR-CHPWD-026 | — |
| `must_change_password = true`, route `/auth/change-password` → allow | FR-CHPWD-026 | — |
| `must_change_password = true`, route `/api/v1/meetings` → HTTP 403 | FR-CHPWD-026 | AC-006b |
| `must_change_password = true`, route `/auth/logout` → allow | FR-CHPWD-026 | — |

### 10.4 Unit Tests — `jwt-auth.guard.spec.ts` (bổ sung)

| Test Case | FR liên quan | AC liên quan |
|---|---|---|
| JWT có `iat < invalid_after` → HTTP 401 | FR-CHPWD-008 | AC-009 |
| JWT có `iat >= invalid_after` → allow | FR-CHPWD-008 | AC-011 |

> **Lưu ý**: AC-009 và AC-011 đã được test một phần bởi guard hiện có. Cần bổ sung test case cụ thể cho `password_change` scenario nếu chưa có.

### 10.5 Integration / E2E (Tùy chọn cho v1)

Nếu có test infrastructure:
- Happy path end-to-end: login → change password → verify old JWT rejected → login again → verify new JWT works
- Rate-limit: 5 lần sai liên tiếp → lần thứ 6 nhận 429

---

## 11. Implementation Phases

### Phase 1: Foundation (không có dependency)

**P1.1** — Tạo `ChangePasswordDto` (`src/modules/auth/dto/change-password.dto.ts`)
- 3 fields: `currentPassword`, `newPassword`, `confirmPassword`
- Decorators: `@IsString`, `@IsNotEmpty`, `@MinLength(8)`, `@MaxLength(72)`, `@Matches(regex complexity)`
- Unit test: `change-password.dto.spec.ts`

**P1.2** — Tạo `UsersChangePasswordRepository` (`src/modules/auth/repositories/users-change-password.repository.ts`)
- Method `findByIdForUpdate(userId)`: SELECT FOR UPDATE
- Method `updatePassword(transactionalEntityManager, userId, newHash)`: UPDATE query
- Interface `UserChangePasswordRecord`: `{ id, passwordHash, accountStatus, mustChangePassword, deletedAt }`

**P1.3** — Tạo `ChangePasswordCacheService` (`src/modules/auth/services/change-password-cache.service.ts`)
- `isBlocked(userId)`: GET `change_password:block:{userId}`
- `incrementFailedCounter(userId)`: GET + SET `change_password:failed:{userId}` (TTL 15 phút), return new count
- `setBlockFlag(userId)`: SET `change_password:block:{userId}` (TTL 15 phút)
- Inject `CACHE_MANAGER`

**P1.4** — Tạo `ChangePasswordAuditRepository` (`src/modules/auth/repositories/change-password-audit.repository.ts`)
- Method `logSuccess(params)`: INSERT audit_logs với action_type = `password_change_success`
- Method `logRateLimited(params)`: INSERT audit_logs với action_type = `password_change_rate_limited`

### Phase 2: Core Service

**P2.1** — Tạo `ChangePasswordService` (`src/modules/auth/services/change-password.service.ts`)
- Implement luồng đầy đủ theo mục 7.1
- Dependencies: `UsersChangePasswordRepository`, `ChangePasswordCacheService`, `ChangePasswordAuditRepository`, `PasswordResetCacheService` (reuse `invalidateUserTokens`)
- Unit test: `change-password.service.spec.ts` — bao phủ tất cả test case mục 10.1

### Phase 3: Guard mới

**P3.1** — Tạo `MustChangePasswordGuard` (`src/modules/auth/guards/must-change-password.guard.ts`)
- Implement theo mục 7.3
- Cần thêm method `findMustChangePassword(userId)` vào `UsersChangePasswordRepository` (hoặc `authz-read.repository.ts`)
- Unit test: `must-change-password.guard.spec.ts`

**P3.2** — Đăng ký `MustChangePasswordGuard` trong `AppModule` hoặc global
- Quyết định: Global guard (apply toàn bộ) nhưng skip nếu route không cần auth, hoặc chỉ apply ở business modules

### Phase 4: Controller & Wiring

**P4.1** — Thêm endpoint vào `AuthController`
```typescript
@Patch('change-password')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
async changePassword(
  @Body() dto: ChangePasswordDto,
  @Req() request: Request,
  @Ip() ipAddress: string,
  @Headers('user-agent') userAgent?: string,
  @Headers('x-request-id') requestId?: string,
) {
  const userId = (request['user'] as { userId: string }).userId;
  return this.changePasswordService.changePassword(userId, dto, { ipAddress, userAgent, requestId });
}
```

**P4.2** — Cập nhật `auth.module.ts`
- Thêm vào `providers`: `ChangePasswordService`, `ChangePasswordCacheService`, `ChangePasswordAuditRepository`, `UsersChangePasswordRepository`
- Thêm `ChangePasswordService` vào constructor của `AuthController`

### Phase 5: Testing & Documentation

**P5.1** — Hoàn thiện unit tests còn thiếu (DTO, Service, Guard)

**P5.2** — Swagger documentation
- `@ApiOperation`, `@ApiResponse` cho tất cả status codes (200, 400, 401, 403, 422, 429, 500)
- `@ApiBody({ type: ChangePasswordDto })`
- `@ApiBearerAuth()`

**P5.3** — Review `jwt-auth.guard.spec.ts` để bổ sung test case cho `invalid_after` scenario mới (AC-009, AC-011)

---

## 12. Risks & Mitigations

| Risk | Mức độ | Mitigation |
|---|---|---|
| **bcrypt blocking event loop** trong transaction giữ lock quá lâu | Medium | bcrypt là CPU-bound nhưng Node.js `bcryptjs` tự offload sang libuv thread. Chấp nhận cho v1; nếu latency cao có thể chuyển sang pre-compute ngoài transaction. |
| **Race condition** giữa `SELECT FOR UPDATE` và check account_status | Low | Row-level lock đảm bảo không có concurrent write nào chen vào. Nếu lock timeout → transaction rollback → HTTP 500 (chấp nhận được). |
| **Redis unavailable** khi check block flag | Low | Nếu Redis down, cacheService throw `InternalServerErrorException`. Service should handle: nếu Redis check fail → fail-open (tiếp tục) hoặc fail-closed (reject). **Quyết định v1**: fail-closed → HTTP 500, log error. |
| **`MustChangePasswordGuard` thêm 1 DB query per request** | Medium | Có thể cache `must_change_password` trong Redis với TTL ngắn (30 giây) per userId. Implement trong v1 với DB query thẳng; optimize sau nếu cần. |
| **counter reset sau khi hết TTL** nhưng user đã đổi thành công | Negligible | TTL counter tự expire. Nếu user đổi thành công, counter không được xóa — nhưng sau 15 phút tự reset. Không cần cleanup counter sau success. |

---

## 13. Acceptance Criteria Traceability

| AC ID | Requirement | Implement ở đâu | Test ở đâu |
|---|---|---|---|
| **AC-001** | Đổi mật khẩu thành công end-to-end | `ChangePasswordService.changePassword()` (BL-1..10) | `change-password.service.spec.ts` |
| **AC-002** | `must_change_password` reset về false | BL-7: UPDATE query (must_change_password = false) | `change-password.service.spec.ts` |
| **AC-003** | Trường bắt buộc bị bỏ trống → 400 | `ChangePasswordDto` + `ValidationPipe` | `change-password.dto.spec.ts` |
| **AC-004** | `newPassword` không đạt chuẩn → 400 | `@Matches()` decorator trong DTO | `change-password.dto.spec.ts` |
| **AC-004b** | `newPassword` > 72 ký tự → 400 | `@MaxLength(72)` trong DTO | `change-password.dto.spec.ts` |
| **AC-005** | `confirmPassword` không khớp → 400 | `ChangePasswordService` (bước BL-2) | `change-password.service.spec.ts` |
| **AC-006** | Không có JWT → 401 | `JwtAuthGuard` (existing) | `jwt-auth.guard.spec.ts` (existing) |
| **AC-006b** | `must_change_password = true` chặn API nghiệp vụ → 403 | `MustChangePasswordGuard` | `must-change-password.guard.spec.ts` |
| **AC-007** | `currentPassword` sai → 400 + tăng counter | `ChangePasswordService` (BL-4) | `change-password.service.spec.ts` |
| **AC-008** | `newPassword` trùng cũ → 422 | `ChangePasswordService` (BL-5) | `change-password.service.spec.ts` |
| **AC-009** | JWT cũ bị reject sau đổi mật khẩu (passive) | `JwtAuthGuard` check `invalid_after` (existing) + `invalidateUserTokens` gọi trong BL-8 | `jwt-auth.guard.spec.ts` (bổ sung) |
| **AC-010** | Audit log ghi khi thành công | `ChangePasswordAuditRepository.logSuccess()` gọi trong BL-9 | `change-password.service.spec.ts` |
| **AC-011** | JWT mới (sau login lại) được chấp nhận | `JwtAuthGuard` — `iat >= invalid_after` → pass | `jwt-auth.guard.spec.ts` (bổ sung) |
| **AC-012** | Block sau 5 lần sai → 429 | `ChangePasswordService` (BL-4, counter logic) + `ChangePasswordCacheService.setBlockFlag()` | `change-password.service.spec.ts` |
| **AC-013** | Reject ngay trong block period → không tốn tài nguyên | `ChangePasswordService` (BL-1, check trước mọi thứ) | `change-password.service.spec.ts` |

---

## Phụ lục: File mới cần tạo

| File | Loại | Phase |
|---|---|---|
| `dto/change-password.dto.ts` | DTO | P1.1 |
| `dto/change-password.dto.spec.ts` | Unit test | P1.1 |
| `repositories/users-change-password.repository.ts` | Repository | P1.2 |
| `services/change-password-cache.service.ts` | Service | P1.3 |
| `repositories/change-password-audit.repository.ts` | Repository | P1.4 |
| `services/change-password.service.ts` | Service | P2.1 |
| `services/change-password.service.spec.ts` | Unit test | P2.1 |
| `guards/must-change-password.guard.ts` | Guard | P3.1 |
| `guards/must-change-password.guard.spec.ts` | Unit test | P3.1 |

## Phụ lục: File cần sửa đổi

| File | Thay đổi | Phase |
|---|---|---|
| `controllers/auth.controller.ts` | Thêm `PATCH change-password` endpoint | P4.1 |
| `auth.module.ts` | Thêm providers và inject | P4.2 |
| `guards/jwt-auth.guard.spec.ts` | Bổ sung test cho `invalid_after` scenario | P5.3 |
