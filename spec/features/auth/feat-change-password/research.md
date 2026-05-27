# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Khởi tạo research.md cho feat-change-password — bổ sung sau khi plan.md thiếu file này | Toàn bộ tài liệu |

# Research: feat-change-password (AUTH-CHPWD-004)

> **Mục đích**: Ghi lại tất cả quyết định kỹ thuật, phân tích codebase hiện có, và lý do chọn approach cho từng vấn đề. Phục vụ `/speckit-tasks` và agent implement.

---

## 1. Codebase Analysis — Auth Module hiện tại

### 1.1 JWT Invalidation mechanism

**Phát hiện**: `JwtAuthGuard` (dòng 55–71) đã có sẵn logic check key `auth:user:{userId}:invalid_after` trong Redis:

```typescript
const invalidAfterKey = `auth:user:${payload.sub}:invalid_after`;
const invalidAfter = await this.cacheManager.get<number | string>(invalidAfterKey);
if (invalidAfter) {
  const invalidAfterMs = typeof invalidAfter === 'string' ? parseInt(invalidAfter, 10) : invalidAfter;
  if (payload.iat * 1000 < invalidAfterMs) {
    throw new UnauthorizedException('Token has been revoked due to password change');
  }
}
```

**Phát hiện thêm**: `PasswordResetCacheService.invalidateUserTokens(userId, ttlMs)` đã implement set key này:
```typescript
async invalidateUserTokens(userId: string, ttlMs: number): Promise<void> {
  const key = `auth:user:${userId}:invalid_after`;
  await this.cacheManager.set(key, Date.now(), ttlMs);
}
```

**Quyết định**: **Reuse hoàn toàn** cả hai. Sau khi đổi mật khẩu thành công, gọi `passwordResetCacheService.invalidateUserTokens(userId, 7_ngày_ms)`. Không cần thay đổi `JwtAuthGuard`.

---

### 1.2 Rate-limit pattern hiện có

**Phát hiện**: Có 2 pattern rate-limit trong codebase:

| Service | Approach | Phù hợp với UC-AUTH-04? |
|---|---|---|
| `RateLimitService` | In-memory `Map<string, number[]>` | ❌ Không persist qua restart, không dùng Redis |
| `PasswordResetCacheService` | Redis counter + block key | ✅ Đúng approach cho change-password |

**Quyết định**: Tạo `ChangePasswordCacheService` mới theo pattern của `PasswordResetCacheService`, dùng Redis keys:
- `change_password:failed:{userId}` — counter (TTL 15 phút)
- `change_password:block:{userId}` — block flag (TTL 15 phút)

**Lý do tách service riêng** thay vì extend `PasswordResetCacheService`:
- Separation of concerns: OTP cache vs change-password rate-limit
- Key namespace khác nhau (`otp:` vs `change_password:`)
- TTL khác nhau (5/60 phút vs 15/15 phút)

---

### 1.3 DB Transaction pattern

**Phát hiện**: `UsersResetRepository.updatePasswordInTransaction()` dùng `dataSource.transaction()` nhưng **không có SELECT FOR UPDATE**:

```typescript
await this.dataSource.transaction(async (transactionalEntityManager) => {
  await transactionalEntityManager.query(
    `UPDATE users SET password_hash = $2, password_updated_at = now(), must_change_password = false, updated_at = now() WHERE id = $1`,
    [userId, newPasswordHash],
  );
});
```

**Vấn đề**: Không có row-level lock → có thể xảy ra race condition nếu Admin lock tài khoản đồng thời.

**Quyết định**: Tạo `UsersChangePasswordRepository` mới với `SELECT ... FOR UPDATE` + re-check `account_status` trong transaction:

```sql
-- Bên trong transaction:
SELECT id, password_hash, account_status, must_change_password, deleted_at
FROM users WHERE id = $1 FOR UPDATE;

-- Chỉ UPDATE nếu status hợp lệ:
UPDATE users SET password_hash = $2, password_updated_at = NOW(),
  must_change_password = false, updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL;
```

---

### 1.4 Audit log pattern

**Phát hiện**: `AuthAuditRepository` dùng raw SQL INSERT trực tiếp vào `audit_logs`:

```sql
INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
VALUES ($1, 'login', 'users', $2, $3, $4, $5, 'info', $6::jsonb)
```

**Quyết định**: Tạo `ChangePasswordAuditRepository` theo cùng pattern, với 2 methods:
- `logSuccess(params)` — action_type: `password_change_success`, severity: `info`
- `logRateLimited(params)` — action_type: `password_change_rate_limited`, severity: `warn`

Audit log ghi **fire-and-forget** (`.catch(() => {})`) để không block business logic — nhất quán với pattern `password-reset.service.ts` dòng 104–118.

---

### 1.5 `MustChangePasswordGuard` — Không có precedent trong codebase

**Vấn đề**: Không có guard nào trong codebase hiện tại check `must_change_password`.

**Quyết định**: Tạo `MustChangePasswordGuard` mới:
- Áp dụng **sau** `JwtAuthGuard` (yêu cầu `request.user` đã được populate)
- Query DB để lấy `must_change_password` value (không cache để tránh stale data)
- Whitelist các routes: `/api/v1/auth/me`, `/api/v1/auth/change-password`, `/api/v1/auth/logout`
- Đăng ký ở `AppModule` level hoặc business module level (tùy quyết định của team)

**Lý do không encode `must_change_password` vào JWT claim**: JWT có TTL dài → claim stale; Admin thay đổi flag → cần phản ánh ngay lập tức mà không cần invalidate toàn bộ JWT.

---

## 2. Technology Decisions

### 2.1 `bcryptjs` vs `bcrypt`

**Phát hiện**: Codebase dùng `bcryptjs` (pure JavaScript) tại `password-reset.service.ts`:
```typescript
import * as bcrypt from 'bcryptjs';
```

**Quyết định**: Dùng `bcryptjs` (đã import, không cần thêm dependency).

**Salt rounds**: `bcrypt.genSalt(10)` — nhất quán với `password-reset.service.ts`.

---

### 2.2 maxLength = 72 cho bcrypt

**Lý do kỹ thuật**: bcrypt chỉ xử lý **72 byte đầu tiên** của input (giới hạn của thuật toán Blowfish). Chuỗi > 72 ký tự ASCII:
1. Bị cắt ngầm → hai mật khẩu khác nhau (chỉ khác ký tự 73+) tạo hash giống nhau → **security vulnerability**
2. Unicode multi-byte chars có thể vượt 72 bytes dù < 72 ký tự → cần thêm validation

**Quyết định**: `@MaxLength(72)` cho tất cả password fields. Ghi chú rõ trong DTO comment lý do kỹ thuật.

---

### 2.3 Thứ tự validation trong service

**Vấn đề**: Phải xác định thứ tự tối ưu để tránh tốn tài nguyên (bcrypt là CPU-bound).

**Quyết định** (thứ tự từ rẻ → đắt về tài nguyên):
1. Redis block check (O(1), network round-trip) ← rẻ nhất
2. DTO validation (đã xử lý bởi `ValidationPipe` trước khi vào service)
3. confirmPassword match (string compare, O(n)) ← rẻ
4. DB transaction + SELECT FOR UPDATE (network I/O)
5. `bcrypt.compare(currentPassword)` (CPU-bound, ~100ms) ← đắt
6. `bcrypt.compare(newPassword)` E5 check (CPU-bound)  ← đắt
7. `bcrypt.hash(newPassword)` (CPU-bound) ← đắt nhất
8. UPDATE + commit
9. Redis set `invalid_after`
10. Fire-and-forget audit log

---

### 2.4 Vị trí kiểm tra account_status

**Vấn đề**: Nên check `account_status` trước hay trong transaction?

**Phân tích**:
- Check **trước transaction**: Nhanh hơn, nhưng có thể stale (status thay đổi giữa check và update)
- Check **trong transaction với FOR UPDATE**: Chậm hơn (lock row), nhưng đảm bảo consistency

**Quyết định**: Check **trong transaction** — đây là business requirement từ spec (Q-EH-02 race condition). Chấp nhận thêm lock overhead để đảm bảo correctness.

---

## 3. Scope Decisions

### 3.1 Tại sao KHÔNG dùng Active JWT Revocation (Redis blacklist by jti)

**Vấn đề**: Passive invalidation (`iat < invalid_after`) không revoke token hiện tại ngay lập tức — token đang dùng để gọi API change-password vẫn hợp lệ cho đến khi hết hạn (thường 15–60 phút).

**Quyết định**: **Chấp nhận** — đây là trade-off đã được chốt trong Q-BL-01. Request PATCH `/auth/change-password` được phép hoàn tất nếu token hợp lệ lúc bắt đầu. Token đó sẽ tự hết hạn. Active revocation (blacklist by jti) là out of scope theo `OOS-005`.

### 3.2 Tại sao KHÔNG extend `PasswordResetCacheService`

Đã giải thích ở mục 1.2. Tóm tắt: namespace khác, TTL khác, concern khác → tách biệt rõ ràng tốt hơn cho maintainability.

### 3.3 `ChangePasswordService` inject `PasswordResetCacheService` hay tạo interface chung?

**Quyết định**: Inject trực tiếp `PasswordResetCacheService` cho method `invalidateUserTokens()` — method này đã ổn định, không cần thêm abstraction layer. Nếu sau này refactor thành `TokenInvalidationService` riêng thì làm ở scope khác.

---

## 4. Risks Identified During Research

| Risk | Phát hiện từ | Mitigation trong plan |
|---|---|---|
| bcrypt blocking event loop trong transaction giữ lock lâu | Pattern analysis | Chấp nhận cho v1; refactor nếu p95 > 2s |
| `RateLimitService` hiện tại là in-memory — không reusable | Code review | Tạo `ChangePasswordCacheService` riêng với Redis |
| `constitution.md` rỗng — không có gate check | File inspection | Không áp dụng gate; team cần setup constitution |
| `MustChangePasswordGuard` thêm 1 DB query/request | Architecture analysis | Acceptable cho v1; optimize bằng Redis cache sau |

---

## 5. Files Analyzed

| File | Mục đích | Kết quả |
|---|---|---|
| `guards/jwt-auth.guard.ts` | Check cơ chế invalidation | Reuse `invalid_after` key — không sửa |
| `services/password-reset-cache.service.ts` | Pattern Redis cache | Model cho `ChangePasswordCacheService` |
| `services/password-reset.service.ts` | Pattern business logic + audit | Reference cho `ChangePasswordService` |
| `repositories/users-reset.repository.ts` | Pattern DB transaction | Reference + bổ sung FOR UPDATE |
| `repositories/auth-audit.repository.ts` | Pattern audit log | Reuse INSERT pattern |
| `services/rate-limit.service.ts` | Pattern rate-limit | Không reuse (in-memory) |
| `controllers/auth.controller.ts` | Pattern controller | Reference cho thêm endpoint |
