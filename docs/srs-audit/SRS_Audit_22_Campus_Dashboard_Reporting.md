# Đánh giá SRS — Campus Dashboard & Reporting

## Tổng quan

Số UC: 4 | Khớp hoàn toàn: 0 | Khớp 1 phần: 4 | Sai hoàn toàn: 0 | Không có code: 0

---

## UC-126 — Dashboard điều hành khuôn viên

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Bước 3 Normal Flow: "Hệ thống trả về dữ liệu tổng hợp theo cấu trúc phân cấp Tòa nhà → Tầng → Khu vực, **kèm tọa độ khu vực để FE dựng bản đồ GIS**."

**Code thực tế (bằng chứng):**
- Route: `GET campus-dashboard/overview`, permission `campus_dashboard.overview.read` — `src/modules/campus-dashboard/controllers/dashboard-overview.controller.ts:21-41`, comment gắn nhãn "CDB-001 / UC-126".
- `DashboardOverviewService.buildZoneOverview()` (`src/modules/campus-dashboard/services/dashboard-overview.service.ts:64-95`): trả cấu trúc phân cấp `buildings → floors → zones` (khớp bước 3), có `occupancy` (qua `resolveOccupancyStatus`, phân biệt "không có dữ liệu" với "0 người" — khớp EX1), `cameraStatus`, `gateTraffic.{entriesToday,exitsToday}` (đếm thật từ `gate_access_logs` theo `direction='enter'/'leave'` trong ngày, dòng 80-83) — các phần này đều có dữ liệu thật, tính đúng.
- **Riêng `coordinates: null` (dòng 90, comment "BLOCKED — xem spec §2.1")** — trường tọa độ khu vực **luôn `null`** cho mọi zone, vì bảng `zones` chưa có cột lưu vị trí (xác nhận chéo với Mục 20 UC-120, cùng comment "BLOCKED" tham chiếu ngược lại chính UC-126 §2.1).

**Nhận xét:**
Toàn bộ số liệu tổng hợp (hiện diện, camera, lưu lượng ra/vào trong ngày) đều là dữ liệu thật, tính đúng. Riêng phần tọa độ — điều kiện tiên quyết để FE "dựng bản đồ GIS" như SRS yêu cầu tường minh ở bước 3 — luôn rỗng, khiến phần bản đồ trực quan không thể triển khai được cho bất kỳ khu vực nào ở phiên bản hiện tại.

**Đề xuất sửa SRS:**
> Bước 3: Dữ liệu trả về có cấu trúc phân cấp Tòa nhà → Tầng → Khu vực kèm số liệu hiện diện/camera/lưu lượng ra-vào trong ngày — **nhưng trường tọa độ khu vực luôn `null`** (bảng `zones` chưa có cột lưu vị trí trong mặt bằng). Phần bản đồ GIS trực quan mà FE dự định dựng dựa trên tọa độ này **hiện chưa khả thi** cho tới khi bổ sung cột tọa độ vào schema `zones`.

---

## UC-127 — Xuất báo cáo ra vào khuôn viên

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** EX1: "Nếu không có dữ liệu nào khớp bộ lọc... hệ thống thông báo 'Không có dữ liệu để xuất báo cáo' và **KHÔNG tạo tác vụ xuất**."

**Code thực tế (bằng chứng):**
- Route: `POST reports/gate-access/exports`, permission `report.gate_access.export` — `src/modules/reports/controllers/gate-access-report.controller.ts:16-48`, comment "UC-127". `CreateGateAccessExportDto` (`create-gate-access-export.dto.ts:33-47`): `format` giới hạn đúng `['pdf','xlsx']` (khớp BR1), `scope` lọc `zoneId`/`departmentId`/`userId` (khớp "cổng/phòng ban/cá nhân").
- `createExportJob()` (`src/modules/reports/services/gate-access-report.service.ts:28-36,50-109`): docblock đầu class ghi rõ tường minh: **"§0.1 spec: LUÔN enqueue job kể cả khi tổ hợp filter có thể rỗng — worker sẽ render file 'Không có dữ liệu' hợp lệ, KHÔNG chặn tạo job đồng bộ ở tầng này."** Hàm chỉ validate khoảng thời gian (`validateDateRange`/`validateMaxRangeDays`) rồi tạo `backgroundJob` + đẩy vào queue ngay (dòng 68-91) — không có bước kiểm tra dữ liệu rỗng nào trước khi tạo job.

**Nhận xét:**
Luồng chính (cấu hình bộ lọc, chọn định dạng, xuất bất đồng bộ qua BullMQ) khớp rất tốt với SRS. Riêng EX1 sai lệch theo hướng cụ thể: SRS mô tả kiểm tra ĐỒNG BỘ ngay tại bước tạo yêu cầu ("không tạo tác vụ xuất"), nhưng code CHỦ Ý (ghi rõ trong docblock, không phải thiếu sót) luôn tạo job trước, và việc "không có dữ liệu" chỉ thể hiện dưới dạng **nội dung file kết quả** ("Không có dữ liệu") do worker render ra sau khi job chạy xong — không phải một thông báo chặn tức thời trên màn hình như SRS mô tả.

**Đề xuất sửa SRS:**
> EX1: Hệ thống **luôn tạo job xuất báo cáo** ngay khi khoảng thời gian hợp lệ, bất kể có dữ liệu khớp bộ lọc hay không (quyết định thiết kế có chủ đích, ghi trong spec nội bộ §0.1). Nếu không có dữ liệu, job vẫn chạy xong bình thường và trả về 1 file PDF/Excel có nội dung "Không có dữ liệu" — không phải một thông báo chặn ngay lập tức, không có tác vụ nào bị từ chối tạo.

---

## UC-128 — Xuất báo cáo phương tiện

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**Code thực tế (bằng chứng):**
- Route: `POST reports/vehicle/exports`, permission `report.vehicle.export` — `src/modules/reports/controllers/vehicle-report.controller.ts:16-40+`, comment "UC-128": "danh sách đăng ký / thống kê lưu lượng / cả hai" — khớp chính xác lựa chọn nội dung ở bước 1 Normal Flow.
- `VehicleReportService.createExportJob()` (`src/modules/reports/services/vehicle-report.service.ts:19-25,38-97`): docblock đầu class xác nhận trực tiếp cả 2 điểm: **"§2.2 spec: KHÔNG áp scope phòng ban Manager (khác UC-127/UC-AA-12) — `vehicle_registrations`/lưu lượng phương tiện không gắn `department_id`"** và **"§0.1 spec: LUÔN enqueue job kể cả khi rỗng — worker render file 'Không có dữ liệu' hợp lệ"**. Thân hàm (dòng 42-97) xác nhận đúng: chỉ validate ngày tháng rồi tạo job ngay, không filter theo phòng ban.

**Nhận xét:**
1. EX1 (dữ liệu rỗng): giống hệt UC-127 — job luôn được tạo, "không có dữ liệu" chỉ là nội dung file kết quả, không phải thông báo chặn đồng bộ.
2. Phát hiện mới (không có ở UC-127): báo cáo phương tiện **không** giới hạn phạm vi theo phòng ban cho Manager — trái ngược với PRE-1 của SRS liệt kê "Admin/Manager" như nhau nhưng không nói rõ Manager có bị giới hạn phạm vi hay không; thực tế Manager xuất được báo cáo cho TOÀN BỘ phương tiện, không riêng phòng ban mình (vì bản ghi phương tiện không có `department_id`).

**Đề xuất sửa SRS:**
> EX1: Tương tự UC-127 — job luôn được tạo, "không có dữ liệu" thể hiện trong nội dung file, không chặn tạo job.
> Bổ sung: Báo cáo phương tiện **không phân biệt phạm vi Manager theo phòng ban** — Manager xuất được dữ liệu toàn bộ phương tiện trong công ty, vì bảng phương tiện không lưu thông tin phòng ban.

---

## UC-129 — Xuất báo cáo sự kiện an ninh

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**Code thực tế (bằng chứng):**
- Route: `POST reports/security-alert/exports`, permission `report.security_alert.export` — `src/modules/reports/controllers/security-alert-report.controller.ts:16-40+`, comment "UC-129", nguồn dữ liệu `security_alerts` (khớp UC-123).
- `SecurityAlertReportService.createExportJob()` (`src/modules/reports/services/security-alert-report.service.ts:19-25,37-94`): docblock xác nhận trực tiếp: **"§2.2 spec: KHÔNG áp scope phòng ban Manager — `security_alerts` không gắn `department_id`, chỉ gắn `zone_id` (filter tùy chọn cho mọi role)"** và **"§0.1 spec: LUÔN enqueue job kể cả khi rỗng"**. Filter thân hàm (dòng 45-49): `alertType`/`zoneId`/`status` — khớp đúng "loại cảnh báo, khu vực, trạng thái xử lý" ở bước 1 Normal Flow.

**Nhận xét:**
1. EX1: giống hệt UC-127/128 — job luôn được tạo, "không có dữ liệu" là nội dung file, không phải thông báo chặn.
2. Cùng phát hiện như UC-128: không giới hạn phạm vi Manager theo phòng ban (do `security_alerts` không có `department_id`, chỉ có `zone_id`).

**Đề xuất sửa SRS:**
> EX1: Tương tự UC-127/128.
> Bổ sung: Manager xuất được báo cáo an ninh cho toàn bộ khu vực (không giới hạn theo phòng ban quản lý) — chỉ lọc được theo `zone_id` cụ thể nếu muốn, không có ràng buộc quyền hạn theo phòng ban.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **`resolveScope()` theo role** trong `GateAccessReportService` (dòng 62-66) — tự động giới hạn phạm vi dữ liệu xuất báo cáo theo role người yêu cầu (tương tự mô hình Manager-giới hạn-phòng-ban đã thấy ở Mục 15/17) — chi tiết không có trong SRS.
2. **`validateMaxRangeDays()`** — giới hạn số ngày tối đa cho phép trong 1 lần xuất báo cáo (ngăn query quá lớn) — không có trong SRS Mục 22 (dù các Mục báo cáo khác như Mục 15 UC-96 có nhắc gần tương tự ở dạng khác — "khoảng thời gian quá lớn").
3. **Audit log riêng cho mỗi yêu cầu xuất báo cáo** (`writeAuditLog()`, best-effort, không chặn luồng chính nếu ghi log lỗi) — không có trong SRS.
