# VCC-001 — UC9 (ANPR/SAVP): Đối chiếu control-list khi xe qua cổng + cảnh báo

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo spec VCC-001 (UC9): `checkControlList(plate)` (VehicleControlListService) + `VehicleControlAlertService` (đối chiếu + cảnh báo qua notification queue). RECON phát hiện 2 lệch quan trọng so với mô tả gốc (điểm nối thật, Swagger chưa setup). 4 câu hỏi nghiệp vụ đã chốt trực tiếp trước khi viết spec. | Toàn bộ |

> **SPEC + PLAN + TASKS viết cùng lượt** (OQ đã chốt trước khi đặt bút, mirror UC8). Vẫn giữ STOP cuối file.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Điểm nối THẬT khác tên file yêu cầu gốc nêu (phát hiện quan trọng)
Yêu cầu gốc nói điểm nối là `default-vehicle-event.handler.ts`. Đọc code thật: [anpr.module.ts:44-47](../../../../src/modules/anpr/anpr.module.ts) — token `VEHICLE_EVENT_HANDLER` bind (`useExisting`) vào **`VehicleResolveService`** (UC5), KHÔNG phải `DefaultVehicleEventHandler` (UC4 — chỉ là fallback log-only, KHÔNG được gọi trong luồng thật). `VehicleWebhookController.receiveEvent` ([vehicle-webhook.controller.ts:56-57](../../../../src/modules/anpr/controllers/vehicle-webhook.controller.ts)) gọi `this.handler.onVehicleEvent(event)` qua token đó → **`VehicleResolveService.onVehicleEvent` mới là nơi "mọi event biển số đổ về" thật sự**. Đã xác nhận lại với Thiếu Chủ — chốt đặt code ở đây (mục 1).

### 0.2. `VehicleResolveService.onVehicleEvent` ([vehicle-resolve.service.ts](../../../../src/modules/anpr/services/vehicle-resolve.service.ts))
Resolve `plateNumber` (đã normalize từ UC4, KHÔNG normalize lại — DATA-03) → user qua `vehicle_registrations` → persist `iot_device_events` (luôn persist kể cả unmatched) → NotThrow (try/catch bao ngoài, lỗi chỉ log, KHÔNG throw — webhook UC4 always-ack). Toàn bộ constructor hiện chỉ có `DataSource`.

### 0.3. `VehicleControlListEntity`/`VehicleControlListService` (UC8, vừa xong)
`checkControlList` sẽ thêm vào `VehicleControlListService` (đã có repo `VehicleControlListEntity`). Index thật `IDX_vehicle_control_lookup = (plate_number) WHERE deleted_at IS NULL AND active = true` — đúng hot-path cho hàm này. Một plate CÓ THỂ có 2 dòng active đồng thời (1 blocklist + 1 watchlist, khác `list_type`) — cần quyết định ưu tiên khi cả 2 cùng match (mục 1).

### 0.4. Tiền lệ port-hook + alert gần nhất — `StrangerAlertService` ([stranger-alert.service.ts](../../../../src/modules/face-access/services/stranger-alert.service.ts))
Pattern: throttle in-memory `Map<key, timestampMs>` (default 300s, config qua `ConfigService`) → resolve recipient (raw query `users`/`user_roles`/`roles`) → `notificationsService.createNotification({..., channel: IN_APP, recipientUserIds})`. **Phát hiện bug có sẵn (KHÔNG thuộc scope UC9, không sửa)**: `resolveAdmins()` query `role_code = 'admin'` — nhưng role thật đã seed toàn CHỮ HOA (`SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER/EMPLOYEE`, migration `20260720000002`), nên hàm này luôn trả rỗng → cảnh báo unknown-face hiện tại **không bao giờ gửi được**. UC9 **KHÔNG copy lỗi này** — dùng đúng role_code đã seed.

### 0.5. `NotificationsService`/`NotificationsModule` ([notifications.module.ts](../../../../src/modules/notifications/notifications.module.ts))
Export `NotificationsService`. **KHÔNG** import ngược `AnprModule` → import `NotificationsModule` vào `AnprModule` an toàn, không circular. `createNotification()` nhận `notificationType` (enum `NotificationType`, varchar không CHECK constraint — mở rộng enum là convention đã có, xem `database_v4_current_41_tables.md §1.6`), `channel`, `priority`, `recipientUserIds`, `payloadJson`.

### 0.6. Swagger chưa từng setup trong dự án
`@nestjs/swagger` có trong `package.json` nhưng `main.ts` không gọi `SwaggerModule.setup()`, không controller nào dùng `@ApiTags`. Acceptance "CRUD chạy qua Swagger" (từ UC8) sẽ verify bằng REST client thường, KHÔNG bật Swagger UI ở bước này (mục 1).

### 0.7. `ConfigModule` global
[app.module.ts:70-71](../../../../src/app.module.ts) — `ConfigModule.forRoot({isGlobal:true})` → `ConfigService` inject được ở mọi module, KHÔNG cần import riêng trong `AnprModule`.

---

## 1. Câu hỏi nghiệp vụ đã chốt (trước khi viết spec này)

1. **Swagger**: KHÔNG setup Swagger UI ở bước này (không đụng `main.ts` — bootstrap toàn cục ngoài scope). Verify CRUD UC8 + luồng UC9 bằng gọi REST/service trực tiếp.
2. **Điểm nối**: đặt logic đối chiếu vào **`VehicleResolveService.onVehicleEvent`** (handler THẬT đang bind `VEHICLE_EVENT_HANDLER`), KHÔNG phải `DefaultVehicleEventHandler` (fallback chưa bind, sửa vào đó sẽ không bao giờ chạy).
3. **Watchlist match**: CŨNG sinh notification, nhưng khác blocklist — blocklist → `priority HIGH` + message "xe bị chặn"; watchlist → `priority NORMAL` + message "xe cần theo dõi". Cả 2 đều có tác dụng thật từ UC9, không chờ bước sau.
4. **Throttle**: CÓ, throttle theo `plate_number` (mirror `StrangerAlertService`: in-memory `Map`, mặc định 300s/plate, config qua `ConfigService` key `VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS`) — tránh spam nhiều notification cho cùng 1 lượt xe (nhiều frame camera liên tiếp).

---

## 2. Scope (UC9)

### TRONG scope
1. **`VehicleControlListService.checkControlList(plateNumber)`** — hàm "đối chiếu" thuần (pure lookup, KHÔNG side-effect): tra 1 bản ghi active còn sống theo `plateNumber`; nếu cả blocklist + watchlist cùng active → ưu tiên trả **blocklist** (severity cao hơn).
2. **`VehicleControlAlertService`** (mới) — "chỗ gọi ổn định" (stable call site) nhận `plateNumber` + context (`channelId`, `direction`) → gọi `checkControlList` → nếu match: throttle theo plate → resolve recipient (role `MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN` — đúng bộ role đã gán quyền `vehicle_control.read` ở UC8) → gửi notification qua `NotificationsService.createNotification()` (channel `IN_APP`, `notificationType` mới `VEHICLE_CONTROL_LIST_MATCH`, `priority` theo `list_type`). NotThrow toàn bộ (lỗi chỉ log, không throw) — đây chính là **đích cảnh báo sẽ đổi ở Bước 3** (trỏ sang `security_alerts`), trong khi `checkControlList` và call-site ở `VehicleResolveService` giữ nguyên.
3. Wiring: `VehicleResolveService.onVehicleEvent` gọi `vehicleControlAlertService.evaluate(plateNumber, {channelId, direction})` — độc lập với `matchState` (chạy cho cả biển matched lẫn unmatched, vì biển trong blocklist thường KHÔNG phải xe đã đăng ký hợp lệ).
4. Thêm `NotificationType.VEHICLE_CONTROL_LIST_MATCH = 'vehicle_control_list_match'` vào enum (mở rộng thuần, đúng convention enum-mở-rộng đã ghi nhận trong `database_v4_current_41_tables.md`).
5. `AnprModule` import `NotificationsModule` (lấy `NotificationsService`) — KHÔNG circular (đã xác nhận mục 0.5).
6. Unit test: `checkControlList` (normalize giả định đã làm ở caller — DATA-03) + `VehicleControlAlertService.evaluate` (match/no-match/throttle/blocklist vs watchlist/NotThrow/no-recipient) + cập nhật `VehicleResolveService.spec.ts` (thêm mock dependency mới, verify `evaluate` được gọi đúng tham số, KHÔNG phá 12 test cũ).
7. "Acceptance — event biển số giả lập khớp blocklist sinh được cảnh báo": test tại tầng `VehicleControlAlertService` (mock `checkControlList` trả blocklist active) + test tại tầng `VehicleResolveService` (mock `evaluate`, verify được gọi) — đủ để chứng minh dây chuyền nối đúng mà KHÔNG cần dựng DB thật.

### NGOÀI scope (UC sau — KHÔNG làm ở đây)
- Bảng `security_alerts`/alert rules/person watchlist — CHƯA có schema (CLAUDE.md §5.5 quy tắc 7), KHÔNG tự thiết kế ở UC9. `VehicleControlAlertService` chỉ là chỗ SẼ trỏ sang đó ở Bước 3.
- Setup Swagger UI thật (`main.ts`) — mục 1 đã chốt, để dành task riêng.
- Ghép cặp in/out (`paired_log_id`), dashboard khuôn viên, báo cáo — các bước sau trong roadmap của Tài.
- Sửa bug `role_code = 'admin'` trong `StrangerAlertService` — phát hiện ngoài lề, KHÔNG thuộc UC9 (có thể spawn task riêng nếu Thiếu Chủ muốn).
- Email channel cho cảnh báo control-list (mirror `STRANGER_ALERT_EMAIL_ENABLED`) — KHÔNG làm, chỉ `IN_APP` ở bước này (không được yêu cầu, giữ scope tối thiểu).
- WebSocket emit cho cảnh báo — task chỉ yêu cầu "bắn qua notification queue hiện có", KHÔNG yêu cầu realtime WS.

## 3. `checkControlList` (đề xuất — thêm vào `VehicleControlListService`)
```
async checkControlList(plateNumber: string): Promise<VehicleControlListEntity | null>
```
- `repo.findOne({ where: { plateNumber, deletedAt: IsNull(), active: true }, order: { listType: 'ASC' } })`.
- `order: {listType:'ASC'}`: `'blocklist' < 'watchlist'` theo thứ tự chữ cái → khi cả 2 cùng active, `findOne` trả về dòng `blocklist` trước (severity cao hơn ưu tiên) — **ghi rõ comment giải thích**, KHÔNG dựa vào may rủi alphabet ngầm định mà không note.
- **KHÔNG normalize lại** `plateNumber` trong hàm này — caller (UC5, đã normalize từ UC4) chịu trách nhiệm truyền plate đã chuẩn hóa (mirror DATA-03 của `VehicleResolveService`, ghi rõ trong docstring để tránh hiểu lầm khi có caller mới sau này).

## 4. `VehicleControlAlertService` (mới — file riêng, KHÔNG nhét vào `VehicleControlListService`/`VehicleResolveService`)
```
src/modules/anpr/services/vehicle-control-alert.service.ts
```
- Constructor: `VehicleControlListService`, `NotificationsService`, `ConfigService`, `DataSource`.
- `evaluate(plateNumber: string, context: {channelId: number; direction: string}): Promise<void>` — public, NotThrow (try/catch bao toàn bộ thân hàm, lỗi chỉ `logger.error`, KHÔNG throw).
  1. `match = await controlListService.checkControlList(plateNumber)` → không match → return (no-op).
  2. Throttle: `Map<plateNumber, lastAlertAtMs>`, window `configService.get('VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS', 300) * 1000`; trong window → return (bỏ qua, KHÔNG update lastAlertAt lần này — giữ nguyên mốc throttle gốc, mirror `StrangerAlertService`).
  3. `recipients = await resolveRecipients()` (private, raw query `users`/`user_roles`/`roles` role_code IN `('MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN')`, `deleted_at IS NULL`) → rỗng → log warn + return (KHÔNG throw).
  4. `isBlocklist = match.listType === 'blocklist'` → chọn `subject`/`content`/`priority` (HIGH vs NORMAL) theo mục 1.3.
  5. `notificationsService.createNotification({notificationType: VEHICLE_CONTROL_LIST_MATCH, channel: IN_APP, subject, content, priority, recipientScope:'user_list', recipientUserIds: recipients, payloadJson:{plateNumber, listType, reason, channelId, direction, controlListEntryId: match.id}})`.

## 5. Wiring vào `VehicleResolveService.onVehicleEvent`
- Thêm tham số constructor `vehicleControlAlertService: VehicleControlAlertService`.
- Trong `onVehicleEvent`, ngay sau khi tính `direction` (TRƯỚC bước INSERT `iot_device_events`, để cảnh báo không phụ thuộc DB ingest có thành công hay không): gọi `await this.vehicleControlAlertService.evaluate(evt.plateNumber, {channelId: evt.channelId, direction})`. Gọi **độc lập với `matchState`** (chạy cho cả matched/unmatched).
- `evaluate` tự NotThrow nên KHÔNG cần try/catch riêng tại điểm gọi (đã nằm trong try/catch ngoài của `onVehicleEvent` như 1 lớp phòng thủ kép, không bắt buộc).

## 6. Notification type mới
`src/modules/notifications/entities/notification.entity.ts` — thêm 1 dòng enum: `VEHICLE_CONTROL_LIST_MATCH = 'vehicle_control_list_match'`. Enum mở rộng thuần (varchar, không CHECK constraint) — đúng convention đã ghi nhận, KHÔNG cần migration.

## 7. Requirements (EARS)
- **R1**: **WHEN** `VehicleResolveService.onVehicleEvent` xử lý 1 event biển số bất kỳ (matched hoặc unmatched) **→** LUÔN gọi `vehicleControlAlertService.evaluate(plateNumber, context)`.
- **R2 (crux)**: **IF** `plateNumber` khớp 1 bản ghi `vehicle_control_list` còn sống + `active=true` **→** sinh notification đúng theo `list_type` (blocklist=HIGH, watchlist=NORMAL), gửi tới đúng nhóm role (`MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN`).
- **R3**: **IF** không khớp bản ghi nào **→** KHÔNG gọi `createNotification`, KHÔNG side-effect nào khác.
- **R4**: **IF** cùng `plateNumber` khớp trong vòng throttle window (mặc định 300s) kể từ lần cảnh báo gần nhất **→** bỏ qua, KHÔNG gửi notification lần 2.
- **R5**: **IF** `checkControlList`/`resolveRecipients`/`createNotification` ném lỗi bất kỳ **→** `evaluate` bắt lỗi, chỉ log, KHÔNG throw ra ngoài (NotThrow, không phá luồng ingest event chính).
- **R6**: **IF** không resolve được recipient nào (role rỗng) **→** log warn + KHÔNG gọi `createNotification` (KHÔNG throw).
- **R7**: **WHILE** `checkControlList` chạy, LUÔN lọc `deleted_at IS NULL AND active = true` — KHÔNG trả về bản ghi đã xóa mềm hoặc đã tắt (`active=false`).

## 8. Constitution
- **ARCH-01**: `checkControlList` (pure lookup) và `VehicleControlAlertService` (alert sink) **tách biệt 2 tầng** — đúng ý "để chỗ gọi không phải sửa khi đổi đích": Bước 3 chỉ cần sửa nội bộ `VehicleControlAlertService` (hoặc thay `useExisting` alert sink khác), `VehicleResolveService` và `checkControlList` KHÔNG cần đổi.
- **SEC-01**: Toàn bộ pipeline NotThrow — lỗi cảnh báo/notification KHÔNG được phép làm vỡ ack webhook (mirror UC4/UC5).
- **SEC-02**: KHÔNG log `imageBase64`/dữ liệu nhạy cảm trong log lỗi (mirror UC5 convention).
- **DATA-01**: `checkControlList` KHÔNG normalize lại plate — caller chịu trách nhiệm (mirror DATA-03 UC5).
- **DATA-02**: `list_type` ưu tiên blocklist khi cả 2 active cùng match — có comment giải thích rõ (KHÔNG dựa alphabet ngầm không ghi chú).
- **NO-SCOPE-01**: KHÔNG tự thiết kế `security_alerts`/alert rules — CLAUDE.md §5.5 quy tắc 7.
- **VAL-01**: KHÔNG thêm migration/DTO/endpoint mới — đây là internal service wiring, KHÔNG có route HTTP mới.

## 9. Residuals / known-gaps
- **Bước 3 (owed, ngoài scope)**: trỏ `VehicleControlAlertService` sang bảng `security_alerts` khi bảng đó được thiết kế + review.
- **Bug `role_code='admin'` trong `StrangerAlertService`**: phát hiện ngoài lề, KHÔNG sửa ở UC9 (khác scope, khác service) — có thể báo riêng cho team.
- **Throttle in-memory**: single-instance, reset khi restart process (mirror caveat `StrangerAlertService` — nếu scale nhiều instance sau này cần Redis-based throttle, chưa cần ở giai đoạn capstone).
- **Email channel cho cảnh báo control-list**: chưa làm, có thể thêm sau nếu team yêu cầu (mirror pattern `STRANGER_ALERT_EMAIL_ENABLED`).
- **Swagger UI thật**: chưa setup toàn app — task riêng nếu team muốn.

---

> **STOP.** Spec+Plan+Tasks (3 file) viết cùng lượt vì OQ đã chốt trước. Chờ Thiếu Chủ duyệt cả 3 file trước khi code. KHÔNG tự code khi chưa có xác nhận.
