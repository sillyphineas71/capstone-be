# Đánh giá SRS — Vehicle & License Plate Management

## Tổng quan

Số UC: 7 | Khớp hoàn toàn: 3 | Khớp 1 phần: 3 | Sai hoàn toàn: 0 | Không có code: 1

Ghi chú tổng quan: Module `anpr` đã triển khai rất đầy đủ (đăng ký, tra cứu, webhook, control-list, cảnh báo) — vượt xa mức "một vài route có sẵn" mà SRS Other Information của nhiều UC trong Mục này mô tả. Phát hiện lớn nhất: **toàn bộ khái niệm "Chờ duyệt → Admin phê duyệt" mà UC-108/109/110 xoay quanh không hề tồn tại** — đăng ký phương tiện được kích hoạt (`active`) ngay lập tức, không có hàng đợi duyệt nào.

---

## UC-108 — Đăng ký phương tiện

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** POST-1: bản ghi đăng ký tạo với trạng thái **"Chờ duyệt"**. BR2: đăng ký "Chờ duyệt" không được phép ra/vào bằng nhận diện biển số cho tới khi được duyệt (UC-109).

**Code thực tế (bằng chứng):**
- Route: `POST anpr/vehicle-registrations` (tự đăng ký) / `POST anpr/admin/vehicle-registrations` (Admin đăng ký hộ) — `src/modules/anpr/controllers/vehicle-registration.controller.ts:178-215`.
- `register()` (`src/modules/anpr/services/vehicle-registration.service.ts:50-...`): gán **`status: 'active'` ngay lập tức** (dòng 79) — không có giá trị "pending"/"chờ duyệt" nào được set.
- Entity `VehicleRegistrationEntity.status` (`src/modules/anpr/entities/vehicle-registration.entity.ts:42-43`): cột `varchar(30)` tự do, **default `'active'`**, không có ràng buộc enum hay giá trị "pending_approval" nào trong toàn bộ codebase.

**Nhận xét:**
Phần thu thập form (biển số/loại xe/màu/hãng), kiểm tra định dạng (EX2) và kiểm tra trùng biển số (EX1 — service có kiểm tra trùng trước khi tạo) khớp đúng SRS. Nhưng **toàn bộ khái niệm "Chờ duyệt"** — vốn là trạng thái trung tâm của POST-1 và tiền đề cho BR2 — hoàn toàn không tồn tại: đăng ký kích hoạt (`active`, sẵn sàng nhận diện) ngay khi tạo, không qua bất kỳ hàng đợi phê duyệt nào.

**Đề xuất sửa SRS:**
> POST-1: Bản ghi đăng ký được tạo với trạng thái **`active` ngay lập tức** — có hiệu lực nhận diện tại cổng từ thời điểm đăng ký, không qua bước phê duyệt trung gian nào. Bỏ BR2 và mọi tham chiếu tới UC-109 (xem UC-109 bên dưới).

---

## UC-109 — Duyệt đăng ký phương tiện (bỏ UC này)

**Trạng thái:** ❌ KHÔNG CÓ CODE

**SRS hiện tại ghi:** Manager/Admin xem hàng đợi, duyệt/từ chối đăng ký "Chờ duyệt", gửi email kết quả.

**Code thực tế (bằng chứng):** Grep `approve|reject|pending` trong toàn bộ `src/modules/anpr/`: không có bất kỳ endpoint, service method, hay giá trị status nào liên quan tới việc "duyệt" đăng ký phương tiện. `VehicleRegistrationController` chỉ có `updateStatus()` (`PATCH vehicle-registrations/:id/status`, dòng 242-261) — đây là hành động **tự người sở hữu bật/tắt** (active↔disabled) biển số của chính mình, không phải hành động phê duyệt của Admin/Manager đối với người khác.

**Nhận xét:**
Kết quả kiểm tra code xác nhận đúng khuyến nghị mà chính SRS đã tự ghi trong tiêu đề UC này — "(bỏ UC này)". Không có hàng đợi duyệt, không có hành động approve/reject nào tồn tại.

**Đề xuất sửa SRS:**
> Xác nhận **bỏ UC-109** khỏi danh sách UC nghiệp vụ theo đúng đề xuất trong tiêu đề gốc. Hệ thống dùng mô hình tự đăng ký – tự kích hoạt (self-service, auto-active), không có bước duyệt của Manager/Admin.

---

## UC-110 — Cập nhật & hủy đăng ký phương tiện

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Cho phép sửa thông tin phương tiện **kể cả đổi biển số** (VD "đổi biển số khi đổi xe"); POST-1: nếu biển số thay đổi, đăng ký quay lại "Chờ duyệt".

**Code thực tế (bằng chứng):**
- `UpdateVehicleRegistrationDto` (`src/modules/anpr/dto/update-vehicle-registration.dto.ts:15-28`): **CHỈ** 2 field `vehicleType`/`note` — comment dòng 8 xác nhận tường minh: "DATA-01: CHỈ `note` + `vehicle_type`. **KHÔNG `plate_number`**/`plate_raw`/`user_id`/`status`" — biển số **không thể sửa** qua API cập nhật.
- Hủy đăng ký: `DELETE vehicle-registrations/:id` → `softDeleteOwned()` (`vehicle-registration.controller.ts:264-277`) — khớp đúng POST-2 (soft-delete, dừng nhận diện).

**Nhận xét:**
Phần "hủy đăng ký" khớp hoàn toàn. Nhưng phần "cập nhật" chỉ cho sửa metadata (loại xe/ghi chú) — **biển số là bất biến sau khi tạo**, khác hẳn ví dụ trung tâm mà SRS dùng để minh họa UC này ("đổi biển số khi đổi xe"). Muốn đổi biển số, người dùng phải hủy đăng ký cũ và tạo đăng ký hoàn toàn mới (UC-108) — không có luồng "sửa tại chỗ rồi quay lại chờ duyệt" như SRS mô tả (hệ quả tất yếu vì bản thân trạng thái "chờ duyệt" cũng không tồn tại — xem UC-108/109).

**Đề xuất sửa SRS:**
> POST-1: Chỉ `vehicleType` (loại xe) và `note` (ghi chú) có thể chỉnh sửa qua `PATCH /anpr/vehicle-registrations/:id`. **Biển số xe là bất biến** sau khi đăng ký — muốn đổi biển số, người dùng phải hủy đăng ký hiện tại (`DELETE`) và tạo đăng ký mới (`POST`) với biển số khác.

---

## UC-111 — Xem & tra cứu phương tiện

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** BR1: nhân viên chỉ xem phương tiện của mình; Admin xem toàn bộ.

**Code thực tế (bằng chứng):**
- `GET anpr/vehicle-registrations` (own, `vehicle-registration.controller.ts:138-156`, `userId` lấy từ JWT) và `GET anpr/admin/vehicle-registrations` (toàn bộ, permission `anpr.vehicle.admin_read`, dòng 119-133) — khớp chính xác BR1.
- Chi tiết 1 phương tiện (`GET vehicle-registrations/:id`, dòng 159-175) — không thuộc sở hữu → 404, khớp nguyên tắc bảo mật ẩn danh (không lộ 403 phân biệt tồn tại/không tồn tại).

**Nhận xét:** Không phát hiện sai lệch.

---

## UC-112 — Ghi nhận sự kiện biển số

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** EX2: nếu độ tin cậy nhận diện dưới ngưỡng, vẫn lưu sự kiện nhưng đánh dấu "Cần xác minh thủ công" thay vì tự động đối chiếu.

**Code thực tế (bằng chứng):**
- Route: `POST internal/ivss/vehicle-events`, xác thực bằng `AnprInternalTokenGuard` (header `X-Internal-Token`, không phải JWT) — `src/modules/anpr/controllers/vehicle-webhook.controller.ts:39-77`. Comment dòng 26 xác nhận "ARCH-01: LUÔN ack 200" (khớp BR1 — mọi sự kiện đều được xử lý/lưu, không chặn ở tầng webhook) và chuẩn hóa biển số qua `normalizePlate()` trước khi xử lý (khớp bước 3 Normal Flow).
- Nguồn gửi thực tế là **"IVSS bridge"** (cùng hạ tầng tích hợp IVSS đã ghi nhận ở Mục 10), không phải một "ANPR Webhook Service" độc lập như SRS liệt kê ở Secondary Actors — về bản chất tương đương, chỉ khác tên gọi kênh tích hợp.
- Grep `confidence|threshold|manual|Cần xác minh` trong `vehicle-resolve.service.ts`: **0 kết quả** — không tìm thấy cơ chế đánh dấu "Cần xác minh thủ công" theo ngưỡng độ tin cậy.

**Nhận xét:**
Luồng chính (nhận, xác thực, chuẩn hóa, lưu, đối chiếu — BR1/BR2) khớp tốt. EX2 (ngưỡng độ tin cậy → đánh dấu cần xác minh thủ công) không tìm thấy bằng chứng triển khai trong phạm vi đã đọc — có thể do payload webhook từ IVSS bridge không mang theo điểm tin cậy, hoặc cơ chế này chưa được nối.

**Đề xuất sửa SRS:**
> Secondary Actor thực tế là "IVSS Bridge" (cùng hạ tầng tích hợp IVSS dùng cho điểm danh/hiện diện ở Mục 10), không phải một dịch vụ webhook ANPR độc lập. EX2 (xử lý độ tin cậy thấp) hiện **chưa xác nhận được bằng chứng triển khai** — cần đội BE xác nhận lại trước khi giữ nguyên yêu cầu này trong đặc tả.

---

## UC-113 — Danh sách kiểm soát phương tiện

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi (Other Information):** "Đây là phần xây mới hoàn toàn (**chưa có code sẵn**), khác với các UC còn lại trong FT-19."

**Code thực tế (bằng chứng):**
- `VehicleControlListController` (`src/modules/anpr/controllers/vehicle-control-list.controller.ts:1-60+`) — 5 route CRUD đầy đủ dưới `anpr/admin/control-list`, toàn bộ admin/security-gated (`PermissionsGuard`, không có route self-service) — khớp đúng "độc lập với danh sách đăng ký, không có ownership" của SRS.
- `VehicleControlAlertService` (`src/modules/anpr/services/vehicle-control-alert.service.ts:1-50+`) — kích hoạt `AlertsService.recordAlert()` + notification khi biển số khớp control-list, có throttle chống spam cảnh báo (300s/biển số) và tôn trọng `AlertRulesService` (cho phép tắt loại cảnh báo này) — khớp đúng BR2.

**Nhận xét:**
Ghi chú "chưa có code sẵn" của SRS **đã lỗi thời** — module này không chỉ có sẵn mà còn được xây khá hoàn chỉnh, bao gồm cả phần tích hợp cảnh báo (liên kết trực tiếp tới Mục 21 - Security Alert Center). Về mặt hành vi nghiệp vụ, không phát hiện sai lệch.

**Đề xuất sửa SRS:** Cập nhật ghi chú "Other Information" — bỏ câu "chưa có code sẵn", thay bằng xác nhận module đã triển khai đầy đủ CRUD + tích hợp cảnh báo.

---

## UC-114 — Thống kê lưu lượng phương tiện

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Thống kê lưu lượng ra/vào theo thời gian/cổng/loại xe, dạng biểu đồ + bảng.

**Code thực tế (bằng chứng):**
- Route: `GET gate-access/admin/vehicle-traffic-stats`, permission `gate_access.stats.read` — `src/modules/gate-access/controllers/vehicle-traffic-stats.controller.ts:21-39`, comment dòng 18 gắn nhãn trực tiếp **"UC-114"** và "SRS Primary Actor 'System Admin / Manager'" — xác nhận đội BE tự đối chiếu đúng UC này khi code.
- Đặt trong module **`gate-access`** (thuộc phạm vi Mục 19 của SRS), không phải trong `anpr` — hợp lý về ranh giới module vì đây là phân tích dữ liệu ra/vào (gate log), không phải dữ liệu đăng ký/nhận diện biển số.

**Nhận xét:** Không phát hiện sai lệch nghiệp vụ. Chỉ khác vị trí module so với cách SRS xếp UC-114 vào Mục 18 (Vehicle & License Plate Management) thay vì Mục 19 (Gate Check-in/Check-out) — một điểm tổ chức tài liệu, không phải lỗi hành vi.

**Đề xuất sửa SRS:** Không cần sửa nội dung nghiệp vụ; có thể cân nhắc di chuyển UC-114 sang Mục 19 trong lần tái cấu trúc tài liệu tiếp theo cho khớp ranh giới module thật.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **`VehicleUnknownService`** (`GET anpr/admin/unknown-vehicles`, `vehicle-registration.controller.ts:96-109`) — Admin xem danh sách biển số "lạ" (đi qua camera nhưng không khớp bất kỳ đăng ký nào) — một màn hình quản trị hoàn toàn không có trong SRS Mục 18 (dù có tinh thần gần với "Xe lạ" ở POST-2 của UC-112, nhưng SRS không mô tả nó như một màn hình tra cứu riêng cho Admin).
2. **`VehicleHistoryService`** — 2 route lịch sử ra/vào riêng cho biển số (`vehicle-history` cho chính mình, `admin/vehicle-history` cho Admin xem toàn bộ kể cả chưa khớp đăng ký) — trùng lặp một phần với UC-117 (Mục 19) nhưng nằm trong module `anpr`, tập trung theo góc nhìn "biển số" thay vì "cổng".
3. **Đăng ký hộ bởi Admin** (`POST anpr/admin/vehicle-registrations`, permission `anpr.vehicle.admin_register`) — Admin tạo đăng ký thay cho một user bất kỳ (`userId` lấy từ body thay vì JWT) — không có trong SRS UC-108 (SRS chỉ mô tả nhân viên tự đăng ký).
