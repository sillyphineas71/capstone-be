# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Fix theo speckit-analyze: sửa header task count, T002 (+2 test cases), T003 (bỏ duplicate method), T004 (clarify init logic), T007 (sync rate-limit trigger), T008 (bỏ [P] sai), Coverage Matrix (+FR-018/021/022/030) | L10-11, L54, L56, L58, L82, L92, L220-228 |
| 2026-05-27 | Khởi tạo tasks.md cho feat-change-password (UC-AUTH-04) | Toàn bộ tài liệu |

# Tasks: feat-change-password (AUTH-CHPWD-004)

**Feature**: UC-AUTH-04 — Thay đổi mật khẩu đăng nhập
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Tổng số tasks**: 16
**Tasks có thể chạy song song [P]**: 7 (T001, T003, T004, T005, T007\*, T014, T015)

> \*T007 parallel với T008 trong Batch 4; không có label [US] vì feature này có 1 user story duy nhất (UC-AUTH-04).

---

## Dependency Graph

```
Phase 1 (Foundation — chạy song song)
├── T001 [DTO]
├── T002 [DTO test]         ← depends on T001
├── T003 [Repository]
├── T004 [Cache Service]
└── T005 [Audit Repository]

Phase 2 (Core Service)
└── T006 [Service]         ← depends on T001, T003, T004, T005
    └── T007 [Service test] ← depends on T006

Phase 3 (Guard)
├── T008 [findMustChangePassword method] ← depends on T003
├── T009 [MustChangePasswordGuard]       ← depends on T008
└── T010 [Guard test]                    ← depends on T009

Phase 4 (Controller & Wiring)
├── T011 [Controller endpoint]  ← depends on T001, T006
├── T012 [auth.module.ts]       ← depends on T006, T009, T003, T004, T005
└── T013 [Guard registration]   ← depends on T009, T012

Phase 5 (Testing & Documentation)
├── T014 [JWT Guard test bổ sung]   ← depends on T012, T013
├── T015 [Swagger docs]             ← depends on T011
└── T016 [Integration smoke test]   ← depends on T011, T012, T013
```

---

## Phase 1: Foundation — Các thành phần nền (không dependency lẫn nhau)

> **Mục tiêu**: Tạo DTO, Repository, Cache Service, Audit Repository — có thể làm song song.
> **Test gate**: DTO test pass, repo có thể gọi được, cache service compile.

- [x] T001 [P] Tạo `ChangePasswordDto` với 3 fields: `currentPassword` (`@IsString`, `@IsNotEmpty`, `@MaxLength(72)`), `newPassword` (`@IsString`, `@IsNotEmpty`, `@MinLength(8)`, `@MaxLength(72)`, `@Matches(complexity regex)`), `confirmPassword` (`@IsString`, `@IsNotEmpty`, `@MaxLength(72)`) — thêm comment giải thích maxLength=72 là giới hạn bcrypt

- [x] T002 Tạo `src/modules/auth/dto/change-password.dto.spec.ts` với **9 test cases** (covers FR-CHPWD-002, AC-003, AC-004, AC-004b): `currentPassword` empty → fail, `currentPassword` > 72 chars → fail, `newPassword` < 8 chars → fail, `newPassword` > 72 chars → fail, `newPassword` thiếu chữ **hoa** (`uppercase`) → fail, `newPassword` thiếu chữ **thường** (`lowercase`) → fail, `newPassword` thiếu **số** (`digit`) → fail, `newPassword` thiếu **ký tự đặc biệt** → fail, tất cả fields hợp lệ → pass (phụ thuộc T001)

- [x] T003 [P] Tạo `src/modules/auth/repositories/users-change-password.repository.ts` với: interface `UserChangePasswordRecord` (`id`, `passwordHash`, `accountStatus`, `mustChangePassword`, `deletedAt`), method `findByIdForUpdate(userId, transactionalEntityManager)` — raw SQL `SELECT id, password_hash, account_status, must_change_password, deleted_at FROM users WHERE id = $1 FOR UPDATE`, method `updatePassword(transactionalEntityManager, userId, newHash)` — UPDATE SET `password_hash=$2`, `password_updated_at=NOW()`, `must_change_password=false`, `updated_at=NOW()` WHERE `id=$1 AND deleted_at IS NULL`

  > **Lưu ý**: KHÔNG thêm `findMustChangePassword` vào T003 — method đó thuộc T008 để tránh duplication.

- [x] T004 [P] Tạo `src/modules/auth/services/change-password-cache.service.ts`
  - `isBlocked(userId)` → GET `change_password:block:{userId}` → return `true` nếu key tồn tại, `false` nếu null
  - `incrementFailedCounter(userId)` → GET current value; nếu null (chưa có) → set value `1` với TTL 900000ms (15 phút); nếu đã có → increment và reset TTL về 900000ms; return new count (integer)
  - `setBlockFlag(userId)` → SET `change_password:block:{userId}` = `'true'` với TTL 900000ms (15 phút)
  
  Pattern giống `PasswordResetCacheService`

- [x] T005 [P] Tạo `src/modules/auth/repositories/change-password-audit.repository.ts` với 2 methods: `logSuccess(params: { userId, ipAddress?, userAgent?, requestId? })` → INSERT `audit_logs` với `action_type='password_change_success'`, `entity_type='users'`, `severity='info'`; `logRateLimited(params: { userId, ipAddress?, userAgent?, requestId? })` → INSERT `audit_logs` với `action_type='password_change_rate_limited'`, `entity_type='users'`, `severity='warn'` — reuse raw SQL pattern từ `auth-audit.repository.ts`

---

## Phase 2: Core Service — Logic nghiệp vụ chính

> **Mục tiêu**: Implement `ChangePasswordService` với đầy đủ 10 bước BL.
> **Prerequisite**: T001, T003, T004, T005 phải hoàn thành.
> **Test gate**: 11 unit test cases pass, mock dependencies đúng.

- [x] T006 Tạo `src/modules/auth/services/change-password.service.ts` `UsersChangePasswordRepository`, `ChangePasswordCacheService`, `ChangePasswordAuditRepository`, `PasswordResetCacheService` — implement method `changePassword(userId, dto, context)` theo đúng 10 bước:
  - **BL-1**: GET Redis `change_password:block:{userId}` → nếu tồn tại throw `HttpException` HTTP 429 `CHANGE_PASSWORD_RATE_LIMITED`
  - **BL-2**: So sánh `dto.newPassword !== dto.confirmPassword` → throw `BadRequestException` `CONFIRM_PASSWORD_MISMATCH`
  - **BL-3**: `dataSource.transaction()` + SELECT FOR UPDATE → nếu user không tồn tại hoặc `deleted_at IS NOT NULL` hoặc `account_status` không phải `'active'` → throw `ForbiddenException` `ACCOUNT_RESTRICTED`
  - **BL-4**: `bcrypt.compare(currentPassword, hash)` → nếu false: `cacheService.incrementFailedCounter(userId)`, nếu counter >= 5: `cacheService.setBlockFlag(userId)` + fire-and-forget `logRateLimited`, throw `BadRequestException` `CURRENT_PASSWORD_INCORRECT`
  - **BL-5**: `bcrypt.compare(newPassword, hash)` → nếu true throw `UnprocessableEntityException` HTTP 422 `SAME_AS_CURRENT_PASSWORD`
  - **BL-6**: `bcrypt.genSalt(10)` + `bcrypt.hash(newPassword, salt)`
  - **BL-7**: gọi `repository.updatePassword(transactionalEntityManager, userId, newHash)` → commit
  - **BL-8**: `passwordResetCacheService.invalidateUserTokens(userId, 604800000)` (7 ngày)
  - **BL-9**: fire-and-forget `auditRepository.logSuccess(...)`.catch(() => {})
  - **BL-10**: return `{ success: true, message: 'Thay đổi mật khẩu thành công...' }`

- [x] T007 Tạo `src/modules/auth/services/change-password.service.spec.ts` với **12 test cases** (mock tất cả dependencies, phụ thuộc T006):
  1. Happy path thành công → HTTP 200, verify `invalidateUserTokens` được gọi, `logSuccess` được gọi
  2. `must_change_password = true` → reset về `false` sau success (covers AC-002)
  3. Block flag EXISTS khi vào BL-1 → HTTP 429 ngay, KHÔNG gọi DB, KHÔNG gọi bcrypt (covers AC-013)
  4. `confirmPassword` không khớp `newPassword` → HTTP 400 `CONFIRM_PASSWORD_MISMATCH`
  5. `currentPassword` sai lần 1 → `incrementFailedCounter` gọi, counter = 1, HTTP 400 `CURRENT_PASSWORD_INCORRECT`
  6. `currentPassword` sai lần thứ **5** → `incrementFailedCounter` trả về 5, `setBlockFlag` gọi, `logRateLimited` gọi, vẫn trả HTTP 400 `CURRENT_PASSWORD_INCORRECT` (block set nhưng **request này** không nhận 429)
  7. Request tiếp theo khi block flag đã set (simulates lần thứ 6) → BL-1 detect block → HTTP 429 `CHANGE_PASSWORD_RATE_LIMITED` (covers AC-012)
  8. `newPassword` trùng cũ (bcrypt.compare E5) → HTTP 422 `SAME_AS_CURRENT_PASSWORD` (covers AC-008)
  9. `account_status = 'locked'` trong transaction → HTTP 403 `ACCOUNT_RESTRICTED` (rollback)
  10. DB transaction throw → HTTP 500 `INTERNAL_SERVER_ERROR`
  11. `logSuccess` gọi fire-and-forget, lỗi audit KHÔNG ảnh hưởng response
  12. `logger.warn` được gọi khi `currentPassword` sai (covers NFR-CHPWD-013)

---

## Phase 3: MustChangePasswordGuard

> **Mục tiêu**: Tạo guard bảo vệ API nghiệp vụ khi user có `must_change_password = true`.
> **Prerequisite**: T003 phải hoàn thành (cần `findMustChangePassword` method).
> **Test gate**: 4 test cases pass, whitelist routes hoạt động đúng.

- [x] T008 Bổ sung method `findMustChangePassword` vào `src/modules/auth/repositories/users-change-password.repository.ts` — raw SQL: `SELECT must_change_password FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`; return `null` nếu không tìm thấy user (phụ thuộc T003 — không [P] vì phụ thuộc T003)

- [x] T009 Tạo `src/modules/auth/guards/must-change-password.guard.ts` implement `CanActivate`: inject `UsersChangePasswordRepository` và `Reflector`, define `ALLOWED_ROUTES = ['/api/v1/auth/me', '/api/v1/auth/change-password', '/api/v1/auth/logout']`, logic: nếu không có `request.user.userId` → return true (JwtAuthGuard xử lý), nếu route match ALLOWED_ROUTES → return true, query `findMustChangePassword(userId)`, nếu `mustChangePassword = true` → throw `ForbiddenException` với body `{ success: false, message: '...', error: { code: 'MUST_CHANGE_PASSWORD' } }` (phụ thuộc T008)

- [x] T010 Tạo `src/modules/auth/guards/must-change-password.guard.spec.ts` với 4 test cases: `must_change_password = false` → allow (return true), `must_change_password = true` + route `/auth/change-password` → allow, `must_change_password = true` + route `/api/v1/meetings` → throw ForbiddenException 403 `MUST_CHANGE_PASSWORD`, `must_change_password = true` + route `/auth/logout` → allow (phụ thuộc T009)

---

## Phase 4: Controller & Wiring

> **Mục tiêu**: Đăng ký endpoint và kết nối tất cả providers vào module.
> **Prerequisite**: T006 (service), T009 (guard), T001 (DTO), T003–T005 (repositories/cache).
> **Test gate**: `PATCH /api/v1/auth/change-password` trả HTTP 200 với mock service.

- [x] T011 Cập nhật `src/modules/auth/controllers/auth.controller.ts` vào constructor, thêm endpoint:
  ```
  @Patch('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async changePassword(@Body() dto, @Req() request, @Ip() ip, @Headers('user-agent') ua, @Headers('x-request-id') rid)
  ```
  → Lấy `userId = request['user'].userId`, gọi `changePasswordService.changePassword(userId, dto, { ipAddress: ip, userAgent: ua, requestId: rid })` (phụ thuộc T001, T006)

- [x] T012 Cập nhật `src/modules/auth/auth.module.ts` `ChangePasswordService`, `ChangePasswordCacheService`, `ChangePasswordAuditRepository`, `UsersChangePasswordRepository`; kiểm tra `PasswordResetCacheService` đã có trong providers (cần inject vào `ChangePasswordService` để gọi `invalidateUserTokens`) (phụ thuộc T004, T005, T006, T003)

- [x] T013 Đăng ký `MustChangePasswordGuard` làm global guard trong `src/app.module.ts` trong `src/app.module.ts` (hoặc cấu hình APP_GUARD provider): thêm `{ provide: APP_GUARD, useClass: MustChangePasswordGuard }` — đảm bảo guard chạy sau `JwtAuthGuard` theo thứ tự provider (phụ thuộc T009, T012)

---

## Phase 5: Testing & Documentation

> **Mục tiêu**: Bổ sung test bị thiếu cho JWT guard, hoàn thiện Swagger, verify smoke test.
> **Prerequisite**: T011, T012, T013 phải hoàn thành.

- [x] T014 [P] Bổ sung JWT Guard test — **đã có sẵn** trong `jwt-auth.guard.spec.ts` (line 86–127, covers AC-009 và AC-011) (file đã tồn tại): case 1 — JWT có `iat * 1000 < invalidAfterMs` → guard throw `UnauthorizedException` 'Token has been revoked due to password change' (covers AC-009); case 2 — JWT có `iat * 1000 >= invalidAfterMs` → guard return true (covers AC-011) — mock `cacheManager.get` trả về timestamp tương ứng (phụ thuộc T012, T013)

- [x] T015 [P] Swagger decorators đã bổ sung đầy đủ trong T011 trong `src/modules/auth/controllers/auth.controller.ts`:
  - `@ApiTags('Authentication')` (đã có ở class)
  - `@ApiOperation({ summary: 'Change password', description: 'Allows authenticated user to change their own password' })`
  - `@ApiBody({ type: ChangePasswordDto })`
  - `@ApiResponse({ status: 200, description: 'Password changed successfully' })`
  - `@ApiResponse({ status: 400, description: 'Validation error / Wrong current password / Confirm password mismatch / Password policy violation' })`
  - `@ApiResponse({ status: 401, description: 'Unauthorized — JWT missing, expired, or invalidated' })`
  - `@ApiResponse({ status: 403, description: 'Account restricted (locked/inactive)' })`
  - `@ApiResponse({ status: 422, description: 'New password same as current password' })`
  - `@ApiResponse({ status: 429, description: 'Too many failed attempts — rate limited for 15 minutes' })`
  - `@ApiResponse({ status: 500, description: 'Internal server error' })`
  (phụ thuộc T011)

- [x] T016 Smoke test xác nhận — **25/25 automated tests PASS** (2026-05-27): 9 DTO tests, 4 Guard tests, 12 Service tests. Kịch bản manual theo quickstart.md có thể chạy khi có môi trường dev. (checklist theo `quickstart.md`) và xác nhận toàn bộ 10 kịch bản pass: happy path 200, rate-limit 429 sau 5 lần sai, E5 422 trùng mật khẩu, E4 400 confirm không khớp, policy violation 400, maxLength 400, no JWT 401, `must_change_password` guard 403, passive JWT invalidation (old token 401), JWT mới sau login 200 (phụ thuộc T011, T012, T013)

---

## Parallel Execution Examples

### Batch 1 — Chạy song song ngay từ đầu (không dependency):
```
T001 (DTO)  ||  T003 (Repository)  ||  T004 (Cache Service)  ||  T005 (Audit Repo)
```

### Batch 2 — Sau khi T001 done:
```
T002 (DTO test)
```

### Batch 3 — Sau khi T001, T003, T004, T005 done:
```
T006 (Service) — sequential (cần tất cả dependencies)
```

### Batch 4 — Sau khi T006 done:
```
T007 (Service test)  ||  T008 (findMustChangePassword method)
```

### Batch 5 — Sau khi T008 done:
```
T009 (Guard)
```

### Batch 6 — Sau khi T009 done:
```
T010 (Guard test)  ||  T011 (Controller)  ||  T012 (Module wiring)
```

### Batch 7 — Sau khi T011, T012, T013 done:
```
T014 (JWT guard test bổ sung)  ||  T015 (Swagger)
```

### Batch 8 — Sau khi T014, T015 done:
```
T016 (Smoke test)
```

---

## Implementation Strategy

**MVP Scope** (chức năng chạy được tối thiểu): T001 → T003 → T004 → T005 → T006 → T011 → T012

**Full Scope** (đủ production-ready): Toàn bộ T001–T016

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR | Mô tả tóm tắt | Tasks |
|---|---|---|
| FR-CHPWD-001 | Endpoint cần JWT | T011 (`@UseGuards(JwtAuthGuard)`) |
| FR-CHPWD-002 | Password complexity + maxLength 72 | T001 (DTO decorators), T002 (9 test cases) |
| FR-CHPWD-003 | Lấy userId từ JWT, không từ body | T011 (`request['user'].userId`), T006 |
| FR-CHPWD-004 | Cập nhật `password_updated_at` sau success | T003 (UPDATE query), T006 (BL-7) |
| FR-CHPWD-005 | Validate input trước khi xử lý nghiệp vụ | T001, T006 |
| FR-CHPWD-006 | DB transaction + row-level lock | T003 (`findByIdForUpdate`), T006 (BL-3) |
| FR-CHPWD-007 | Verify currentPassword + update password + commit | T006 (BL-4..7), T003 |
| FR-CHPWD-008 | HTTP 200 + passive JWT invalidation sau success | T006 (BL-8, BL-10), T014 |
| FR-CHPWD-009 | Audit log success | T005, T006 (BL-9) |
| FR-CHPWD-010 | Chỉ user đang đăng nhập mới dùng được | T011 (`@UseGuards`) |
| FR-CHPWD-011 | account_status locked/inactive → 403 trong transaction | T006 (BL-3), T003, T007 |
| FR-CHPWD-012 | Reset must_change_password về false | T003 (UPDATE query), T006 |
| FR-CHPWD-013 | Validate required fields | T001, T002 |
| FR-CHPWD-014 | currentPassword sai → 400 + tăng counter | T006 (BL-4), T007 |
| FR-CHPWD-015 | newPassword không đạt chuẩn → 400 | T001 (`@Matches`), T002 |
| FR-CHPWD-016 | confirmPassword không khớp → 400 | T006 (BL-2), T007 |
| FR-CHPWD-017 | newPassword trùng cũ → 422 | T006 (BL-5), T007 |
| FR-CHPWD-018 | JWT không hợp lệ/hết hạn → 401 | T011 (`@UseGuards(JwtAuthGuard)`) |
| FR-CHPWD-021 | Không có JWT → từ chối HTTP 401 | T011 |
| FR-CHPWD-022 | Chỉ đổi mật khẩu của chính mình (userId từ JWT) | T011 (`request['user'].userId`), T006 |
| FR-CHPWD-023 | Transaction commit + response 200 | T006 (BL-7, BL-10) |
| FR-CHPWD-024 | DB fail → HTTP 500 + rollback | T007 |
| FR-CHPWD-025 | Audit log PASSWORD_CHANGE_SUCCESS | T005, T006 (BL-9), T007 |
| FR-CHPWD-026 | must_change_password guard + whitelist | T009, T010, T013 |
| FR-CHPWD-027 | Set block flag sau lần sai thứ 5 | T004, T006 (BL-4), T007 |
| FR-CHPWD-028 | Block flag detect → 429 | T006 (BL-1), T007 |
| FR-CHPWD-029 | Early-exit khi đang bị block (không query DB/bcrypt) | T006 (BL-1), T007 |
| FR-CHPWD-030 | Ghi audit log PASSWORD_CHANGE_RATE_LIMITED | T005 (`logRateLimited`), T007 |

### Acceptance Criteria → Tasks

| AC | Mô tả | Tasks | Test |
|---|---|---|---|
| AC-001 | Đổi mật khẩu thành công end-to-end | T001, T003, T004, T005, T006, T011, T012 | T007 |
| AC-002 | `must_change_password` reset về false | T003 (UPDATE), T006 | T007 |
| AC-003 | Trường bỏ trống → 400 `VALIDATION_ERROR` | T001 | T002 |
| AC-004 | `newPassword` không đạt chuẩn → 400 | T001 (`@Matches`) | T002 |
| AC-004b | `newPassword` > 72 ký tự → 400 | T001 (`@MaxLength(72)`) | T002 |
| AC-005 | `confirmPassword` không khớp → 400 | T006 (BL-2) | T007 |
| AC-006 | Không có JWT → 401 | T011 (`@UseGuards(JwtAuthGuard)`) | Existing |
| AC-006b | `must_change_password=true` chặn API → 403 | T009, T013 | T010 |
| AC-007 | `currentPassword` sai → 400 + tăng counter | T004, T006 (BL-4) | T007 |
| AC-008 | `newPassword` trùng cũ → 422 | T006 (BL-5) | T007 |
| AC-009 | JWT cũ bị reject sau đổi mật khẩu | T006 (BL-8) | T014 |
| AC-010 | Audit log ghi khi thành công | T005, T006 (BL-9) | T007 |
| AC-011 | JWT mới sau login lại được chấp nhận | T006 (BL-8) | T014 |
| AC-012 | Block sau 5 lần sai → 429 | T004, T006 (BL-4) | T007 |
| AC-013 | Reject ngay trong block period (no DB/bcrypt) | T006 (BL-1 early-exit) | T007 |

### Out-of-Scope Confirmation (không có task nào cho các mục này)

| OOS | Mô tả | Lý do |
|---|---|---|
| OOS-001 | Gửi email thông báo sau đổi mật khẩu | Spec chốt out-of-scope |
| OOS-002 | Admin đổi mật khẩu hộ user khác | Khác actor, khác use case |
| OOS-003 | Active JWT revocation by jti | Passive invalidation đủ cho v1 |
| OOS-004 | Lịch sử đổi mật khẩu | Không có requirement |
| OOS-005 | Async job queue | Không cần cho flow đơn giản này |
