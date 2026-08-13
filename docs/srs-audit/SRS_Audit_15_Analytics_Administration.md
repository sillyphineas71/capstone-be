# Đánh giá SRS — Analytics & Administration

## Tổng quan

Số UC: 5 | Khớp hoàn toàn: 1 | Khớp 1 phần: 3 | Sai hoàn toàn: 1 | Không có code: 0

Ghi chú tổng quan: Cả UC-96, UC-97, UC-100 trong SRS đều dùng lý luận "Rule 6" để gộp nhiều UC cũ (UC-AA-xx, UC-RUM-xx) thành 1 UC hợp nhất duy nhất, với lý do "các chỉ số/luồng con này chỉ là tiện ích CỦA 1 màn hình/API duy nhất, không phải use case độc lập". Kiểm tra code cho thấy **lý luận gộp này không khớp với thực tế triển khai** ở phần lớn trường hợp: các "UC cũ" mà SRS tuyên bố đã gộp/loại bỏ vẫn tồn tại như những route, permission, và (với UC-100) cả DTO/service hoàn toàn tách biệt trong code — đây là phát hiện xuyên suốt của cả Mục này.

---

## UC-96 — Xem Dashboard Tổng quan Hệ thống (KPI Cuộc họp)

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi (Other Information):** "Gộp từ UC-AA-01, UC-AA-04, UC-AA-05, UC-AA-06, UC-AA-07 — theo Rule 6, các chỉ số này là **tiện ích CỦA** dashboard tổng quan, **KHÔNG PHẢI use case độc lập**."

**Code thực tế (bằng chứng):**
- `GET analytics/dashboard/overview`, permission `analytics.overview.read` — `src/modules/analytics/controllers/dashboard-overview.controller.ts:34-81`, comment "UC-AA-01": trả về "8 KPI và trend theo ngày" trong 1 lần gọi — khớp đúng ý tưởng dashboard hợp nhất.
- `DashboardOverviewService.validateDepartmentOwnership()` (`src/modules/analytics/services/dashboard-overview.service.ts:204-211`) — khớp đúng BR-01 (Manager giới hạn theo phòng ban quản lý, chặn bằng lỗi `DEPARTMENT_OUT_OF_SCOPE`).
- **NHƯNG** các "UC cũ" mà SRS khẳng định đã gộp vẫn tồn tại như route **độc lập, permission riêng**:
  - `GET analytics/meetings/count-by-period`, permission `analytics.meeting.read` — `meeting-count-by-period.controller.ts:30-45`, comment ngay trong code: **"UC-AA-04 / UC-151"**.
  - `meeting-status-breakdown.controller.ts`, `meeting-average-duration.controller.ts`, `meeting-cancel-rate.controller.ts` — tương ứng UC-AA-05/06/07, đều là controller/route riêng dưới `analytics/meetings/*`.

**Nhận xét:**
Bản thân dashboard hợp nhất (UC-AA-01) hoạt động đúng như SRS mô tả. Nhưng khẳng định "các UC cũ không phải use case độc lập" là sai — chúng vẫn là route API độc lập, có permission riêng (`analytics.meeting.read`, khác `analytics.overview.read` của dashboard), có thể gọi tách biệt hoàn toàn không qua màn hình dashboard.

**Đề xuất sửa SRS:**
> Bỏ khẳng định "không phải use case độc lập". Thực tế: có 2 lớp API song song — (1) `GET /analytics/dashboard/overview` (permission `analytics.overview.read`) trả 8 KPI + trend trong 1 lần gọi, dùng cho màn hình dashboard tổng quan; (2) các endpoint chi tiết riêng biệt cho từng chỉ số (`analytics/meetings/count-by-period`, `.../status-breakdown`, `.../average-duration`, `.../cancel-rate`, permission `analytics.meeting.read`) — vẫn tồn tại như API độc lập, có thể gọi trực tiếp không qua dashboard.

---

## UC-97 — Xem Dashboard Sử dụng Phòng họp

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** 4 chỉ số cốt lõi/phòng trong 1 dashboard hợp nhất; AF-1: nhấp "Xuất Dữ liệu" tại màn hình dashboard → hệ thống đóng gói ngay thành .xlsx để tải.

**Code thực tế (bằng chứng):**
- `GET analytics/rooms/dashboard`, permission `analytics.room.read` — `room-usage-dashboard.controller.ts:37-50`, comment "UC-AA-02 / UC-149" — trả danh sách phòng kèm 4 chỉ số + trend, khớp Normal Flow.
- `GET analytics/rooms/:roomId/detail` (dòng 91+) — khớp bước 4 "chọn 1 phòng cụ thể xem sâu dòng thời gian".
- AF-1 (xuất .xlsx): **không nằm trong controller dashboard này** — grep xác nhận `room-usage-dashboard.controller.ts` chỉ có 2 route (`dashboard`, `:roomId/detail`), không có action export. Chức năng xuất thật nằm ở **module khác** (`reports`): `POST reports/room-utilization/exports` (permission RIÊNG `report.room_utilization.export`, chỉ seed cho BUSINESS_ADMIN/SYSTEM_ADMIN — **không có MANAGER**, `src/modules/reports/controllers/room-utilization-report.controller.ts:16-24,30-55`) — trả **202 Accepted + jobId bất đồng bộ** (phải poll `background-jobs/:id`), không phải "đóng gói ngay và tải xuống" như SRS mô tả.
- Old sub-UC vẫn tồn tại độc lập: `no-show-rate.controller.ts`, `room-utilization-rate.controller.ts`, `room-usage-history.controller.ts` — route riêng dưới `analytics/rooms/*`.

**Nhận xét:**
1. AF-1 (xuất dữ liệu) thực chất là một action **bất đồng bộ ở module khác** (`reports`), với quyền hạn hẹp hơn hẳn (không có Manager, dù UC-97's BR-03 cho phép Manager xem dashboard phòng ban mình) — không phải nút "Xuất" đồng bộ ngay trên màn hình dashboard.
2. Tương tự UC-96, các "UC cũ" (tỷ lệ sử dụng, tỷ lệ no-show) vẫn là endpoint độc lập, không chỉ là "nội dung được gộp vào" dashboard.

**Đề xuất sửa SRS:**
> AF-1: Xuất dữ liệu hiệu suất phòng là hành động **bất đồng bộ, khác endpoint** với dashboard (`POST /reports/room-utilization/exports`, permission `report.room_utilization.export` — chỉ Business/System Admin, **không có Manager**) — trả về `jobId`, client phải tự poll `GET /background-jobs/:id` rồi tải file khi job hoàn tất, không phải tải ngay lập tức.

---

## UC-98 — Xem Dashboard Điểm danh & Hiện diện

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi (Other Information):** "Gộp từ UC-AA-03 (dashboard điểm danh) và UC-AA-10 (tỷ lệ đúng giờ) — số liệu tỷ lệ đúng giờ được gộp vào làm nội dung của dashboard này." Ngụ ý có 1 màn hình/API "dashboard điểm danh" (UC-AA-03) chứa nội dung tỷ lệ đúng giờ bên trong.

**Code thực tế (bằng chứng):**
- Không tồn tại route nào tên "attendance dashboard"/"UC-AA-03" — grep `attendance|presence` trong thư mục controller của `analytics` chỉ tìm thấy đúng 1 file: `on-time-rate.controller.ts`.
- `GET analytics/attendance/on-time-rate`, permission `analytics.attendance.read` — `on-time-rate.controller.ts:36-50`, comment **"UC-AA-10 / UC-157"** (chính là "UC cũ" mà SRS nói đã bị gộp-vào, không phải endpoint hợp nhất mới).
- Response DTO (`src/modules/analytics/dto/on-time-rate-response.dto.ts:25-37`) thực tế đã bao phủ đủ **cả 3 chỉ số** SRS yêu cầu: `onTimeCount`/`lateCount`/`absentCount` + `onTimeRate`, cộng thêm `trend`, `lateByHourOfDay`, `lateByDepartment` — nội dung dữ liệu đủ để làm dashboard, chỉ là được đặt dưới route/tên gọi của "UC cũ" (`on-time-rate`) thay vì một route "dashboard" mới.
- BR-01 (Manager giới hạn phòng ban) khớp — `on-time-rate.service.ts:59-95` có `resolveScope()`/`validateDepartmentOwnership()`.

**Nhận xét:**
Về mặt DỮ LIỆU, UC-98 được thỏa mãn đầy đủ (đủ cả 3 tỷ lệ + phân rã theo giờ/phòng ban). Nhưng về mặt KIẾN TRÚC API, không có 1 endpoint "dashboard điểm danh & hiện diện" hợp nhất mới nào được tạo ra — chính "UC cũ" UC-AA-10 (tỷ lệ đúng giờ) đã tự gánh vác luôn vai trò dashboard, chứ không phải bị "gộp vào bên trong" một dashboard khác như câu chữ SRS ngụ ý.

**Đề xuất sửa SRS:**
> Không có endpoint "dashboard điểm danh" riêng biệt — toàn bộ nội dung Mục này (tỷ lệ đúng giờ/trễ/vắng mặt, phân rã theo giờ trong ngày và theo phòng ban, lịch sử đi trễ theo từng người) được phục vụ bởi 1 endpoint duy nhất: `GET /analytics/attendance/on-time-rate` (permission `analytics.attendance.read`), Manager bị giới hạn theo phòng ban quản lý.

---

## UC-99 — Xem nhật ký kiểm tra hệ thống (Audit Logs)

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Read-only tuyệt đối, System Admin, danh sách phân trang 20-50 bản ghi/trang, sắp xếp giảm dần theo thời gian, cột: Thời gian/Người thực hiện/Hành động/Đối tượng/Trạng thái.

**Code thực tế (bằng chứng):**
- `GET audit-logs`, permission `audit.system.read` (chỉ SYSTEM_ADMIN) — `src/modules/administration/controllers/audit-logs.controller.ts:44-94`, comment tường minh "Read-only tuyệt đối: không có PATCH/PUT/DELETE" (dòng 41) và "KHÔNG gọi AuditLogsService.logAction()... ở bất kỳ đâu trong controller này" (dòng 38-39) — khớp chính xác POST-2/BR1.
- `AuditLogQueryService.listAuditLogs()` (`audit-log-query.service.ts:49-50`): `page = query.page ?? 1`, `limit = query.limit ?? 20` — mặc định 20, nằm trong khoảng "20-50" SRS nêu; `limit` tối đa cho phép là 100 (`query-audit-logs.dto.ts:39-49`).

**Nhận xét:** Không phát hiện sai lệch chức năng.

**Đề xuất sửa SRS:** Không cần sửa nội dung nghiệp vụ.

---

## UC-100 — Xuất Báo cáo Hoạt động Tổng hợp

**Trạng thái:** ❌ SAI HOÀN TOÀN

**SRS hiện tại ghi (Other Information):** "Gộp từ UC-AA-12 (xuất báo cáo hoạt động tổng hợp) và UC-RUM-16 (xuất báo cáo sử dụng phòng) — **MỘT chức năng xuất DUY NHẤT** bao trùm cả hai loại dữ liệu; UC-RUM-16 chỉ là một đường dẫn xuất **bị trùng lặp** [nên loại bỏ]."

**Code thực tế (bằng chứng):** Tồn tại **2 controller/route/permission/DTO/service hoàn toàn tách biệt**, không phải 1 chức năng hợp nhất:
1. `POST reports/meeting-activity/exports`, permission `report.meeting_activity.export` — `src/modules/reports/controllers/meeting-activity-report.controller.ts:26-55`, comment "UC-AA-12 / UC-158".
2. `POST reports/room-utilization/exports`, permission **RIÊNG** `report.room_utilization.export` — `src/modules/reports/controllers/room-utilization-report.controller.ts:30-54`, comment "UC-RUM-16", kèm ghi chú tường minh ngay trong code (dòng 23-24): **"Permission chỉ seed cho BUSINESS_ADMIN/SYSTEM_ADMIN (§0.5 spec.md — khác UC-AA-12, KHÔNG có MANAGER)."**

Dòng comment trên là bằng chứng trực tiếp cho thấy đội ngũ phát triển đã **CHỦ Ý quyết định giữ 2 UC này tách biệt** với phạm vi quyền khác nhau (UC-AA-12/meeting-activity cho phép Manager; UC-RUM-16/room-utilization thì không) — theo đúng 1 tài liệu spec nội bộ (`spec.md`) — hoàn toàn trái ngược quyết định gộp của SRS.

**Nhận xét:**
Tiền đề trung tâm của UC-100 ("một chức năng xuất DUY NHẤT... UC-RUM-16 chỉ là đường dẫn trùng lặp cần loại bỏ") bị chính code bác bỏ bằng bằng chứng rất rõ ràng: không chỉ 2 route tồn tại song song, mà quyền hạn giữa chúng còn KHÁC NHAU theo một quyết định thiết kế đã được ghi chép lại. Không có bất kỳ endpoint nào implement đúng như SRS mô tả (1 form cấu hình, chọn phạm vi thời gian + phòng ban, xuất 1 file bao gồm cả 2 loại dữ liệu).

**Đề xuất sửa SRS:**
> Không có chức năng xuất hợp nhất. Có 2 endpoint xuất báo cáo tách biệt, đều bất đồng bộ (202 + `jobId`, poll `background-jobs/:id`):
> - `POST /reports/meeting-activity/exports` (permission `report.meeting_activity.export`) — báo cáo hoạt động cuộc họp, cho phép cả Manager lẫn Admin.
> - `POST /reports/room-utilization/exports` (permission `report.room_utilization.export`) — báo cáo hiệu suất sử dụng phòng, **chỉ Business/System Admin**, không có Manager.
> Đây là quyết định thiết kế có chủ đích (ghi trong `spec.md` nội bộ), không phải một đường dẫn trùng lặp cần dọn dẹp.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Bề mặt API analytics rộng hơn nhiều so với 5 UC được SRS mô tả** — ngoài các endpoint đã liệt kê ở trên, còn có `audit-activity-hourly.controller.ts` (thống kê hoạt động audit theo giờ) và `security-alerts-daily-trend.controller.ts` (xu hướng cảnh báo an ninh theo ngày, thuộc phạm vi mở rộng SAVP — liên quan Mục 21) — hoàn toàn không được nhắc tới trong SRS Mục 15.
2. **Endpoint lịch sử đi trễ theo từng cá nhân** (`LateHistoryResponseDto`, liên kết tới `GET analytics/attendance/.../late-history` dựa trên `QueryLateHistoryDto` — `on-time-rate-response.dto.ts:39-55`) — tra cứu chi tiết các lần đi trễ của 1 người cụ thể, một mức độ chi tiết (drill-down) không được SRS UC-98 mô tả.
3. **Xuất Excel nhật ký kiểm tra hệ thống** (`GET audit-logs/export`, `audit-logs.controller.ts:103-152`) — code tự ghi chú rõ: "Ngoài phạm vi UC-AA-11 gốc (thêm theo yêu cầu trực tiếp 2026-08-11)" — giới hạn an toàn 50.000 dòng, chỉ xuất đúng 5 trường cố định. Hoàn toàn không có trong SRS UC-99.
