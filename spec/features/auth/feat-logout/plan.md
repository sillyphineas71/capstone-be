# Implementation Plan: AUTH-002 Logout (v3.2 Compact)

Dựa trên cập nhật Database v3.2 Compact, bảng `user_sessions` đã bị loại bỏ. Việc quản lý logout sẽ được thực hiện qua **JWT Blacklist sử dụng Cache/Redis**.

## 1. Feature Summary
Tính năng Logout cho phép người dùng kết thúc phiên làm việc. Hệ thống lấy `jti` từ JWT access token và đưa vào danh sách đen (Blacklist) trong Cache/Redis. `JwtStrategy` sẽ kiểm tra danh sách này để chặn token đã bị thu hồi. Thao tác này cũng được ghi lại vào bảng `audit_logs` (non-blocking).

## 2. Technical Context & Scope
- **Backend framework**: NestJS
- **Data storage**: 
  - Token Blacklist: `CacheModule` (Redis/Memory).
  - Audit: PostgreSQL (`audit_logs`).
- **Idempotency**: API trả 200 OK ngay cả khi token đã ở trong blacklist.
- **Security Guard**: Cập nhật `JwtStrategy` để check `blacklist:<jti>` trước khi cho phép request qua Guard.

## 3. Data Model Impact
- **Cache/Redis**: Sử dụng pattern `blacklist:<jti>` với giá trị là timestamp `revokedAt`. TTL của cache key bằng chính thời gian còn lại của token (`exp - current_time`).
- **Database (`audit_logs`)**: Ghi log thao tác (action: `logout`). Không query DB trong quá trình auth guard để đảm bảo hiệu năng.

## 4. API & Contract Plan
- `POST /api/v1/auth/logout`
- **Request**: Không body. Yêu cầu `Authorization Bearer <token>`.
- **Response 200**:
```json
{
  "success": true,
  "message": "Logout successful",
  "data": {
    "revoked": true,
    "revokedAt": "2026-05-27T10:00:00Z"
  }
}
```

## 5. Authorization & Guard Plan
- Endpoint được bảo vệ bằng `JwtAuthGuard`.
- `JwtStrategy.validate(payload)`:
  - Đọc `payload.jti`.
  - Check `cacheManager.get('blacklist:' + payload.jti)`.
  - Nếu tồn tại -> quăng lỗi `UnauthorizedException('Token has been revoked')`.

## 6. Business Logic & Error Handling
1. `AuthService.logout(user, tokenPayload)`:
   - Tính toán TTL = `tokenPayload.exp * 1000 - Date.now()`.
   - Nếu TTL > 0, set cache: `cacheManager.set('blacklist:' + jti, true, TTL)`.
   - Nếu lỗi Cache -> throw `InternalServerErrorException`.
2. Ghi Audit Log:
   - Khởi chạy một Promise không `await` (hoặc dùng `EventEmitter`) để insert `audit_logs`.
   - Bọc `try-catch` để lỗi DB không làm fail luồng cache.

## 7. Testing Strategy
- **Unit Test**: Mock `CacheManager` để test các logic `set` (logout) và `get` (guard). Test tính toán TTL chính xác.
- **E2E Test**: Dùng token gọi API protected -> Gọi /logout -> Gọi lại protected API (kỳ vọng 401). Gọi /logout lần 2 (kỳ vọng 200).
