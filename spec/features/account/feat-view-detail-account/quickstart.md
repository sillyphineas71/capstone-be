# Quickstart: Xem chi tiết hồ sơ tài khoản

> Phase 1 output — Test scenarios & verification notes.

---

## Test Scenarios

### Happy Path

| # | Scenario | Given | When | Then | AC Ref |
|---|---|---|---|---|---|
| HP1 | System Admin xem user detail | System Admin có permission `account.user.read.detail`, target user tồn tại | GET `/api/v1/users/:userId` | HTTP 200 với đầy đủ 17 fields | AC-001, AC-012 |
| HP2 | Business Admin xem user trong scope | Business Admin có permission, target user cùng department (bao gồm child) | GET `/api/v1/users/:userId` | HTTP 200 với đầy đủ fields | AC-013 |
| HP3 | Self-view (Business Admin xem chính mình) | Business Admin có permission, target userId == authenticated userId | GET `/api/v1/users/:userId` | HTTP 200, bypass department scope | AC-014 |
| HP4 | User không có face profile | Target user có face_profiles rỗng | GET `/api/v1/users/:userId` | `hasFaceProfile: false` | AC-002 |
| HP5 | Direct manager null | Target user có `direct_manager_id = null` | GET `/api/v1/users/:userId` | `directManager: null` (field tồn tại) | AC-015 |
| HP6 | Avatar URL null | Target user có `avatar_url = null` | GET `/api/v1/users/:userId` | `avatarUrl: null` | AC-016 |
| HP7 | Avatar URL có giá trị | Target user có `avatar_url` hợp lệ | GET `/api/v1/users/:userId` | `avatarUrl` chứa giá trị từ DB | AC-017 |

### Error Cases

| # | Scenario | Given | When | Then | AC Ref |
|---|---|---|---|---|---|
| E1 | Invalid UUID | userId = "abc" hoặc "" | GET `/api/v1/users/abc` | HTTP 400, code `INVALID_USER_ID` | AC-003 |
| E2 | Unauthenticated | Không có JWT token | GET `/api/v1/users/:userId` | HTTP 401 | AC-004 |
| E3 | Không có permission | User login không có `account.user.read.detail` | GET `/api/v1/users/:userId` | HTTP 403, code `FORBIDDEN` | AC-005 |
| E4 | Business Admin ngoài scope | Target user thuộc department khác, không phải self-view | GET `/api/v1/users/:userId` | HTTP 403, code `FORBIDDEN` | AC-006 |
| E5 | User không tồn tại | userId không có trong DB | GET `/api/v1/users/:userId` | HTTP 404, code `USER_NOT_FOUND` | AC-007 |
| E6 | User soft-deleted | Target user có `deleted_at` không null | GET `/api/v1/users/:userId` | HTTP 404, code `USER_NOT_FOUND` | AC-008 |

### Audit Cases

| # | Scenario | Given | When | Then | AC Ref |
|---|---|---|---|---|---|
| A1 | Audit log recorded | System Admin thành công xem detail | Request complete | AuditLogEntity created với actionType `view_detail` | AC-011 |

---

## Verification Notes

### Pre-implementation

- [ ] Confirm `UsersService` is exported from `AccountsModule` (hiện tại đã export)
- [ ] Confirm `AdministrationModule` is imported in `AccountsModule` (hiện tại đã import)
- [ ] Confirm `AuthzReadRepository` is available for permission check (PermissionsGuard handles it)

### Post-implementation

- [ ] Controller method: `@Get(':userId')` với `@UseGuards(JwtAuthGuard, PermissionsGuard)` và `@RequirePermissions('account.user.read.detail')`
- [ ] DTO `UserDetailResponseDto` không expose `password_hash`, `username`, `failed_login_count`
- [ ] `ParseUUIDPipe` cho `userId` param
- [ ] Department scope check chỉ chạy cho Business Admin, không chạy cho System Admin
- [ ] Self-view bypass department scope
- [ ] Audit log không blocking (try/catch như pattern hiện có)
- [ ] Query chỉ dùng SELECT, không có INSERT/UPDATE/DELETE
- [ ] Response format đúng convention: `{ success, message, data }`
- [ ] Roles chỉ trả về active roles (`isActive: true`)
- [ ] `directManager` field luôn present trong response (kể cả khi null)
- [ ] `hasFaceProfile` luôn present trong response
- [ ] Unit test coverage cho `getUserDetail` method
- [ ] Employment status chỉ nhận: `active`, `probation`, `resigned`, `transferred`

### Integration Test Checklist

- [ ] Test với real database hoặc transaction rollback
- [ ] Seed data: System Admin user, Business Admin user, target users ở nhiều department
- [ ] Verify audit log tồn tại sau mỗi successful request
- [ ] Verify department scope resolution với nested departments (parent + children)
