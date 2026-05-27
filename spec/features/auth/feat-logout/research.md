# Research & Clarifications: Logout (v3.2)

Tài liệu này ghi chú các quyết định thiết kế cho tính năng Logout dựa trên database v3.2 Compact.

## 1. Cơ chế JWT Blacklist thay cho bảng user_sessions
Vì bảng `user_sessions` đã bị loại bỏ, hệ thống không còn theo dõi state của refresh/access token dưới DB. Để đảm bảo an toàn sau khi logout, chúng ta sử dụng kiến trúc JWT Blacklist:
- Khi user gọi `/logout`, hệ thống lấy `jti` (JWT ID) từ token.
- Hệ thống đẩy `jti` này vào bộ nhớ đệm (thông qua `CacheModule` của NestJS, hỗ trợ Redis).
- Khi Guard xác thực (ví dụ `JwtStrategy`) decode token, nó sẽ kiểm tra xem `jti` có nằm trong Cache không. Nếu có, token bị từ chối (trả 401).

**TTL (Time To Live) của Blacklist**
Để Cache không bị tràn bộ nhớ, key `blacklist:<jti>` sẽ được set TTL bằng với thời gian còn lại của token.
- `TTL = exp (từ token) - current_time`
Khi token gốc tự động hết hạn, key trong blacklist cũng biến mất, đảm bảo memory footprint rất nhỏ.

## 2. Idempotent Logout
Nếu client gọi `/logout` 2 lần liên tiếp với cùng một token:
- Hàm `cacheManager.set()` sẽ chạy đè lên key cũ (hoặc bỏ qua nếu đã tồn tại).
- Không phát sinh lỗi hệ thống.
- Vẫn trả về 200 OK.
- Điều này giúp UI dễ dàng xử lý các cú click đúp.

## 3. Asynchronous Audit Logging
- Theo thiết kế v3.2, thao tác security phải được ghi nhận vào `audit_logs`.
- Ghi log liên quan tới I/O Database chậm hơn Cache, nên thao tác này được tách ra chạy ngầm (fire-and-forget).
- Hàm `logLogoutAction` không sử dụng `await` trong luồng chính và được bọc `try-catch`. Lỗi DB sẽ được log ra console thay vì quăng Exception về cho user, đảm bảo quá trình logout siêu tốc.
