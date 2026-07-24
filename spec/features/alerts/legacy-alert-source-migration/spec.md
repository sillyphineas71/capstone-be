# ASM-001 — 3d (Alerts / SAVP): Hợp nhất nguồn cảnh báo cũ vào `security_alerts`

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec ASM-001 (3d): trỏ `VehicleControlAlertService` (Bước 1) + `StrangerAlertService` (qua port `stranger-alert-hook`) ghi `security_alerts` qua `AlertsService.recordAlert()`, đi kèm `AlertRulesService.findEffectiveRule()` để tôn trọng bật/tắt rule (UC-122). RECON code thật 2 service cũ, phát hiện bug có sẵn `role_code='admin'` không tồn tại trong 4 role chuẩn — ghi rõ residual, KHÔNG tự ý sửa ngoài phạm vi 3d. | Toàn bộ |

> 3d KHÔNG có số UC riêng trong SRS (roadmap liệt là hạng mục hạ tầng riêng của Bước 3, phụ thuộc `../uc122-alert-rules-crud/` cho `findEffectiveRule()` và `../uc123-alert-center/` cho `recordAlert()` — code 2 cụm đó XONG trước mới code 3d).
>
> **STOP.** Chờ Thiếu Chủ duyệt toàn bộ 15 file Bước 3 trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `VehicleControlAlertService` hiện tại ([vehicle-control-alert.service.ts](../../../../src/modules/anpr/services/vehicle-control-alert.service.ts))
`evaluate(plateNumber, context: {channelId, direction})`: `checkControlList()` → không khớp → return; khớp → throttle in-memory 300s/plate → `resolveRecipients()` (role `MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN` — **role hợp lệ**, khác bug ở §0.2) → `notificationsService.createNotification(...)`. Comment đầu file đã ghi sẵn: "Bước 3 (owed) chỉ cần sửa NỘI BỘ service này để trỏ sang bảng `security_alerts` — chỗ gọi (`VehicleResolveService`) và `checkControlList` KHÔNG cần đổi." → xác nhận đúng kế hoạch 3d, KHÔNG đổi chữ ký `evaluate()`.

### 0.2. `StrangerAlertService` hiện tại ([stranger-alert.service.ts](../../../../src/modules/face-access/services/stranger-alert.service.ts))
`onStranger(evt: StrangerAlertInput)` (implement `StrangerAlertHook`, nhận qua port `STRANGER_ALERT_HOOK` — `iot` gọi, `face-access` provide): throttle in-memory 300s/device → WS room-scoped → `resolveAdmins()` → `notificationsService.createNotification(...)`.
**⚠ BUG PHÁT HIỆN (ngoài phạm vi 3d sửa, chỉ GHI NHẬN):** `resolveAdmins()` query `WHERE r.role_code = 'admin'` — nhưng `20260720000002-SeedCoreRoles.ts` (§RECON dưới) xác nhận 4 role CHUẨN DUY NHẤT đang dùng là `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` (chữ HOA, không có `'admin'` chữ thường). Hệ quả: `resolveAdmins()` LUÔN trả mảng rỗng trên DB hiện tại → `if (admins.ids.length === 0) { ...skip notification... }` LUÔN đúng → **cảnh báo người lạ (`stranger`) hiện tại KHÔNG BAO GIỜ gửi được notification cho ai**, kể cả trước khi có 3d. Xem §7 Residuals — quyết định KHÔNG tự sửa bug này trong 3d (ngoài scope "hợp nhất nguồn", đụng vào có thể ảnh hưởng hành vi WS/email hiện tại chưa được yêu cầu sửa).

### 0.3. `SeedCoreRoles` xác nhận role hợp lệ ([20260720000002-SeedCoreRoles.ts](../../../../src/database/migrations/20260720000002-SeedCoreRoles.ts))
Chỉ 4 role: `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` — xác nhận bug ở §0.2.

### 0.4. Port pattern tham chiếu ([stranger-alert-hook.ts](../../../../src/common/ports/stranger-alert-hook.ts))
`STRANGER_ALERT_HOOK` là `Symbol` injection token đặt ở `common` (leaf, không import module nào) — `iot` inject hook mà KHÔNG import `face-access` (tránh circular). `face-access` là `@Global()`, provide token bằng `useExisting: StrangerAlertService`. 3d **KHÔNG đổi port này** — chỉ sửa nội dung implementation `StrangerAlertService.onStranger()` (thêm gọi `recordAlert()`), đúng comment review Hải: "chuyển hướng chỉ cần đổi implementation phía sau port, không phải sửa `StrangerAlertService`" — CHÍNH XÁC 3d sửa BÊN TRONG `StrangerAlertService`, không đổi interface/port.

### 0.5. `VehicleResolveService` chưa ghi `zone_id` (nợ đã ghi ở roadmap mục phối hợp #6)
`iot_device_events` từ vehicle event hiện KHÔNG có `zone_id` → `VehicleControlAlertService` KHÔNG có sẵn `zoneId` để truyền vào `recordAlert()`. `StrangerAlertService` CÓ `roomId` (không phải `zoneId`) — 2 khái niệm khác nhau (`rooms` vs `zones`), KHÔNG map thẳng được (residual §7).

---

## 1. Câu hỏi nghiệp vụ đã chốt (AskUserQuestion, dùng chung cho cả 5 cụm Bước 3)
Xem `../uc122-alert-rules-crud/spec.md` §1. 3d không có câu hỏi riêng (dùng lại quyết định câu 1: phạm vi trọn cụm).

## 2. Quyết định thiết kế suy luận thêm (chưa hỏi riêng — ghi rõ lý do, KHÔNG tự ý đổi khi code)

1. **`zoneId` truyền cho cả 2 nguồn: `null`** (§0.5) — CHẤP NHẬN cho đợt này, KHÔNG tự chế giá trị giả. `VehicleControlAlertService`: `zoneId: null` (rule áp dụng nhánh "toàn khuôn viên" cho `vehicle_control_match` cho tới khi Hải cập nhật `zone_id`). `StrangerAlertService`: cũng `zoneId: null` — `roomId` KHÔNG map sang `zoneId` (2 bảng độc lập, `rooms` không phải `zones`; map sai sẽ tạo dữ liệu bịa).
2. **GIỮ NGUYÊN notification hiện có, THÊM `recordAlert()` song song** (KHÔNG thay thế) — đúng kiến trúc 2 tầng đã duyệt trong báo cáo ("sự cố sinh ra việc đi báo"). Thứ tự gọi: `findEffectiveRule()` → nếu `suppressed` → return sớm, KHÔNG gọi cả `recordAlert()` LẪN notification (đúng AF1: tắt rule = ngừng sinh cảnh báo, và notification vốn chỉ nên đi kèm khi có alert) → nếu KHÔNG suppressed → `recordAlert()` trước → SAU ĐÓ mới `notificationsService.createNotification()` như cũ (giữ nguyên throttle in-memory 300s hiện có làm điều kiện gate cho CẢ HAI, tránh 2 luồng lệch throttle nhau).
3. **`isNew` từ `recordAlert()` KHÔNG dùng để gate notification** — throttle in-memory 300s hiện tại (theo plate/device) đã đủ chống spam notification; `isNew=false` (alert bị dedup tăng `occurrenceCount`) KHÔNG có nghĩa "đừng gửi notification nữa", vì throttle 300s và cửa sổ dedup alert (tới khi `resolved`) là 2 khái niệm thời gian khác nhau — 1 alert có thể mở nhiều giờ trong khi throttle notification chỉ 300s (vẫn nên nhắc lại nếu bảo vệ chưa xử lý sau 5 phút).
4. **KHÔNG sửa bug `role_code='admin'` của `StrangerAlertService.resolveAdmins()`** (§0.2) — ngoài scope "hợp nhất nguồn" của 3d. Ghi residual rõ ràng, đề xuất Thiếu Chủ tách thành 1 fix riêng (1 dòng đổi `'admin'` → `'MANAGER'` hoặc theo đúng bộ role đã dùng ở `VehicleControlAlertService.resolveRecipients()`) vì SỬA Ở ĐÂY sẽ làm review 3d lẫn lộn 2 loại thay đổi (hợp nhất nguồn vs sửa bug tồn tại từ trước).
5. **Severity truyền tường minh** (đúng kiến trúc UC-123 §2.2): `VehicleControlAlertService` tính `severity = match.listType === 'blocklist' ? 'high' : 'medium'` (mirror logic `NotificationPriority` đang có: `isBlocklist ? HIGH : NORMAL`). `StrangerAlertService` KHÔNG truyền `severity` (dùng mặc định tĩnh `'medium'` của `recordAlert()` cho `alertType='stranger'`, đúng bảng UC-123 §2.2).
6. **`payloadJson` truyền cho `recordAlert()`**: TÁI SỬ DỤNG NGUYÊN payload đang gửi cho `notificationsService.createNotification()` (đã có sẵn đủ field: `plateNumber`/`listType`/`reason`/`channelId`/`direction`/`controlListEntryId` cho xe; `deviceId`/`roomId`/`strangerId`/`similarity`/`capturedAt` cho người lạ) — KHÔNG thiết kế payload mới, tránh trùng lặp logic.
7. **`sourceEventId`**: KHÔNG truyền (cả 2 service hiện tại KHÔNG có sẵn `iot_device_events.id` trong tham số đang nhận — `VehicleControlAlertService.evaluate()` chỉ có `channelId`/`direction`, `StrangerAlertHook` không có `eventId` trong interface) — để `null`, ghi residual (§7) nếu sau này cần bằng chứng liên kết event gốc.

---

## 3. Scope (3d)

### TRONG scope
1. Sửa `VehicleControlAlertService.evaluate()`: sau throttle pass, TRƯỚC khi gửi notification — gọi `alertRulesService.findEffectiveRule('vehicle_control_match', null)` → `suppressed` → return sớm; không suppressed → `alertsService.recordAlert({alertType: 'vehicle_control_match', zoneId: null, severity: <tính theo §2.5>, ruleId: rule?.id ?? null, payloadJson: <như §2.6>})` → tiếp tục luồng notification hiện có (KHÔNG đổi phần notification).
2. Sửa `StrangerAlertService.onStranger()`: TƯƠNG TỰ — `findEffectiveRule('stranger', null)` → suppressed → return sớm (bỏ qua CẢ WS lẫn notification, vì AF1 áp dụng cho toàn bộ luồng cảnh báo, KHÔNG riêng notification) → không suppressed → `recordAlert({alertType: 'stranger', zoneId: null, ruleId: rule?.id ?? null, payloadJson: <như §2.6>})` → tiếp tục WS + notification hiện có.
3. `AnprModule`/`FaceAccessModule` thêm `imports: [AlertsModule]` (để inject `AlertRulesService`+`AlertsService`) — đúng chiều phụ thuộc đã chốt (`anpr/face-access → alerts`, KHÔNG ngược).
4. Constructor 2 service thêm `AlertRulesService`, `AlertsService` (inject qua DI, KHÔNG `forwardRef`).

### NGOÀI scope (KHÔNG làm ở đây)
- Sửa bug `role_code='admin'` (§2.4 — residual riêng).
- Thêm `zoneId` thật (chờ Hải cập nhật `VehicleResolveService`/map `roomId`→`zoneId`).
- Cảnh báo camera offline (roadmap ghi "nếu còn thời gian" — KHÔNG bắt buộc, để residual).
- Đổi throttle in-memory hiện có sang cơ chế bền vững hơn (Redis) — ngoài scope 3d, giữ nguyên hành vi cũ.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** `VehicleControlAlertService.evaluate()` khớp control-list VÀ qua throttle VÀ `findEffectiveRule('vehicle_control_match', null).suppressed === false` **→** hệ thống gọi `recordAlert()` TRƯỚC, sau đó vẫn gửi notification như cũ.
- **R2 (crux)**: **WHEN** `findEffectiveRule('vehicle_control_match', null).suppressed === true` **→** hệ thống KHÔNG gọi `recordAlert()` VÀ KHÔNG gửi notification (AF1: tắt rule = ngừng sinh cảnh báo toàn luồng, không riêng 1 kênh).
- **R3**: **WHEN** `StrangerAlertService.onStranger()` qua throttle VÀ `findEffectiveRule('stranger', null).suppressed === false` **→** hệ thống gọi `recordAlert()` TRƯỚC, sau đó vẫn WS + notification như cũ.
- **R4**: **WHEN** `findEffectiveRule('stranger', null).suppressed === true` **→** hệ thống KHÔNG gọi `recordAlert()`, KHÔNG WS, KHÔNG notification.
- **R5**: **IF** `recordAlert()` throw lỗi KHÔNG PHẢI do suppressed (vd lỗi DB thật) **→** hệ thống bắt lỗi, log, **VẪN tiếp tục luồng notification cũ** (NotThrow toàn cục — mirror comment gốc `VehicleControlAlertService`: "lỗi cảnh báo KHÔNG được phá luồng ingest event chính"). `recordAlert()` lỗi KHÔNG được làm mất luôn cả notification (đã hoạt động từ trước, không nên regressed vì 3d).

## 5. Constitution

- **ARCH-01**: `AnprModule`/`FaceAccessModule` import `AlertsModule` (chiều một chiều đã chốt) — `AlertsModule` KHÔNG import ngược.
- **ARCH-02 (crux)**: KHÔNG `forwardRef` ở bất kỳ hướng nào.
- **DATA-01**: KHÔNG đổi chữ ký `evaluate()`/`onStranger()` (interface `StrangerAlertHook` giữ nguyên — nhiều nơi khác có thể đã phụ thuộc).
- **SAFETY-01 (crux)**: Lỗi từ `recordAlert()`/`findEffectiveRule()` PHẢI bị `try/catch` nuốt (NotThrow), KHÔNG được làm hỏng luồng notification/WS hiện có đang chạy tốt.

## 6. Test cases trọng yếu
- `VehicleControlAlertService.evaluate()`: suppressed=true → KHÔNG gọi `recordAlert` lẫn notification; suppressed=false → gọi `recordAlert` với đúng `severity` theo `listType` rồi mới gọi notification (assert thứ tự); `recordAlert` throw lỗi thường → notification VẪN được gọi (NotThrow).
- `StrangerAlertService.onStranger()`: tương tự 3 case trên, thay `alertType='stranger'`.
- DI: `AnprModule`/`FaceAccessModule` import `AlertsModule` thành công, KHÔNG circular (`AppModule` compile được).

## 7. Residuals / known-gaps
- **Bug `role_code='admin'`** trong `StrangerAlertService.resolveAdmins()` — cảnh báo người lạ hiện KHÔNG gửi được notification cho ai (từ trước 3d, không phải do 3d gây ra). Đề xuất fix riêng 1 dòng, KHÔNG gộp vào 3d.
- **`zoneId: null`** cho cả 2 nguồn — chờ Hải cập nhật `VehicleResolveService` ghi `zone_id`; `roomId`→`zoneId` (stranger) chưa có mapping chính thức.
- **`sourceEventId: null`** — 2 service hiện tại không có sẵn `iot_device_events.id` trong tham số nhận được.
- **Cảnh báo camera offline** — chưa làm (roadmap: "nếu còn thời gian").

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 5 cụm Bước 3 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
