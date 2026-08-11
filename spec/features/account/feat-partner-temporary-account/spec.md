# Feature Specification: Tài khoản Đối tác Tạm thời (Partner Temporary Account)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo spec, chuyển thể từ `KE_HOACH_TAI_KHOAN_DOI_TAC_TAM_THOI_2026-08-11.md` (thư mục gốc repo) — tài liệu đó đã ghi lại toàn bộ quá trình Q&A trực tiếp với Product Owner (Thiếu Chủ) qua hội thoại, gồm 3 lần chốt/đổi quyết định. Spec này diễn giải các quyết định đã chốt thành EARS requirements. | Toàn bộ file |

> Nguồn gốc: **Không có UC gốc trong Feature Table.** Product Owner nêu trực tiếp: muốn đưa khách ngoài công ty (đối tác/khách quen cần vào hệ thống lặp lại nhiều ngày) vào làm user thật thay vì coi là ngoài hệ thống — nhưng không muốn thêm role mới, dùng `department` để đánh dấu. Tạm đặt mã **PTA-001 (mới)**, chờ Product Owner gán số chính thức trong Feature Table — theo đúng tiền lệ đã áp dụng ở `feat-share-meeting-minutes` và `GLA-001`.
>
> **Quan hệ với feature khác — KHÔNG thay thế, chạy song song:** Dự án đã có sẵn `GLA-001` (`spec/features/guest-access/feat-external-guest-live-meeting-access/`) — khách vãng lai mời 1 lần/1 cuộc họp, xác thực bằng magic link + OTP, **không** tạo row `users`. Tài liệu thiết kế `GLA-001` (mục 3.2, `KE_HOACH_MAGIC_LINK_KHACH_NGOAI_2026-08-07.md`) đã cân nhắc và loại bỏ chính xác cách tiếp cận "tạo `users` row" cho use case khách vãng lai. Feature `PTA-001` này phục vụ **use case khác**: đối tác/khách quen cần đăng nhập lặp lại trong một khoảng thời gian (không phải 1 lần), nên chấp nhận đánh đổi tạo `users` row thật, có kiểm soát rủi ro riêng (xem mục 8).
>
> Tài liệu phân tích nghiệp vụ gốc (đã được Product Owner chốt từng quyết định qua hội thoại, 3 lần cập nhật): `KE_HOACH_TAI_KHOAN_DOI_TAC_TAM_THOI_2026-08-11.md` (thư mục gốc repo).

- **Feature ID**: PTA-001
- **Feature Name**: Partner Temporary Account (Tài khoản Đối tác Tạm thời)
- **Module / Domain**: `accounts` (chính) + điểm chạm ở `auth` (login/refresh-token/guard toàn cục), `meetings` (tái dùng API mời participant có sẵn, không đổi)
- **Created Date**: 2026-08-11
- **Status**: Draft — chờ duyệt trước khi implement
- **Source Documents**:
  - `KE_HOACH_TAI_KHOAN_DOI_TAC_TAM_THOI_2026-08-11.md` (phân tích nghiệp vụ + toàn bộ quyết định đã chốt, kể cả 2 lần đổi hướng)
  - `CLAUDE.md` (quy tắc backend, đặc biệt mục 5.4 — schema thay đổi cần yêu cầu rõ ràng; permission seed qua migration)
  - `db_schema.sql` (schema thật: `users`, `departments`, `face_profiles`, `user_roles`)
  - `spec/features/guest-access/feat-external-guest-live-meeting-access/spec.md` (đối chiếu ranh giới với `GLA-001`)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống hiện coi mọi người ngoài công ty là nằm ngoài hệ thống tài khoản (`users`) — khách ngoài công ty đi qua `meeting_external_participants` (không có tài khoản) hoặc qua `GLA-001` (magic link + OTP, cũng không tạo `users` row). Cách này phù hợp với khách vãng lai 1 lần, nhưng không phù hợp với **đối tác/khách quen** cần vào hệ thống lặp lại nhiều lần trong một khoảng thời gian (ví dụ 1 tuần làm việc chung một dự án) — OTP không có cơ chế "ghi nhớ" nhiều ngày, phải xác thực lại mỗi lần bấm link mới.

Product Owner muốn: đưa nhóm đối tác này vào làm **user thật** trong bảng `users`, dùng role `EMPLOYEE` có sẵn (không tạo role mới), đánh dấu bằng `department = "Đối tác"`, tài khoản **tự hết hạn** sau một khoảng thời gian định trước, và chỉ được tham gia **đúng những cuộc họp đã được mời** — các màn hình/chức năng khác của nhân viên phải bị khoá bằng logic code.

### 1.2 Mục tiêu

Cho phép Administrator/Host tạo một tài khoản `users` cho đối tác — dùng role `EMPLOYEE` sẵn có, gán vào 1 department cố định đánh dấu "Đối tác" — với hạn dùng xác định trước (`account_expires_at`), đăng nhập được ngay bằng mật khẩu = chính email của họ (không cần nhớ thêm mật khẩu, không bị ép đổi), nhưng bị giới hạn chỉ truy cập được tập endpoint được khai báo tường minh là mở cho đối tác (mặc định chặn mọi endpoint khác).

### 1.3 Giá trị mang lại

- **Cho đối tác**: đăng nhập đơn giản (mật khẩu = email của chính họ), không phải xác thực lại OTP mỗi lần vào các cuộc họp khác nhau trong cùng đợt hợp tác.
- **Cho host/admin**: dùng lại được toàn bộ cơ chế mời participant nội bộ có sẵn (`addInternalParticipant`) — không cần học API mới để mời đối tác vào cuộc họp.
- **Cho bảo mật hệ thống**: tài khoản tự hết hạn theo lịch định trước, không cần thao tác thủ công để thu hồi; phạm vi chức năng bị giới hạn nghiêm ngặt bằng cơ chế fail-closed (mặc định chặn, chỉ mở nơi khai báo tường minh).
- **Cho vận hành**: không thêm bảng mới, không thêm role mới, chỉ 1 cột mới + 1 dòng dữ liệu seed.

### 1.4 Giả định

- Admin/Host tạo tài khoản đối tác có sẵn ảnh sinh trắc học của đối tác đó tại thời điểm tạo tài khoản (điều kiện bắt buộc — xem FR-PTA-005).
- `BiometricEnforcementGuard` và `MustChangePasswordGuard` (2 global guard hiện có) **giữ nguyên không sửa** — feature này thoả mãn cả 2 guard bằng dữ liệu tạo sẵn lúc provisioning, không bằng cách sửa guard.
- Toàn bộ endpoint đọc `live-meeting` hiện tại lọc quyền xem theo `meeting_participants` của đúng cuộc họp (không chỉ theo role) — đây là giả định **cần xác minh riêng trước khi bật tính năng** (xem mục 1.5, Cần làm rõ).
- Access token có TTL ngắn (mặc định 15 phút theo `.env.example`), nên việc không có cơ chế thu hồi token tức thời khi tài khoản hết hạn là chấp nhận được (độ trễ tối đa bằng TTL access token).

### 1.5 Nhật ký Quyết định đã chốt (Q&A trực tiếp với Product Owner)

Toàn bộ điểm dưới đây đã được Product Owner xác nhận qua hội thoại (không phải suy đoán của agent), gồm cả 2 lần đổi hướng:

1. **Không tạo role mới**: dùng role `EMPLOYEE` sẵn có, đánh dấu đối tác bằng `department = "Đối tác"` (seed 1 row `departments` với UUID cố định).
2. **Thêm 1 cột mới**: `users.account_expires_at timestamptz NULL` — không tái dùng `locked_until` (đã có nghĩa khác: khoá do đăng nhập sai) hay `user_roles.expired_at` (chỉ ảnh hưởng permission, không chặn được login).
3. **Ảnh sinh trắc học nhập kèm lúc tạo tài khoản** *(chốt lần 1, thay thế hướng "sửa `BiometricEnforcementGuard`")*: admin bắt buộc upload ảnh ngay lúc tạo tài khoản đối tác; hệ thống tạo thẳng `face_profiles` với `status = ACTIVE` (bỏ qua `pending_review`) — **không sửa `BiometricEnforcementGuard`**, vì guard đó ảnh hưởng toàn bộ user trong hệ thống, sửa sai rủi ro cao hơn hẳn so với giải quyết bằng dữ liệu.
4. **Rủi ro participant-picker/danh sách enroll khuôn mặt lộ đối tác lẫn nhân viên thật *(TẠM HOÃN, ngoài scope feature này)***: Product Owner chốt xử lý ở đợt sau, không nằm trong phạm vi implement của `PTA-001`.
5. **Cơ chế khoá màn hình bằng decorator opt-in + `Reflector`** *(giải thích chi tiết theo yêu cầu Product Owner)*: KHÔNG dùng bảng path-prefix kiểu blocklist/whitelist string (rủi ro fail-open khi có route mới không ai nhớ cập nhật danh sách) — dùng decorator `@AllowPartnerAccount()` gắn trực tiếp trên từng endpoint, mặc định **chặn tuyệt đối** nếu không có decorator, đúng pattern `@RequireRoles`/`@RequirePermissions` đã có sẵn trong repo.
6. **Mật khẩu = email của khách, KHÔNG ép đổi** *(chốt lần 2, thay thế hướng "1 mật khẩu mặc định dùng chung cho mọi đối tác" đã chốt trước đó)*: để giảm ma sát cho khách chỉ vào hệ thống một thời gian ngắn, mật khẩu ban đầu = chính email của tài khoản đó (khác nhau theo từng người, không phải 1 chuỗi cố định dùng chung), hash bcrypt như bình thường, và **`must_change_password = false`** — không bắt đổi mật khẩu lần đầu. Đã cảnh báo rõ với Product Owner đây là mẫu hình username=password tồn tại suốt vòng đời tài khoản (không chỉ lần đăng nhập đầu) — Product Owner xác nhận chấp nhận đánh đổi, khuyến nghị đi kèm: đặt `account_expires_at` mặc định NGẮN (khuyến nghị 1 ngày) vì đây là lớp phòng thủ còn lại duy nhất.

### 1.6 Cần làm rõ

- **Endpoint live-meeting có lọc theo `meeting_participants` hay theo role chung?** Chưa audit đầy đủ trong tài liệu nguồn — cần xác nhận trước khi bật tính năng cho production, vì nếu có endpoint chỉ kiểm tra role (`EMPLOYEE` là đủ) mà không lọc theo participant, đối tác sẽ đọc được cuộc họp họ KHÔNG được mời. Đây là lỗ hổng ảnh hưởng cả nhân viên thật, không riêng đối tác — cần audit riêng, có thể là 1 task tiền đề trước Phase 3 (xem `plan.md`, `tasks.md`).
- **DTO của `PATCH /users/:id` hiện tại có mở field `department_id`/`account_expires_at` cho admin sửa hay chưa?** Chưa xác nhận — cần kiểm tra khi implement (xem `research.md`).
- **Danh sách permission thật mà role `EMPLOYEE` đang sở hữu** (qua hàng chục migration seed) — chưa liệt kê đầy đủ trong tài liệu nguồn; `PartnerAccountRestrictionGuard` xử lý được vấn đề này ở mức "chặn theo endpoint" mà không cần biết chi tiết từng permission, nhưng nên rà soát riêng để hiểu rõ bề mặt bị chặn.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| **Administrator / Host** | Tạo, gia hạn, khoá sớm tài khoản đối tác; mời đối tác vào cuộc họp | Permission quản trị tài khoản đối tác (mục 2.2) |
| **Đối tác (Partner)** | Chủ thể chính — user thật, role `EMPLOYEE`, `department = Đối tác` | Đăng nhập, đổi mật khẩu (tuỳ chọn, không bắt buộc), xem cuộc họp được mời trong phạm vi `@AllowPartnerAccount()` |
| **Hệ thống Email** | Actor phụ trợ | Gửi mail thông báo tài khoản + hạn dùng cho đối tác |
| **Nhân viên nội bộ khác** | Actor bị ảnh hưởng gián tiếp | Có thể vô tình thấy đối tác trong participant picker (rủi ro đã biết, HOÃN xử lý — mục 8) |

### 2.2 Role & Permission Rules

- Đối tác **dùng chung role `EMPLOYEE`** đã có sẵn trong hệ thống — **không tạo permission/role riêng cho đối tác**. Phạm vi chức năng của đối tác bị giới hạn bằng `PartnerAccountRestrictionGuard` (mục 3.4), không bằng bảng `permissions`.
- Cần 1 permission mới cho **Administrator/Host** (không phải cho đối tác) để quản lý vòng đời tài khoản đối tác — ví dụ `account.partner.manage` (tạo/gia hạn/khoá sớm) — seed qua migration, theo đúng convention granularity đã dùng ở `meeting.guest.*` (`GLA-001`).

### 2.3 Actor Constraints

- Đối tác chỉ gọi thành công các endpoint có decorator `@AllowPartnerAccount()` — mọi endpoint khác trả `403 PARTNER_ACCOUNT_RESTRICTED` bất kể role `EMPLOYEE` có permission gì trong bảng `role_permissions` (FR-PTA-013, FR-PTA-020).
- Đối tác không tự tạo được tài khoản đối tác khác — hành động tạo/gia hạn/khoá sớm chỉ dành cho actor có permission quản trị tài khoản đối tác.
- Tài khoản đối tác không được đăng nhập/refresh token thành công nếu `account_expires_at` đã qua (FR-PTA-010, FR-PTA-011), bất kể `account_status` vẫn là `active`.

---

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)

- **FR-PTA-001**: THE system SHALL đánh dấu một tài khoản là "đối tác" bằng `users.department_id` trỏ tới 1 row `departments` cố định (UUID cố định, seed sẵn), trong khi `role` của tài khoản đó vẫn là `EMPLOYEE` như user thường — KHÔNG tạo role mới, KHÔNG tạo bảng mới.
- **FR-PTA-002**: THE system SHALL lưu hạn dùng tài khoản đối tác trong `users.account_expires_at` (cột mới, kiểu `timestamptz`, cho phép NULL). `NULL` nghĩa là tài khoản không giới hạn thời gian (áp dụng cho user thường hiện có).
- **FR-PTA-003**: THE system SHALL đặt `users.password_hash` của tài khoản đối tác bằng cách hash (bcrypt, cùng cấu hình salt round hiện tại) chính giá trị `email` của tài khoản đó — KHÔNG sinh mật khẩu ngẫu nhiên, KHÔNG dùng 1 chuỗi cố định chung cho mọi đối tác.
- **FR-PTA-004**: THE system SHALL đặt `users.must_change_password = false` khi tạo tài khoản đối tác — khác với luồng tạo tài khoản nhân viên thông thường (luôn đặt `true`).
- **FR-PTA-005**: THE system SHALL yêu cầu đúng 1 ảnh sinh trắc học đi kèm bắt buộc trong yêu cầu tạo tài khoản đối tác — không được tạo tài khoản đối tác thiếu ảnh.

### 3.2 Event-driven Requirements

- **FR-PTA-006**: WHEN một tài khoản đối tác được tạo thành công kèm ảnh hợp lệ, THE system SHALL tạo 1 bản ghi `face_profiles` với `status = ACTIVE` (bỏ qua `pending_review`), `enrolled_by` = actor thực hiện tạo tài khoản, `enrolled_at = now()`.
- **FR-PTA-007**: WHEN tài khoản đối tác được tạo thành công, THE system SHALL gửi email cho đối tác chứa: email đăng nhập, ghi chú rõ "mật khẩu chính là địa chỉ email này", và ngày hết hạn tài khoản — KHÔNG gửi bất kỳ chuỗi mật khẩu nào khác trong nội dung mail.
- **FR-PTA-008**: WHEN Administrator/Host mời một tài khoản đối tác tham gia cuộc họp, THE system SHALL tái sử dụng API thêm participant nội bộ hiện có (`addInternalParticipant`) — KHÔNG tạo API mời riêng cho đối tác.
- **FR-PTA-009**: WHEN Administrator/Host cập nhật `account_expires_at` của một tài khoản đối tác đang tồn tại (gia hạn hoặc rút ngắn), THE system SHALL áp dụng giá trị mới ngay lập tức cho các lần kiểm tra login/refresh-token tiếp theo — không yêu cầu tạo lại tài khoản.

### 3.3 State-driven Requirements

- **FR-PTA-010**: WHILE `users.account_expires_at` của một tài khoản đã ở trong quá khứ, THE system SHALL từ chối yêu cầu đăng nhập của tài khoản đó ngay cả khi mật khẩu đúng và `account_status = 'active'`.
- **FR-PTA-011**: WHILE `users.account_expires_at` của một tài khoản đã ở trong quá khứ, THE system SHALL từ chối yêu cầu làm mới access token (`refresh-token`) của tài khoản đó.
- **FR-PTA-012**: WHILE một tài khoản đã đăng nhập được xác định là tài khoản đối tác (`department_id` khớp department cố định ở FR-PTA-001), THE system SHALL chỉ cho phép tài khoản đó gọi thành công các endpoint có decorator `@AllowPartnerAccount()` — mặc định từ chối mọi endpoint khác.

### 3.4 Authorization Requirements

- **FR-PTA-013**: THE system SHALL triển khai `PartnerAccountRestrictionGuard` như một guard toàn cục (`APP_GUARD`), chạy sau `JwtAuthGuard`, áp dụng cho mọi request đã xác thực.
- **FR-PTA-014**: THE system SHALL triển khai decorator `@AllowPartnerAccount()` (dùng `SetMetadata` + đọc lại bằng `Reflector`, cùng cơ chế với `@RequireRoles`/`@RequirePermissions` hiện có) để đánh dấu tường minh một endpoint là được phép gọi bởi tài khoản đối tác.
- **FR-PTA-015**: THE system SHALL NOT sửa `BiometricEnforcementGuard` (danh sách exempt role, logic kiểm tra) để phục vụ tài khoản đối tác — tài khoản đối tác thoả mãn guard này thông qua dữ liệu tạo sẵn ở FR-PTA-005/006, không thông qua thay đổi logic guard.
- **FR-PTA-016**: THE system SHALL NOT sửa `MustChangePasswordGuard` để phục vụ tài khoản đối tác — tài khoản đối tác thoả mãn guard này thông qua `must_change_password = false` được đặt sẵn lúc tạo (FR-PTA-004), không thông qua thay đổi logic guard.
- **FR-PTA-017**: THE system SHALL yêu cầu permission quản trị riêng (mục 2.2) cho MỌI thao tác tạo/gia hạn/khoá sớm tài khoản đối tác — tài khoản đối tác KHÔNG được cấp permission này.

### 3.5 Optional Feature Requirements

- **FR-PTA-018**: WHERE Administrator gửi yêu cầu cập nhật `account_expires_at` cho một tài khoản đối tác hiện có, THE system SHALL chấp nhận giá trị mới mà không yêu cầu tạo lại tài khoản (mirror FR-PTA-009, viết dưới dạng optional-feature để nêu rõ đây là 1 nhánh cập nhật riêng biệt với luồng tạo mới).

### 3.6 Unwanted Behavior Requirements

- **FR-PTA-019**: IF một yêu cầu tạo tài khoản đối tác không kèm ảnh sinh trắc học hợp lệ, THEN THE system SHALL từ chối yêu cầu với lỗi validation và KHÔNG tạo bản ghi `users`.
- **FR-PTA-020**: IF actor cố sửa `department_code`/tên hoặc xoá mềm (`deleted_at`) row department cố định dùng để đánh dấu "Đối tác" (FR-PTA-001), THEN THE system SHALL từ chối thao tác đó.
- **FR-PTA-021**: IF một tài khoản đối tác gọi một endpoint KHÔNG có decorator `@AllowPartnerAccount()`, THEN THE system SHALL trả `403 PARTNER_ACCOUNT_RESTRICTED` và KHÔNG thực thi logic nghiệp vụ của endpoint đó.
- **FR-PTA-022**: IF yêu cầu đăng nhập được gửi cho một tài khoản có `account_expires_at` đã qua, THEN THE system SHALL trả lỗi `403 AUTH_ACCOUNT_EXPIRED` — mã lỗi riêng biệt với `AUTH_ACCOUNT_LOCKED`/`AUTH_ACCOUNT_INACTIVE` đã có.
- **FR-PTA-023**: IF actor không có permission quản trị tài khoản đối tác (mục 2.2) cố tạo/gia hạn/khoá sớm tài khoản đối tác, THEN THE system SHALL từ chối yêu cầu và không thay đổi dữ liệu.

### 3.7 Data & State Requirements

- **FR-PTA-024**: WHEN một tài khoản đối tác được tạo, THE system SHALL lưu `department_id` tham chiếu đúng row department cố định (FR-PTA-001).
- **FR-PTA-025**: THE system SHALL NOT tạo bảng database mới cho feature này — chỉ 1 cột mới (`users.account_expires_at`) và 1 row dữ liệu seed (`departments`).

### 3.8 Notification / Audit Requirements

- **FR-PTA-026**: WHEN một tài khoản đối tác được tạo, gia hạn, hoặc khoá sớm, THE system SHALL ghi 1 bản ghi `audit_logs` tương ứng với `actor` = Administrator/Host thực hiện, `target` = tài khoản đối tác bị tác động.

### 3.9 Complex / Combined Requirements

- **FR-PTA-027**: IF `users.account_status = 'active'` AND `account_expires_at IS NOT NULL` AND `account_expires_at < now()`, THEN THE system SHALL coi tài khoản là hết hạn cho mục đích đăng nhập/refresh-token (FR-PTA-010/011), phân biệt rõ với trạng thái `locked`/`inactive` hiện có (không rơi vào nhánh xử lý `active` bình thường).

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn / Quyết định liên quan |
|---|---|---|
| FR-PTA-001 | Ubiquitous | Quyết định 1 (mục 1.5) — không role mới |
| FR-PTA-002 | Ubiquitous | Quyết định 2 — cột mới `account_expires_at` |
| FR-PTA-003, FR-PTA-004 | Ubiquitous | Quyết định 6 (chốt lần 2) — mật khẩu = email, không ép đổi |
| FR-PTA-005 | Ubiquitous | Quyết định 3 (chốt lần 1) — ảnh bắt buộc lúc tạo |
| FR-PTA-006 | Event-driven | Quyết định 3 |
| FR-PTA-007 | Event-driven | Quyết định 6 |
| FR-PTA-008 | Event-driven | Tái dùng `addInternalParticipant` có sẵn |
| FR-PTA-009, FR-PTA-018 | Event-driven / Optional | Vòng đời gia hạn tài khoản |
| FR-PTA-010, FR-PTA-011, FR-PTA-027 | State-driven / Complex | Quyết định 2 — enforcement tại login/refresh |
| FR-PTA-012 | State-driven | Quyết định 5 — allowlist mặc định chặn |
| FR-PTA-013, FR-PTA-014 | Authorization | Quyết định 5 |
| FR-PTA-015, FR-PTA-016 | Authorization | Quyết định 3, 6 — không sửa 2 guard toàn cục hiện có |
| FR-PTA-017 | Authorization | Mục 2.2 |
| FR-PTA-019 | Unwanted Behavior | Quyết định 3 |
| FR-PTA-020 | Unwanted Behavior | Bảo vệ department cố định khỏi fail-open |
| FR-PTA-021, FR-PTA-022, FR-PTA-023 | Unwanted Behavior | Quyết định 2, 5 |
| FR-PTA-024, FR-PTA-025 | Data & State | Quyết định 1, 2 — không thêm bảng |
| FR-PTA-026 | Notification/Audit | Convention audit log toàn dự án |

---

## 4. Non-functional Requirements

### 4.1 Security

- **NFR-PTA-001**: THE system SHALL NEVER trả `password_hash` hoặc bất kỳ giá trị mật khẩu nào (kể cả email dùng làm mật khẩu) trong API response của luồng tạo/xem tài khoản đối tác.
- **NFR-PTA-002**: THE system SHALL xác định department cố định dùng để đánh dấu "Đối tác" bằng UUID hằng số (seed cố định), KHÔNG bằng so khớp chuỗi `department_code`/`department_name` rải rác nhiều nơi trong code.
- **NFR-PTA-003**: THE system SHALL đảm bảo `PartnerAccountRestrictionGuard` mặc định từ chối (fail-closed) khi không xác định được decorator `@AllowPartnerAccount()` trên handler đang gọi, kể cả khi có lỗi đọc metadata.
- **NFR-PTA-004**: THE system SHALL KHÔNG dựa vào việc thu hồi access token tức thời khi tài khoản hết hạn — chấp nhận độ trễ tối đa bằng TTL access token hiện tại (mặc định 15 phút), không thêm hạ tầng blacklist mới cho feature này.

### 4.2 Reliability & Consistency

- **NFR-PTA-005**: THE system SHALL từ chối mọi thao tác sửa/xoá mềm row department cố định (FR-PTA-020) ở tầng service, không chỉ ở tầng UI/FE.
- **NFR-PTA-006**: THE system SHALL không suy ra ngược `account_status` từ `account_expires_at` khi ghi DB (không tự động đổi `account_status` thành giá trị khác khi hết hạn) — trạng thái "đã hết hạn" chỉ là giá trị tính toán tại thời điểm đọc, tránh 2 nguồn sự thật lệch nhau.

### 4.3 Usability

- **NFR-PTA-007**: THE system SHALL trả thông báo lỗi bằng tiếng Việt, theo đúng format response chuẩn của dự án (`{ success, message, error: { code, details } }`), nhất quán với các module khác.

### 4.4 Observability

- **NFR-PTA-008**: THE system SHALL ghi log ứng dụng (không chỉ `audit_logs`) mỗi khi `PartnerAccountRestrictionGuard` từ chối một request — tín hiệu hữu ích để phát hiện endpoint mới bị bỏ sót decorator.

### 4.5 Maintainability

- **NFR-PTA-009**: THE system SHALL tập trung toàn bộ logic xác định "tài khoản đối tác" vào đúng 1 hàm dùng chung (ví dụ `isPartnerAccount()`), không lặp lại điều kiện `department_id === PARTNER_DEPARTMENT_ID` ở nhiều nơi.

---

## 5. Data Model

Xem chi tiết đầy đủ ở `data-model.md`. Tóm tắt:

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `users` | +1 cột mới `account_expires_at`; ghi `department_id`, `password_hash`, `must_change_password` theo quy tắc riêng cho đối tác | KHÔNG thêm bảng, chỉ 1 cột |
| `departments` | +1 row seed cố định UUID, đánh dấu "Đối tác" | Bảo vệ khỏi sửa/xoá (FR-PTA-020) |
| `face_profiles` | Ghi thẳng `status = ACTIVE` lúc tạo tài khoản đối tác | Khác luồng tự nộp ảnh (mặc định `pending_review`) |
| `user_roles` | Gán role `EMPLOYEE` như user thường | Không đổi |
| `meeting_participants` | Tái dùng luồng `addInternalParticipant` có sẵn | Không đổi schema/API |
| `audit_logs` | Ghi vết tạo/gia hạn/khoá sớm tài khoản đối tác | `actor` = admin/host |

### 5.2 Dữ liệu đầu vào (tóm tắt — chi tiết ở `plan.md` mục 5)

- Tạo tài khoản đối tác — request kèm: thông tin cơ bản (họ tên, email, ...), `accountExpiresAt`, file ảnh sinh trắc học (bắt buộc).
- Gia hạn/khoá sớm — request kèm: `accountExpiresAt` mới.
- Mời tham gia cuộc họp — dùng nguyên request shape của `addInternalParticipant` hiện có (không đổi).

### 5.3 State / Status Model

Không có state machine riêng cho tài khoản đối tác — dùng lại `users.account_status` hiện có (`active`/`inactive`/`locked`), cộng thêm khái niệm "hết hạn" được **tính toán** (không lưu) từ `account_expires_at` tại thời điểm đọc.

---

## 6. Error Handling

### 6.1 Validation Errors
- `400`/tương đương: thiếu ảnh sinh trắc học khi tạo tài khoản đối tác (FR-PTA-019).

### 6.2 Authentication / Authorization Errors
- `403 AUTH_ACCOUNT_EXPIRED`: đăng nhập/refresh-token khi `account_expires_at` đã qua (FR-PTA-022).
- `403 PARTNER_ACCOUNT_RESTRICTED`: tài khoản đối tác gọi endpoint không có `@AllowPartnerAccount()` (FR-PTA-021).
- `403`: actor không có permission quản trị tài khoản đối tác (FR-PTA-023).

### 6.3 Business Rule Errors
- Từ chối sửa/xoá mềm department cố định đánh dấu "Đối tác" (FR-PTA-020) — mã lỗi cụ thể chốt khi implement (xem `plan.md` mục 9).

### 6.4 Error Response Expectations

Theo đúng format chuẩn toàn dự án (`{ success, message, error: { code, details }, timestamp, path }`), không phát sinh format mới.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

- **AC-001**: GIVEN Administrator có permission quản trị tài khoản đối tác VÀ cung cấp đầy đủ thông tin kèm 1 ảnh hợp lệ, WHEN tạo tài khoản đối tác, THEN tài khoản được tạo với `department_id` = department cố định, role `EMPLOYEE`, `account_expires_at` đúng giá trị đã chọn, `must_change_password = false`, VÀ có 1 `face_profiles` với `status = ACTIVE`.
- **AC-002**: GIVEN tài khoản đối tác vừa tạo, WHEN đối tác đăng nhập bằng email + mật khẩu = chính email đó, THEN đăng nhập thành công, KHÔNG bị chuyển hướng màn đổi mật khẩu.
- **AC-003**: GIVEN tài khoản đối tác đã đăng nhập, WHEN gọi 1 endpoint có decorator `@AllowPartnerAccount()`, THEN request được xử lý bình thường.
- **AC-004**: GIVEN tài khoản đối tác đã đăng nhập, WHEN gọi 1 endpoint KHÔNG có decorator `@AllowPartnerAccount()`, THEN trả `403 PARTNER_ACCOUNT_RESTRICTED`.
- **AC-005**: GIVEN Host muốn mời đối tác vào cuộc họp, WHEN gọi API `addInternalParticipant` hiện có với `userId` của tài khoản đối tác, THEN thêm thành công, không cần API riêng.

### 7.2 Expiry Cases

- **AC-006**: GIVEN tài khoản đối tác có `account_expires_at` đã qua, WHEN đối tác cố đăng nhập bằng đúng mật khẩu, THEN trả `403 AUTH_ACCOUNT_EXPIRED`.
- **AC-007**: GIVEN tài khoản đối tác có `account_expires_at` đã qua NHƯNG vẫn còn access token cũ chưa hết hạn, WHEN token đó hết hạn VÀ client gọi refresh-token, THEN trả `403 AUTH_ACCOUNT_EXPIRED`, không cấp access token mới.
- **AC-008**: GIVEN Administrator gia hạn `account_expires_at` của một tài khoản đối tác đã hết hạn sang một mốc tương lai, WHEN đối tác đăng nhập lại, THEN đăng nhập thành công.

### 7.3 Guard & Data Protection Cases

- **AC-009**: GIVEN actor bất kỳ (kể cả admin), WHEN cố đổi `department_code`/tên hoặc xoá mềm row department cố định đánh dấu "Đối tác", THEN thao tác bị từ chối.
- **AC-010**: GIVEN tài khoản tạo mới KHÔNG kèm ảnh sinh trắc học, WHEN gọi API tạo tài khoản đối tác, THEN request bị từ chối, không có bản ghi `users` nào được tạo.
- **AC-011**: GIVEN actor không có permission quản trị tài khoản đối tác, WHEN cố tạo/gia hạn/khoá sớm tài khoản đối tác, THEN request bị từ chối, không có thay đổi dữ liệu nào xảy ra.

### 7.4 Acceptance Criteria Traceability

| AC ID | FR liên quan |
|---|---|
| AC-001 | FR-PTA-001, FR-PTA-002, FR-PTA-004, FR-PTA-005, FR-PTA-006 |
| AC-002 | FR-PTA-003, FR-PTA-004 |
| AC-003, AC-004 | FR-PTA-012, FR-PTA-013, FR-PTA-014, FR-PTA-021 |
| AC-005 | FR-PTA-008 |
| AC-006 | FR-PTA-010, FR-PTA-022, FR-PTA-027 |
| AC-007 | FR-PTA-011, FR-PTA-022 |
| AC-008 | FR-PTA-009, FR-PTA-018 |
| AC-009 | FR-PTA-020 |
| AC-010 | FR-PTA-019 |
| AC-011 | FR-PTA-017, FR-PTA-023 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- `OOS-001`: THE system SHALL NOT tạo role RBAC mới cho tài khoản đối tác.
- `OOS-002`: THE system SHALL NOT tạo bảng database mới.
- `OOS-003`: THE system SHALL NOT lọc tài khoản đối tác khỏi participant picker hoặc danh sách chọn user để enroll khuôn mặt cửa ra vào (`device_user_mappings`) — **đã chốt HOÃN sang đợt sau** (Quyết định 4, mục 1.5). Ở phiên bản này, tài khoản đối tác **sẽ** xuất hiện lẫn trong các danh sách user nội bộ đó.
- `OOS-004`: THE system SHALL NOT sửa `BiometricEnforcementGuard` hoặc `MustChangePasswordGuard`.
- `OOS-005`: THE system SHALL NOT thêm cơ chế thu hồi access token tức thời (blacklist realtime) khi tài khoản hết hạn.
- `OOS-006`: THE system SHALL NOT audit toàn diện danh sách permission mà role `EMPLOYEE` sở hữu qua các migration trước đây — chỉ giới hạn phạm vi chức năng bằng `PartnerAccountRestrictionGuard` ở mức endpoint.
- `OOS-007`: THE system SHALL NOT sửa đổi hoặc mở rộng module `guest-access` (`GLA-001`) — 2 feature độc lập, không phụ thuộc lẫn nhau.
- `OOS-008`: THE system SHALL NOT triển khai cơ chế xoá/anonymize tự động dữ liệu tài khoản đối tác sau khi hết hạn — tài khoản chỉ bị khoá đăng nhập, dữ liệu (lịch sử tham dự cuộc họp, ...) được giữ nguyên.

### 8.2 Có thể xem xét ở feature khác

- Lọc tài khoản đối tác khỏi participant picker và danh sách enroll khuôn mặt (OOS-003, khi được ưu tiên lại).
- Audit toàn diện endpoint `live-meeting` để xác nhận lọc đúng theo `meeting_participants` (mục 1.6) — nên làm TRƯỚC khi bật tính năng cho production dù không phải deliverable của feature này.
- Rút ngắn cửa sổ rủi ro "mật khẩu = email" bằng cách vô hiệu hoá nếu tài khoản chưa từng đăng nhập sau N giờ kể từ lúc tạo.

### 8.3 Out-of-scope EARS Guardrails

- **FR-OOS-001**: THE system SHALL NOT thêm bất kỳ bảng database mới nào cho feature này.
- **FR-OOS-002**: THE system SHALL NOT thêm role hoặc permission nào được gán riêng cho tài khoản đối tác (permission mới chỉ dành cho actor quản trị, mục 2.2).
- **FR-OOS-003**: THE system SHALL NOT thay đổi logic của `BiometricEnforcementGuard` hoặc `MustChangePasswordGuard`.

## Assumptions
Xem mục 1.4 và 1.5.
