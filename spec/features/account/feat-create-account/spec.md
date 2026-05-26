

## Context & Goal 
 # Business problem: 
  - Khi có nhân sự mới, Administrator cầm tạo tài khoàn 1 cách nhanh chóng, đúng thông tin và đúng quyền. Nếu làm thủ công có thẻ khó kiểm soát dễ xảy ra các vấn đề như : trùng thông tin unique(email, username,...), gửi sai hoặc không gửi thông tin đăng nhập về mail cho nhân sự mới,.... Với hệ thống này thì tạo tài khoản hệ thống là bước khởi đầu cho những chức năng quan trọng sau này. Nếu xử lý không chặt chẽ thì sẽ ảnh hưởng trực tiếp đến hệ thống.
 # Feature Goal: 
  - CHo phép Administrator tạo một tài khoản mới theo cách : đúng dữ liệu, đúng role và department, an toàn về bảo mật, có thể sử dụng ngay sau khi tạo.
 # Success Metrics:
  - Tạo tài khoản mới với đầy đủ thông tin bắt buộc.
  - Tài khoản được gán đúng role trước khi active.
  - Không phát sinh trùng dữ liệu(email, username,....).
  - Có thể đăng nhập bằng tài khoản được cấp.
  - Các lỗi nhập liệu được phát hiện ngay lập tức khi tạo account.
  - Gửi thông tin về tài khoản nhân viên sau khi tạo thành công account.
 # Technical Context:
  - Stack: Nestjs 16, PostgreeSQL 18, Brevo(send email api).

## Clarifications Applied
- Trạng thái tài khoản ngay sau khi tạo thành công là `Active`.
- Actor chỉ cần permission chính cho use case tạo account, ví dụ `accounts:create` hoặc `accounts:write`; không cần thỏa tất cả permission nhỏ lẻ.
- Việc gán role phải tuân theo cơ chế whitelist role được phép gán.
- Feature này không áp dụng department boundary; Administrator có thể chọn mọi department còn hiệu lực.
- Các trường bắt buộc khi tạo account là: `full_name`, `employee_code`, `email`, `role`.
- `username` không do Administrator nhập; hệ thống tự sinh theo quy tắc `short_name_base + random_4_digits` và normalize trước khi lưu.
- Mỗi account mới chỉ có 1 role chính tại thời điểm tạo.
- `email` được lowercase trước khi lưu; `full_name` được trim và collapse spaces; `phone_number` là optional và phải đúng regex `^\+?[0-9]{10,15}$` nếu được cung cấp.
- `employee_code` là required, unique toàn hệ thống và phải đúng regex `^[A-Z0-9]{4,20}$`.
- `username` được đảm bảo unique bằng cơ chế retry generation tối đa 10 lần kết hợp database unique constraint; nếu vẫn thất bại thì trả lỗi `USERNAME_GENERATION_FAILED` cho field `username` với message `Unable to generate a unique username. Please try again.`
- Dữ liệu account mới được ghi vào các bảng: `users`, `user_roles`, `audit_logs`.
- `department_id` nằm trong bảng `users` và là khóa ngoại tham chiếu `departments`.
- Tài khoản mới phải có `force_change_password = true` và field này có kiểu boolean.
- Temporary password chỉ tồn tại ngắn trong application memory; không được lưu plaintext trong DB, log, cache, queue hay API response.
- Nếu email gửi thất bại, hệ thống vẫn giữ account đã tạo và chỉ hiển thị warning; recovery flow sẽ được xử lý ở use case khác như Resend Initial Credential hoặc Regenerate Temporary Password.
- Nếu role hoặc department không còn hợp lệ tại thời điểm submit, hệ thống trả lỗi nghiệp vụ theo field với code tương ứng: `INVALID_ROLE_SELECTION`, `INVALID_DEPARTMENT_SELECTION`.
- “Có thể đăng nhập” trong success metric được hiểu là account readiness; login thực tế thuộc integration/E2E, không thuộc phạm vi core của UC-AM-01.
- SLA `< 500ms` áp dụng cho API create account, không tính thời gian gửi email async.
- Reuse lookup API có sẵn là hướng ưu tiên.
- `account.created` chỉ là optional extension, không bắt buộc trong core use case.

## Actors & Roles
  | Actors | Mô tả | Permission|
  |Administrator|Actor chính thực hiện use case Create new account|accounts:create hoặc accounts:write|
  |Email Notification System| Actor phụ được sử dụng để gửi email chứa thông tin đăng nhập cho người dùng mới| notification.send_account_email, notification.use_account_template,  notification.receive_delivery_result|

## Function Requirments
 - THE system SHALL chỉ cho phép Administrator truy cập chức năng Create New Account khi có permission chính cho use case này, ví dụ `accounts:create` hoặc `accounts:write`.
 - THE system SHALL hiển thị Create Account Form khi Administrator chọn action Add New Account.
 - THE system SHALL tải danh sách Role, Department hợp lệ từ lookup API có sẵn trong hệ thống để cho Administrator lựa chọn khi tạo account.
 - THE system SHALL validate dữ liệu đầu vào trước khi lưu, bao gồm :
    - Kiểm tra nhập đủ các trường required gồm `full_name`, `employee_code`, `email`, `role`.
    - Kiểm tra `employee_code` theo regex `^[A-Z0-9]{4,20}$`.
    - KIểm tra định dạng của email theo chuẩn email hợp lệ và lowercase trước khi lưu.
    - KIểm tra định dạng của `phone_number` theo regex `^\+?[0-9]{10,15}$` nếu người dùng nhập.
    - Chuẩn hóa `full_name` bằng cách trim và collapse spaces trước khi lưu.
    - Kiểm tra tính duy nhất của email trên hệ thống trước khi tạo account.
    - Kiểm tra tính duy nhất của username trên hệ thống trước khi hoàn tất tạo account.
    - Kiểm tra tính duy nhất của employee_code trên hệ thống trước khi tạo account.
 - WHERE dữ liệu trùng hoặc không hợp lệ, THE system SHALL chặn thao tác lưu và hiển thị lỗi rõ ràng tương ứng theo field cho người dùng.
 - WHEN dữ liệu hợp lệ, THE system SHALL tự động sinh `username` theo quy tắc `short_name_base + random_4_digits`, normalize username và retry tối đa 10 lần nếu bị trùng.
- WHEN dữ liệu hợp lệ, THE system SHALL tự động sinh teporary password ngẫu nhiên.
 - WHEN thao tác lưu thành công, THE system SHALL tạo mới 1 bản ghi user với trạng thái mặc định là Active.
 - WHEN thao tác lưu thành công, THE system SHALL gán đúng 1 role chính cho new user và gán `department` nếu `departmentId` được cung cấp hợp lệ.
 - THE system SHALL chỉ cho phép gán role nằm trong whitelist role mà Administrator được phép gán.
 - THE system SHALL thiết lập force_change_password =  true cho tài khoản mới tạo để bắt buộc họ phải đổi mật khẩu ở lần đăng nhập đầu tiên.
 - WHEN tạo tài khoản thành công, THE system SHALL gọi Email Notification System để gửi email thông báo cho người dùng mới.
 - THE system SHALL gửi email với đầy đủ thông tin : username, temporary password và login URL hoặc hướng dẫn đăng nhập.
 - WHEN gửi email thành công, THE system SHALL hiển thị thông báo tạo tài khoản thành công cho Administrator.
 - WHERE gửi email thất bại, THE system SHALL giữ nguyên tài khoản đã tạo thành công và hiển thị cảnh báo để Administrator biết cần xử lý thủ công; recovery flow sẽ thuộc use case khác.
 - WHEN tạo tài khoản thành công, THE system SHALL đóng form và chuỷen màn hình về  màn hình Account List và làm mới Account List để hiện thị tài khoản vừa tạo.
 - THE system SHALL cho phép Administrator hủy thao tác tạo account trước khi lưu dữ liệu.
 - WHEN Administrator hủy thao tác tạo account, THE system SHALL đóng form chuyển về màn hình Account List và không được phép tạo mới bất kì dữ liệu accoutn nào.
 - THE system SHALL ghi nhận audit log cho hành động tạo tài khoản, bao gồm người thực hiện, thời gian thực hiện, và account được tạo.
 - THE system SHALL từ chối truy cập chức năng này đối với user không có permission chính để tạo account.
 - THE system SHALL trả về kết quả xử lý rõ ràng cho ba trường hợp: tạo thành công, tạo thất bại do validation, và tạo thành công nhưng gửi email thất bại.

 ## Non-Function Requirment
 - Security : Chỉ có đúng actor có quyển mới được tạo account.
 - Password Protection : Chỉ lưu `password_hash`, không lưu plaintext password trong DB, log, cache, queue hay API response.
 - Data Integrity: không được tạo trùng email, username, employee_code.
 - Auditability: phải có log người tạo, thời gian tạo, dữ liệu liên quan.
 - Performance: API create account phải phản hồi nhanh < 500ms, không tính thời gian gửi email async.

 ## Data Model
 - users: employee_code, username, email, password_hash, full_name, phone_number, department_id, status, force_change_password, created_by, updated_by.
 - roles.
 - user_roles.
 - departments.
  - permissions và role_permissions.
 - audit_logs.

 ## Error Handling
 - WHERE thiếu dữ liệu bắt buộc khi nhập vào(`full_name`, `employee_code`, `email`, `role`), THE system SHALL chặn lưu và hiển thị thông báo cho người dùng lỗi thiếu dữ liệu.
 - WHERE trùng các dữ liệu unique, THE system SHALL chặn lưu và hiển thị thông báo cho người dùng lỗi trùng dữ liệu tương ứng theo field như `Email already exists`, `Username already exists`, `Employee code already exists`.
 - WHERE auto-generate username thất bại sau tối đa 10 lần retry, THE system SHALL trả lỗi nghiệp vụ với `code = USERNAME_GENERATION_FAILED`, `field = username`, `message = Unable to generate a unique username. Please try again.`
 - WHERE role hoặc department không còn hợp lệ tại thời điểm submit, THE system SHALL chặn lưu và trả lỗi nghiệp vụ theo field với code tương ứng `INVALID_ROLE_SELECTION` hoặc `INVALID_DEPARTMENT_SELECTION`.
 - WHERE gặp lỗi trong quá trình lưu users hoặc user_role, THE system SHALL rollback.
 - WHERE gặp lỗi chỉ khi ở bước gửi mail, THE system  SHALL gửi cảnh báo cho Administrator và vẫn giữ new account; không giữ temporary password dạng plaintext để gửi thủ công.

 ## Acceptance Criteria
  - [ ] Only Administrator có quyền tạo mới account.
  - [ ] Form phải hỗ trợ nhập `full_name`, `employee_code`, `email`, `role`, `department`, `phone_number` và validate đúng theo rule đã định.
  - [ ] Username phải được hệ thống tự sinh theo quy tắc `short_name_base + random_4_digits`, normalize trước khi lưu và retry tối đa 10 lần nếu bị trùng.
  - [ ] Chỉ role nằm trong whitelist role mà Administrator được phép gán mới được chấp nhận.
  - [ ] `employee_code` là required, unique toàn hệ thống và phải đúng regex `^[A-Z0-9]{4,20}$`.
  - [ ] Nếu role hoặc department không hợp lệ tại thời điểm submit, hệ thống phải trả về error code tương ứng `INVALID_ROLE_SELECTION` hoặc `INVALID_DEPARTMENT_SELECTION`.
  - [ ] Account mới được tạo phải được tạo trong users, gán role qua user_role và có trạng thái Active.
 - [ ] Password phải được hash và bắt buộc user đổi ở lần đăng nhập đầu tiên.
  - [ ] Hệ thống phải gửi email thông báo hoặc cảnh báo nếu gửi thất bại.
  - [ ] Nếu email gửi thất bại, account vẫn được giữ nguyên và hệ thống chỉ hiển thị warning; recovery flow không thuộc phạm vi UC-AM-01.
  - [ ] Account mới được coi là sẵn sàng đăng nhập ở mức account readiness; kiểm chứng login thực tế thuộc integration/E2E.
  - [ ] Account mới phải được persist thành công và có thể truy vấn lại qua Account List API.

 ## Out Of Scope
  - chỉ tập trung vào việc tạo mới một account, gán role, liên kết department, đặt trạng thái hoạt động, sinh mật khẩu tạm thời và gửi email thông báo.
  - không bao gồm các chức năng như cấu hình role/permission/department, cập nhật hoặc xóa account, reset/change password, first login flow, email verification, upload face profile, import hàng loạt từ file, approval workflow, hoặc đồng bộ với hệ thống HR.
