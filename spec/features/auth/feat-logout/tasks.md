# Implementation Tasks: AUTH-002 Logout (v3.2)

Dựa trên cập nhật Database v3.2 (không còn `user_sessions`, dùng Cache/Redis Blacklist), dưới đây là danh sách task.

## Phase 1: Setup & Foundations
Mục tiêu: Chuẩn bị DTO và cơ sở hạ tầng Cache.

- [x] T001 [P] Tạo `LogoutResponseDto` trả về `revoked: boolean`, `revokedAt: Date` tại `src/modules/auth/dto/logout-response.dto.ts`
- [x] T002 Config và inject `CacheModule` (nếu chưa có) vào `AuthModule` để hỗ trợ token blacklist tại `src/modules/auth/auth.module.ts`

## Phase 2: User Story [US1] - Đăng xuất khỏi hệ thống
Mục tiêu: Blacklist token thông qua `CacheManager` và cập nhật JwtStrategy.

- [x] T003 [US1] Triển khai hàm `logout` trong `AuthService` với logic: trích xuất `jti` và `exp` từ token, lưu vào Cache (`blacklist:{jti}`) với TTL tương ứng (Lưu ý: quy đổi exp từ giây sang mili-giây chính xác để không bị lưu key vĩnh viễn) tại `src/modules/auth/auth.service.ts`
- [x] T004 [P] [US1] Triển khai hàm `logLogoutAudit` bất đồng bộ để insert vào `audit_logs` (bọc try-catch không làm fail luồng chính) trong `AuthService` tại `src/modules/auth/auth.service.ts`
- [x] T005 [P] [US1] Cập nhật logic trong `JwtStrategy.validate()`: kiểm tra xem `payload.jti` có tồn tại trong Cache không, nếu có trả về lỗi 401 tại `src/modules/auth/strategies/jwt.strategy.ts`
- [x] T006 [US1] Tích hợp `logout` và `logLogoutAudit` vào endpoint `POST /api/v1/auth/logout` trong `AuthController`, kết hợp `JwtAuthGuard`, trích xuất raw token và thông tin user tại `src/modules/auth/auth.controller.ts`

## Phase 3: Integration & Testing
- [x] T007 [P] [US1] Viết Unit Tests cho `AuthService` (test blacklist token tính đúng TTL, test mock lỗi Exception cho Cache và DB audit logs) tại `src/modules/auth/tests/auth.service.spec.ts`
- [x] T008 [P] [US1] Viết Unit Tests cho `JwtStrategy` kiểm tra case token bị chặn nếu dính blacklist tại `src/modules/auth/tests/jwt.strategy.spec.ts`
- [x] T009 [US1] Viết E2E Tests giả lập request logout thành công, request lặp lại (idempotent), và gọi API protected bị 401 tại `test/auth/logout.e2e-spec.ts`

## Phase 4: Polish & Documentation
- [x] T010 [P] Cập nhật Swagger documentation (các decorator `@ApiOperation`, `@ApiResponse`) cho endpoint trong `AuthController` tại `src/modules/auth/auth.controller.ts`

## Requirements Coverage
| Task ID | Bao phủ Requirement | Ghi chú |
|---|---|---|
| T001, T010 | FR-005 | Trả response json hợp lệ |
| T002, T003 | FR-003, FR-004 | Sử dụng Cache TTL quản lý blacklist token |
| T003, T006 | FR-006, FR-008 | Idempotent / Catch error Cache return 500 |
| T004 | FR-009 | Audit logs non-blocking |
| T005, T008 | FR-007 | Block token sau logout (trả 401) |
| T009 | NFR | Đảm bảo tính đúng đắn luồng end-to-end |
