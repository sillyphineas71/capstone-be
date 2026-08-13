# Đánh giá SRS — 1. Authentication & Authorization

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "1. Authentication & Authorization" (UC-01 → UC-04).
Nguồn code đối chiếu: `src/modules/auth/**` (nhánh `main`, commit `07f47b6`).

## Tổng quan
Số UC: 4 | Khớp hoàn toàn: 1 | Khớp một phần: 3 | Sai hoàn toàn: 0 | Không có code: 0

---

## UC-01 — Đăng nhập hệ thống
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Người dùng nhập Email + Mật khẩu → hệ thống kiểm tra tính hợp lệ → đối chiếu với DB → kiểm tra tình trạng hoạt động tài khoản → thiết lập phiên đăng nhập mới (Session/Token) → chuyển hướng Dashboard. EX2: sai email/mật khẩu → thông báo lỗi chung. EX3: tài khoản bị khóa → chặn, hiển thị "Tài khoản của bạn đã bị vô hiệu hóa. Vui lòng liên hệ với Quản trị viên để được hỗ trợ." BR1: chỉ dùng Email làm định danh, loại bỏ hoàn toàn Username.

**Code thực tế (bằng chứng):**
- `src/modules/auth/dto/login.dto.ts:4-15` — DTO chỉ có 2 field `email` (phải là email hợp lệ) và `password`; không có field username nào.
- `src/modules/auth/utils/login-normalization.util.ts:5-10` (`hasOnlyAllowedLoginFields`) + `src/modules/auth/controllers/auth.controller.ts:77-88` — request bị từ chối thẳng (`VALIDATION_ERROR`) nếu body chứa bất kỳ field nào ngoài `email`/`password` → xác nhận đúng BR1.
- `src/modules/auth/services/login.service.ts:50-69` — **Rate limiting theo IP+email**: `RateLimitService.checkOrThrow` (dựa trên Redis, ngưỡng cấu hình qua `AuthConfigService`) tăng counter ở **mọi** lần gọi login (kể cả thành công), vượt ngưỡng → ném lỗi `AUTH_TOO_MANY_ATTEMPTS`, HTTP 429 (`login.service.ts:60-66`). **Không hề được nhắc tới trong SRS.**
- `src/modules/auth/services/login.service.ts:80-89` — sai email/mật khẩu → `UnauthorizedException` với `AUTH_INVALID_CREDENTIALS` (401). Khớp EX2 về mặt hành vi (không lộ email nào sai).
- `src/modules/auth/services/login.service.ts:91-121` — account status được xử lý theo **4 nhánh riêng biệt**, không phải 1 nhánh "bị khóa" gộp chung như SRS:
  - `accountExpiresAt` đã qua → `ForbiddenException` `AUTH_ACCOUNT_EXPIRED` (403) — **hoàn toàn không có trong SRS**.
  - `accountStatus === 'inactive'` → `ForbiddenException` `AUTH_ACCOUNT_INACTIVE` (403).
  - `accountStatus === 'locked'` → `HttpException` `AUTH_ACCOUNT_LOCKED`, **HTTP 423 Locked** (`login.service.ts:108-115`) — khác mã lỗi/khác message với nhánh inactive.
  - Nhánh default (status lạ) → `AUTH_ACCOUNT_STATUS_NOT_ALLOWED` (403) — cũng không có trong SRS.
  - Xem đầy đủ danh sách mã lỗi tại `src/modules/auth/constants/auth-error-codes.ts:1-16`.
- `src/modules/auth/services/login.service.ts:123-146` — session thực chất là **cặp JWT access token + refresh token** (`TokenService.generateAccessToken`/`generateRefreshToken`, mỗi token có `jti` riêng), không phải khái niệm "Session" chung chung như SRS diễn đạt.
- `src/modules/auth/services/login.service.ts:176-216` — response login còn trả về **trạng thái sinh trắc học khuôn mặt** (`biometricReviewStatus`, `biometricRequired`, `shouldShowBiometricPopup`, miễn trừ cho Business Admin/System Admin qua `isBiometricExemptRole`) — toàn bộ cơ chế popup nhắc đăng ký khuôn mặt sau khi đăng nhập **không được SRS nhắc tới**.
- `src/modules/auth/services/login.service.ts:148-149` — trả về `roles`, `permissions` hiệu lực (qua `AuthzReadRepository.getEffectiveRolesAndPermissions`) để FE dựng menu — khớp tinh thần POST-2 của SRS ("giao diện hiển thị đúng cấu trúc menu theo quyền hạn").

**Nhận xét:**
1. SRS thiếu hoàn toàn cơ chế rate-limit chống brute-force theo IP+email (429).
2. SRS gộp "khóa" và "vô hiệu hóa" thành 1 tình huống, nhưng code phân biệt rạch ròi 4 trạng thái (`inactive`/`locked`/`expired`/status lạ) với HTTP status và message khác nhau — SRS thiếu nhánh "hết hạn tài khoản" (`AUTH_ACCOUNT_EXPIRED`) hoàn toàn.
3. SRS không đề cập cơ chế token: access/refresh JWT với `jti`.
4. SRS không đề cập tính năng sinh trắc học (biometric popup) gắn liền ngay sau khi đăng nhập thành công — đây là 1 phần dữ liệu response thực tế mà FE phụ thuộc vào.

**Đề xuất sửa SRS:**
- Bổ sung vào Normal Flow bước 6: "Hệ thống kiểm tra số lần đăng nhập thất bại/tổng số lần thử trong một khoảng thời gian gần nhất theo cặp (IP, Email); nếu vượt ngưỡng cấu hình, hệ thống từ chối yêu cầu với mã lỗi giới hạn tần suất (HTTP 429) mà không xử lý tiếp bước xác thực."
- Sửa bước 7: "Hệ thống thiết lập một cặp token JWT gồm Access Token (thời hạn ngắn) và Refresh Token (thời hạn dài hơn), mỗi token gắn một định danh phiên (`jti`) riêng, và tải cấu hình quyền hạn (Role/Permission) hiệu lực của người dùng."
- Sửa EX3 thành 3 nhánh riêng biệt:
  - "Nếu tài khoản đang ở trạng thái Vô hiệu hóa (Inactive), hệ thống từ chối đăng nhập với thông báo tài khoản không hoạt động."
  - "Nếu tài khoản đang ở trạng thái Khóa (Locked), hệ thống từ chối đăng nhập (HTTP 423) với thông báo tài khoản đã bị khóa."
  - "Nếu tài khoản đã hết hạn sử dụng (quá `accountExpiresAt`), hệ thống từ chối đăng nhập với thông báo tài khoản đã hết hạn."
- Bổ sung Postcondition: "Nếu tài khoản chưa có hoặc chưa được duyệt hồ sơ khuôn mặt, response đăng nhập trả kèm cờ yêu cầu hiển thị popup nhắc đăng ký/khuôn mặt đang chờ duyệt (miễn trừ với Business Admin/System Admin)."

---

## UC-02 — Đăng xuất khỏi hệ thống
**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Người dùng chọn "Đăng xuất" → hệ thống hủy phiên làm việc hiện tại trên thiết bị này → xóa thông tin đăng nhập tạm trên trình duyệt → chuyển về màn hình đăng nhập. BR1: chỉ URL nội bộ từ thiết bị đó không có xác thực mới sẽ bị chặn. BR2: đăng xuất chỉ chấm dứt phiên của thiết bị hiện tại, không ảnh hưởng các phiên khác.

**Code thực tế (bằng chứng):**
- `src/modules/auth/controllers/auth.controller.ts:142-186` (`POST /auth/logout`, yêu cầu `JwtAuthGuard`) — lấy `jti`/`exp` từ token hiện hành trong `request['user']`.
- `src/modules/auth/services/logout.service.ts:19-35` (`logout`) — chỉ blacklist đúng **1 `jti`** (của token đang dùng để gọi API), TTL = đúng thời gian còn lại của token đó (`exp * 1000 - Date.now()`) → khớp chính xác BR2 (không đụng tới các phiên/token khác của cùng user).
- `src/modules/auth/guards/jwt-auth.guard.ts:35-47` — mọi route bảo vệ bởi `JwtAuthGuard` (trừ route có `@SetMetadata('ignoreBlacklist', true)`) đều kiểm tra `blacklist:{jti}` trong Redis, có → `UnauthorizedException('Token has been revoked')` → khớp chính xác BR1.
- `src/modules/auth/services/logout.service.ts:37-55` — ghi audit log logout (fire-and-forget, không chặn response nếu lỗi).

**Nhận xét:** Không có sai lệch đáng kể. Chi tiết kỹ thuật (blacklist theo `jti` trong Redis, TTL bằng đúng thời gian còn lại của token) là hiện thực hóa hợp lý của khái niệm "hủy phiên làm việc" mà SRS mô tả ở mức khái quát.

**Đề xuất sửa SRS:** Không bắt buộc; có thể bổ sung 1 câu kỹ thuật ở "Other Information": "Cơ chế hủy phiên được hiện thực bằng cách đưa định danh phiên (`jti`) của token đang dùng vào danh sách đen (blacklist) trong Redis với thời gian sống bằng đúng thời hạn còn lại của token đó."

---

## UC-03 — Yêu cầu đặt lại mật khẩu qua OTP
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Người dùng nhập Email → hệ thống kiểm tra tồn tại/trạng thái → sinh OTP 6 số gửi qua email → chuyển màn hình xác thực & đặt lại mật khẩu → người dùng nhập OTP + mật khẩu mới + xác nhận mật khẩu mới → hệ thống kiểm tra OTP + độ an toàn mật khẩu → lưu mật khẩu mới. AF1: gửi lại mã (hủy mã cũ, tạo mã mới, đặt lại đồng hồ đếm ngược). EX1: email không tồn tại/bị khóa → thông báo "Email không tồn tại hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại." EX2: sai OTP/hết hạn → thông báo lỗi chung. BR1: OTP 6 số, hiệu lực 10 phút. BR2: mật khẩu mới ≥8 ký tự, hoa/thường/số/đặc biệt. BR3: dùng xong OTP hết hiệu lực ngay.

**Code thực tế (bằng chứng):**
- `src/modules/auth/services/password-reset.service.ts:96-105` (`requestOtp`) — OTP = `crypto.randomInt(100000, 999999)` (6 chữ số), lưu **hash SHA-256** của OTP (không lưu plaintext) vào Redis với TTL `600000`ms = 10 phút → khớp chính xác BR1.
- `src/modules/auth/services/password-reset.service.ts:41-74` — **Chống spam gửi OTP hoàn toàn không có trong SRS**: đếm số lần request trong cửa sổ 5 phút (`incrementLimitCounter(email, 300000)`); nếu >3 lần → khóa email 60 phút (`blockEmail`, HTTP 429, mã `AUTH_TOO_MANY_ATTEMPTS`); nếu email đang bị khóa → 429 ngay từ đầu.
- `src/modules/auth/services/password-reset.service.ts:76-93` — điều kiện chặn rộng hơn SRS: `!user || user.deletedAt !== null || user.accountStatus !== 'active' || user.employmentStatus !== 'active'` → cùng 1 message `"Email không tồn tại hoặc tài khoản đã bị khóa. Vui lòng kiểm tra lại."` (khớp **verbatim** với SRS EX1) nhưng còn chặn cả tài khoản **đã nghỉ việc** (`employmentStatus`) mà SRS không hề nhắc tới.
- `src/modules/auth/services/password-reset.service.ts:192-225` (`confirmReset`) — **giới hạn 5 lần nhập sai OTP**: mỗi lần sai tăng `session.attempts`; đến lần thứ 5, **tự hủy hoàn toàn phiên OTP** (`deleteOtpSession`) buộc người dùng phải yêu cầu OTP mới từ đầu — chi tiết "khóa sau 5 lần sai" này **không có trong SRS EX2**, SRS chỉ mô tả chung "yêu cầu nhập lại hoặc lấy mã mới" như một lựa chọn ngang hàng, không phải hệ quả bắt buộc.
- `src/modules/auth/dto/confirm-reset.dto.ts:11-45` (`ConfirmResetDto`) — payload thực tế của `POST /auth/password-reset/confirm` chỉ có 3 field: `email`, `otp`, `newPassword`. **KHÔNG có field `confirmPassword`** — mâu thuẫn với SRS Normal Flow bước 7 ("nhập mã OTP từ email, nhập mã cùng với mật khẩu mới (và xác nhận mật khẩu mới) vào biểu mẫu"). Việc đối chiếu 2 ô mật khẩu (nếu FE có làm) là validation phía client, **backend không nhận/không kiểm tra field xác nhận này**.
- `src/modules/auth/dto/confirm-reset.dto.ts:37-44` — regex mật khẩu mới: `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[...]{8,}$` → khớp chính xác BR2.
- `src/modules/auth/services/password-reset.service.ts:236-240` — sau khi đổi thành công: xóa OTP session, xóa bộ đếm spam, xóa cờ khóa email, **và** gọi `invalidateUserTokens(user.id, 604800000)` để vô hiệu hóa mọi JWT cũ đã phát hành trong 7 ngày gần nhất — khớp BR3 (OTP hết hiệu lực ngay) **và bổ sung thêm** hành vi ép đăng xuất toàn bộ thiết bị đang đăng nhập bằng token cũ, điều SRS không đề cập.
- Không tồn tại endpoint "resend OTP" riêng — AF1 (Gửi lại mã) trên thực tế chỉ là gọi lại đúng `POST /auth/password-reset/request`, việc này tự nhiên ghi đè session Redis cũ (`setOtpSession` cùng key theo email) → hành vi tương đương AF1 nhưng không phải một action/endpoint riêng biệt.

**Nhận xét:**
1. SRS hoàn toàn thiếu cơ chế chống spam yêu cầu OTP (giới hạn 3 lần/5 phút, khóa 60 phút).
2. SRS thiếu giới hạn 5 lần nhập sai OTP dẫn đến tự hủy phiên OTP (không chỉ đơn thuần "yêu cầu nhập lại").
3. SRS mô tả có trường "xác nhận mật khẩu mới" nhưng DTO backend không hề nhận trường này — sai lệch hợp đồng API.
4. Điều kiện chặn tài khoản rộng hơn mô tả SRS (bao gồm cả `employmentStatus` nghỉ việc).
5. SRS thiếu hệ quả "đổi mật khẩu thành công → toàn bộ token cũ (mọi thiết bị) bị vô hiệu hóa trong 7 ngày tới" thay vì chỉ đơn thuần cập nhật mật khẩu.

**Đề xuất sửa SRS:**
- Sửa Normal Flow bước 4: "Hệ thống kiểm tra tính hợp lệ, sự tồn tại, trạng thái hoạt động (đang làm việc, chưa bị khóa/xóa) của địa chỉ email này trong cơ sở dữ liệu; đồng thời kiểm tra số lần yêu cầu OTP gần nhất — nếu vượt quá 3 lần trong 5 phút, hệ thống tạm khóa yêu cầu OTP cho email này trong 60 phút."
- Sửa EX2 thành: "Nếu người dùng nhập sai mã OTP, hệ thống tăng bộ đếm số lần sai; nếu mã đã quá thời gian hiệu lực hoặc số lần nhập sai đạt 5 lần liên tiếp, hệ thống hủy hoàn toàn mã OTP hiện tại và yêu cầu người dùng thực hiện lại từ đầu (lấy mã OTP mới); nếu chưa đạt ngưỡng, hệ thống cho phép nhập lại."
- Bỏ cụm "(và xác nhận mật khẩu mới)" khỏi bước 7, hoặc ghi chú rõ đây là validation chỉ diễn ra ở giao diện người dùng (frontend), không phải trường dữ liệu gửi lên server.
- Bổ sung Postcondition: "Sau khi đặt lại mật khẩu thành công, toàn bộ phiên đăng nhập (token) đã phát hành trước đó cho tài khoản này trên mọi thiết bị đều bị vô hiệu hóa, buộc đăng nhập lại bằng mật khẩu mới."

---

## UC-04 — Thay đổi mật khẩu đăng nhập
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Người dùng nhập Mật khẩu hiện tại, Mật khẩu mới, Xác nhận mật khẩu mới → hệ thống kiểm tra hợp lệ, đối chiếu mật khẩu hiện tại → lưu mật khẩu mới, chấm dứt hiệu lực mật khẩu cũ. EX2: sai mật khẩu hiện tại. EX3: mật khẩu mới yếu. EX4: xác nhận không khớp. EX5: mật khẩu mới trùng mật khẩu hiện tại. BR1: chính sách mật khẩu mới (8 ký tự, hoa/thường/số/đặc biệt). Postcondition: "Mật khẩu mới được áp dụng và kích hoạt ngay lập tức cho các lần xác thực tiếp theo."

**Code thực tế (bằng chứng):**
- `src/modules/auth/dto/change-password.dto.ts:19-80` — DTO có đúng 3 field `currentPassword`, `newPassword`, `confirmPassword` → khớp cấu trúc biểu mẫu SRS mô tả (khác với UC-03, ở đây field xác nhận có tồn tại thật).
- `src/modules/auth/dto/change-password.dto.ts:55-61` — regex chính sách mật khẩu mới: 8-72 ký tự, có hoa/thường/số/ký tự đặc biệt → khớp BR1.
- `src/modules/auth/controllers/auth.controller.ts:251-304` (`PATCH /auth/change-password`, yêu cầu `JwtAuthGuard`) — `userId` lấy từ JWT (`request.user.userId`), không tin từ body — khớp nguyên tắc bảo mật chung của CLAUDE.md.
- `src/modules/auth/services/change-password.service.ts:60-75` (BL-1) — **Rate limit hoàn toàn không có trong SRS**: nếu user đang bị `isBlocked` (Redis) → `HttpException` 429 `CHANGE_PASSWORD_RATE_LIMITED`, thông báo "Bạn đã nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút."
- `src/modules/auth/services/change-password.service.ts:77-84` (BL-2) — `newPassword !== confirmPassword` → `BadRequestException` "Mật khẩu xác nhận không trùng khớp" — khớp verbatim SRS EX4.
- `src/modules/auth/services/change-password.service.ts:91-106` — kiểm tra lại trạng thái tài khoản (`deletedAt`, `accountStatus !== 'active'`) **ngay trong transaction**, dù precondition SRS giả định người dùng "đã đăng nhập thành công" — đây là 1 nhánh lỗi (`ACCOUNT_RESTRICTED`, 403) mà SRS UC-04 hoàn toàn không đề cập (không có trong Exceptions).
- `src/modules/auth/services/change-password.service.ts:108-138` (BL-4) — sai `currentPassword` → tăng bộ đếm thất bại (`incrementFailedCounter`); đến lần thứ 5 → set cờ khóa 15 phút + ghi audit `logRateLimited`; luôn trả lỗi `BadRequestException` "Mật khẩu hiện tại không chính xác. Vui lòng kiểm tra lại." — message khớp verbatim SRS EX2, nhưng cơ chế khóa sau 5 lần sai **không có trong SRS**.
- `src/modules/auth/services/change-password.service.ts:140-151` (BL-5) — mật khẩu mới trùng mật khẩu hiện tại → `UnprocessableEntityException` (**HTTP 422**, khớp với `@ApiResponse({status: 422 ...})` ở controller dòng 278-281) "Mật khẩu mới không được trùng với mật khẩu hiện tại." — khớp verbatim SRS EX5.
- `src/modules/auth/services/change-password.service.ts:161-179` (BL-8) — sau khi đổi mật khẩu thành công: gọi `invalidateUserTokens(userId, 7 ngày)` — set khóa `auth:user:{userId}:invalid_after` trong Redis; `src/modules/auth/guards/jwt-auth.guard.ts:50-61` xác nhận **mọi JWT phát hành trước thời điểm đổi mật khẩu (kể cả token của chính phiên vừa gọi API này) đều bị từ chối ở request tiếp theo**. Message trả về xác nhận rõ: "Thay đổi mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới." → **trực tiếp mâu thuẫn** với Postcondition của SRS ("mật khẩu mới được áp dụng và kích hoạt ngay lập tức cho các lần xác thực tiếp theo" ngụ ý phiên hiện tại vẫn tiếp tục dùng được).

**Nhận xét:**
1. SRS hoàn toàn thiếu cơ chế khóa 15 phút sau 5 lần nhập sai mật khẩu hiện tại.
2. SRS thiếu nhánh lỗi tài khoản bị khóa/xóa phát sinh giữa lúc đang thao tác (dù đã đăng nhập trước đó).
3. Postcondition của SRS sai lệch với thực tế: đổi mật khẩu **không** giữ nguyên phiên hiện tại, mà buộc đăng xuất toàn bộ (kể cả phiên vừa dùng để gọi API) và yêu cầu đăng nhập lại.

**Đề xuất sửa SRS:**
- Bổ sung Exception mới: "EX6: Nếu người dùng nhập sai Mật khẩu hiện tại 5 lần liên tiếp, hệ thống tạm khóa chức năng đổi mật khẩu của tài khoản này trong 15 phút và hiển thị thông báo yêu cầu thử lại sau."
- Bổ sung Exception mới: "EX7: Nếu trong quá trình xử lý, hệ thống phát hiện tài khoản đã bị khóa hoặc xóa, thao tác đổi mật khẩu bị từ chối với thông báo tài khoản không còn hợp lệ."
- Sửa Postcondition POST-2 thành: "Mật khẩu mới được lưu và có hiệu lực ngay; đồng thời TẤT CẢ các phiên đăng nhập (token) đã phát hành trước đó cho tài khoản này — bao gồm cả phiên vừa dùng để thực hiện thao tác đổi mật khẩu — đều bị vô hiệu hóa ngay lập tức. Người dùng bắt buộc phải đăng nhập lại bằng mật khẩu mới để tiếp tục sử dụng hệ thống."

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **`MustChangePasswordGuard`** (`src/modules/auth/guards/must-change-password.guard.ts:32-80`) — một guard toàn cục áp dụng cho MỌI route đã xác thực (chạy sau `JwtAuthGuard`): nếu cờ `must_change_password = true` của user (được set khi tạo tài khoản mới, thấy ở nhóm UC Account Management), mọi request tới các endpoint **khác** ngoài whitelist `/api/v1/auth/me`, `/api/v1/auth/change-password`, `/api/v1/auth/logout` đều bị chặn với `ForbiddenException` mã `MUST_CHANGE_PASSWORD` (403), buộc người dùng phải đổi mật khẩu trước khi dùng bất kỳ chức năng nào khác. Đây là hành vi vận hành trực tiếp nối tiếp UC-01 (đăng nhập) nhưng **hoàn toàn không được nhắc tới ở bất kỳ UC nào trong mục Authentication & Authorization** của SRS. Đề xuất: nên bổ sung như một Postcondition/Alternative Flow của UC-01, hoặc tạo UC riêng "Bắt buộc đổi mật khẩu lần đầu đăng nhập".
2. **`POST /auth/refresh`** (`src/modules/auth/controllers/auth.controller.ts:99-140`, `RefreshTokenService`) — toàn bộ cơ chế làm mới token (refresh token rotation: token cũ bị blacklist ngay sau khi dùng để chống replay) **không có UC tương ứng nào trong SRS mục 1**. Đây là một luồng nghiệp vụ độc lập, cần thiết vì UC-01 chỉ mô tả access token ngắn hạn.
3. **`RefreshToken` error codes** `REFRESH_TOKEN_INVALID`/`REFRESH_TOKEN_REVOKED` (`src/modules/auth/constants/auth-error-codes.ts:14-15`) — không có mô tả nghiệp vụ tương ứng trong SRS.
