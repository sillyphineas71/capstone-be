# Đánh giá SRS — 2. Account Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "2. Account Management" (UC-05 → UC-19).
Nguồn code đối chiếu: `src/modules/accounts/**` (nhánh `main`, commit `07f47b6`).

## Tổng quan
Số UC: 15 | Khớp hoàn toàn: 1 | Khớp một phần: 12 | Sai hoàn toàn: 1 | Không có code (một phần): 1

---

## UC-05 — Tạo tài khoản nhân viên (thủ công)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Form nhập "Họ và tên, Địa chỉ Email, Vai trò, và Phòng ban" → hệ thống kiểm tra hợp lệ, kiểm tra email trùng → sinh mật khẩu ngẫu nhiên đạt chuẩn bảo mật → gửi email thông báo. BR1: Email là định danh duy nhất. BR2: mật khẩu ngẫu nhiên ≥8 ký tự, hoa/thường/số/đặc biệt. BR3: mọi tài khoản mới bị gắn cờ bắt buộc đổi mật khẩu lần đầu.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/dto/create-user.dto.ts:42-49` — `roleIds` là **mảng UUID bắt buộc không rỗng** (`@IsArray`, `@ArrayNotEmpty`), không phải 1 dropdown chọn "Vai trò" duy nhất như SRS mô tả — tài khoản có thể được gán nhiều vai trò ngay lúc tạo.
- `src/modules/accounts/dto/create-user.dto.ts:76-88` — có 2 trường **hoàn toàn không có trong form SRS**: `directManagerId` (UUID người quản lý trực tiếp, optional) và `accountType: 'employee' | 'partner'` + `accountExpiresAt`.
- `src/modules/accounts/services/users.service.ts:142-336` (`createUser`) — **phát hiện lớn: tồn tại loại tài khoản "partner" (đối tác) hoàn toàn không có trong SRS**:
  - Khi `accountType === 'partner'`: `departmentId` bị ép cứng thành `PARTNER_DEPARTMENT_ID` (bỏ qua giá trị client gửi) (dòng 151); bắt buộc `accountExpiresAt` là thời điểm tương lai (`validatePartnerProvisionPayload`, dòng 452-466); bắt buộc đính kèm ảnh sinh trắc học JPEG/PNG/WEBP ≤5MB upload thẳng lên Cloudinary (dòng 467-489).
  - `src/modules/accounts/services/users.service.ts:512-514` (`persistAccount`) — **mật khẩu của tài khoản partner = chính địa chỉ email**, không sinh ngẫu nhiên, không áp policy phức tạp nào → **mâu thuẫn trực tiếp với BR2** (chỉ áp dụng cho `accountType='employee'`).
  - `persistAccount:532` — `mustChangePassword: !data.partner` → tài khoản partner **không** bị bắt buộc đổi mật khẩu lần đầu → **mâu thuẫn trực tiếp với BR3** (BR3 chỉ đúng với employee).
  - `persistAccount:546-577` — tài khoản partner còn tự động tạo `FaceProfileEntity` với `status: ACTIVE` ngay lập tức, **bỏ qua hoàn toàn bước duyệt** (UC-17) mà SRS mô tả cho mọi ảnh khuôn mặt khác.
- `src/modules/accounts/services/users.service.ts:515` — với tài khoản employee (không phải partner), mật khẩu tạm được sinh bởi `PasswordGeneratorService.generateTemporaryPassword(12)` (`src/modules/accounts/services/password-generator.service.ts:11-34`) — đảm bảo có ≥1 hoa/thường/số/ký tự đặc biệt, 12 ký tự, dùng CSPRNG shuffle → khớp chính xác BR2 (chỉ cho nhánh employee).
- `src/modules/accounts/services/users.service.ts:522,532` — `username = email` (BR4 nội bộ) và `mustChangePassword: true` cho employee → khớp BR1 và BR3 (chỉ cho nhánh employee).
- `src/modules/accounts/services/users.service.ts:223-245,247-265` — kiểm tra thêm: phòng ban phải `isActive`, từng vai trò phải `isActive`, mã nhân viên (nếu có) không trùng, người quản lý trực tiếp (nếu có) phải active/chưa nghỉ việc — **không có UC nào trong SRS UC-05 nhắc tới các ràng buộc "phòng ban/vai trò phải đang hoạt động" hay "quản lý trực tiếp"**.
- `src/modules/accounts/services/users.service.ts:373-401` — email chào mừng được gửi qua **hàng đợi bất đồng bộ** (`notificationsService.enqueueEmailNotification`), không phải "hệ thống tự động kích hoạt tiến trình gửi email" đồng bộ ngay như câu chữ SRS ngụ ý; nếu enqueue thất bại, hệ thống vẫn coi tài khoản tạo thành công và chỉ ghi audit cảnh báo (dòng 402-426) — SRS không đề cập khả năng "tạo tài khoản thành công nhưng email có thể không gửi được".
- `src/modules/accounts/dto/create-user.dto.ts:54-57` — `employeeCode` là **optional**, không phải trường bắt buộc trong form tạo mới (SRS cũng không liệt kê employeeCode trong form UC-05, nên đây không phải mâu thuẫn — chỉ là chi tiết bổ sung).

**Nhận xét:**
1. Loại tài khoản "partner" là một tính năng hoàn toàn song song, có luồng bảo mật khác hẳn (mật khẩu = email, không bắt đổi mật khẩu, face profile auto-active) — không được nhắc tới trong SRS UC-05 dù dùng chung endpoint `POST /users`.
2. Vai trò là tập hợp nhiều giá trị (mảng), không phải lựa chọn đơn như SRS mô tả.
3. Nhiều ràng buộc nghiệp vụ (phòng ban/vai trò active, quản lý trực tiếp hợp lệ) không được liệt kê trong Exceptions của SRS.

**Đề xuất sửa SRS:**
- Bổ sung Precondition/Note: "Tài khoản được tạo qua chức năng này thuộc loại `employee` (nhân viên nội bộ, áp dụng đầy đủ BR2/BR3). Có một loại tài khoản khác — `partner` (đối tác ngoài) — dùng cùng API nhưng có cơ chế bảo mật và phê duyệt khác hẳn (mật khẩu = email, không bắt đổi mật khẩu, có hạn dùng, ảnh khuôn mặt tự động active); loại này nên được đặc tả thành một UC riêng."
- Sửa form fields ở bước 2: thay "Vai trò" (số ít) thành "Một hoặc nhiều Vai trò"; bổ sung 2 trường tùy chọn "Người quản lý trực tiếp" và (khi tạo tài khoản đối tác) "Ngày hết hạn tài khoản, Ảnh khuôn mặt".
- Bổ sung Exception: "Nếu phòng ban hoặc vai trò được chọn hiện đang ở trạng thái ngừng hoạt động, hoặc người quản lý trực tiếp được chọn đang bị khóa/đã nghỉ việc, hệ thống từ chối tạo tài khoản và báo lỗi tương ứng."

---

## UC-06 — Tạo tài khoản nhân viên (import Excel)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Tải file mẫu → tải lên file Excel → hệ thống đọc, kiểm tra, hiển thị preview → người dùng xác nhận tạo cho các dòng hợp lệ → sinh mật khẩu, gửi email. BR1: mật khẩu ≥8 ký tự đạt chuẩn. BR2: dòng lỗi bị bỏ qua, dòng hợp lệ vẫn được tạo. BR3: bắt buộc đổi mật khẩu lần đầu. BR4: chỉ dùng Email.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/controllers/users.controller.ts:138-155` (`GET /users/import/template`) — khớp AF1 (tải file mẫu).
- `src/modules/accounts/controllers/users.controller.ts:157-241` (`POST /users/import`) — cùng 1 endpoint dùng chung cho preview và commit qua tham số `commit` (`ImportAccountsDto`); `commit=false` trả preview không ghi DB, `commit=true` mới tạo — khớp đúng ý luồng SRS bước 4-7 (đọc → preview → xác nhận tạo), dù thực hiện qua 2 lần gọi API khác `commit`, không phải qua 1 nút "Tiến hành tạo tài khoản" ở giữa trang preview.
- `src/modules/accounts/services/account-import.service.ts:176-322` (`importAccounts`) — **phát hiện lớn: hỗ trợ đính kèm ảnh sinh trắc học hàng loạt hoàn toàn không có trong SRS UC-06**: field `photos` (multipart, tối đa `MAX_IMPORT_ROWS`=200 ảnh) khớp theo tên file gốc = `employee_code`; nếu có gửi kèm ảnh và `commit=true`, **bắt buộc** `biometricConsentConfirmed=true` (dòng 195-209), nếu không trả `BIOMETRIC_CONSENT_REQUIRED` (400). Ảnh khớp được tạo `face_profiles` trạng thái `pending_review`, giống hệt luồng tự nộp ảnh UC-16.
- `src/modules/accounts/constants/import-accounts.constants.ts:6` — `MAX_IMPORT_ROWS = 200` — **giới hạn số dòng tối đa không được SRS nhắc tới** (SRS EX1 chỉ nói về sai định dạng/dung lượng file, không giới hạn số dòng).
- `src/modules/accounts/services/account-import.service.ts:253-294` — xử lý từng dòng trong 1 transaction riêng (per-row), dòng lỗi không làm rớt các dòng khác — khớp chính xác BR2.
- `src/modules/accounts/services/account-import.service.ts:259-266` — mỗi dòng hợp lệ gọi lại đúng `UsersService.persistAccount` (cùng hàm dùng cho UC-05) → thừa hưởng đúng cơ chế sinh mật khẩu 12 ký tự đạt chuẩn (BR1) và `mustChangePassword=true` (BR3, chỉ áp dụng loại `employee` — import không hỗ trợ tạo tài khoản `partner`).
- `src/modules/accounts/services/account-import.service.ts:296-299` — gửi email credentials **best-effort theo từng người** sau khi tạo xong toàn bộ (không phải "tự động kích hoạt" đồng thời với việc tạo — có độ trễ thứ tự: tạo hết → mới gửi email).

**Nhận xét:**
1. SRS hoàn toàn thiếu tính năng đính kèm ảnh sinh trắc học hàng loạt trong luồng import (yêu cầu xác nhận đồng ý riêng).
2. SRS thiếu giới hạn cứng 200 dòng/file.
3. Cơ chế "preview rồi mới tạo" hiện thực bằng 2 lần gọi API (khác giá trị `commit`), không phải 1 API trả preview + 1 nút "confirm" gọi tiếp API khác — về bản chất tương đương nhưng đáng ghi chú kỹ thuật.

**Đề xuất sửa SRS:**
- Bổ sung Alternative Flow: "AF2: Đính kèm ảnh sinh trắc học hàng loạt — Người dùng có thể tải kèm tối đa 200 ảnh chân dung, mỗi ảnh đặt tên theo đúng Mã nhân viên tương ứng trong file Excel; hệ thống tự động khớp ảnh với từng dòng. Nếu có đính kèm ảnh, người dùng bắt buộc xác nhận đã có sự đồng ý của nhân viên trước khi tiến hành tạo tài khoản; ảnh khớp được sẽ vào hàng chờ duyệt giống luồng tự nộp ảnh (UC-16/17)."
- Bổ sung Business Rule: "BR5: Hệ thống giới hạn tối đa 200 dòng dữ liệu cho mỗi lần import; vượt quá số này, hệ thống từ chối toàn bộ file."

---

## UC-07 — Khởi tạo phòng ban mới
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Form chỉ có "Tên phòng ban, Mã phòng ban" (+ "thiết lập thông tin quản lý liên quan"). BR1: Mã phòng ban là định danh duy nhất. BR2: Tên phòng ban phải duy nhất.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/services/departments.service.ts:37` — `MAX_DEPTH = 5`; `createDepartment` (dòng 50-245) nhận và xử lý **cấu trúc phân cấp cha-con hoàn chỉnh** (`parentDepartmentId`) với kiểm tra phòng ban cha phải tồn tại + đang active (dòng 120-133) và giới hạn độ sâu tối đa 5 cấp (dòng 135-145, lỗi `422 VALIDATION_ERROR` nếu vượt) — **toàn bộ khái niệm phân cấp phòng ban không có trong SRS UC-07** (SRS chỉ mô tả phòng ban phẳng, không cha-con).
- `src/modules/accounts/services/departments.service.ts:89-117` — kiểm tra trùng `departmentCode` và trùng `departmentName` bằng **2 exception riêng biệt** với 2 message khác nhau ("Ma phong ban nay da duoc su dung." / "Ten phong ban nay da duoc su dung.", viết không dấu) — khớp tinh thần BR1+BR2 nhưng khác với SRS's single combined message ở EX2 ("Mã phòng ban hoặc Tên phòng ban này đã được sử dụng...").
- `src/modules/accounts/services/departments.service.ts:148-163` — `managerUserId` (người quản lý) là optional, nếu có phải là user đang `active` — khớp ý "thiết lập thông tin quản lý liên quan" của SRS bước 3.
- `src/modules/accounts/controllers/departments.controller.ts:90` — header `Idempotency-Key` được hỗ trợ (chống tạo trùng do double-submit, cache 24h) — không có trong SRS.

**Nhận xét:** Thiếu sót chính là toàn bộ mô hình phân cấp cha-con (tối đa 5 cấp) — một phần cấu trúc dữ liệu cốt lõi của phòng ban trong code nhưng vắng mặt hoàn toàn trong SRS.

**Đề xuất sửa SRS:** Bổ sung vào form bước 2: "Phòng ban cha (tùy chọn, dùng để xây dựng cơ cấu tổ chức phân cấp)"; bổ sung Business Rule: "BR3: Phòng ban có thể được tổ chức theo cấu trúc cha-con; hệ thống giới hạn tối đa 5 cấp phân cấp. Phòng ban cha được chọn phải đang ở trạng thái hoạt động."

---

## UC-08 — Cập nhật vai trò & quyền tài khoản
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Chọn 1 vai trò mới từ dropdown thay thế vai trò hiện tại → lưu. Exceptions: N/A. BR1: tài khoản phải gắn ít nhất 1 vai trò. BR2: hệ thống luôn đảm bảo có ít nhất 1 Quản trị viên hoạt động.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/controllers/users.controller.ts:243-317` (`PUT /users/:userId/roles`) + `src/modules/accounts/dto/update-user-roles.dto.ts` — nhận `roleIds: string[]` là **tập hợp mong muốn đầy đủ (replace-set)**, không phải chọn 1 giá trị đơn từ dropdown — khác hẳn mô tả SRS ("người dùng lựa chọn một vai trò mới thay thế cho vai trò hiện tại").
- `src/modules/accounts/services/users.service.ts:647-658` — **Exception hoàn toàn không có trong SRS**: nếu tài khoản mục tiêu không ở trạng thái `active`, trả `422 ACCOUNT_INACTIVE`.
- `src/modules/accounts/services/users.service.ts:705-721` (BR-04 nội bộ) — **self-lockout**: nếu actor tự sửa vai trò của chính mình và đang định gỡ 1 vai trò hệ thống (`isSystemRole`), hệ thống chặn với `422 CANNOT_MODIFY_OWN_ADMIN_ROLE` — hoàn toàn không có trong SRS.
- `src/modules/accounts/services/users.service.ts:690-703,765-794` — **phát hiện lớn: cơ chế thu hồi sinh trắc học tự động khi giáng chức**: nếu actor gỡ user khỏi vai trò miễn trừ sinh trắc học (BUSINESS_ADMIN/SYSTEM_ADMIN), toàn bộ `face_profiles` đang `ACTIVE` của user đó bị chuyển sang `REVOKED`, buộc nộp lại ảnh — liên kết chéo với UC-16/17, không hề có trong SRS.
- **BR2 của SRS ("hệ thống luôn đảm bảo có ít nhất 1 Quản trị viên hoạt động") KHÔNG được enforce trong hàm này**: toàn bộ 196 dòng code (`updateUserRoles`, dòng 623-818) không có bất kỳ truy vấn nào đếm "SYSTEM_ADMIN cuối cùng còn lại" khi một actor (không phải chính user đó) gỡ vai trò SYSTEM_ADMIN của MỘT tài khoản khác — trong khi 3 hàm khác cùng file (`deleteUser` dòng 895-920, `lockUser` dòng 1126-1158, `updateUserStatus`→INACTIVE dòng 1382-1414) đều có block kiểm tra "LAST_SYSTEM_ADMIN" giống hệt nhau. Đây là lỗ hổng thực tế: một System Admin có thể gỡ vai trò SYSTEM_ADMIN của System Admin còn lại duy nhất khác mà không bị chặn, khiến hệ thống có thể mất hết Quản trị viên hoạt động — trái với chính BR2 mà SRS đặt ra.

**Nhận xét:**
1. Mô hình dữ liệu là multi-role (replace-set), không phải single-role như SRS.
2. SRS ghi "Exceptions: N/A" nhưng thực tế có ít nhất 4 nhánh lỗi (404 not found, 404/422 role, 422 account inactive, 422 self-lockout).
3. BR2 của chính SRS không được code thực thi đầy đủ trong đường dẫn cập nhật vai trò (chỉ được thực thi ở khóa/xóa/vô hiệu hóa tài khoản).

**Đề xuất sửa SRS:**
- Sửa Normal Flow bước 3-4: thay "chọn một vai trò mới thay thế" thành "chọn tập hợp một hoặc nhiều vai trò mong muốn (có thể giữ, thêm, hoặc bỏ bớt vai trò hiện có)".
- Thay "Exceptions: N/A" bằng danh sách: tài khoản không active; vai trò không tồn tại/không active; không thể tự gỡ vai trò hệ thống của chính mình.
- Bổ sung Postcondition: "Nếu người dùng bị gỡ khỏi vai trò Quản trị viên (miễn trừ sinh trắc học), mọi hồ sơ khuôn mặt đang hoạt động của người đó bị thu hồi và yêu cầu nộp lại."
- Gắn cờ rủi ro/TODO kỹ thuật cho BE: BR2 hiện chưa được enforce khi thao tác qua endpoint cập nhật vai trò — nên bổ sung kiểm tra "còn ít nhất 1 SYSTEM_ADMIN active" tương tự 3 hàm kia.

---

## UC-09 — Cập nhật thông tin tài khoản (Admin)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (1 điểm mâu thuẫn trực tiếp với BR1 của SRS)

**SRS hiện tại ghi:** Bước 4: "thay đổi các thông tin cần thiết (mã nhân viên, số điện thoại, **email**, phòng ban, chức danh)". BR1: "Việc thay đổi Email đồng nghĩa với việc thay đổi tài khoản đăng nhập... Hệ thống sẽ sử dụng Email mới này cho các phiên xác thực tiếp theo."

**Code thực tế (bằng chứng):**
- `src/modules/accounts/dto/update-user.dto.ts:11-20` — docstring xác nhận rõ: "Chỉ 5 trường hồ sơ được phép cập nhật: fullName, employeeCode, phoneNumber, positionTitle, departmentId... **KHÔNG có: email (bất biến)**, directManagerId, roleIds, accountStatus, username, avatarUrl". Controller dùng `forbidNonWhitelisted: true` (`users.controller.ts:583-589`) → gửi field `email` sẽ bị từ chối 400.
- `src/modules/accounts/services/users.service.ts:1459-1469` — comment xác nhận lại: "Email/username/role/account_status/password/avatar KHÔNG thuộc UC-09."
- **→ Email hoàn toàn KHÔNG THỂ đổi qua endpoint `PATCH /users/:userId` — mâu thuẫn trực tiếp với cả Normal Flow bước 4 lẫn BR1 của SRS.**
- `src/modules/accounts/services/users.service.ts` (`updateUser`, dòng 1471+) — có kiểm tra department-scope cho Business Admin (chỉ sửa được nhân sự trong phạm vi phòng ban quản lý) — không có trong SRS (SRS coi Business Admin có quyền như nhau trên toàn hệ thống).

**Nhận xét:** Đây là sai lệch rõ ràng nhất trong mục Account Management: SRS mô tả email có thể đổi qua UC-09 và trình bày hẳn 1 Business Rule riêng cho việc này, nhưng code hiện tại (có comment tường minh, rõ ràng là quyết định thiết kế chủ đích, không phải thiếu sót) khẳng định email là bất biến qua endpoint quản trị này.

**Đề xuất sửa SRS:**
- Xóa "email" khỏi danh sách trường có thể sửa ở Normal Flow bước 4.
- Xóa hoàn toàn BR1 hiện tại (đổi email = đổi định danh đăng nhập), thay bằng: "BR1: Địa chỉ Email của tài khoản là bất biến sau khi khởi tạo và không thể chỉnh sửa qua chức năng Cập nhật thông tin tài khoản. Đây là quyết định thiết kế nhằm giữ email luôn là định danh đăng nhập ổn định."
- Bổ sung: "Business Admin chỉ được cập nhật thông tin của nhân sự thuộc phạm vi phòng ban mình quản lý; ngoài phạm vi này, hệ thống từ chối với lỗi không đủ quyền."

---

## UC-10 — Xóa tài khoản
**Trạng thái:** ❌ SAI HOÀN TOÀN (đối với Postcondition/bản chất thao tác; luồng validate xung quanh thì khớp một phần)

**SRS hiện tại ghi:** POST-1: "Tài khoản mục tiêu và các thông tin hồ sơ cá nhân liên quan bị gỡ bỏ **VĨNH VIỄN** khỏi cơ sở dữ liệu hệ thống." Hộp thoại xác nhận: "...sẽ gỡ bỏ hoàn toàn tài khoản khỏi hệ thống và **không thể khôi phục**." EX1: chặn xóa nếu "đã từng được sử dụng để tổ chức họp, tham gia họp hoặc được gán tên vào các biên bản/danh sách công việc" (không giới hạn thời gian).

**Code thực tế (bằng chứng):**
- `src/modules/accounts/services/users.service.ts:1004-1005` — `await tem.softDelete(UserEntity, targetUserId);` — đây là **SOFT DELETE** (đặt `deletedAt`), dữ liệu vẫn còn nguyên trong DB, không phải xóa vĩnh viễn → **mâu thuẫn trực tiếp** với Postcondition và nội dung hộp thoại xác nhận của SRS. (Phù hợp với nguyên tắc chung của dự án — CLAUDE.md mục 5.4: "Soft delete chỉ dùng khi thật sự cần" — đây chính là trường hợp cần dùng, nhưng SRS lại mô tả sai bản chất kỹ thuật.)
- `src/modules/accounts/services/users.service.ts:922-1000` — 5 loại ràng buộc chặn xóa, **và cả 5 đều chỉ xét dữ liệu ĐANG HOẠT ĐỘNG/SẮP TỚI** (`status IN (SCHEDULED, IN_PROGRESS)` và `endTime > now`), không xét lịch sử quá khứ:
  - (a) là host/organizer của cuộc họp sắp tới/đang diễn ra (`upcoming_meeting_host`),
  - (b) là participant của cuộc họp sắp tới/đang diễn ra (`upcoming_meeting_participant`),
  - (c) có room booking còn hiệu lực (`active_booking`),
  - (d) đang là quản lý trực tiếp của nhân sự khác đang active (`manages_users`),
  - (e) đang là trưởng phòng ban active (`manages_department`).
  - → **Không có kiểm tra "đã từng tổ chức/tham gia họp trong QUÁ KHỨ"** như SRS mô tả (một người đã tổ chức 100 cuộc họp đã hoàn tất trong quá khứ vẫn XÓA ĐƯỢC nếu không còn ràng buộc active/sắp tới) — SRS mô tả rule chặt hơn thực tế.
  - → **Không có kiểm tra "được gán tên vào biên bản/danh sách công việc"** (meeting minutes / action items) trong 5 loại này — hoàn toàn vắng mặt.
  - → Ngược lại, code có 2 loại ràng buộc **KHÔNG có trong SRS**: đang là quản lý trực tiếp của người khác, đang là trưởng phòng ban.
- `src/modules/accounts/services/users.service.ts:876-883` — **không có trong SRS**: không được tự xóa chính mình (`CANNOT_DELETE_SELF`, 422).
- `src/modules/accounts/services/users.service.ts:895-919` — **không có trong SRS**: không được xóa nếu là SYSTEM_ADMIN active cuối cùng còn lại (`LAST_SYSTEM_ADMIN`, 422).
- `src/modules/accounts/services/users.service.ts:1014-1018` — soft-delete kèm theo `face_profiles` và `device_user_mappings` liên quan; `1044-1055` — thu hồi token qua Redis `invalid_after` (post-commit, best-effort).

**Nhận xét:** Đây là điểm sai nghiêm trọng nhất trong mục này: bản chất "xóa vĩnh viễn, không thể khôi phục" mà SRS khẳng định trực tiếp trong cả postcondition lẫn nội dung cảnh báo hiển thị cho người dùng là **không đúng sự thật** — hệ thống chỉ soft-delete. Ngoài ra phạm vi ràng buộc chặn xóa cũng khác về bản chất (active/sắp tới thay vì lịch sử toàn thời gian).

**Đề xuất sửa SRS:**
- Sửa Postcondition POST-1 thành: "Tài khoản mục tiêu được đánh dấu đã xóa (xóa mềm) trong cơ sở dữ liệu; tài khoản không còn xuất hiện trong các danh sách và không thể đăng nhập, nhưng dữ liệu lịch sử (hồ sơ, log liên quan) vẫn được lưu trữ để phục vụ tra cứu/kiểm toán."
- Sửa nội dung hộp thoại xác nhận: bỏ cụm "và không thể khôi phục"; thay bằng cảnh báo phù hợp (ví dụ: "Tài khoản sẽ bị vô hiệu hóa hoàn toàn và ẩn khỏi hệ thống.").
- Sửa EX1 thành: "Nếu tài khoản đang là người tổ chức/chủ trì hoặc người tham dự của một cuộc họp SẮP DIỄN RA hoặc ĐANG DIỄN RA, đang có một lượt đặt phòng còn hiệu lực, đang là quản lý trực tiếp của nhân sự khác đang hoạt động, hoặc đang là trưởng phòng ban đang hoạt động, hệ thống chặn thao tác xóa."
- Bổ sung Exception: "Không thể tự xóa tài khoản của chính mình." và "Không thể xóa tài khoản Quản trị viên hệ thống cuối cùng còn đang hoạt động."

---

## UC-11 — Cập nhật trạng thái tài khoản (Khóa/Kích hoạt)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (mô hình trạng thái khác cấu trúc)

**SRS hiện tại ghi:** Một nút chuyển đổi trạng thái duy nhất, chuyển "tài khoản từ Hoạt động sang Vô hiệu hóa, hoặc ngược lại". EX1: không thể tự vô hiệu hóa chính mình.

**Code thực tế (bằng chứng):**
- Thực tế có **3 endpoint tách biệt**, không phải 1 nút toggle:
  - `PATCH /users/:userId/status` (`users.controller.ts:321-395`, permission `accounts.user.update_status`) — chỉ chuyển đổi **ACTIVE ⟷ INACTIVE** (trạng thái nghiệp vụ thông thường).
  - `PATCH /users/:userId/lock` (`users.controller.ts:399-473`, permission `accounts.user.lock`) — chuyển sang **LOCKED** (kỷ luật/bảo mật), có trường `reason` tùy chọn ghi vào audit.
  - `PATCH /users/:userId/unlock` (`users.controller.ts:475-539`, permission `accounts.user.unlock`) — chỉ chuyển **LOCKED → ACTIVE**, reset `failedLoginCount=0`.
  - → Khớp với phát hiện ở UC-01 (login phân biệt rõ `inactive` và `locked` là 2 trạng thái riêng, HTTP status khác nhau).
- `src/modules/accounts/services/users.service.ts:1350-1364` — **Exception không có trong SRS**: không thể chuyển ACTIVE↔INACTIVE khi tài khoản đang `LOCKED` hoặc `PENDING_RESET` (409 `INVALID_STATUS_TRANSITION`) — phải mở khóa trước (dùng endpoint `/unlock` riêng).
- `src/modules/accounts/services/users.service.ts:1374-1379` (khi chuyển INACTIVE) và `1112-1119` (`lockUser`) — 2 nhánh tự bảo vệ khác nhau ("Bạn không thể vô hiệu hóa tài khoản của chính mình." / "Bạn không thể khóa tài khoản của chính mình.") — khớp tinh thần EX1 của SRS, nhưng SRS chỉ có 1 nhánh EX1 vì gộp chung 2 hành động thành 1.
- `src/modules/accounts/services/users.service.ts:1382-1414` (INACTIVE) và `1126-1158` (LOCKED) — cả hai đều chặn nếu target là SYSTEM_ADMIN active cuối cùng — không có trong SRS.
- `src/modules/accounts/services/users.service.ts:1093-1110,1233-1250,1339-1348` — **Business Admin bị giới hạn theo phạm vi phòng ban** (`resolveDepartmentScope`) cho cả 3 endpoint; System Admin không giới hạn — SRS chỉ liệt kê "Business Admin, System Admin" ngang hàng, không phân biệt phạm vi.
- `src/modules/accounts/services/users.service.ts:1439-1454` — chỉ thu hồi token (Redis `invalid_after`) khi chuyển sang **INACTIVE**; `unlockUser` (dòng 1287-1288) **không** thao tác token gì cả (vì tài khoản LOCKED vốn không có phiên hợp lệ) — khớp tinh thần POST-2 của SRS cho nhánh vô hiệu hóa, nhưng SRS không phân biệt rạch ròi 3 luồng.
- BR2 của SRS ("tài khoản Vô hiệu hóa vẫn giữ tên hiển thị trong báo cáo lịch sử... nhưng ẩn khỏi danh sách chọn mời họp mới") — không tìm thấy bằng chứng code cho phần "ẩn khỏi danh sách chọn mời họp" trong phạm vi module `accounts` (thuộc trách nhiệm module `meetings` — cần đối chiếu ở mục Meeting Management, không kết luận ở đây).

**Nhận xét:** SRS mô tả một thao tác toggle nhị phân đơn giản, trong khi code triển khai một mô hình trạng thái 3-status (`ACTIVE`/`INACTIVE`/`LOCKED`) với 3 endpoint, 3 permission, và ràng buộc chuyển trạng thái (state machine) rõ ràng hơn nhiều.

**Đề xuất sửa SRS:** Viết lại UC-11 thành 3 luồng con rõ ràng (hoặc tách 3 UC): (1) Chuyển đổi Hoạt động/Vô hiệu hóa — chỉ áp dụng khi tài khoản không đang bị khóa; (2) Khóa tài khoản (kỷ luật/bảo mật, có lý do tùy chọn) — kèm chặn tự khóa mình và khóa Quản trị viên hệ thống cuối cùng; (3) Mở khóa tài khoản — chỉ áp dụng khi đang bị khóa, đưa về Hoạt động và reset bộ đếm đăng nhập sai. Ghi rõ Business Admin bị giới hạn theo phạm vi phòng ban quản lý.

---

## UC-12 — Xem, Tìm kiếm & Lọc Danh sách Tài khoản
**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Tìm theo Họ tên/Email/Mã NV, lọc theo Phòng ban/Vai trò/Trạng thái, debounce, xóa bộ lọc. BR-01: không phân biệt hoa thường. BR-02: áp dụng cho cả active/inactive. BR-03: chỉ tìm trên Họ tên/Email/Mã NV.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/services/users.service.ts:2071-2079` (`listUsersForManagement`) — tìm kiếm bằng `ILIKE` (case-insensitive) trên đúng 3 trường `fullName`/`email`/`employeeCode` → khớp chính xác BR-01 và BR-03.
- `src/modules/accounts/services/users.service.ts:2054-2069` — lọc theo `departmentId`, `accountStatus`, `roleId` — không có điều kiện mặc định loại trừ trạng thái nào → khớp chính xác BR-02.
- `src/modules/accounts/services/users.service.ts:2081-2089` — sắp xếp qua allowlist `SORT_MAP` cố định (không đưa input trực tiếp vào `ORDER BY`, chống SQL injection) — chi tiết bảo mật hợp lý, không mâu thuẫn SRS.
- `src/modules/accounts/services/users.service.ts:2029-2043` — Business Admin bị giới hạn theo `resolveDepartmentScope`; nếu lọc theo `departmentId` ngoài phạm vi → 403 — không có trong SRS nhưng không mâu thuẫn (chỉ là ràng buộc bổ sung hợp lý theo phân quyền).

**Nhận xét:** Không có sai lệch cốt lõi so với 3 Business Rule mà SRS đặt ra.

**Đề xuất sửa SRS:** Không bắt buộc; có thể bổ sung ghi chú "Business Admin chỉ tìm kiếm/lọc được trong phạm vi phòng ban mình quản lý."

---

## UC-13 — Xem chi tiết hồ sơ tài khoản
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Xem chi tiết hồ sơ ở chế độ chỉ đọc, chia 3 khu vực: Thông tin cá nhân, Cấu trúc tổ chức, Thông tin hệ thống.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/controllers/users.controller.ts:821-887` (`GET /users/:userId`, permission `account.user.read.detail`) — endpoint tồn tại, mô tả "Business Admin bị giới hạn department scope" — khớp ý chính.
- `src/modules/accounts/controllers/users.controller.ts:889-936` (`GET /users/:userId/public-profile`) — **endpoint hoàn toàn không có trong SRS**: bất kỳ user đã đăng nhập nào (chỉ cần `JwtAuthGuard`, không cần permission quản trị) đều xem được hồ sơ công khai rút gọn (id, fullName, email, employeeCode, department, avatarUrl) của người khác — một luồng xem hồ sơ dành cho NHÂN VIÊN THƯỜNG xem đồng nghiệp, khác hẳn với UC-13 (dành riêng cho Admin xem chi tiết đầy đủ).

**Nhận xét:** Chức năng chính (Admin xem chi tiết) khớp, nhưng SRS bỏ sót hoàn toàn một luồng xem hồ sơ công khai dành cho toàn bộ nhân viên (không cần quyền quản trị) — đây có thể là chức năng phục vụ các UC khác (ví dụ xem thông tin người được mời họp) nhưng đáng được ghi nhận trong mục Account Management vì cùng nằm trong `UsersController`.

**Đề xuất sửa SRS:** Bổ sung ghi chú/UC phụ: "Ngoài luồng Admin xem chi tiết hồ sơ (đầy đủ, giới hạn quyền), hệ thống còn cung cấp một hồ sơ công khai rút gọn (Họ tên, Email, Mã NV, Phòng ban, Ảnh đại diện) mà bất kỳ người dùng đã đăng nhập nào cũng xem được của bất kỳ đồng nghiệp nào, không cần quyền quản trị."

---

## UC-14 — Xem lịch sử hoạt động tài khoản
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Truy cập từ trong Quản lý tài khoản, chọn "Xem lịch sử hoạt động" của một tài khoản cụ thể → danh sách sự kiện giảm dần theo thời gian → lọc theo thời gian/loại hành động → AF1 xuất dữ liệu (.csv/.xlsx).

**Code thực tế (bằng chứng):**
- `src/modules/administration/controllers/audit-logs.controller.ts:44-94` (`GET /audit-logs`, permission `audit.system.read`, chỉ SYSTEM_ADMIN) — đây là **một endpoint audit-log TOÀN HỆ THỐNG dùng chung** (nội bộ gọi là "UC-AA-11", thuộc mục Section 15/Analytics & Administration của SRS này — trùng với UC-99 "Xem nhật ký kiểm tra hệ thống"), không phải một tính năng riêng gắn trong màn hình Quản lý tài khoản; để xem lịch sử của MỘT tài khoản cụ thể, client phải gọi cùng endpoint này kèm filter `userId` (`QueryAuditLogsDto`).
- Quyền truy cập: `audit.system.read`, chỉ SYSTEM_ADMIN — khớp đúng Primary Actor của SRS UC-14 (chỉ liệt kê "System Admin").
- `src/modules/administration/controllers/audit-logs.controller.ts:103-152` (`GET /audit-logs/export`) — xuất **chỉ định dạng XLSX** (không hỗ trợ CSV như SRS AF1 đề cập "(.csv hoặc .xlsx)"), giới hạn an toàn 50.000 dòng, bắt buộc `from`/`to`.
- Không tìm thấy đoạn code nào xử lý message đặc thù "Tài khoản này chưa phát sinh bất kỳ lịch sử hoạt động nào" (EX1 của SRS) — với danh sách rỗng, API chỉ trả `meta.total=0` như mọi truy vấn rỗng khác, không có message riêng biệt.

**Nhận xét:** Về mặt dữ liệu, chức năng được đáp ứng (có thể lọc theo `userId`, theo khoảng thời gian, xuất Excel), nhưng đây là MỘT tính năng audit-log tổng dùng chung cho cả UC-14 (Account Management) và UC-99 (Administration), không phải một sub-feature riêng của màn hình quản lý tài khoản như SRS mô tả.

**Đề xuất sửa SRS:** Ghi chú rõ: "Chức năng xem lịch sử hoạt động của một tài khoản sử dụng chung API/màn hình Nhật ký kiểm tra hệ thống (xem thêm mục Administration), được lọc theo tài khoản cụ thể — không phải một API riêng biệt." Sửa AF1: chỉ hỗ trợ xuất định dạng .xlsx (không có .csv).

---

## UC-15 — Cập nhật thông tin cá nhân (Tự phục vụ)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (phần sửa Họ tên/SĐT: ❌ KHÔNG TÌM THẤY CODE)

**SRS hiện tại ghi:** Người dùng vào "Hồ sơ cá nhân" → nhấn "Chỉnh sửa" → sửa thông tin (bao gồm ngụ ý cả họ tên, SĐT — Email/Mã NV bị khóa) hoặc tải ảnh đại diện → lưu. BR1: Email/Mã NV không được người dùng tự đổi. BR2: có công cụ crop ảnh tỉ lệ 1:1.

**Code thực tế (bằng chứng):**
- Đã rà soát toàn bộ `src/modules` tìm controller mount tại `/me`: chỉ có đúng 2 controller — `src/modules/accounts/controllers/avatar-photo.controller.ts` (`POST /me/avatar`) và `src/modules/accounts/controllers/biometric-submission.controller.ts` (`POST /me/biometric-submission`, `GET /me/biometric-status`). **Không tồn tại bất kỳ endpoint `PATCH`/`PUT` nào cho phép người dùng tự sửa `fullName` hoặc `phoneNumber` của chính mình.** Endpoint `PATCH /users/:userId` (UC-09) yêu cầu permission quản trị `accounts.user.update`, không dành cho self-service của nhân viên thường.
- `src/modules/accounts/controllers/avatar-photo.controller.ts:34-37` — comment xác nhận rõ đây là thiết kế chủ đích: "AvatarPhotoController — ACCT-AVATAR-PHOTO-001 (avatar hiển thị, tự do, không duyệt). Tách biệt hoàn toàn khỏi BiometricSubmissionController."
- `src/modules/accounts/controllers/avatar-photo.controller.ts:44-94` (`POST /me/avatar`) — nhận file ảnh, lưu Cloudinary, **cập nhật `users.avatarUrl` ngay lập tức, không qua duyệt**. Không thấy tham số crop/tỉ lệ khung hình nào được gửi lên hay xử lý ở BE — công cụ crop 1:1 (nếu có) là việc của FE trước khi upload, BE không enforce tỉ lệ ảnh.

**Nhận xét:** Đây là gap thực chất, không phải chỉ thiếu mô tả: BE hiện KHÔNG cung cấp API để nhân viên tự sửa lỗi chính tả họ tên hay cập nhật số điện thoại của chính mình — chỉ có API tự cập nhật ảnh đại diện. Nếu FE có form "Chỉnh sửa hồ sơ" hiển thị các trường này, các trường đó chỉ có thể đọc (không có API PATCH tương ứng để lưu).

**Đề xuất sửa SRS:**
- Đánh dấu rõ trong tài liệu: phần "tự cập nhật ảnh đại diện" đã triển khai đầy đủ (BR1 Email/Mã NV bất biến khớp đúng vì hoàn toàn không có API sửa 2 trường này ở bất kỳ đâu cho self-service).
- Phần "tự sửa Họ tên/Số điện thoại": ghi chú là **CHƯA TRIỂN KHAI** ở backend — cần bổ sung API `PATCH /me/profile` (hoặc tương đương) nếu vẫn muốn giữ yêu cầu này, hoặc loại bỏ khỏi UC-15 nếu đã bị hủy bỏ theo quyết định sản phẩm.
- Xóa BR2 (công cụ crop 1:1) khỏi phạm vi backend, hoặc ghi chú rõ đây là trách nhiệm hoàn toàn của FE (BE không nhận/không kiểm tra tỉ lệ khung hình ảnh).

---

## UC-16 — Đăng ký & Liên kết Dữ liệu Sinh trắc học Khuôn mặt
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (SRS mô tả thiết kế cũ đã hợp nhất avatar+biometric; code đã tách rời theo quyết định 2026-07-29)

**SRS hiện tại ghi:** 2 luồng — (a) đăng ký qua thiết bị đầu cuối (Face Attendance Terminal) và (b) tự tải lên ảnh chân dung qua web. PRE-3: ảnh phải image/*, ≤5MB. E2: phát hiện giả mạo (chặn tại thiết bị). E3: trùng lặp khuôn mặt (máy chủ từ chối liên kết). E4: sai định dạng/kích thước (lỗi 400).

**Code thực tế (bằng chứng):**
- `src/modules/accounts/controllers/biometric-submission.controller.ts:1-137` (`POST /me/biometric-submission`) — luồng tự tải lên: yêu cầu `file` + **`consentAccepted` bắt buộc** (dòng 104-112, `required: ['file', 'consentAccepted']`) — trường xác nhận đồng ý này **không có trong Normal Flow của SRS luồng tự tải lên**.
- Comment dòng 43-45: "[SỬA 2026-07-29] Đổi tên từ AvatarController — luồng này bắt buộc + phải duyệt cho FaceGate, KHÔNG phải avatar hiển thị (avatar hiển thị tự do, không duyệt, ở AvatarPhotoController)." → xác nhận đây là **quyết định thiết kế tách rời avatar và sinh trắc học đã chốt sau khi SRS gốc được viết** — SRS UC-15/UC-16 hiện vẫn còn lẫn lộn khái niệm "ảnh đại diện" (UC-15) và "dữ liệu sinh trắc học" (UC-16) như thể chúng có thể trùng nhau, trong khi code coi đây là 2 hệ thống độc lập hoàn toàn (2 bảng lưu trữ, 2 endpoint, 2 permission khác nhau: `profile.avatar.update` vs `profile.biometric.submit`).
- `src/modules/accounts/services/biometric-submission.service.ts:41` — `DEFAULT_MAX_BYTES = 5 * 1024 * 1024` → khớp chính xác PRE-3 (5MB).
- Luồng đăng ký qua thiết bị (Face Attendance Terminal): theo đúng nguyên tắc kiến trúc của CLAUDE.md mục 11.2 ("Backend không tự detect face, không tự extract embedding, không tự so khớp khuôn mặt... chỉ nhận kết quả nhận diện từ thiết bị"), việc phát hiện giả mạo (E2) và tính toán độ trùng khớp khuôn mặt (E3) là trách nhiệm của phần cứng Face Terminal, không phải logic BE trong module `accounts` — rà soát `admin-biometric-review.controller.ts`/`.service.ts` xác nhận **không có bất kỳ thuật toán so khớp/trùng lặp khuôn mặt nào ở BE**; việc duyệt/từ chối hoàn toàn là quyết định thủ công của Admin xem ảnh bằng mắt — do đó không thể tìm thấy code hiện thực hóa E3 ("Nếu máy chủ phát hiện mức độ trùng khớp cao... hệ thống từ chối thao tác liên kết") ở phía backend `accounts` module — **phù hợp với kiến trúc dự án đã quy định, KHÔNG phải thiếu sót của code, mà là điểm SRS mô tả một hành vi tự động hóa (auto duplicate-detection) không nằm trong phạm vi backend theo đúng CLAUDE.md.**

**Nhận xét:**
1. SRS chưa cập nhật theo quyết định tách avatar/biometric ngày 2026-07-29 — cần đồng bộ hóa lại UC-15/UC-16 để phản ánh đúng 2 hệ thống độc lập.
2. Thiếu trường "đồng ý/consent" bắt buộc trong Normal Flow của luồng tự tải lên.
3. E3 (trùng lặp khuôn mặt tự động) không hiện thực ở BE theo đúng chủ trương kiến trúc — nếu SRS muốn giữ yêu cầu này, cần làm rõ đây là trách nhiệm của thiết bị Face Terminal (không phải BE trung tâm) hoặc phải mở một hạng mục thiết kế mới (vector search/embedding matching) mà CLAUDE.md hiện đang cấm tự ý triển khai.

**Đề xuất sửa SRS:**
- Ghi chú đầu UC-16: "Từ 2026-07-29, hệ thống tách biệt hoàn toàn 'Ảnh đại diện hiển thị' (UC-15, tự do không cần duyệt) và 'Dữ liệu sinh trắc học khuôn mặt cho FaceGate' (UC-16, bắt buộc + phải qua duyệt Admin) — đây là 2 API, 2 permission, 2 bảng dữ liệu khác nhau."
- Bổ sung vào Normal Flow (luồng tự tải lên): "Người dùng phải xác nhận đã đồng ý cho phép sử dụng ảnh cho mục đích sinh trắc học trước khi gửi."
- Sửa E3: ghi rõ việc phát hiện trùng lặp khuôn mặt (nếu có) là trách nhiệm của thiết bị Face Terminal khi đăng ký qua thiết bị; luồng tự tải lên qua web hiện KHÔNG có cơ chế phát hiện trùng lặp tự động ở phía máy chủ — việc phát hiện trùng lặp (nếu có) hoàn toàn phụ thuộc vào đánh giá thủ công của Admin khi duyệt (UC-17).

---

## UC-17 — Phê duyệt/Từ chối Ảnh Khuôn mặt đăng ký
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Primary Actor: Business Admin. Xem danh sách chờ duyệt → chọn Phê duyệt/Từ chối.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/controllers/admin-biometric-review.controller.ts:44-124` — `GET /admin/biometric-submissions` (danh sách), `GET /:faceProfileId` (chi tiết), `GET /:faceProfileId/download-url` (tải ảnh), `POST /:faceProfileId/approve`, `POST /:faceProfileId/reject` — khớp đúng hình dạng luồng SRS.
- `@RequireRoles('SYSTEM_ADMIN', 'BUSINESS_ADMIN')` (dòng 45, 58, 72, 91, 110) — **cả SYSTEM_ADMIN lẫn BUSINESS_ADMIN đều có quyền duyệt**, không phải chỉ Business Admin như SRS liệt kê ở Primary Actor.
- `src/modules/accounts/controllers/admin-biometric-review.controller.ts:108-124` (`reject`) — nhận `RejectBiometricSubmissionDto` với trường `reason` — SRS không đặc tả rõ việc từ chối có bắt buộc nhập lý do hay không (SRS chỉ nói chọn "Từ chối").
- Comment dòng 34-36: đổi tên từ `AdminAvatarReviewController` — cùng xác nhận quyết định tách biệt avatar/biometric đã nêu ở UC-16.

**Nhận xét:** Về cơ bản khớp shape, chỉ khác ở phạm vi vai trò được phép duyệt (SRS chỉ liệt kê Business Admin, code cho phép cả System Admin).

**Đề xuất sửa SRS:** Sửa Primary Actor thành "Business Admin, System Admin".

---

## UC-18 — Cập nhật phòng ban
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Sửa Tên, Người quản lý phụ trách. BR1: Mã phòng ban không được sửa sau khi khởi tạo (đúng). BR2: Tên phòng ban sau cập nhật vẫn phải duy nhất.

**Code thực tế (bằng chứng):**
- `src/modules/accounts/controllers/departments.controller.ts:253-268` — comment xác nhận: "KHÔNG cho sửa departmentCode" → khớp chính xác BR1.
- `src/modules/accounts/controllers/departments.controller.ts:268` — **"BREAKING CHANGE (2026-08-12, ACCT-DEPT-DEACTIVATE-001): field isActive đã bị xóa khỏi endpoint này — dùng POST /departments/:id/deactivate và /reactivate thay thế."** → xác nhận rõ đây là **thiết kế cũ đã bị thay thế**: trước đây có thể việc bật/tắt hoạt động phòng ban từng nằm trong cùng API cập nhật, nhưng từ 2026-08-12 đã tách thành 2 endpoint chuyên biệt với ràng buộc nghiệp vụ riêng (không cho vô hiệu hóa nếu còn phòng ban con active hoặc nhân sự active; không cho vô hiệu hóa `PARTNER_DEPARTMENT_ID`; không cho kích hoạt lại nếu phòng ban cha đang inactive) — **toàn bộ cơ chế deactivate/reactivate với các ràng buộc này hoàn toàn không có trong SRS UC-18**.
- `src/modules/accounts/services/departments.service.ts:251-275` — cập nhật cho phép sửa `departmentName`, `parentDepartmentId`, `managerUserId`, `description` — có thêm `parentDepartmentId` (phân cấp, xem UC-07) mà SRS không đề cập; body rỗng (không field nào) → 400 `EMPTY_UPDATE_PAYLOAD` — không có trong SRS.
- `src/modules/accounts/services/departments.service.ts:257-263` — không được sửa phòng ban `PARTNER_DEPARTMENT_ID` (403 `PARTNER_DEPARTMENT_PROTECTED`) — liên quan tới loại tài khoản "partner" phát hiện ở UC-05, hoàn toàn không có trong SRS.

**Nhận xét:** Đây là ví dụ rõ ràng của "SRS mô tả thiết kế cũ, đã bị thay bằng thiết kế mới" theo đúng lưu ý trong yêu cầu công việc — code có breaking-change log tường minh xác nhận điều này.

**Đề xuất sửa SRS:**
- Bổ sung Normal Flow: khả năng sửa "Phòng ban cha" (theo cấu trúc phân cấp bổ sung ở UC-07).
- Bổ sung 2 luồng/UC mới (hoặc Alternative Flow): "Vô hiệu hóa phòng ban" (chặn nếu còn phòng ban con hoặc nhân sự đang hoạt động) và "Kích hoạt lại phòng ban" (chặn nếu phòng ban cha đang ngừng hoạt động) — đây không còn nằm trong luồng Cập nhật thông tin cơ bản.

---

## UC-19 — Xem danh sách phòng ban
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (BR1 sai — mâu thuẫn trực tiếp)

**SRS hiện tại ghi:** Postcondition: danh sách kèm "TÊN, MÃ, Người quản lý phụ trách, **số lượng nhân sự**". BR1: "Danh sách chỉ hiển thị các phòng ban đang ở trạng thái hoạt động, trừ khi người dùng chủ động bật bộ lọc 'Hiển thị phòng ban đã ngừng hoạt động'."

**Code thực tế (bằng chứng):**
- `src/modules/accounts/services/departments.service.ts:770-807` (`listDepartments`) — chỉ lọc theo `deletedAt IS NULL` và (tùy chọn) `parentId`/`search`; **không có bất kỳ điều kiện lọc theo `isActive` nào, không có tham số `includeInactive`** → theo mặc định trả về **CẢ phòng ban đang hoạt động lẫn đã ngừng hoạt động** cùng lúc, không có cách nào để "ẩn phòng ban ngừng hoạt động theo mặc định" như BR1 mô tả → **mâu thuẫn trực tiếp với BR1**.
- `src/modules/accounts/services/departments.service.ts:880-892` (`toResponse`) — trường trả về: `id, departmentCode, departmentName, parentDepartmentId, managerUserId, description, isActive, createdAt, updatedAt`. **Không có trường số lượng nhân sự (headcount) nào cả** → mâu thuẫn với Postcondition của SRS ("kèm số lượng nhân sự"). Muốn biết số lượng nhân sự phải gọi riêng `GET /departments/:id/members` (`departments.controller.ts:212-249`) rồi tự đếm độ dài mảng trả về — không có endpoint đếm trực tiếp.

**Nhận xét:** Cả Postcondition (thiếu headcount) và BR1 (không lọc theo trạng thái hoạt động mặc định) của SRS đều không khớp thực tế API.

**Đề xuất sửa SRS:**
- Sửa Postcondition: bỏ "kèm số lượng nhân sự" khỏi phần dữ liệu trả về của danh sách; ghi chú số lượng nhân sự phải tra cứu riêng qua API "Danh sách nhân sự trực thuộc phòng ban" (`GET /departments/:id/members`).
- Sửa BR1 thành: "Danh sách phòng ban trả về mặc định bao gồm CẢ phòng ban đang hoạt động lẫn đã ngừng hoạt động (không tự động ẩn); mỗi bản ghi có trường `isActive` để giao diện tự quyết định hiển thị/lọc."

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Loại tài khoản "partner" (đối tác)** — toàn bộ cơ chế tạo tài khoản đối tác với `PARTNER_DEPARTMENT_ID` cố định, mật khẩu = email, không bắt đổi mật khẩu, có hạn dùng (`accountExpiresAt`), face profile tự động active — xuất hiện xuyên suốt `createUser`, `persistAccount`, `login.service.ts` (kiểm tra hết hạn), `departments.service.ts` (bảo vệ phòng ban đối tác khỏi bị sửa/xóa/vô hiệu hóa) — không có bất kỳ UC nào trong SRS mô tả loại tài khoản này. Đề xuất: cần một UC riêng "Tạo/Quản lý tài khoản đối tác ngoài công ty".
2. **Cơ chế thu hồi sinh trắc học tự động khi giáng chức khỏi vai trò Admin** (`isBiometricDemotion`, `users.service.ts:690-794`) — liên kết chéo UC-08 và UC-16/17, không được nhắc ở UC nào.
3. **Idempotency-Key** cho tạo phòng ban (`departments.controller.ts:90`, cache 24h) — chi tiết kỹ thuật chống double-submit, không có trong SRS.
4. **Department deactivate/reactivate với ràng buộc cascade** (`departments.controller.ts:331-445`) — đã nêu ở UC-18, là tính năng độc lập cần 1 UC riêng.
5. **`GET /users/:userId/public-profile`** — hồ sơ công khai rút gọn cho mọi user đã đăng nhập, không cần quyền quản trị — đã nêu ở UC-13.
6. **Kiểm tra "SYSTEM_ADMIN active cuối cùng"** được lặp lại giống hệt nhau ở 3/4 nơi (`deleteUser`, `lockUser`, `updateUserStatus`→INACTIVE) nhưng **thiếu** ở `updateUserRoles` (UC-08) — một lỗ hổng nhất quán đáng lưu ý cho đội BE, không chỉ là vấn đề tài liệu.
