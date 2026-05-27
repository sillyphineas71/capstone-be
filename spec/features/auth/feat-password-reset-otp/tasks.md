# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Hoàn thành toàn bộ Phase 5 Polish & Verification | Phần đầu và Phase 5 |
| 2026-05-27 | Cập nhật hoàn thành Phase 3 và Phase 4 (T010 - T029) | Phần đầu, Phase 3 và Phase 4 |
| 2026-05-27 | Cập nhật hoàn thành Phase 2 (T004 - T009) và các test liên quan | Phần đầu và Phase 2 |
| 2026-05-27 | Cập nhật hoàn thành T001, T002, T003 trong Phase 1 | Phần đầu và Phase 1 |
| 2026-05-27 | Khởi tạo tài liệu checklist công việc chi tiết (tasks.md) | Toàn bộ tài liệu |

# Tasks: AUTH-003 Password Reset with OTP

**Input**: Design documents from `/spec/features/auth/feat-password-reset-otp/`
**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `contracts/reset-api.md`, `quickstart.md`

**Tests**: Bao gồm test tasks để đảm bảo 100% độ tin cậy của luồng bảo mật (validation, rate limit, error handling, Redis TTL, và token invalidation).

**Organization**: Tasks được nhóm theo từng Phase và từng User Story để đảm bảo tính độc lập khi phát triển, kiểm thử, và tích hợp.

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Có thể chạy song song (khác file, không phụ thuộc vào task chưa hoàn thành).
- **[Story]**: Label xác định task thuộc User Story nào (US1 cho Request OTP, US2 cho Confirm Reset).
- Mọi task đều bắt buộc có file path rõ ràng.

---

## Path Conventions

- Source code: `src/`
- Unit tests: `src/**/*.spec.ts`
- E2E tests: `test/*.e2e-spec.ts`
- Feature docs: `spec/features/auth/feat-password-reset-otp/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Thiết lập wiring module và khai báo cấu trúc cơ bản cho tính năng Password Reset OTP trong `AuthModule` có sẵn hoặc tạo mới.

- [x] T001 Xác nhận hoặc khởi tạo `AuthModule` skeleton tại `src/modules/auth/auth.module.ts`
- [x] T002 [P] Khai báo các hằng số mã lỗi `AUTH_OTP_INVALID_OR_EXPIRED`, `AUTH_TOO_MANY_ATTEMPTS`, và `AUTH_ACCOUNT_RESTRICTED` tại `src/modules/auth/constants/auth-error-codes.ts`
- [x] T003 [P] Định nghĩa kiểu dữ liệu cho phiên lưu trữ OTP trong Redis và kết quả xác thực tại `src/modules/auth/types/password-reset.types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Xây dựng các building blocks dùng chung như DTO validation, Redis Cache Adapter, DB Repositories, và Mail Adapter.

**⚠️ CRITICAL**: Phải hoàn thành toàn bộ Phase này trước khi triển khai các endpoint nghiệp vụ.

- [x] T004 Tạo `RequestOtpDto` để validate email (trim, lowercase, RFC 5322) tại `src/modules/auth/dto/request-otp.dto.ts`
- [x] T005 Tạo `ConfirmResetDto` để validate email, OTP (6 số), và newPassword complexity rule (tối thiểu 8 ký tự, 1 hoa, 1 thường, 1 số, 1 đặc biệt) tại `src/modules/auth/dto/confirm-reset.dto.ts`
- [x] T006 [P] Tạo `PasswordResetCacheService` để đọc/ghi OTP hashed, counter rate-limit, và block key trong Redis tại `src/modules/auth/services/password-reset-cache.service.ts`
- [x] T007 [P] Tạo `AuthEmailService` adapter sử dụng SMTP để gửi mã OTP tiếng Việt tại `src/modules/auth/services/auth-email.service.ts`
- [x] T008 [P] Tạo repository truy vấn và cập nhật `users` (`password_hash`, `password_updated_at`, `must_change_password`, loại bỏ soft deleted/resigned) tại `src/modules/auth/repositories/users-reset.repository.ts`
- [x] T009 [P] Tạo repository ghi audit log cho cả hai sự kiện OTP request và Reset success tại `src/modules/auth/repositories/reset-audit.repository.ts`

**Checkpoint**: Foundation đã sẵn sàng. Các luồng nghiệp vụ có thể triển khai.

---

## Phase 3: User Story 1 - Yêu cầu gửi mã OTP khôi phục mật khẩu (Priority: P1) 🎯 MVP

**Goal**: Người dùng gửi email -> Hệ thống kiểm tra rate limit -> Tra cứu DB loại bỏ tài khoản không khả dụng (E1) -> Tạo OTP và băm trước khi lưu Redis Cache (TTL 10 phút) -> Gửi email OTP tiếng Việt -> Ghi audit log.

**Independent Test**: Gọi API 1 thành công, kiểm tra OTP hash và TTL được lưu chính xác trong Redis, chặn spam đúng giới hạn 3 lần/5 phút và trả lỗi HTTP 429.

### Tests cho User Story 1
- [x] T010 [P] [US1] Viết unit test cho `RequestOtpDto` validation và email normalization tại `src/modules/auth/dto/request-otp.dto.spec.ts`
- [x] T011 [P] [US1] Viết unit test cho `PasswordResetCacheService` (đảm bảo đếm spam chính xác và block key lưu đúng 60 phút) tại `src/modules/auth/services/password-reset-cache.service.spec.ts`
- [x] T012 [P] [US1] Viết unit test cho `UsersResetRepository` (loại bỏ deleted/resigned/locked accounts) tại `src/modules/auth/repositories/users-reset.repository.spec.ts`
- [x] T013 [P] [US1] Viết unit test cho `AuthEmailService` (mặc định gửi tiếng Việt, mock SMTP connection) tại `src/modules/auth/services/auth-email.service.spec.ts`
- [x] T014 [US1] Viết e2e test cho API `POST /api/v1/auth/password-reset/request` verify các mã lỗi `AUTH_ACCOUNT_RESTRICTED` và `AUTH_TOO_MANY_ATTEMPTS` tại `test/password-reset-request.e2e-spec.ts`

### Implementation cho User Story 1
- [x] T015 [US1] Triển khai logic rate-limiting và spam protection (3 lần/5 phút -> block 60 phút) trong `PasswordResetService` tại `src/modules/auth/services/password-reset.service.ts`
- [x] T016 [US1] Triển khai truy vấn an toàn người dùng (với mã lỗi E1 đồng nhất khi deleted/locked/inactive/resigned) trong `PasswordResetService` tại `src/modules/auth/services/password-reset.service.ts`
- [x] T017 [US1] Triển khai tạo mã OTP 6 chữ số an toàn mã hóa, băm SHA-256 và lưu Redis Cache TTL 10 phút trong `PasswordResetService` tại `src/modules/auth/services/password-reset.service.ts`
- [x] T018 [US1] Kích hoạt tiến trình gửi Email tiếng Việt và ghi audit log non-blocking trong `PasswordResetService` tại `src/modules/auth/services/password-reset.service.ts`
- [x] T019 [US1] Tạo endpoint `POST /api/v1/auth/password-reset/request` trong `AuthController` tại `src/modules/auth/controllers/auth.controller.ts`

**Checkpoint**: US1 hoàn thành. Người dùng có thể yêu cầu OTP và nhận mail.

---

## Phase 4: User Story 2 - Xác thực OTP và đặt lại mật khẩu mới (Priority: P2)

**Goal**: Người dùng cung cấp OTP và mật khẩu mới -> Xác thực OTP trên Redis (sai quá 5 lần tự hủy OTP) -> Hash mật khẩu mới, cập nhật bảng `users` -> Invalidate các stateless JWT cũ qua Auth Guard -> Hủy cache OTP -> Ghi audit log.

**Independent Test**: Gọi API 2 thành công, verify mật khẩu mới đã hash lưu DB, `password_updated_at` cập nhật, stateless JWT có `iat` nhỏ hơn `password_updated_at` bị từ chối truy cập qua Auth Guard, key OTP bị xóa khỏi Redis.

### Tests cho User Story 2
- [x] T020 [P] [US2] Viết unit test cho `ConfirmResetDto` validate regex OTP và độ phức tạp mật khẩu tại `src/modules/auth/dto/confirm-reset.dto.spec.ts`
- [x] T021 [P] [US2] Viết unit test cho logic đếm sai OTP (sai quá 5 lần tự hủy key) tại `src/modules/auth/services/password-reset.service.spec.ts`
- [x] T022 [P] [US2] Viết unit test cho cơ chế invalidation token JWT (`iat < password_updated_at`) trong `JwtAuthGuard` tại `src/common/guards/jwt-auth.guard.spec.ts`
- [x] T023 [US2] Viết e2e test cho API `POST /api/v1/auth/password-reset/confirm` verify các case thành công, OTP hết hạn, sai chuẩn mật khẩu mới và brute force blocker tại `test/password-reset-confirm.e2e-spec.ts`

### Implementation cho User Story 2
- [x] T024 [US2] Triển khai so khớp mã OTP đã băm, xử lý đếm sai và tự hủy sau 5 lần nhập sai trong `PasswordResetService` tại `src/modules/auth/services/password-reset.service.ts`
- [x] T025 [US2] Triển khai DB write transaction cập nhật `password_hash`, `password_updated_at` và `must_change_password = false` trong `UsersResetRepository` tại `src/modules/auth/repositories/users-reset.repository.ts`
- [x] T026 [US2] Triển khai tích hợp kiểm duyệt `iat < password_updated_at` vào lớp `JwtAuthGuard` chung của hệ thống tại `src/common/guards/jwt-auth.guard.ts`
- [x] T027 [US2] Triển khai xóa sạch Redis Cache OTP và counter rate-limit sau khi đổi thành công trong `PasswordResetService` tại `src/modules/auth/services/password-reset.service.ts`
- [x] T028 [US2] Triển khai ghi audit log sự kiện thành công (IP/User-Agent, cấm lưu plain pass/plain OTP) trong `PasswordResetService` tại `src/modules/auth/services/password-reset.service.ts`
- [x] T029 [US2] Tạo endpoint `POST /api/v1/auth/password-reset/confirm` trong `AuthController` tại `src/modules/auth/controllers/auth.controller.ts`

**Checkpoint**: US2 hoàn thành. Tính năng khôi phục mật khẩu OTP hoạt động trọn vẹn và an toàn.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup code, tối ưu hóa hiệu năng, chạy linting và đảm bảo tính nhất quán cuối cùng.

- [x] T030 [P] Cập nhật tài liệu hướng dẫn kiểm thử [quickstart.md](file:///c:/Users/Admin/Desktop/Capstone/capstone-be/spec/features/auth/feat-password-reset-otp/quickstart.md) với các case thực tế
- [x] T031 Rà soát toàn bộ code, xóa bỏ comment debug nhạy cảm, chạy lint và định dạng code tại `src/modules/auth/`
- [x] T032 Chạy toàn bộ test suites cho luồng password reset:
  `npm run test src/modules/auth` và `npm run test test/password-reset-request.e2e-spec.ts test/password-reset-confirm.e2e-spec.ts`

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (Phase 1)**: Bắt đầu lập tức.
- **Foundational (Phase 2)**: Phụ thuộc Phase 1. Quyết định toàn bộ abstractions nền tảng.
- **User Story 1 (Phase 3)**: Phụ thuộc Phase 2 hoàn thành.
- **User Story 2 (Phase 4)**: Phụ thuộc Phase 2 và Phase 3 (vì dùng chung controller và DB repository).
- **Polish (Phase 5)**: Phụ thuộc Phase 3 và Phase 4 hoàn tất.

### Parallel Opportunities [P]
- Các repository/service nền tảng ở Phase 2 (`T006`, `T007`, `T008`, `T009`) hoàn toàn độc lập về file, có thể code song song.
- Viết test suite DTO và services (`T010`-`T013` và `T020`-`T022`) có thể triển khai song song bởi một developer khác trước hoặc trong khi implement services chính.

---

## Requirements Coverage

| FR / AC chính | Tasks cover | Thành phần hiện thực hóa |
| :--- | :--- | :--- |
| **FR-AUTH-OTP-001** / Lưu Redis TTL 10 phút | T006, T011, T017 | Redis cache key, TTL config |
| **FR-AUTH-OTP-002** / Mật khẩu mới chuẩn bảo mật | T005, T020 | DTO validation rules |
| **FR-AUTH-OTP-003** / Xóa OTP ngay khi reset thành công | T024, T027 | Hủy key Redis cache |
| **FR-AUTH-OTP-004** / Không dùng DB table vật lý | T001, T008 | Tuân thủ v3.2 database compact |
| **FR-AUTH-OTP-005** / Kiểm tra email active | T008, T012, T016 | Postgres User query |
| **FR-AUTH-OTP-006** / Sinh OTP ngẫu nhiên, gửi email | T007, T013, T017, T018 | Node crypto, Mail adapter |
| **FR-AUTH-OTP-007** / Start đếm ngược 10 phút | T015, T017, T019 | API 1 Response metadata |
| **FR-AUTH-OTP-008** / Resend OTP hủy cũ tạo mới | T015, T017, T018 | Hủy key cũ & ghi đè Redis |
| **FR-AUTH-OTP-009** / Đổi pass, invalid token | T025, T026, T027, T029 | DB transaction, JwtAuthGuard `iat` check |
| **FR-AUTH-OTP-011** / Chặn Spam rate limit | T006, T011, T015 | Redis counter & block key |
| **FR-AUTH-OTP-013** / Lỗi E1 tài khoản restrictions | T008, T012, T016 | Đồng bộ thông báo bảo mật chung |
| **FR-AUTH-OTP-014** / OTP sai 5 lần tự hủy | T021, T024 | Redis increment & delete |
| **FR-AUTH-OTP-016** / Spam block 60 phút, HTTP 429 | T011, T014, T015 | API rate-limiting response |
| **FR-AUTH-OTP-022** / Audit log IP, User-Agent | T009, T018, T028 | audit_logs table write, metadata_json |
| **AC-001** / Yêu cầu OTP thành công | T014, T015, T016, T017, T018, T019 | Request API flow |
| **AC-002** / Đổi mật khẩu thành công | T023, T024, T025, T026, T027, T028, T029 | Confirm API flow, Guard validation |
| **AC-003** / Email restricts E1 | T012, T014, T016 | Security check test case |
| **AC-004** / Sai OTP/Hết hạn E2 | T021, T023, T024 | Expired check test case |
| **AC-005** / Pass không đạt chuẩn E3 | T020, T023 | Password complexity test case |
| **AC-006** / Rate limit spam E4 | T011, T014, T015 | 429 test case |
