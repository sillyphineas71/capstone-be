# Đánh giá SRS — Security Alert Center

## Tổng quan

Số UC: 4 | Khớp hoàn toàn: 0 | Khớp 1 phần: 4 | Sai hoàn toàn: 0 | Không có code: 0

Module `alerts` được xây dựng bài bản. Sau khi đọc sâu thêm tầng service và truy vết lời gọi thực tế (không chỉ DTO/controller), phát hiện 4 điểm lệch cụ thể — đáng chú ý nhất là UC-125: chức năng "kích hoạt cảnh báo khi nhận diện khớp watchlist" đã viết code đúng nhưng **chưa từng được gọi tới** từ luồng nhận diện khuôn mặt thật; và UC-123: có 1 cron tùy chọn (tắt mặc định) tự động resolve cảnh báo, mâu thuẫn trực tiếp với BR1 nếu được bật.

---

## UC-122 — Cấu hình quy tắc cảnh báo

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Bước 2 Normal Flow: form cấu hình gồm "phạm vi áp dụng (**toàn khuôn viên**/chọn khu vực cụ thể)" — áp dụng chung cho mọi loại sự kiện, ví dụ minh họa chính ngay ở bước 1 là **"Tụ tập đông người, Xâm nhập khu vực hạn chế"** (tức `crowd`/`intrusion`).

**Code thực tế (bằng chứng):**
- `AlertRulesController` (`src/modules/alerts/controllers/alert-rules.controller.ts:33-70+`, comment "ARL-001 / UC-122") — CRUD đầy đủ `alert_rules`. `CreateAlertRuleDto` (`create-alert-rule.dto.ts:19-109`): `alertType` (7 loại), `zoneId` khai `@IsOptional()` ở tầng DTO (dòng 66-70), `threshold` bắt buộc dương khi `alertType='crowd'` (khớp EX1).
- **NHƯNG** `AlertRulesService.assertZoneRequired()` (`src/modules/alerts/services/alert-rules.service.ts:239-263`) chặn ở tầng service: nếu `alertType === 'intrusion' || alertType === 'crowd'` mà **không có `zoneId`** → `BadRequestException` code `ALERT_RULE_ZONE_REQUIRED`, message: **"Loại cảnh báo này yêu cầu chọn khu vực cụ thể — không hỗ trợ áp dụng cho toàn khuôn viên."** Comment dòng 240-250 xác nhận đây là chủ đích: `loadZoneScopedIntrusionRules()`/`loadZoneScopedCrowdRules()` (dùng bởi cron Mục 20 UC-121/124) **CHỦ Ý lọc bỏ mọi rule `zoneId=NULL`** khỏi tập quét — một rule "toàn khuôn viên" cho 2 loại này dù tạo được (trước bản vá) cũng sẽ **không bao giờ kích hoạt**, nên bản vá 2026-08-11 chặn hẳn việc tạo từ gốc.
- `findEffectiveRule()` (dòng 213-237, cơ chế zone-scoped ghi đè global — khớp BR2) chỉ áp dụng thật cho **5/7 loại còn lại** (`stranger`/`unknown_vehicle`/`vehicle_control_match`/`device_error`/`person_watchlist_match`) — không áp dụng cho `crowd`/`intrusion` vì 2 loại này không có khái niệm rule toàn cục.

**Nhận xét:**
Đây là mâu thuẫn trực tiếp với chính ví dụ minh họa mà SRS dùng ở bước 1 Normal Flow: "Tụ tập đông người" (`crowd`) và "Xâm nhập khu vực hạn chế" (`intrusion`) là 2 loại sự kiện **duy nhất** không cho phép chọn "toàn khuôn viên" — bắt buộc phải gắn 1 khu vực cụ thể. 5 loại sự kiện còn lại (người lạ, xe lạ, xe trong control-list, thiết bị lỗi, watchlist người) mới thực sự hỗ trợ đúng cả 2 lựa chọn phạm vi như SRS mô tả.

**Đề xuất sửa SRS:**
> Bước 2: Lựa chọn phạm vi "toàn khuôn viên / khu vực cụ thể" **chỉ áp dụng cho 5 loại sự kiện**: người lạ, xe lạ, xe trong danh sách kiểm soát, thiết bị lỗi, người trong watchlist. Riêng 2 loại **"Tụ tập đông người"** và **"Xâm nhập khu vực hạn chế"** — ví dụ minh họa chính của SRS — **bắt buộc phải chọn 1 khu vực cụ thể**, không hỗ trợ cấu hình áp dụng cho toàn khuôn viên (validation chặn ở tầng service, lỗi `ALERT_RULE_ZONE_REQUIRED`).

---

## UC-123 — Xem & xử lý cảnh báo an ninh

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR1: "Cảnh báo chưa xử lý **không tự động biến mất** khỏi danh sách dù đã quá thời gian dài — phải được người dùng **chủ động** xác nhận xử lý."

**Code thực tế (bằng chứng):**
- Phần thao tác thủ công khớp tốt: `AlertsController` (`src/modules/alerts/controllers/alerts.controller.ts:32-123`, comment "ASC-001 / UC-123") — `list`/`detail` (kèm `zone`+`history` cùng loại/cùng zone, khớp bước 3), `acknowledge()` (`alerts.service.ts:313-329`, conditional UPDATE `WHERE status='new'`, atomic — khớp EX1 race-condition), `resolve()` (dòng 332-350, chỉ chuyển được từ `status='acknowledged'`, kèm `resolutionNote` — khớp POST-2), `bulkAcknowledge()` (dòng 353+, xử lý độc lập từng id — khớp AF1).
- **NHƯNG** có 1 cron riêng **tự động resolve cảnh báo mà KHÔNG cần con người**: `SecurityAlertAutoResolveService.autoResolveExpired()` (`src/modules/alerts/services/security-alert-auto-resolve.service.ts:36-52`) — chạy mỗi 5 phút (`scheduler.service.ts:480-497`, gate `SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED`, **mặc định OFF**), thực thi trực tiếp: `UPDATE security_alerts SET status='resolved', resolved_at=NOW(), resolution_note='Tự động đóng do không tái phát trong N phút' WHERE status <> 'resolved' AND ... < NOW() - N phút` — áp dụng cho **cả alert `status='new'` (chưa từng ai acknowledge)**, không có `resolved_by` (không gắn người xử lý nào).

**Nhận xét:**
Toàn bộ thao tác thủ công (xem/lọc/acknowledge/resolve/bulk) khớp SRS rất tốt. Nhưng có 1 cơ chế **tùy chọn** (tắt mặc định, Admin có thể bật qua biến môi trường) trực tiếp mâu thuẫn BR1: nếu bật, cảnh báo **sẽ tự động biến mất** (chuyển `resolved`) sau N phút không tái phát, hoàn toàn không cần "người dùng chủ động xác nhận" như SRS khẳng định là bắt buộc.

**Đề xuất sửa SRS:**
> BR1: Mặc định, cảnh báo chưa xử lý không tự động biến mất — phải người dùng chủ động xác nhận. Tuy nhiên hệ thống có sẵn 1 cơ chế **tùy chọn** (tắt theo mặc định, Admin bật qua cấu hình `SCHEDULER_SECURITY_ALERT_AUTO_RESOLVE_ENABLED`): nếu bật, mọi cảnh báo (kể cả chưa từng được ai xác nhận) sẽ **tự động chuyển sang "Đã xử lý"** nếu không tái phát trong N phút (mặc định 15, cấu hình được), với ghi chú tự động "Tự động đóng do không tái phát trong N phút" — không gắn người xử lý.

---

## UC-124 — Cảnh báo xâm nhập khu vực hạn chế

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** EX1: "Nếu hệ thống chỉ có dữ liệu đếm số người... cảnh báo vẫn được sinh ra nhưng **ghi rõ 'Không xác định danh tính — chỉ ghi nhận có người xuất hiện ngoài khung giờ cho phép'**."

**Code thực tế (bằng chứng):**
- Cron `restricted-zone-intrusion` (mỗi 5 phút) → `RestrictedZoneIntrusionService.evaluateIntrusions()` (`src/modules/restricted-zone/services/restricted-zone-intrusion.service.ts:30-125`, comment "ARZ-001 / UC-124") — đối chiếu CẢ `gate_access_logs` LẪN `zone_presence_events` với rule `intrusion` gắn zone cụ thể, theo khung giờ `restrictedHoursJson`.
- `isViolation()` (dòng 252-...): comment xác nhận chính xác 3 nhánh — "trong khung giờ cho phép → KHÔNG vi phạm bất kể userId; ngoài khung → chỉ userId trong `allowedPersonIdsJson` mới KHÔNG vi phạm; **userId NULL (chưa định danh) → LUÔN vi phạm**" — khớp đúng tinh thần EX1 (occupancy không định danh vẫn tính là vi phạm khi ngoài khung giờ).
- `recordIntrusion()` (dòng 192-219): khi ghi cảnh báo, chỉ lưu **`isKnownPerson: userId !== null`** (dòng 216) vào `payload_json` — đây là **1 cờ boolean thuần túy**, KHÔNG phải chuỗi thông điệp "Không xác định danh tính — chỉ ghi nhận có người xuất hiện ngoài khung giờ cho phép" như SRS yêu cầu nguyên văn. Không tìm thấy đoạn code nào sinh ra chuỗi thông điệp đó.

**Nhận xét:**
Logic nghiệp vụ (khi nào tính là vi phạm, xử lý an toàn trường hợp không có `userId`) khớp đúng tinh thần SRS. Nhưng phần "nội dung hiển thị" mà EX1 yêu cầu nguyên văn không tồn tại trong BE — BE chỉ trả về 1 cờ `isKnownPerson: false`; việc dựng câu thông báo cụ thể (nếu có) phải do FE tự làm dựa trên cờ này, không phải BE tạo sẵn.

**Đề xuất sửa SRS:**
> EX1: Khi không xác định được danh tính, BE ghi cờ **`isKnownPerson: false`** vào dữ liệu cảnh báo (`payload_json`) — không tự sinh sẵn chuỗi thông báo "Không xác định danh tính...". FE cần tự dựng nội dung hiển thị dựa trên cờ này nếu muốn đúng như văn phong SRS mô tả.

---

## UC-125 — Danh sách kiểm soát người (Watchlist) (bỏ UC này)

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (SRS tự đề xuất bỏ — không nên bỏ, nhưng phần "kích hoạt cảnh báo" của BR2 hiện KHÔNG chạy được trong thực tế)

**SRS hiện tại ghi:** Tiêu đề UC tự đánh dấu "(bỏ UC này)". BR2: "Khi một sự kiện nhận diện khuôn mặt khớp với một hồ sơ trong watchlist, hệ thống **phải kích hoạt cảnh báo** mức ưu tiên tương ứng."

**Code thực tế (bằng chứng):**
- `PersonControlListController` (`src/modules/alerts/controllers/person-control-list.controller.ts:33-50+`, comment "PWL-001 / UC-125") — CRUD đầy đủ, admin-gated — khớp Normal Flow quản lý danh sách (thêm/xem/gỡ).
- `CreatePersonControlListDto` (`src/modules/alerts/dto/create-person-control-list.dto.ts:32-79`): `userId`/`faceProfileId` optional độc lập — khớp BR1.
- `PersonWatchlistCheckService.checkPersonWatchlist()` (`src/modules/alerts/services/person-watchlist-check.service.ts:17-18`, comment tự mô tả: **"điểm vào DUY NHẤT cho `face-access` gọi khi có event nhận diện"**) — logic bên trong đúng (severity lấy từ `match.priority`, có throttle).
- **Đã grep toàn bộ `src/` cho `PersonWatchlistCheckService`/`checkPersonWatchlist`: chỉ xuất hiện trong chính `alerts.module.ts` (khai báo provider) và file spec test của chính nó.** Grep riêng module `face-access` cho `watchlist|control_list|ControlList`: **0 kết quả**. Xác nhận: **không có bất kỳ nơi nào trong toàn bộ codebase thực sự GỌI `checkPersonWatchlist()`** — kể cả module `face-access` mà chính comment của service này nói là "điểm vào duy nhất" cho nó gọi tới.

**Nhận xét:**
Đây là trường hợp phức tạp hơn các UC "(bỏ UC này)" khác đã gặp (UC-30/31, UC-84, UC-109 — ở đó đề xuất bỏ được xác nhận ĐÚNG vì chưa/không triển khai gì). Ở UC-125: phần **quản lý danh sách** (CRUD watchlist) đã triển khai đầy đủ và khớp SRS tốt — nên **không nên bỏ UC này**. Nhưng phần **kích hoạt cảnh báo khi nhận diện khớp** (BR2 — chính là giá trị cốt lõi của một "watchlist") **chưa được kết nối vào luồng nhận diện khuôn mặt thật** — hàm xử lý đã viết xong và đúng logic, nhưng không có lời gọi nào tới nó từ `face-access` hay bất kỳ module nào khác. Nói cách khác: thêm 1 người vào watchlist hôm nay, và người đó xuất hiện trước camera, **sẽ không có cảnh báo nào được sinh ra** trong hệ thống hiện tại — trái ngược hoàn toàn với hiệu ứng mà Normal Flow bước 4 và BR2 mô tả ("kể từ thời điểm này, mọi sự kiện nhận diện khớp... sẽ kích hoạt cảnh báo").

**Đề xuất sửa SRS:**
> Không bỏ UC này — chức năng quản lý watchlist (thêm/xem/gỡ) đã hoạt động đầy đủ. Tuy nhiên cần ghi rõ: **tính năng cốt lõi "tự động cảnh báo khi nhận diện khớp watchlist" (BR2) hiện CHƯA hoạt động** — hàm xử lý cảnh báo (`PersonWatchlistCheckService.checkPersonWatchlist()`) đã được viết đúng logic nhưng **chưa được module nhận diện khuôn mặt (`face-access`) gọi tới ở bất kỳ đâu**. Đây là một khoảng trống tích hợp (integration gap) cần đội BE bổ sung 1 lời gọi từ luồng xử lý sự kiện nhận diện khuôn mặt thật trước khi tính năng này hoạt động đúng như đặc tả.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **`AlertRulesService.findEffectiveRule()`** — cơ chế phân giải "quy tắc có hiệu lực" khi có cả rule mặc định toàn hệ thống LẪN rule riêng cho 1 zone cụ thể (zone-scoped ghi đè global) — đúng tinh thần BR2 của UC-122 nhưng có tên hàm/API tường minh không được SRS mô tả chi tiết.
2. **Throttle in-memory chống spam cảnh báo theo từng đối tượng** (300 giây/biển số hoặc /userId, dùng chung pattern giữa `VehicleControlAlertService` và `PersonWatchlistCheckService`) — cảnh báo có `lastAlertAt` in-memory map (mirror nhau, single-instance, reset khi backend restart) — chi tiết triển khai không có trong SRS.
3. **"Đường tắt tức thời" song song với cron theo lô** cho cả UC-121 (crowd) lẫn UC-124 (intrusion) — cảnh báo có thể được sinh ngay khi sự kiện xảy ra (không cần đợi chu kỳ quét định kỳ) — một tối ưu độ trễ không được SRS đề cập.
