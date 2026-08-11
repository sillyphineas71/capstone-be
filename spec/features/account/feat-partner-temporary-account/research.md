# Research: Partner Temporary Account (PTA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo research, chuyển thể từ toàn bộ quá trình phân tích trong `KE_HOACH_TAI_KHOAN_DOI_TAC_TAM_THOI_2026-08-11.md` | Toàn bộ file |

## 1. Đánh dấu tài khoản đối tác: department vs role mới

- **Decision**: Dùng `department_id` trỏ tới 1 row `departments` cố định (UUID hard-code), role vẫn là `EMPLOYEE`.
- **Rationale**: Product Owner chốt trực tiếp không muốn thêm role mới. Repo có tiền lệ xấu với việc seed role/permission sai (`role_code='admin'`, `INTERNAL_USER` hỏng hàng loạt — xem `feedback_uc1nn_filepath_corruption.md`/memory dự án), nên tránh mở rộng bề mặt RBAC khi không bắt buộc.
- **Alternatives considered**:
  - Tạo role `GUEST`/`PARTNER` riêng: đã được cân nhắc VÀ loại bỏ bởi chính tài liệu thiết kế `GLA-001` (mục 3.2, phương án B) cho use case khách vãng lai — lý do tương tự áp dụng ở đây (ô nhiễm participant picker, headcount). Product Owner chốt chấp nhận rủi ro này có kiểm soát cho use case đối tác lặp lại, nhưng vẫn từ chối thêm role.
  - Dùng 1 cột boolean mới `is_partner` trên `users`: khả thi về mặt kỹ thuật nhưng đi ngược yêu cầu tường minh của Product Owner ("dùng bảng department kiểu 1 cột data là Đối tác") — không chọn.

## 2. Lưu hạn dùng tài khoản: cột mới vs tái dùng cột có sẵn

- **Decision**: Thêm cột mới `users.account_expires_at timestamptz NULL`.
- **Rationale**: Đã rà soát toàn bộ ứng viên tái dùng trong schema thật (`db_schema.sql`) — không có cột nào phù hợp mà không đụng chạm nghĩa khác đang dùng (xem bảng dưới).
- **Alternatives considered**:
  - `users.locked_until`: đã có nghĩa "mốc hết khoá do đăng nhập sai nhiều lần" (brute-force lockout). Logic "mở khoá" hiện có (`failed_login_count = 0` → clear `locked_until`) sẽ vô tình gỡ luôn hạn dùng đối tác nếu tái dùng chung cột.
  - `user_roles.expired_at`: chỉ ảnh hưởng tính toán permission (`getEffectiveRolesAndPermissions` lọc theo `expired_at`), KHÔNG chặn được đăng nhập — user vẫn login được, chỉ gọi API nào cũng 403 vì hết permission. Trải nghiệm lỗi rải rác từng API tệ hơn hẳn 1 thông báo "tài khoản hết hạn" rõ ràng lúc login.
  - `users.employment_status`: enum nghiệp vụ nhân sự (active/resigned/on_leave), không phải trường thời gian.

## 3. Thoả mãn `BiometricEnforcementGuard`: sửa guard vs dữ liệu tại thời điểm tạo

- **Decision**: KHÔNG sửa `BiometricEnforcementGuard`. Bắt buộc admin upload ảnh sinh trắc học ngay lúc tạo tài khoản đối tác, ghi thẳng `face_profiles.status = ACTIVE`.
- **Rationale**: `BiometricEnforcementGuard` là `APP_GUARD` toàn cục, áp dụng cho MỌI user trong hệ thống, không riêng đối tác. Sửa exempt-list của guard này có rủi ro cao hơn hẳn (1 dòng sai ảnh hưởng toàn bộ nhân viên) so với việc đảm bảo dữ liệu đúng ngay từ lúc tạo — vốn chỉ ảnh hưởng tài khoản đối tác mới tạo.
- **Kỹ thuật xác nhận (đọc code thật)**: `resolveBiometricReviewStatus()` (`common/utils/biometric-status-resolver.util.ts`) chỉ trả `not_uploaded` khi KHÔNG có row `face_profiles` nào cho user. Guard chỉ chặn khi kết quả là `not_uploaded`/`rejected`. Có sẵn 1 row `status = active` (map ra `approved`) → guard không bao giờ chặn, không cần biết khái niệm "đối tác" tồn tại.
- **Alternatives considered**:
  - Thêm nhánh `isPartnerAccount()` vào `BiometricEnforcementGuard.canActivate()`: khả thi kỹ thuật, nhưng tăng bề mặt rủi ro của 1 guard bảo mật toàn cục nhạy cảm — bị loại theo quyết định trực tiếp của Product Owner.
  - Để đối tác tự nộp ảnh qua `/me/biometric-submission` (như nhân viên thường): tạo độ trễ/friction không cần thiết (đối tác phải tự chụp ảnh + đợi admin duyệt `pending_review`) — không phù hợp mục tiêu giảm ma sát cho tài khoản dùng ngắn hạn.

## 4. Cơ chế giới hạn phạm vi chức năng: path-prefix blocklist/whitelist vs decorator opt-in

- **Decision**: Decorator `@AllowPartnerAccount()` (`SetMetadata` + `Reflector`), guard mặc định chặn (fail-closed) nếu không có decorator.
- **Rationale**: Bảng path-prefix string (mirror cách 2 guard cũ `BiometricEnforcementGuard`/`MustChangePasswordGuard` khai báo whitelist ngoại lệ) phù hợp cho bài toán "mặc định CHO QUA, chặn vài ngoại lệ" — nhưng bài toán ở đây ngược lại: "mặc định CHẶN, mở vài ngoại lệ". Dùng bảng string cho trường hợp này có nhược điểm fail-open: route mới ai đó thêm sau này (không biết khái niệm "đối tác" tồn tại) mặc định LỌT QUA nếu vô tình khớp 1 prefix có sẵn trong bảng.
- **Kỹ thuật xác nhận**: repo đã có sẵn pattern quen thuộc cho đúng nhu cầu này — `@RequireRoles()`/`@RequirePermissions()` (`auth/decorators/require-roles.decorator.ts`, `require-permissions.decorator.ts`), dùng `SetMetadata` + đọc lại bằng `Reflector.getAllAndOverride()` tại guard. Route KHÔNG có decorator → không có metadata → mặc định coi là KHÔNG được phép, đúng hướng fail-closed cần thiết.
- **Alternatives considered**:
  - Bảng `PARTNER_ALLOWED_ROUTE_PREFIXES` (path-prefix string): bị loại vì lý do trên. Repo từng có bug fail-open thật ở guard `face-profile` — cùng lớp lỗi (liệt kê thủ công, quên cập nhật khi thêm route mới).
  - Blocklist (liệt kê endpoint bị CẤM thay vì được PHÉP): bị loại vì cùng lý do fail-open — route mới mặc định KHÔNG nằm trong blocklist nên mặc định được phép, sai hướng an toàn cần thiết ở đây.

## 5. Mật khẩu ban đầu: sinh ngẫu nhiên + ép đổi vs email + không ép đổi

- **Decision** (chốt lần 2, thay thế quyết định "1 mật khẩu mặc định dùng chung" ở lần chốt trước): mật khẩu = chính email của tài khoản đó, hash bcrypt bình thường; `must_change_password = false`.
- **Rationale**: Product Owner ưu tiên trải nghiệm không ma sát cho khách chỉ vào hệ thống một thời gian ngắn — không muốn khách phải nhớ/nhập thêm 1 chuỗi mật khẩu riêng, và không muốn bị chặn bởi màn đổi mật khẩu bắt buộc.
- **Rủi ro đã trình bày và được Product Owner xác nhận chấp nhận**: mẫu hình username=password, tồn tại suốt vòng đời tài khoản (không chỉ lần đầu như phương án "1 mật khẩu chung + ép đổi" đã cân nhắc trước đó). Lớp phòng thủ còn lại duy nhất là `account_expires_at` — khuyến nghị đặt ngắn (1 ngày) làm giá trị mặc định đề xuất khi build UI tạo tài khoản.
- **Alternatives considered**:
  - 1 mật khẩu mặc định dùng chung cho MỌI tài khoản đối tác (`PARTNER_ACCOUNT_DEFAULT_PASSWORD` qua env), ép đổi lần đầu: đây là quyết định CHỐT LẦN 1, đã bị thay thế bởi quyết định lần 2 trong cùng phiên làm việc. Rủi ro của phương án này: lộ 1 password là lộ TẤT CẢ tài khoản đối tác (dù giảm thiểu bằng ép đổi ngay). Bị thay thế vì Product Owner muốn giảm ma sát hơn nữa (bỏ hẳn bước đổi mật khẩu).
  - Mật khẩu sinh ngẫu nhiên (như luồng tạo user thường), ép đổi lần đầu: đúng convention hiện có nhất nhưng đối tác phải nhận + nhập 1 chuỗi ngẫu nhiên khó nhớ — đi ngược mục tiêu giảm ma sát của Product Owner.

## 6. UUID cố định vs tra cứu theo `department_code`

- **Decision**: Hard-code UUID của department "Đối tác" thành hằng số dùng ở cả migration lẫn code (`PARTNER_DEPARTMENT_ID`), không tra cứu động bằng `WHERE department_code = 'PARTNER'`.
- **Rationale**: `departments` có CRUD đầy đủ (`DepartmentsController`), admin sửa được tên/`department_code`, xoá mềm được (`deleted_at`). Nếu logic gate tra theo `department_code` (chuỗi), một lần đổi tên vô tình sẽ làm toàn bộ cơ chế nhận diện đối tác fail-open hoặc fail-closed âm thầm — đúng lớp bug đã từng xảy ra thật trong repo (`PHAN_HOI_BE_PLAN_Permission_Dependency_Constraints_2026-08-05.md`, guard `face-profile`). UUID cố định không đổi dù tên hiển thị có đổi (dù việc đổi tên/xoá vẫn bị chặn riêng ở tầng service — xem `plan.md` mục 7.5, đây là lớp phòng thủ kép).
- **Alternatives considered**:
  - Tra `department_code = 'PARTNER'` mỗi lần cần check: đơn giản hơn về code nhưng giòn (brittle) trước thao tác CRUD department — bị loại.
