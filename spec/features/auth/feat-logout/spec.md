# Feature Specification: Logout Phiên Hiện Tại

- **Feature ID**: AUTH-002
- **Feature Name**: Đăng xuất khỏi hệ thống
- **Module / Domain**: auth
- **Created Date**: 2026-05-27
- **Status**: Draft
- **Source Documents**:
  - `CLAUDE.md`
  - `database_v3_2_compact_39_tables.md`
  - `API_Contract_Agent_Reference.md`
  - `UC-AUTH-02 - Đăng xuất khỏi hệ thống`

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng này thuộc module `auth`. Căn cứ theo bản cập nhật database v3.2 Compact, bảng `user_sessions` đã bị loại bỏ nhằm giảm độ phức tạp. Theo đó, "quản lý token/session nên xử lý ở tầng JWT/Redis nếu cần; audit_logs vẫn lưu login/logout/security event". Do vậy, cơ chế logout hiện tại sẽ dựa trên Blacklist token (sử dụng Cache/Redis) thay vì cập nhật trạng thái trong database.

### 1.2 Mục tiêu

Cho phép `User` đã đăng nhập kết thúc phiên làm việc hiện tại an toàn. Đảm bảo token vừa đăng xuất bị vô hiệu hóa (blacklist) và không thể dùng để truy cập protected resources ở các request tiếp theo.

### 1.3 Giá trị mang lại

- Bảo vệ dữ liệu, tránh rủi ro lộ lọt khi thiết bị bị sử dụng trái phép.
- Triển khai cơ chế JWT Blacklist chuẩn và tương thích với stateless architecture.
- Ghi nhận `audit_logs` đầy đủ cho các thao tác bảo mật.

### 1.4 Giả định

- Backend sử dụng CacheModule (Memory/Redis) để lưu danh sách các token bị blacklist (Token Blacklist).
- Access token chứa claim `jti` (JWT ID) duy nhất và `exp` (thời điểm hết hạn).
- Protected APIs sẽ kiểm tra `jti` có nằm trong blacklist không ở tầng Guard/Strategy.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| User | Actor chính khởi tạo thao tác logout | Gửi yêu cầu logout từ phiên đã đăng nhập. |
| Backend Auth Service | Thành phần xử lý thu hồi token | Xác định `jti`, đưa vào blacklist, ghi audit log, trả response 200. |
| Frontend Client | Thành phần giao diện | Gọi API logout, dọn auth state cục bộ, điều hướng về login. |

### 2.2 Role & Permission Rules

- Endpoint yêu cầu xác thực (`auth:user`).
- Logout chỉ áp dụng cho token hiện tại gửi trong request, không tác động token khác.

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: Hệ thống phải cho phép người dùng đăng xuất khỏi phiên làm việc hiện tại.
FR-002: Hệ thống phải xác thực request dựa trên `Authorization Bearer access token`.
FR-003: Hệ thống phải lấy claim `jti` (JWT ID) và `exp` từ access token hiện tại.
FR-004: Hệ thống phải đưa `jti` vào danh sách Blacklist (Cache/Redis) với thời gian tồn tại (TTL) bằng thời gian còn lại của token.
FR-005: Khi đưa vào blacklist thành công, hệ thống phải trả response `200` theo định dạng `{revoked: true, revokedAt: "..."}`.
FR-006: Nếu request logout được gửi lặp lại cho token đã bị blacklist, hệ thống vẫn trả success theo tính chất idempotent.
FR-007: Mọi protected API tiếp theo nếu nhận được token có `jti` nằm trong blacklist phải từ chối và trả `401`.
```

### 3.2 Workflow & Integration Requirements

```text
FR-008: Nếu thao tác thêm vào blacklist bị lỗi hệ thống, hệ thống phải trả lỗi `500`.
FR-009: Khi logout thành công, hệ thống phải luôn cố gắng ghi `audit_logs` (loại action: logout). Việc ghi log lỗi không làm fail quá trình logout.
FR-010: Frontend tích hợp tự dọn state cục bộ và điều hướng sau khi API trả thành công.
```

---

## 4. Non-functional Requirements

- **Performance**: Việc kiểm tra blacklist ở JWT Guard phải cực nhanh (dưới 5ms) bằng cách dùng Redis/Cache, không query database SQL.
- **Security**: Response logout không được trả về secret mới. Token cũ bị vô hiệu hóa tuyệt đối.
- **Reliability**: Logout phải idempotent.

---

## 5. API Behavior

### 5.1 Endpoint

- **Method**: `POST`
- **Endpoint**: `/api/v1/auth/logout`
- **Permission**: `auth:user`

### 5.2 Behavior

- Yêu cầu Header `Authorization: Bearer <token>`. Không body.
- Lấy `jti` từ token. Thêm vào Cache với key format `blacklist:${jti}`, TTL = `exp - now()`.
- Trả về 200 OK: `{ "revoked": true, "revokedAt": "2026-05-27T10:00:00Z" }`.
- Ghi `audit_logs` asynchronously.

---

## 6. Data Model

- **Token Blacklist (Cache/Redis)**:
  - Key: `blacklist:<jti>`
  - Value: `true` (hoặc revoked_at timestamp)
  - TTL: Tự động hết hạn khi token JWT gốc tự hết hạn (`exp`), giúp tiết kiệm dung lượng Cache.

- **`audit_logs` (PostgreSQL)**:
  - Bảng ghi lịch sử sự kiện bảo mật.
  - Action: `logout`, Entity: `users`.

---

## 7. Acceptance Criteria

- [ ] Gọi POST /logout với token hợp lệ trả về 200 OK và body `{revoked: true, revokedAt: ...}`.
- [ ] Claim `jti` của token được lưu thành công vào Cache/Redis blacklist.
- [ ] Gọi lại /logout với chính token đó vẫn trả về 200 OK (idempotent).
- [ ] Gọi một protected API bất kỳ với token vừa logout phải nhận về lỗi `401 Unauthorized`.
- [ ] Hệ thống ghi nhận được log vào bảng `audit_logs` cho thao tác logout.
- [ ] Lỗi khi ghi `audit_logs` không làm gián đoạn việc trả về 200 OK của endpoint.
- [ ] Việc hết hạn của token trong blacklist tự động dựa trên TTL của Cache.
