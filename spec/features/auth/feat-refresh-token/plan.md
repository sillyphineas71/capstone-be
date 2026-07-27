# Plan — BE-01 POST /api/v1/auth/refresh

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo plan lần đầu | Toàn bộ file |

---

## 1. File đích

### Code mới
| File | Nội dung |
| :-- | :-- |
| `src/modules/auth/dto/refresh-token.dto.ts` | `RefreshTokenDto { refreshToken: string }` |
| `src/modules/auth/dto/refresh-token-response.dto.ts` | `{ accessToken, refreshToken, expiresIn }` |
| `src/modules/auth/services/refresh-token.service.ts` | Logic 5 bước (xem spec.md §3) |
| `src/modules/auth/services/refresh-token.service.spec.ts` | Unit test |

### Code sửa
| File | Việc |
| :-- | :-- |
| `src/modules/auth/services/auth-config.service.ts` | Thêm `getRefreshTokenSecret()` |
| `src/modules/auth/services/token.service.ts` | `generateRefreshToken` dùng `authConfigService.getRefreshTokenSecret()` thay vì đọc thẳng `process.env` |
| `src/modules/auth/services/token.service.spec.ts` | Thêm test xác nhận secret lấy qua AuthConfigService |
| `src/modules/auth/repositories/users-auth.repository.ts` | Thêm `findById(userId)` để refresh flow load lại user theo `sub` |
| `src/modules/auth/constants/auth-error-codes.ts` | Thêm `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REVOKED` |
| `src/modules/auth/controllers/auth.controller.ts` | Thêm `POST refresh`, không gắn `JwtAuthGuard` |
| `src/modules/auth/auth.module.ts` | Đăng ký `RefreshTokenService` |

### Không cần sửa (đã kiểm tra)
- `src/modules/auth/guards/must-change-password.guard.ts` — không cần đổi `ALLOWED_ROUTE_PREFIXES` (xem spec.md §5).
- `.env.example` — đã có sẵn `AUTH_REFRESH_TOKEN_SECRET` và `AUTH_REFRESH_TOKEN_TTL_SECONDS`.

### Migration
Không cần — endpoint public, không có permission.

## 2. Thứ tự thực hiện

1. `auth-config.service.ts` (thêm getter) trước vì `token.service.ts` và `refresh-token.service.ts` đều phụ thuộc.
2. `token.service.ts` (dọn hard-code env).
3. DTO (`refresh-token.dto.ts`, `refresh-token-response.dto.ts`).
4. `users-auth.repository.ts` (thêm `findById`).
5. `auth-error-codes.ts` (thêm 2 code).
6. `refresh-token.service.ts` + spec.
7. `auth.controller.ts` + `auth.module.ts`.
8. Chạy `tsc --noEmit`, sau đó test riêng suite `auth` trước khi chạy full suite (rủi ro #3 trong `KE_HOACH_TAI_THUC_THI_PLAN_BE_2026-07-26.md`).

## 3. Cách test

- Unit test `refresh-token.service.spec.ts`: valid refresh, jti mới khác jti cũ, blacklist đúng TTL, 401 invalid (sai chữ ký/hết hạn), 401 revoked (jti đã blacklist), 401 user không active/không tồn tại, fail-closed khi Redis lỗi.
- `token.service.spec.ts`: xác nhận `generateRefreshToken` gọi `jwtService.signAsync` với secret lấy từ `AuthConfigService`, không còn đọc `process.env` trực tiếp.
- Không cần integration/e2e mới cho đợt P0 này (theo phạm vi đã chốt), nhưng convention DTO + guard giữ đồng nhất với `login`/`logout` để dễ viết e2e sau.
