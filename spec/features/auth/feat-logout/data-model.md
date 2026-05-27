# Data Model Impacts: Logout (v3.2)

Vì tính năng này dựa trên kiến trúc stateless + JWT Blacklist, luồng tương tác Data Model được phân thành hai nhóm: Cache (Redis) và Database (PostgreSQL).

## 1. Cache (Token Blacklist)
- **Engine**: NestJS `@nestjs/cache-manager` (có thể config dùng memory hoặc Redis).
- **Operation**: `SET`
- **Key**: `blacklist:{jti}`
- **Value**: Timestamp hoặc `true`.
- **TTL**: Tính theo mili-giây: `(token.exp * 1000) - Date.now()`.

## 2. PostgreSQL (audit_logs)
- **Table**: `audit_logs`
- **Operation**: `INSERT`
- **Mapping**:
  - `user_id`: ID của user gọi logout.
  - `action_type`: `'logout'`
  - `entity_type`: `'users'`
  - `entity_id`: `user_id`
  - `severity`: `'info'`
  - `metadata_json`: `{ "jti": "...", "method": "manual" }`
  - `created_at`: `now()`

Lưu ý: Không thực hiện bất kỳ truy vấn hay update nào vào các bảng core. Điều này giữ cho API logout cực kỳ nhanh.
