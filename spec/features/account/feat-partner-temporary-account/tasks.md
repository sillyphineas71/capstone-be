# Task List: Partner Temporary Account (PTA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo tasks cho feat-partner-temporary-account — **chưa implement, chờ Product Owner duyệt spec/plan trước** (cùng quy trình đã áp dụng cho `GLA-001`). | Toàn bộ file |

**Input**: Design documents từ `spec/features/account/feat-partner-temporary-account/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`
**Tests**: Unit test bắt buộc theo `plan.md` mục 10
**Organization**: 4 phase theo đúng thứ tự phụ thuộc đã xác định ở `plan.md` mục 11 (Nền móng → Tạo tài khoản → Enforcement → Quản trị vòng đời)

---

## ⏸ Trạng thái: CHƯA IMPLEMENT — chờ duyệt spec/plan

Không code bất kỳ dòng nào cho tới khi Product Owner duyệt `spec.md`/`plan.md` của feature này.

## Checklist

### Phase 0: Tiền đề bắt buộc trước Phase 3 (audit, không phải code feature)

- [ ] T000 Audit các endpoint đọc `live-meeting`/agenda dự kiến gắn `@AllowPartnerAccount()` (danh sách khởi điểm ở `plan.md` mục 5.1) — xác nhận từng endpoint có lọc quyền xem theo `meeting_participants` của đúng `meetingId`, KHÔNG chỉ theo role chung. Nếu phát hiện endpoint không lọc đúng, báo cáo riêng TRƯỚC khi gắn decorator cho endpoint đó (xem `spec.md` mục 1.6, `plan.md` mục 12 rủi ro cuối)

### Phase 1: Nền móng (không đụng route đang chạy)

- [ ] T001 [P] Migration `src/database/migrations/<timestamp>-AddAccountExpiresAtToUsers.ts` — `ALTER TABLE users ADD COLUMN account_expires_at timestamptz NULL`, cập nhật `UserEntity` (`accounts/entities/user.entity.ts`)
- [ ] T002 [P] Migration `src/database/migrations/<timestamp>-SeedPartnerDepartment.ts` — seed 1 row `departments` với UUID cố định hard-code, `department_code = 'PARTNER'`, `department_name = 'Đối tác'`
- [ ] T003 [P] Migration `src/database/migrations/<timestamp>-SeedPartnerAccountManagePermission.ts` — copy pattern `20260807000003-SeedGuestAccessPermissions.ts`, seed permission `account.partner.manage` (module_code=`accounts`), gán role `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (KHÔNG gán `EMPLOYEE`)
- [ ] T004 Tạo `src/common/utils/partner-account.util.ts` — hằng số `PARTNER_DEPARTMENT_ID` (khớp UUID ở T002) + hàm `isPartnerAccount(departmentId)` / `isPartnerAccountByUserId(userId)`, mirror pattern `isBiometricExemptRole()`
- [ ] T005 [P] Tạo `src/common/decorators/allow-partner-account.decorator.ts` — `SetMetadata` + export `ALLOW_PARTNER_ACCOUNT_KEY`, mirror `require-roles.decorator.ts`
- [ ] T006 Tạo `src/modules/auth/guards/partner-account-restriction.guard.ts` — theo `plan.md` mục 6.1 (early-return nếu không phải đối tác; đọc `Reflector` nếu là đối tác; throw `403 PARTNER_ACCOUNT_RESTRICTED` nếu không có decorator)
- [ ] T007 Đăng ký `PartnerAccountRestrictionGuard` làm `APP_GUARD` trong `src/app.module.ts`, đặt SAU `JwtAuthGuard` trong thứ tự guard
- [ ] T008 [P] Unit test T004 (`isPartnerAccount`: true/false đúng theo `department_id`, không match nhầm department khác)
- [ ] T009 [P] Unit test T006 (guard: user thường → `return true` ngay bước 2, KHÔNG đọc Reflector; đối tác + có decorator → pass; đối tác + không có decorator → `403 PARTNER_ACCOUNT_RESTRICTED`)

**Checkpoint**: Cột DB, department seed, permission seed, util, decorator, guard đã sẵn sàng — chưa route nào dùng tới, không ảnh hưởng hệ thống hiện có.

---

### Phase 2: Luồng tạo tài khoản đối tác

- [ ] T010 Audit `src/modules/accounts/dto/create-user.dto.ts` (hoặc DTO tương đương của endpoint tạo user hiện có) — xác nhận cấu trúc hiện tại, thiết kế field mở rộng: `accountType` (`'employee' | 'partner'`, mặc định `'employee'`), `accountExpiresAt` (bắt buộc khi `accountType='partner'`), `avatarFile` (bắt buộc khi `accountType='partner'`)
- [ ] T011 Cập nhật DTO theo T010 với validation: `accountExpiresAt` phải là thời điểm tương lai; `avatarFile` bắt buộc kèm magic-bytes hợp lệ khi `accountType='partner'` (tái dùng `detectImageMimeType` từ `accounts/utils/image-magic-bytes.util.ts`)
- [ ] T012 Sửa `src/modules/accounts/services/users.service.ts` (`persistAccount()` hoặc method tương đương) — thêm nhánh `accountType='partner'`: `passwordHash = bcrypt.hash(email, salt)` (thay `generateTemporaryPassword`), `departmentId = PARTNER_DEPARTMENT_ID` (ghi đè input nếu có, đảm bảo luôn đúng hằng số), `mustChangePassword = false`, `accountExpiresAt = dto.accountExpiresAt`
- [ ] T013 Trong CÙNG transaction của T012 — insert `face_profiles`: `status = FaceProfileStatus.ACTIVE`, `enrolledBy = creatorId`, `enrolledAt = now()`, `primaryImageFileId` từ ảnh đã upload (tái dùng `CloudinaryService` + `generateFaceProfileCode` từ `BiometricSubmissionService`, KHÔNG copy logic `pending_review`)
- [ ] T014 Insert `audit_logs` với `action = 'account.partner.create'` trong T012
- [ ] T015 Sửa luồng gửi email chào mừng hiện có (nhánh cho `accountType='partner'`) — nội dung: email đăng nhập + hạn dùng tài khoản + ghi chú "mật khẩu chính là email này", KHÔNG gửi bất kỳ chuỗi mật khẩu nào
- [ ] T016 [P] Unit test T012 (nhánh đối tác: `password_hash` khớp `bcrypt.compare(email, hash)`, `mustChangePassword=false`, `departmentId` đúng hằng số bất kể input DTO gửi gì khác)
- [ ] T017 [P] Unit test T013 (tạo đúng `face_profiles.status='active'`, KHÔNG tạo row `pending_review` nào — không ảnh hưởng `ux_face_profiles_user_pending`)
- [ ] T018 [P] Unit test thiếu `avatarFile` khi `accountType='partner'` → reject, KHÔNG có `users` nào được tạo (kiểm tra rollback/transaction)
- [ ] T019 Regression test `persistAccount()` cho `accountType='employee'` (mặc định/không đổi) — xác nhận mật khẩu vẫn random, `mustChangePassword` vẫn `true`, hành vi hiện có không đổi

**Checkpoint**: Tạo được tài khoản đối tác qua API, thoả mãn `BiometricEnforcementGuard`/`MustChangePasswordGuard` mà KHÔNG sửa 2 guard đó.

---

### Phase 3: Enforcement — hết hạn + giới hạn phạm vi + bảo vệ department

- [ ] T020 Sửa `src/modules/auth/services/login.service.ts` — thêm check `account_expires_at` theo `plan.md` mục 7.2 (SAU bcrypt.compare, TRƯỚC switch accountStatus); throw `403 AUTH_ACCOUNT_EXPIRED` khi hết hạn
- [ ] T021 Sửa `src/modules/auth/services/refresh-token.service.ts` — thêm điều kiện `account_expires_at` vào check hiện có ở dòng ~70 theo `plan.md` mục 7.3
- [ ] T022 [P] Unit test T020 (user thường `account_expires_at=NULL` → không ảnh hưởng, hành vi login hiện có giữ nguyên; đối tác chưa hết hạn → login bình thường; đối tác đã hết hạn → `403 AUTH_ACCOUNT_EXPIRED`)
- [ ] T023 [P] Unit test T021 (cùng 3 case như T022 nhưng cho refresh-token)
- [ ] T024 Sửa `src/modules/accounts/services/departments.service.ts` (`update()`/`remove()`) — chặn thao tác nếu `id === PARTNER_DEPARTMENT_ID`, bất kể actor
- [ ] T025 [P] Unit test T024 (cố sửa/xoá department cố định bằng `SYSTEM_ADMIN` → bị từ chối; sửa department khác → không ảnh hưởng)
- [ ] T026 Rà soát T000 (Phase 0) đã xong, gắn `@AllowPartnerAccount()` lên danh sách endpoint tối thiểu đã audit: nhóm `auth` cơ bản (`/auth/me`, `/auth/logout`, `/auth/refresh`, `/auth/change-password`), endpoint đọc live-meeting đã xác nhận lọc đúng theo `meeting_participants`
- [ ] T027 [P] Unit test T026 (gọi từng endpoint đã gắn decorator bằng token đối tác → pass; gọi 1 endpoint CHƯA gắn, ví dụ `POST /meetings` → `403 PARTNER_ACCOUNT_RESTRICTED`)

**Checkpoint**: Tài khoản đối tác đăng nhập/hết hạn/giới hạn phạm vi đúng spec; user thường không bị ảnh hưởng ở bất kỳ điểm sửa nào.

---

### Phase 4: Quản trị vòng đời (gia hạn/khoá sớm) + hoàn thiện

- [ ] T028 Mở rộng `PATCH /api/v1/users/:id` (hoặc endpoint update user hiện có) — field `accountExpiresAt`, validate ràng buộc `department_id = PARTNER_DEPARTMENT_ID` trong điều kiện update (không cho set field này cho user thường qua cùng endpoint)
- [ ] T029 Thêm `@RequirePermissions('account.partner.manage')` cho endpoint T028 khi field `accountExpiresAt` được gửi
- [ ] T030 Insert `audit_logs` (`action = 'account.partner.extend'` hoặc `'account.partner.lock_early'` tuỳ hướng thay đổi) trong luồng T028
- [ ] T031 [P] Unit test T028-T030 (gia hạn thành công cho tài khoản đối tác; set `accountExpiresAt` cho user thường qua cùng endpoint → bị từ chối do ràng buộc `department_id`; actor không có `account.partner.manage` → 403)
- [ ] T032 [P] Chạy toàn bộ `quickstart.md` (S1-S10 + edge scenarios) dưới dạng integration test hoặc kịch bản thủ công
- [ ] T033 `npm run lint`, `npm run build`, `npm run test` toàn repo — xác nhận không có regression ngoài phạm vi feature

**Checkpoint**: Admin/Host vận hành được trọn vòng đời tài khoản đối tác (tạo → mời participant qua API có sẵn → gia hạn/khoá sớm → hết hạn tự nhiên).

---

## Dependencies and Execution Order

### Phase Dependencies
Phase 0 (Audit): độc lập, nên làm sớm nhất — kết quả ảnh hưởng phạm vi T026.
Phase 1 (Nền móng): không phụ thuộc Phase 0, có thể làm song song.
Phase 2 (Tạo tài khoản): phụ thuộc Phase 1 (cần `PARTNER_DEPARTMENT_ID`, `isPartnerAccount()`).
Phase 3 (Enforcement): phụ thuộc Phase 1 VÀ Phase 0 (T026 cần kết quả T000).
Phase 4 (Quản trị vòng đời): phụ thuộc Phase 2 VÀ Phase 3.

### Task Dependencies
- T004 phụ thuộc T002 (cần UUID cố định đã seed để hard-code hằng số khớp nhau).
- T006 phụ thuộc T004, T005.
- T007 phụ thuộc T006.
- T012 phụ thuộc T004, T011.
- T013 phụ thuộc T012.
- T020, T021 phụ thuộc T001 (cột `account_expires_at` phải tồn tại trên entity).
- T026 phụ thuộc T000, T007.
- T028 phụ thuộc T001, T004.

### Parallel Opportunities

| Task | Có thể chạy song song với |
|---|---|
| T001, T002, T003 | Độc lập, khác file migration |
| T008, T009 | Test độc lập theo từng unit |
| T016, T017, T018 | Test độc lập |
| T022, T023 | Test độc lập (login vs refresh) |

### Rủi ro cần verify sớm nhất

T020/T021 (sửa `LoginService`/`RefreshTokenService`, ảnh hưởng MỌI user) là cụm rủi ro cao nhất — bắt buộc viết test T022/T023 NGAY sau khi code xong, với trọng tâm xác nhận nhánh user thường (`account_expires_at=NULL`) không bị chạm tới, trước khi coi Phase 3 hoàn tất. T000 (audit) là rủi ro thứ hai — không được bỏ qua trước khi thực hiện T026.

---

## Requirements Coverage

| Task ID | FR liên quan |
|---|---|
| T001-T009 | FR-PTA-001, FR-PTA-002, FR-PTA-013, FR-PTA-014, FR-PTA-025 |
| T010-T019 | FR-PTA-003, FR-PTA-004, FR-PTA-005, FR-PTA-006, FR-PTA-007, FR-PTA-015, FR-PTA-016, FR-PTA-019 |
| T020-T023 | FR-PTA-010, FR-PTA-011, FR-PTA-022, FR-PTA-027 |
| T024, T025 | FR-PTA-020 |
| T026, T027 | FR-PTA-012, FR-PTA-021 |
| T028-T031 | FR-PTA-009, FR-PTA-017, FR-PTA-018, FR-PTA-023, FR-PTA-026 |
| T032, T033 | Toàn bộ AC (spec.md mục 7) |

## Implementation Strategy

1. **Không code bất kỳ dòng nào cho tới khi Product Owner duyệt `spec.md`/`plan.md`** — đúng yêu cầu đã đặt ra cho phiên làm việc này.
2. Sau khi duyệt: Phase 0 (audit) song song Phase 1 → Phase 2 → Phase 3 → Phase 4, theo đúng thứ tự phụ thuộc ở trên.
3. Viết test song song với từng phần ngay khi xong (không dồn hết về cuối) — mirror bài học đã áp dụng ở `GLA-001`.
4. T020/T021 (sửa method lõi dùng cho mọi user) là 2 task cần review riêng (2 người) trước khi merge, vì đụng vào luồng đăng nhập dùng chung cho toàn hệ thống.
