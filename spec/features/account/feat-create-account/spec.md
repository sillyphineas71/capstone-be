

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

## Actors & Roles
  | Actors | Mô tả | Permission|
  |Administrator|Actor chính thực hiện use case Create new account|account.create, account.view, account.assign_role, account.assign_department, account.active|
  |Email Notification System| Actor phụ được sử dụng để gửi email chứa thông tin đăng nhập cho người dùng mới| notification.send_account_email, notification.use_account_template,  notification.receive_delivery_result|

## Function Requirments
 - THE system SHALL Administrator truy cập chức năng Create New Account khi có đủ permission.
 - THE system SHALL hiển thị Create Account Form khi Administrator chọn action Add New Account.
 - THE system SHALL tải danh sách Role, Department hợp lệ từ hệ thống để cho Administrator lựa chọn khi tạo account.
 - THE system SHALL validate dữ liệu đầu vào trước khi lưu, bao gồm :
    - Kiểm tra nhập đủ các trường required.
    - KIểm tra định dạng của email theo chuẩn email hợp lệ.
    - KIểm tra định dạng của phone_number(nếu người dùng nhập).
    - Kiểm tra tính duy nhất của email trên hệ thống trước khi tạo account.
    - Kiểm tra tính duy nhất của employee_code trên hệ thống trước khi tạo account.
 - WHERE dữ liệu trùng hoặc không hợp lệ, THE system SHALL chặn thao tác lưu và hiển thị lỗi rõ ràng tương ứng cho người dùng.
 - WHEN dữ liệu hợp lệ, THE system SHALL tự động sinh teporary password ngẫu nhiên.
 - WHEN thao tác lưu thành công, THE system SHALL tạo mới 1 bản ghi user với trạng thái mặc định là Active.
 - WHEN thao tác lưu thành công, THE system SHALL gán đúng role và deparment cho new user.
 - THE system SHALL thiết lập force_change_password =  true cho tài khoản mới tạo để bắt buộc họ phải đổi mật khẩu ở lần đăng nhập đầu tiên.
 - WHEN tạo tài khoản thành công, THE system SHALL gọi Email Notification System để gửi email thông báo cho người dùng mới.
 - THE system SHALL gửi email với đầy đủ thông tin : username, temporary password và login URL hoặc hướng dẫn đăng nhập.
 - WHEN gửi email thành công, THE system SHALL hiển thị thông báo tạo tài khoản thành công cho Administrator.
 - WHERE gửi email thất bại, THE system SHALL giữ nguyên tài khoản đã tạo thành công và hiển thị cảnh báo để Administrator biết cần xử lý thủ công.
 - WHEN tạo tài khoản thành công, THE system SHALL đóng form và chuỷen màn hình về  màn hình Account List và làm mới Account List để hiện thị tài khoản vừa tạo.
 - THE system SHALL cho phép Administrator hủy thao tác tạo account trước khi lưu dữ liệu.
 - WHEN Administrator hủy thao tác tạo account, THE system SHALL đóng form chuyển về màn hình Account List và không được phép tạo mới bất kì dữ liệu accoutn nào.
 - THE system SHALL ghi nhận audit log cho hành động tạo tài khoản, bao gồm người thực hiện, thời gian thực hiện, và account được tạo.
 - THE system SHALL từ chối truy cập chức năng này đối với user không có permission quản lý account.
 - THE system SHALL trả về kết quả xử lý rõ ràng cho ba trường hợp: tạo thành công, tạo thất bại do validation, và tạo thành công nhưng gửi email thất bại.

 ## Non-Function Requirment
 - Security : Chỉ có đúng actor có quyển mới được tạo account.
 - Password Protection : Chỉ password_hash, không lưu plaintext.
 - Data Integrity: không được tạo trùng email, username, employee_code.
 - Auditability: phải có log người tạo, thời gian tạo, dữ liệu liên quan.
 - Performance: thao tác tạo account phải phản hồi nhanh < 500ms.

 ## Data Model
 - users: employee_code, username, email, password_hash, full_name, phone_number, department_id, status, created_by, updated_by.
 - roles.
 - user_roles.
 - departments.
 - permissions và role_permissions.
 - user_profiles.

 ## Error Handling
 - WHERE thiếu dữ liệu bắt buộc khi nhập vào(email), THE system SHALL chặn lưu và hiển thị thông báo cho người dùng lỗi thiếu dữ liệu.
 - WHERE trùng các dữ liệu unique, THE system SHALL chặn lưu và hiển thị thông báo cho người dùng lỗi trùng dữ liệu.
 - WHERE gặp lỗi trong quá trình lưu users hoặc user_role, THE system SHALL rollback.
 - WHERE gặp lỗi chỉ khi ở bước gửi mail, THE system  SHALL gửi thông báo cho Administrator và vẫn giữ new account.

 ## Acceptance Criteria
  - [ ] Only Administrator có quyền tạo mới account.
  - [ ] Form phải hỗ trợ nhập đủ dữ liệu và validate đúng.
  - [ ] Account mới được tạo phải được tạo trong users, gán role qua user_role và có trạng thái Active.
  - [ ] Password phải được hash và bắt buộc user đổi ở lần đăng nhập đầu tiên.
  - [ ] Hệ thống phải gửi email thông báo hoặc cảnh báo nếu gửi thất bại.
  - [ ] Danh sách account phải được cập nhật sau khi tạo thành công.

 ## Out Of Scope
  - chỉ tập trung vào việc tạo mới một account, gán role, liên kết department, đặt trạng thái hoạt động, sinh mật khẩu tạm thời và gửi email thông báo.
  - không bao gồm các chức năng như cấu hình role/permission/department, cập nhật hoặc xóa account, reset/change password, first login flow, email verification, upload face profile, import hàng loạt từ file, approval workflow, hoặc đồng bộ với hệ thống HR.
