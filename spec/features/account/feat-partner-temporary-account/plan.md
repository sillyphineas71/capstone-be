# Implementation Plan: Partner Temporary Account (PTA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo plan cho feat-partner-temporary-account, chuyển thể từ `KE_HOACH_TAI_KHOAN_DOI_TAC_TAM_THOI_2026-08-11.md` | Toàn bộ file |

**Branch**: `tai-branch` (đề xuất) | **Date**: 2026-08-11 | **Spec**: spec.md

---

## 1. Feature Summary

Cho phép Administrator/Host tạo tài khoản `users` thật cho đối tác — role `EMPLOYEE` có sẵn, `department_id` trỏ tới 1 row `departments` cố định (seed UUID cứng, đánh dấu "Đối tác") — với hạn dùng xác định trước lưu ở cột mới `users.account_expires_at`. Mật khẩu ban đầu = chính email của tài khoản (hash bcrypt), `must_change_password = false` (không ép đổi). Ảnh sinh trắc học bắt buộc nhập kèm lúc tạo, ghi thẳng `face_profiles.status = ACTIVE` để không đụng `BiometricEnforcementGuard` toàn cục. Phạm vi chức năng bị giới hạn bằng guard mới `PartnerAccountRestrictionGuard` hoạt động theo mô hình opt-in decorator (`@AllowPartnerAccount()`) — mặc định chặn mọi endpoint, chỉ mở nơi được đánh dấu tường minh. Không thêm bảng, không thêm role, không sửa 2 guard toàn cục hiện có (`BiometricEnforcementGuard`, `MustChangePasswordGuard`). Song song, không thay thế `guest-access` (`GLA-001`).

## 2. Technical Context

### 2.1 Tech Stack

NestJS + TypeORM + PostgreSQL. Không dependency npm mới. 1 migration thêm cột `users.account_expires_at` + seed 1 row `departments` (UUID cố định) + seed 1 permission quản trị mới (`account.partner.manage`, tên đề xuất — chốt khi implement).

### 2.2 Existing Codebase Analysis

| Thành phần | Vị trí | Vai trò trong feature này |
| :--- | :--- | :--- |
| `UsersService.persistAccount()` | `accounts/services/users.service.ts:365-401` | **Điểm sửa chính** — thêm nhánh tạo tài khoản đối tác: hash `email` thay vì `generateTemporaryPassword`, `mustChangePassword = false` thay vì hard-code `true`, `departmentId` = hằng số PARTNER |
| `LoginService` | `auth/services/login.service.ts:91-112` | **Điểm sửa** — switch theo `accountStatus`, cần thêm nhánh kiểm tra `account_expires_at` trước khi rơi vào case `active` |
| `RefreshTokenService` | `auth/services/refresh-token.service.ts:70` | **Điểm sửa** — hiện chỉ check `accountStatus !== 'active'`, cần thêm điều kiện `account_expires_at` |
| `BiometricEnforcementGuard` | `auth/guards/biometric-enforcement.guard.ts` | **KHÔNG sửa** — tài khoản đối tác thoả mãn guard bằng dữ liệu (FR-PTA-006), không bằng exempt list mới |
| `MustChangePasswordGuard` | `auth/guards/must-change-password.guard.ts` | **KHÔNG sửa** — thoả mãn bằng `must_change_password = false` đặt sẵn |
| `isBiometricExemptRole()` | `common/utils/biometric-exempt-roles.util.ts` | Pattern mẫu cho 1 hàm hằng số dùng chung — tham khảo cho `isPartnerAccount()` mới |
| `BiometricSubmissionService` | `accounts/services/biometric-submission.service.ts` | Pattern mẫu cho luồng validate/lưu ảnh (`CloudinaryService`, `detectImageMimeType`, `generateFaceProfileCode`) — **tái dùng utility, không copy logic pending_review** |
| `FaceProfileEntity` | `accounts/entities/face-profile.entity.ts` | `status: FaceProfileStatus.ACTIVE` — ghi thẳng, không qua `PENDING_REVIEW` |
| `AdminBiometricReviewController` | `accounts/controllers/admin-biometric-review.controller.ts` | KHÔNG dùng cho luồng này (tài khoản đối tác không đi qua hàng chờ duyệt) |
| `RequireRoles` / `RequirePermissions` decorator | `auth/decorators/require-roles.decorator.ts`, `auth/decorators/require-permissions.decorator.ts` | **Pattern mẫu bắt buộc theo** cho decorator mới `@AllowPartnerAccount()` (`SetMetadata` + `Reflector`) |
| `DepartmentEntity` | `accounts/entities/department.entity.ts` | Seed 1 row cố định UUID, đánh dấu "Đối tác" |
| `DepartmentsController` / `DepartmentsService` | `accounts/controllers/departments.controller.ts`, `accounts/services/departments.service.ts` | **Điểm sửa** — chặn sửa/xoá mềm row department cố định ở tầng service |
| `MeetingsController.addInternalParticipant` | `meetings/controllers/meetings.controller.ts:420` | **Tái dùng nguyên trạng, không sửa** — mời đối tác vào meeting dùng `userId` như user thường |
| `guest-access` module | `spec/features/guest-access/feat-external-guest-live-meeting-access/` | Feature độc lập, không phụ thuộc, không sửa — xem `spec.md` mục "Quan hệ với feature khác" |
| Migration mẫu | `20260807000003-SeedGuestAccessPermissions.ts` | Copy pattern seed permission mới |
| `env.validation.ts` | `config/env.validation.ts` | Không cần biến môi trường mới cho feature này (khác `GLA-001`) |

### 2.3 Patterns to Follow

- Controller trả `{ success, message, data }` theo convention chuẩn toàn dự án.
- Decorator opt-in + `Reflector` cho phân quyền theo endpoint — mirror `@RequireRoles`/`@RequirePermissions`, KHÔNG dùng bảng path-prefix string (đã cân nhắc và loại bỏ, xem `research.md` mục 4).
- 1 hàm dùng chung `isPartnerAccount(user)` — mirror `isBiometricExemptRole()` — tránh lặp điều kiện `department_id === PARTNER_DEPARTMENT_ID` rải rác.
- Seed dữ liệu tham chiếu bằng UUID cố định trong migration (không để `uuid_generate_v4()` sinh ngẫu nhiên) — cần thiết vì code sẽ hard-code hằng số UUID này.
- Ghi `audit_logs` cho hành động tạo/gia hạn/khoá sớm tài khoản đối tác — mirror convention audit toàn dự án.

## 3. Scope Confirmation

### 3.1 In Scope

- Migration: thêm cột `users.account_expires_at`, seed department "Đối tác" (UUID cố định), seed permission quản trị mới.
- `common/utils/partner-account.util.ts`: hằng số `PARTNER_DEPARTMENT_ID` + hàm `isPartnerAccount()`.
- Sửa `UsersService.persistAccount()` (hoặc method tương đương) — nhánh tạo tài khoản đối tác: mật khẩu = hash(email), `mustChangePassword = false`, ảnh bắt buộc → tạo `face_profiles.status = ACTIVE`.
- Sửa `LoginService`, `RefreshTokenService` — check `account_expires_at`.
- Bảo vệ row department cố định khỏi sửa/xoá ở `DepartmentsService`.
- Decorator `@AllowPartnerAccount()` + `PartnerAccountRestrictionGuard` (guard mới, `APP_GUARD`).
- Gắn decorator lên tập endpoint tối thiểu cần thiết cho đối tác (ví dụ đọc live-meeting được mời) — danh sách cụ thể chốt khi implement, xem mục 5.1.
- Endpoint quản trị: tạo/gia hạn/khoá sớm tài khoản đối tác (tái dùng/DTO mở rộng từ endpoint tạo user hiện có nếu khả thi).
- Unit test cho toàn bộ logic mới + regression test cho `persistAccount()`, `LoginService`, `RefreshTokenService`, `DepartmentsService`.

### 3.2 Out of Scope

Xem `spec.md` mục 8. Nhắc lại các điểm quan trọng nhất: KHÔNG role mới, KHÔNG bảng mới, KHÔNG sửa `BiometricEnforcementGuard`/`MustChangePasswordGuard`, KHÔNG lọc participant-picker (HOÃN).

### 3.3 Constitution Gate Check

| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — mật khẩu (dù = email) luôn hash bcrypt trước khi lưu, không log |
| SEC-02 (auth bắt buộc cho mutating endpoint) | PASS — toàn bộ endpoint quản trị tài khoản đối tác yêu cầu `JwtAuthGuard` + `PermissionsGuard` như user thường; không có endpoint public mới nào (khác `GLA-001`) |
| SEC-03 (input validation) | PASS — DTO validate ảnh bắt buộc (magic-bytes, kích thước), `account_expires_at` phải là thời điểm tương lai tại lúc tạo |
| DATA-01 (soft-delete cho business-critical entity) | Không áp dụng trực tiếp — không tạo entity/bảng mới; tài khoản đối tác dùng lại `users`/`departments` hiện có, cơ chế xoá mềm hiện có (`deleted_at`) áp dụng nguyên trạng nếu admin xoá tài khoản (ngoài scope, xem OOS-008) |
| ARCH-01 (service boundary) | PASS — chỉ sửa method trong đúng module `accounts`/`auth` sở hữu, tái dùng entity qua injection |
| ARCH-02 (async cho >2s) | PASS — không thêm luồng gửi mail đồng bộ mới ngoài convention hiện có của `persistAccount()` (đã có sẵn cơ chế enqueue welcome email) |
| ARCH-03 (idempotency) | PASS — gia hạn `account_expires_at` là thao tác ghi đè giá trị (tự nhiên idempotent) |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — endpoint mới/sửa có `@ApiOperation`/`@ApiResponse` |
| ENG-03 (error không lộ stack trace) | PASS — lỗi map sang mã lỗi chuẩn hoá |

### 3.4 Complexity Tracking

Độ phức tạp trung bình — thấp hơn `GLA-001` (không tạo hệ xác thực song song, không sửa `EventsGateway`), nhưng có 2 điểm rủi ro cần review kỹ:
1. **Sửa `LoginService`/`RefreshTokenService`** — 2 method lõi ảnh hưởng TOÀN BỘ user trong hệ thống, không riêng đối tác. Sai 1 điều kiện là khoá nhầm user thường (những user có `account_expires_at = NULL` phải luôn qua được nhánh mới mà không bị ảnh hưởng).
2. **`PartnerAccountRestrictionGuard` là guard toàn cục mới** — cần đảm bảo user thường (không phải đối tác) hoàn toàn không bị guard này chạm tới (early-return ngay khi `!isPartnerAccount()`).

Khuyến nghị review riêng 2 điểm này trước khi merge, tương tự cách `GLA-001` yêu cầu review kỹ `EventsGateway`.

## 4. Data Model Impact

Tóm tắt: **0 bảng mới, +1 cột (`users.account_expires_at`), +1 row seed (`departments`)**.

### 4.1 Migration 1: thêm cột

```
src/database/migrations/<timestamp>-AddAccountExpiresAtToUsers.ts
```
`ALTER TABLE users ADD COLUMN account_expires_at timestamptz NULL;` + cập nhật `UserEntity`.

### 4.2 Migration 2: seed department "Đối tác"

```
src/database/migrations/<timestamp>-SeedPartnerDepartment.ts
```
`INSERT INTO departments (id, department_code, department_name, is_active) VALUES ('<uuid-cố-định-hardcode>', 'PARTNER', 'Đối tác', true) ON CONFLICT (id) DO NOTHING;` — UUID phải hard-code trong migration VÀ trong `common/utils/partner-account.util.ts` (cùng 1 hằng số, không suy luận ngược từ `department_code`).

### 4.3 Migration 3: seed permission quản trị

```
src/database/migrations/<timestamp>-SeedPartnerAccountManagePermission.ts
```
Copy pattern `20260807000003-SeedGuestAccessPermissions.ts`: seed `account.partner.manage` (module_code=`accounts`), gán role mặc định `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (KHÔNG gán `EMPLOYEE` — tránh đối tác/nhân viên thường tự tạo được tài khoản đối tác khác).

### 4.4 Điểm cần xác nhận TRƯỚC khi code

- `departments` có cột nào hỗ trợ đánh dấu "protected/system row" không? Nếu không có, bảo vệ hoàn toàn ở tầng service (`DepartmentsService.update()/remove()` so `id === PARTNER_DEPARTMENT_ID` rồi từ chối) — không cần migration schema thêm cho việc này.
- `PATCH /users/:id` (endpoint update user hiện có) có đang mở field `accountExpiresAt` cho request body chưa? Nếu chưa, cần mở rộng DTO tương ứng (không phải bảng mới, chỉ field mới trong DTO).

## 5. API / Contract Plan

### 5.1 Endpoint bị/được đánh dấu `@AllowPartnerAccount()`

Danh sách khởi điểm (rà soát và bổ sung khi implement, theo nguyên tắc "chỉ mở khi thật sự cần"):

- `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/change-password` — nhóm auth cơ bản, đối tác vẫn cần dùng được (đổi mật khẩu là **tuỳ chọn**, không bắt buộc, nhưng endpoint không bị khoá).
- `GET /api/v1/live-meetings/:meetingId` (và các endpoint đọc nội dung cuộc họp liên quan) — đối tác cần xem được cuộc họp mình được mời. **Lưu ý bắt buộc**: các endpoint này phải tự kiểm tra actor có phải participant của đúng `meetingId` hay không (mục 1.6 spec.md) — decorator chỉ mở "cửa module", không thay cho kiểm tra phạm vi dữ liệu.
- Endpoint đọc agenda/notes đã publish liên quan tới cuộc họp được mời — chốt danh sách cụ thể khi implement, dựa trên kết quả audit ở mục 1.6.

### 5.2 Endpoint quản trị tài khoản đối tác (phía Admin/Host)

Đề xuất tái dùng/mở rộng endpoint user hiện có thay vì tạo route hoàn toàn mới:

- Tạo: mở rộng `POST /api/v1/users` (hoặc endpoint tạo tài khoản hiện có) với field `accountType: 'partner'` (hoặc tương đương) kích hoạt nhánh xử lý mới trong `persistAccount()`, kèm `accountExpiresAt`, `avatarFile` (ảnh bắt buộc khi `accountType = 'partner'`).
- Gia hạn/khoá sớm: mở rộng `PATCH /api/v1/users/:id` với field `accountExpiresAt`.
- Không tạo endpoint mời participant riêng — dùng nguyên `addInternalParticipant` (FR-PTA-008).

### 5.3 Error Responses

Theo `spec.md` mục 6: `AUTH_ACCOUNT_EXPIRED`, `PARTNER_ACCOUNT_RESTRICTED`, lỗi validation thiếu ảnh, lỗi từ chối sửa/xoá department cố định.

## 6. Authorization Plan

### 6.1 `PartnerAccountRestrictionGuard`

```
1. Đọc request.user (đã có từ JwtAuthGuard) — nếu chưa có, return true (bỏ qua, để guard khác xử lý)
2. isPartnerAccount(request.user.userId) — query department_id, so với PARTNER_DEPARTMENT_ID hằng số
   FALSE → return true ngay (user thường, guard này không liên quan)
3. TRUE → đọc metadata qua Reflector.getAllAndOverride('allowPartnerAccount', [handler, class])
   Không có / false → throw ForbiddenException PARTNER_ACCOUNT_RESTRICTED
   Có → return true (điều hướng tiếp cho controller/service tự kiểm tra phạm vi dữ liệu, mục 5.1)
```

### 6.2 Endpoint quản trị tài khoản đối tác

```
1. JwtAuthGuard (xác thực nhân viên)
2. PermissionsGuard + @RequirePermissions('account.partner.manage')
3. (Tài khoản đối tác không bao giờ có permission này — FR-PTA-017 — nên tự động bị chặn ở bước 2, không cần thêm check ownership)
```

## 7. Business Logic Plan

### 7.1 Flow — Tạo tài khoản đối tác

```text
1. Validate DTO: field cơ bản + accountExpiresAt (phải > now) + avatarFile (bắt buộc, magic-bytes hợp lệ)
2. Trong transaction hiện có của persistAccount() (hoặc nhánh mới tương đương):
   a. passwordHash = bcrypt.hash(email, salt)   // KHÔNG generateTemporaryPassword
   b. insert users: departmentId = PARTNER_DEPARTMENT_ID, accountExpiresAt = dto.accountExpiresAt,
      mustChangePassword = false, accountStatus = 'active'
   c. insert user_roles: role = EMPLOYEE (như luồng thường)
   d. insert face_profiles: status = ACTIVE, enrolledBy = creatorId, enrolledAt = now,
      primaryImageFileId = <sau khi upload ảnh qua CloudinaryService/detectImageMimeType>
   e. insert audit_logs: action = account.partner.create
3. Commit transaction
4. Gửi email cho đối tác (bất đồng bộ, mirror welcome-email hiện có): email đăng nhập + hạn dùng,
   KHÔNG gửi giá trị mật khẩu (đối tác tự biết mật khẩu = email của họ)
```

### 7.2 Flow — Đăng nhập tài khoản đối tác (và mọi user khác — điểm sửa dùng chung)

```text
Trong LoginService, SAU bước so bcrypt.compare() thành công, TRƯỚC switch(accountStatus):
1. IF user.accountExpiresAt IS NOT NULL AND user.accountExpiresAt < now():
     THROW 403 AUTH_ACCOUNT_EXPIRED
   (user thường có accountExpiresAt = NULL → luôn bỏ qua nhánh này, không ảnh hưởng)
2. Tiếp tục switch(accountStatus) như hiện tại, không đổi
```

### 7.3 Flow — Refresh token (điểm sửa dùng chung)

```text
Trong RefreshTokenService, cùng chỗ đang check accountStatus !== 'active':
1. Thêm điều kiện: HOẶC (user.accountExpiresAt IS NOT NULL AND user.accountExpiresAt < now())
   → cùng nhánh reject hiện có (401/403 tuỳ convention hiện tại của method)
```

### 7.4 Flow — Gia hạn / khoá sớm

```text
1. Ownership/permission check (account.partner.manage)
2. UPDATE users SET account_expires_at = :newValue WHERE id = :id AND department_id = PARTNER_DEPARTMENT_ID
   (ràng buộc department_id trong WHERE — chặn admin lỡ tay set accountExpiresAt cho user thường qua endpoint này)
3. audit_logs: action = account.partner.extend | account.partner.lock_early
```

### 7.5 Flow — Bảo vệ department cố định

```text
Trong DepartmentsService.update()/remove():
1. IF id === PARTNER_DEPARTMENT_ID:
     THROW lỗi nghiệp vụ (từ chối thao tác) — bất kể actor là ai, kể cả SYSTEM_ADMIN
```

## 8. Validation Plan

| Field | Validation |
|---|---|
| `avatarFile` (tạo tài khoản đối tác) | Bắt buộc khi `accountType = 'partner'`; magic-bytes hợp lệ (tái dùng `detectImageMimeType`), giới hạn kích thước như luồng self-submit hiện có |
| `accountExpiresAt` | Bắt buộc khi `accountType = 'partner'`; phải là thời điểm tương lai tại lúc submit |
| `email` | Giữ nguyên validation hiện có của luồng tạo user (unique, format email) |

## 9. Error Handling Plan

| Điều kiện | Exception | HTTP | Code |
|---|---|---|---|
| Tạo tài khoản đối tác thiếu ảnh | `BadRequestException` | 400 | validation error (field `avatarFile`) |
| Đăng nhập/refresh khi `account_expires_at` đã qua | `ForbiddenException` | 403 | `AUTH_ACCOUNT_EXPIRED` |
| Tài khoản đối tác gọi endpoint không có `@AllowPartnerAccount()` | `ForbiddenException` | 403 | `PARTNER_ACCOUNT_RESTRICTED` |
| Sửa/xoá department cố định | `ForbiddenException`/`BadRequestException` (chốt khi implement) | 400/403 | mã lỗi cụ thể chốt khi implement |
| Actor không có `account.partner.manage` | `ForbiddenException` | 403 | permission error chuẩn hiện có |

## 10. Testing Strategy

### 10.1 Unit Tests — Logic mới

`isPartnerAccount()`: true/false đúng theo `department_id`. Luồng tạo tài khoản đối tác: mật khẩu = hash(email) (không phải random), `mustChangePassword = false`, `face_profiles.status = ACTIVE` được tạo, thiếu ảnh → reject không tạo `users`. Gia hạn: cập nhật đúng field, có ràng buộc `department_id` trong WHERE.

### 10.2 Unit Tests — `LoginService`/`RefreshTokenService` (bắt buộc regression)

User thường (`account_expires_at = NULL`) đăng nhập/refresh bình thường, KHÔNG bị ảnh hưởng bởi nhánh mới. Tài khoản đối tác hết hạn → `403 AUTH_ACCOUNT_EXPIRED` ở cả login và refresh. Tài khoản đối tác chưa hết hạn → đăng nhập bình thường.

### 10.3 Unit Tests — `PartnerAccountRestrictionGuard`

User thường gọi bất kỳ endpoint nào → guard luôn `return true` ngay từ bước 2 (không đọc Reflector). Tài khoản đối tác gọi endpoint có decorator → pass. Tài khoản đối tác gọi endpoint không có decorator → `403 PARTNER_ACCOUNT_RESTRICTED`.

### 10.4 Unit Tests — `DepartmentsService`

Cố sửa/xoá department cố định (kể cả bằng `SYSTEM_ADMIN`) → bị từ chối. Sửa department khác → không bị ảnh hưởng.

### 10.5 Regression Tests

`persistAccount()` cho luồng tạo user thường (không phải đối tác) — xác nhận hành vi hiện có (mật khẩu random, `mustChangePassword = true`) không đổi.

## 11. Implementation Phases

| Phase | Nội dung | Output |
|---|---|---|
| 1 | Nền móng: 3 migration (cột + 2 seed), `isPartnerAccount()` util, decorator `@AllowPartnerAccount()` | Không route nào hoạt động, không đụng code hiện có |
| 2 | Luồng tạo tài khoản đối tác: mở rộng `persistAccount()`, tích hợp upload ảnh → `face_profiles.status=ACTIVE`, email thông báo | Tạo được tài khoản đối tác qua API |
| 3 | Enforcement: sửa `LoginService`/`RefreshTokenService`, `PartnerAccountRestrictionGuard`, gắn decorator lên tập endpoint tối thiểu, bảo vệ `DepartmentsService` | Tài khoản đối tác đăng nhập/hết hạn/giới hạn phạm vi đúng như spec |
| 4 | Endpoint quản trị (gia hạn/khoá sớm) + audit log + hoàn thiện test | Sẵn sàng cho Admin/Host vận hành trọn vòng đời tài khoản đối tác |

## 12. Risks & Mitigations

- **Risk**: Sửa `LoginService`/`RefreshTokenService` (2 method lõi dùng cho MỌI user) làm hỏng đăng nhập của nhân viên thường.
  **Mitigation**: Điều kiện mới luôn bắt đầu bằng `IF account_expires_at IS NOT NULL` — user thường luôn có giá trị này là `NULL`, tự động bỏ qua nhánh mới. Bắt buộc có regression test (mục 10.2) chạy trước khi merge.

- **Risk**: `PartnerAccountRestrictionGuard` (guard toàn cục mới) vô tình ảnh hưởng user thường nếu `isPartnerAccount()` sai logic.
  **Mitigation**: Guard `return true` ngay ở bước 2 nếu không phải đối tác — không đọc `Reflector`, không có đường nào chặn nhầm user thường. Unit test bắt buộc cho đúng nhánh early-return này.

- **Risk**: Quên gắn `@AllowPartnerAccount()` lên endpoint đối tác thật sự cần, làm đối tác không dùng được tính năng cơ bản.
  **Mitigation**: `NFR-PTA-008` (ghi log mỗi lần guard từ chối) giúp phát hiện sớm trong giai đoạn UAT; danh sách endpoint khởi điểm (mục 5.1) rà soát cùng team trước khi release.

- **Risk**: Endpoint `live-meeting` hiện tại có thể không lọc theo `meeting_participants` mà chỉ theo role — nếu vậy, đối tác đọc được cuộc họp không được mời.
  **Mitigation**: Audit riêng (mục 1.6 spec.md) BẮT BUỘC hoàn thành trước khi bật `@AllowPartnerAccount()` cho các endpoint đó — ghi rõ là điều kiện tiền đề của Phase 3, không phải giả định mặc định đúng.

- **Risk**: Admin lỡ tay sửa/xoá department "Đối tác" qua endpoint quản lý department chung, phá vỡ toàn bộ cơ chế gating (fail-open âm thầm).
  **Mitigation**: Chặn cứng ở tầng service (mục 7.5), không phụ thuộc UI/FE ẩn nút.

## 13. Acceptance Criteria Traceability

Xem `spec.md` mục 7.4.

## 14. File Structure Changes

### New files

```
src/common/utils/partner-account.util.ts        (PARTNER_DEPARTMENT_ID hằng số + isPartnerAccount())
src/common/decorators/allow-partner-account.decorator.ts
src/modules/auth/guards/partner-account-restriction.guard.ts

src/database/migrations/
  <timestamp>-AddAccountExpiresAtToUsers.ts
  <timestamp>-SeedPartnerDepartment.ts
  <timestamp>-SeedPartnerAccountManagePermission.ts
```

### Modified files

```
src/modules/accounts/entities/user.entity.ts               (+ accountExpiresAt)
src/modules/accounts/services/users.service.ts              (persistAccount(): nhánh tạo tài khoản đối tác)
src/modules/accounts/services/departments.service.ts        (chặn sửa/xoá department cố định)
src/modules/accounts/dto/create-user.dto.ts (hoặc tương đương) (+ accountType, accountExpiresAt, avatarFile)
src/modules/auth/services/login.service.ts                  (check account_expires_at)
src/modules/auth/services/refresh-token.service.ts           (check account_expires_at)
src/app.module.ts                                            (đăng ký PartnerAccountRestrictionGuard làm APP_GUARD)
src/modules/live-meeting/controllers/live-meeting.controller.ts (gắn @AllowPartnerAccount() theo mục 5.1, sau khi audit 1.6 xong)
```

### No change

- Database schema hiện có ngoài 1 cột mới + 1 row seed (không CREATE TABLE, không đổi cột khác).
- `BiometricEnforcementGuard`, `MustChangePasswordGuard` (không sửa — FR-PTA-015, FR-PTA-016).
- Module `guest-access` (`GLA-001`) — hoàn toàn độc lập.
- `MeetingsController.addInternalParticipant` — tái dùng nguyên trạng.

## Artifacts Produced
`spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `tasks.md`.
