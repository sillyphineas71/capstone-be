# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Khởi tạo data-model.md cho feat-change-password | Toàn bộ tài liệu |

# Data Model: feat-change-password

- **Feature**: AUTH-CHPWD-004
- **Created**: 2026-05-27

---

## 1. Entities sử dụng (không có bảng mới)

### `users` — Bảng chính

| Column | Type (PostgreSQL) | Thao tác | Ghi chú |
|---|---|---|---|
| `id` | `uuid` | READ | Lấy từ JWT `sub` |
| `password_hash` | `varchar` | READ + UPDATE | bcrypt hash — READ để compare, UPDATE sau khi đổi thành công |
| `password_updated_at` | `timestamptz` | UPDATE | Set `NOW()` — trigger passive JWT invalidation |
| `must_change_password` | `boolean` | READ + UPDATE | READ để check guard; SET `false` sau đổi thành công |
| `account_status` | `varchar` | READ | Check `= 'active'` trong transaction |
| `deleted_at` | `timestamptz` | READ | `IS NULL` — tài khoản chưa bị soft delete |
| `updated_at` | `timestamptz` | UPDATE | Set `NOW()` cùng với password update |

**Query SELECT FOR UPDATE (read trong transaction):**
```sql
SELECT id, password_hash, account_status, must_change_password, deleted_at
FROM users
WHERE id = $1
FOR UPDATE;
```

**Query UPDATE (commit khi tất cả checks pass):**
```sql
UPDATE users
SET password_hash = $2,
    password_updated_at = NOW(),
    must_change_password = false,
    updated_at = NOW()
WHERE id = $1
  AND deleted_at IS NULL;
```

---

### `audit_logs` — Ghi sự kiện

Pattern (reuse từ `auth-audit.repository.ts`):
```sql
INSERT INTO audit_logs
  (user_id, action_type, entity_type, entity_id, ip_address, user_agent, request_id, severity, metadata_json)
VALUES ($1, $2, 'users', $3, $4, $5, $6, 'info', $7::jsonb);
```

| action_type | severity | metadata_json | Khi nào |
|---|---|---|---|
| `password_change_success` | `info` | `{}` | Đổi mật khẩu thành công |
| `password_change_rate_limited` | `warn` | `{ "failedAttempts": 5 }` | User bị block do vượt rate-limit |

---

## 2. Redis Keys (ephemeral — không persist vào PostgreSQL)

| Key Pattern | Type | TTL | Set khi | Dùng để |
|---|---|---|---|---|
| `change_password:failed:{userId}` | integer | 15 phút (sliding) | Mỗi lần nhập sai `currentPassword` | Counter số lần sai |
| `change_password:block:{userId}` | `"true"` | 15 phút (fixed) | Counter đạt 5 | Block toàn bộ request đổi mật khẩu |
| `auth:user:{userId}:invalid_after` | timestamp (ms) | 7 ngày | Sau đổi mật khẩu thành công | Guard check `iat < invalid_after` |

> Key `auth:user:{userId}:invalid_after` đã được implement trong `PasswordResetCacheService.invalidateUserTokens()` và được `JwtAuthGuard` đọc. Reuse hoàn toàn.

---

## 3. TypeScript Interfaces

```typescript
// Input từ JWT payload (không từ request body)
interface ChangePasswordContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

// Record từ DB (SELECT FOR UPDATE)
interface UserChangePasswordRecord {
  id: string;
  passwordHash: string;
  accountStatus: string;        // 'active' | 'locked' | 'inactive' | ...
  mustChangePassword: boolean;
  deletedAt: Date | null;
}
```

---

## 4. State Transitions

```
users.password_hash:
  [hash_old] ──── (change password success) ──→ [hash_new]

users.password_updated_at:
  [old_timestamp] ─── (change password success) ──→ [NOW()]

users.must_change_password:
  true ──── (change password success) ──→ false
  false ─── (no change) ──────────────→ false

Redis change_password:failed:{userId}:
  0 ─→ 1 ─→ 2 ─→ 3 ─→ 4 ─→ 5 (block triggered) ─→ [TTL expire: reset]

Redis change_password:block:{userId}:
  [not exists] ─→ [exists, TTL 15min] ─→ [TTL expire: removed]

Redis auth:user:{userId}:invalid_after:
  [not exists or old value] ─→ [Date.now()] ─→ [TTL expire after 7 days]
```
