# Capstone Backend — Project Constitution

> Tài liệu này định nghĩa các nguyên tắc không thể vi phạm cho toàn bộ backend.
> Agent PHẢI đọc và tuân thủ trước khi bắt đầu bất kỳ feature nào.
> Nguồn gốc: `AGENTS.md` (CLAUDE.md) — Backend Guide v1.1

---

## Core Principles

### I. Database Integrity (NON-NEGOTIABLE)

- **Không tự ý thêm bảng mới** khi chưa có yêu cầu rõ ràng từ team. Database baseline là v3.2 Compact (39 bảng).
- **Không xóa bảng hiện có** trong baseline mà không có migration và lý do rõ ràng.
- **Không đổi tên bảng/cột** nếu chưa có migration chính thức.
- Luôn dùng **UUID primary key** và **`timestamptz`** (không dùng `timestamp` plain).
- Mọi thay đổi schema phải đi kèm: migration → entity update → DTO/API update → seed update.

### II. Security-First (NON-NEGOTIABLE)

- **Không lưu plain text password** — bắt buộc hash bằng bcrypt/argon2.
- **Không log password, token, OTP, hash** dưới bất kỳ hình thức nào.
- **Không trả password_hash ra API response**.
- **Luôn lấy `user_id` từ JWT payload** (`sub`), không nhận từ request body.
- Mọi endpoint nghiệp vụ phải có `JwtAuthGuard`.

### III. No Scope Creep (NON-NEGOTIABLE)

- **Không tự mở rộng scope** ngoài use case được yêu cầu.
- **Không tự ý thêm AI/vector/embedding pipeline** trừ khi có yêu cầu rõ ràng.
- **Không triển khai microservice** khi team chưa quyết định — giữ modular monolith.
- Module `documents` hiện tại là setup-only; không implement AI features.

### IV. Module Boundary

- Mỗi domain có module riêng trong `/src/modules/<module-name>`.
- Các module chỉ giao tiếp qua service/export rõ ràng — không import chéo bừa bãi.
- Ranh giới module: `equipment` (tài sản/cấu hình) ≠ `iot` (nhận event) ≠ `presence` (diễn giải tín hiệu).

### V. API Consistency

- Prefix chung: `/api/v1`.
- Response format bắt buộc: `{ success, message, data, meta }` cho success; `{ success, message, error: { code, details }, timestamp, path }` cho error.
- HTTP status codes tuân thủ bảng trong `AGENTS.md` mục 8.3.
- Pagination: `?page=1&limit=20&sortBy=&sortOrder=` — default limit 20, max 100.

### VI. Authentication Architecture

- **Stateless JWT** — không dùng bảng `user_sessions` (đã bị lược bỏ trong v3.2 Compact).
- Logout và password change dùng **JWT Blacklist qua Redis Cache**.
- JWT invalidation: set key `auth:user:{userId}:invalid_after` → Auth Guard check `iat < invalid_after`.
- Password reset dùng OTP qua email, lưu hash trong Redis (không lưu DB).

### VII. Typescript Strict

- Bắt buộc TypeScript strict typing.
- Validate DTO ở boundary bằng `class-validator` + `ValidationPipe`.
- Không dùng `any` nếu có thể tránh.

---

## Quality Gates

Agent PHẢI tự kiểm tra các gate sau trước khi implement:

| Gate | Điều kiện PASS |
|---|---|
| **DB Gate** | Không thêm bảng ngoài spec; nếu thêm phải có justification rõ ràng |
| **Security Gate** | Không có plain text credential nào trong code/log/response |
| **Scope Gate** | Không implement feature ngoài use case spec |
| **Module Gate** | Không vi phạm module boundary; không import circular |
| **API Gate** | Response format đúng convention; HTTP codes đúng |
| **Auth Gate** | Mọi protected endpoint có JwtAuthGuard; user_id từ JWT |
| **Test Gate** | Unit test cho tất cả service methods; DTO validation test |

---

## Complexity Justification

Nếu plan vi phạm bất kỳ principle nào ở trên, agent PHẢI:
1. Ghi rõ vi phạm vào `plan.md` mục "Complexity Tracking"
2. Giải thích tại sao cần vi phạm (business need)
3. Giải thích tại sao không có alternative đơn giản hơn
4. Được team xác nhận trước khi proceed

---

## Governance

- Constitution này có giá trị cao hơn mọi convention code thông thường.
- Mọi amendment phải ghi vào CHANGELOG của file này.
- Xem `AGENTS.md` cho runtime development guidance đầy đủ.
- Khi có mâu thuẫn: User request mới nhất > Database v3.2 > Feature Table > Use Case > API Contract > Spec > AGENTS.md > Code hiện tại.

**Version**: 1.0 | **Ratified**: 2026-05-27 | **Last Amended**: 2026-05-27
