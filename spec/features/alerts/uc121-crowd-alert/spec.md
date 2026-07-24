# ACR-001 — UC-121 (Alerts / SAVP): Cảnh báo tụ tập đông người

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec ACR-001 (UC-121): cron đối chiếu `zone_presence_events` (`event_type='count'`, index `IDX_zpe_count` có sẵn) với `alert_rules` (`alert_type='crowd'`, `threshold`) → `recordAlert('crowd', ...)`. Quyết định qua AskUserQuestion: (1) đưa cả UC-119/120/121/126 vào Bước 4, (2) dùng NGUYÊN `recordAlert()` có sẵn cho dedup — CHẤP NHẬN lệch nhẹ so với chữ SRS EX1 (xem §2.2 residual). | Toàn bộ |

> Phụ thuộc `../uc122-alert-rules-crud/` (đọc `alert_rules`, đã có sẵn `alertType='crowd'` trong `ALERT_TYPES` + `severity='high'` trong `DEFAULT_SEVERITY_BY_TYPE` — KHÔNG cần sửa DTO/entity) + `../uc123-alert-center/` (`recordAlert()`). Cả hai ĐÃ CODE XONG (Bước 3b/3c) — UC-121 chỉ cần code cron mới, 0 thay đổi 2 cụm đó.
>
> Độc lập với UC-119/UC-120/UC-126 (module khác, không phụ thuộc nhau — có thể code song song).
>
> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZonePresenceEventEntity` ([zone-presence-event.entity.ts](../../../../src/modules/zones/entities/zone-presence-event.entity.ts))
`zoneId` (NOT NULL), `occupancyCount` (nullable integer — chỉ có giá trị khi `eventType='count'`), `eventTime`, KHÔNG soft-delete. Migration [20260721000005](../../../../src/database/migrations/20260721000005-CreateZonePresenceEventsTable.ts) đã tạo sẵn **`IDX_zpe_count`** (`zone_id, event_time DESC WHERE event_type='count'`) — index này ĐÃ THIẾT KẾ SẴN đúng cho use case này từ trước, chưa từng được dùng tới cho tới UC-121.

### 0.2. `AlertRuleEntity` ([alert-rule.entity.ts](../../../../src/modules/alerts/entities/alert-rule.entity.ts)) + `CreateAlertRuleDto` ([create-alert-rule.dto.ts](../../../../src/modules/alerts/dto/create-alert-rule.dto.ts))
`threshold` (nullable integer) đã tồn tại sẵn trên entity, và `'crowd'` đã có trong hằng số `ALERT_TYPES` của DTO từ Bước 3b (UC-122) — nghĩa là Admin ĐÃ có thể tạo rule `alert_type='crowd', threshold=<n>` ngay từ bây giờ qua API `/api/v1/alert-rules` có sẵn, không cần sửa gì ở UC-122. **Lỗ hổng RECON phát hiện**: `threshold` là `@IsOptional()` **không phân biệt theo `alertType`** — Admin có thể tạo rule `crowd` mà KHÔNG nhập threshold (threshold=NULL). Ghi residual §7 (KHÔNG sửa DTO ở UC-121 — ngoài phạm vi, UC-122 đã review/duyệt xong).

### 0.3. `AlertsService.recordAlert()` ([alerts.service.ts](../../../../src/modules/alerts/services/alerts.service.ts) dòng 26-30)
`DEFAULT_SEVERITY_BY_TYPE['crowd'] = 'high'` đã có sẵn — xác nhận UC-121 đã được tính toán trước khi thiết kế engine Bước 3c, dùng thẳng KHÔNG cần override severity thủ công.

### 0.4. Pattern cron tái sử dụng ([restricted-zone-intrusion.service.ts](../../../../src/modules/restricted-zone/services/restricted-zone-intrusion.service.ts), UC-124 — đã code xong Bước 3f)
Cấu trúc: load rule zone-scoped enabled → đọc watermark qua `system_configs` → query log mới hơn watermark → áp điều kiện vi phạm → `recordAlert()` → cập nhật watermark. UC-121 mirror GẦN NHƯ NGUYÊN VẸN pattern này, chỉ khác nguồn dữ liệu (`zone_presence_events` thay vì cả 2 bảng) và điều kiện (so ngưỡng số thay vì khung giờ/allowlist).

### 0.5. `SchedulerService` ([scheduler.service.ts](../../../../src/modules/scheduler/scheduler.service.ts)) — pattern gate `SCHEDULER_ENABLED && <feature>_ENABLED` (default `false`), mirror UC-124 dòng 271.

---

## 1. Quyết định nghiệp vụ đã chốt (AskUserQuestion, phiên Bước 4)

1. **Dedup/reset**: dùng NGUYÊN `recordAlert()` có sẵn — KHÔNG thêm state-tracking riêng để bám sát nghĩa đen SRS EX1 ("chỉ tạo mới khi tụt dưới ngưỡng rồi vượt lại"). Xem §2.2 để hiểu rõ deviation.
2. UC-121 nằm trong phạm vi Bước 4 của Tài (cùng UC-119/120/126).

## 2. Quyết định thiết kế suy luận thêm (ghi rõ lý do, KHÔNG tự ý đổi khi code)

1. **Chỉ đánh giá rule GẮN ZONE CỤ THỂ** (`alert_rules.zoneId IS NOT NULL`, `alertType='crowd'`, `enabled=true`) — mirror UC-124 §2.1. Lý do: BR1 (SRS) nói rõ "ngưỡng cấu hình theo TỪNG khu vực (không dùng chung ngưỡng cho toàn khuôn viên) do mỗi khu vực có sức chứa khác nhau" — một rule `crowd` `zoneId=NULL` (ngưỡng chung toàn khuôn viên) vô nghĩa về nghiệp vụ giống hệt lý do đã dùng cho UC-124. DB không cấm tạo rule `crowd` global (giống UC-124), nhưng cron BỎ QUA — residual §7.
2. **Deviation dedup so với SRS EX1 (đã chốt dùng recordAlert nguyên vẹn)**: `recordAlert()` chỉ mở alert MỚI khi KHÔNG có alert đang mở cùng `(alertType, zoneId)` — "đang mở" = `status != 'resolved'`. Nghĩa là: nếu Admin CHƯA resolve alert tụ tập cũ, dù số người có tụt xuống dưới ngưỡng rồi vượt lại N lần, hệ thống CHỈ bump `occurrenceCount`/`lastSeenAt` trên alert cũ — KHÔNG tạo alert mới, ĐÚNG YÊU CẦU "không spam" nhưng KHÁC điều kiện reset SRS đòi hỏi (SRS: reset theo SỐ LIỆU tụt-rồi-vượt; engine hiện tại: reset theo HÀNH ĐỘNG ADMIN resolve). Hệ quả: nếu 1 zone tụ tập đông rồi vắng rồi đông lại NHIỀU LẦN trong khi Admin chưa xử lý alert cũ, hệ thống vẫn coi là "1 sự cố đang tiếp diễn" (đúng tinh thần chống-spam, chỉ khác cơ chế trigger reset). Chấp nhận theo quyết định Thiếu Chủ, ghi rõ residual.
3. **Ngưỡng so sánh**: `occupancyCount > rule.threshold` (KHÔNG dùng `>=`) — "vượt ngưỡng" hiểu là vượt QUÁ, đúng nghĩa đen SRS ("vượt quá ngưỡng cho phép"), bằng ngưỡng chưa coi là tụ tập.
4. **Rule có `threshold=NULL`** (residual RECON §0.2): BỎ QUA rule đó khi quét (không đánh giá được "vượt ngưỡng" nếu ngưỡng chưa cấu hình) — KHÔNG coi là lỗi, KHÔNG crash cron, chỉ skip + log debug.
5. **Watermark cursor qua `system_configs`** (1 key duy nhất, khác UC-124 cần 2 key — UC-121 chỉ có 1 nguồn dữ liệu): `config_group='crowd_alert'`, `config_key='crowd_alert.count_event_watermark'`. Khởi tạo lần đầu = thời điểm hiện tại (KHÔNG quét lùi lịch sử), mirror UC-124 R5.
6. **Tần suất cron nhanh hơn UC-124**: `EVERY_MINUTE` (không phải `EVERY_5_MINUTES`) — SRS UC-121 Postcondition đòi hỏi cập nhật gần-thời-gian-thực hơn ("Sự kiện hiện diện đã được ghi nhận và cập nhật số liệu realtime"), khác UC-124 (xâm nhập, tần suất 5 phút chấp nhận được). Quyết định suy luận riêng của Tài — dễ chỉnh lại nếu team muốn khác, không phải quyết định cứng.

---

## 3. Scope (UC-121)

### TRONG scope
1. `CrowdAlertService.evaluateCrowdAlerts()`:
   1. Load rule `alertType='crowd', enabled=true, zoneId IS NOT NULL, threshold IS NOT NULL` (lọc `threshold` null ở tầng code — filter theo §2.4).
   2. Đọc watermark `crowd_alert.count_event_watermark`.
   3. Với mỗi rule: query `zone_presence_events` (`zoneId=rule.zoneId, eventType='count', eventTime > watermark`) — TẬN DỤNG `IDX_zpe_count`.
   4. Với mỗi event: `occupancyCount > rule.threshold` → `recordAlert({alertType: 'crowd', zoneId: rule.zoneId, ruleId: rule.id, payloadJson: {occupancyCount, threshold: rule.threshold, sourceEventId: event.id, occurredAt: event.eventTime}})`.
   5. Cập nhật watermark = MAX(`eventTime`) đã xử lý.
   6. Trả `{zonesScanned, eventsChecked, violationsFound}`.
2. Module mới `crowd-alert` (mirror `restricted-zone`) — import `AlertsModule` + `TypeOrmModule.forFeature([ZonePresenceEventEntity])`.
3. Wiring `SchedulerService.evaluateCrowdAlerts()`, gate `SCHEDULER_ENABLED && SCHEDULER_CROWD_ALERT_ENABLED` (default `false`), `@Cron(CronExpression.EVERY_MINUTE)`.

### NGOÀI scope (KHÔNG làm ở đây)
- Sửa `CreateAlertRuleDto` để bắt buộc `threshold` khi `alertType='crowd'` — residual, ngoài phạm vi (đã duyệt xong ở UC-122).
- Đánh giá rule `crowd` `zoneId=NULL` (toàn khuôn viên) — bỏ qua có chủ đích (§2.1).
- State-tracking riêng cho reset "tụt-rồi-vượt lại" — đã chốt KHÔNG làm (§2.2).
- Dashboard/timeline/heatmap (UC-119/120/126) — cụm khác.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** cron `evaluateCrowdAlerts` chạy **→** hệ thống chỉ quét zone có rule `crowd` ĐANG BẬT, gắn zone cụ thể, VÀ đã cấu hình `threshold`.
- **R2 (crux)**: **WHEN** một event `zone_presence_events` (`eventType='count'`) mới hơn watermark có `occupancyCount > rule.threshold` **→** hệ thống gọi `recordAlert('crowd', zoneId, ruleId, payloadJson)`.
- **R3**: **WHEN** `occupancyCount <= rule.threshold` **→** hệ thống KHÔNG coi là vi phạm, KHÔNG gọi `recordAlert`.
- **R4**: **WHILE** watermark chưa từng khởi tạo (lần chạy đầu) **→** hệ thống KHÔNG quét dữ liệu lịch sử, chỉ khởi tạo watermark = thời điểm hiện tại.
- **R5**: **WHERE** `SCHEDULER_ENABLED` hoặc `SCHEDULER_CROWD_ALERT_ENABLED` là `false` **→** cron KHÔNG chạy logic quét.
- **R6**: **IF** một bước quét gặp lỗi DB **→** hệ thống bắt lỗi, log, KHÔNG throw ra ngoài cron.
- **R7 (dedup, đã biết deviation §2.2)**: **WHEN** đã có alert `crowd` đang mở (`status != 'resolved'`) cùng zone **→** `recordAlert()` chỉ bump `occurrenceCount`/`lastSeenAt`, KHÔNG tạo alert mới — bất kể số liệu có tụt xuống dưới ngưỡng ở lần quét trước đó hay không.

## 5. Constitution

- **ARCH-01**: Business logic nằm trong `CrowdAlertService` (module `crowd-alert` mới), `SchedulerService` chỉ gọi + log.
- **ARCH-02**: `CrowdAlertModule` import `AlertsModule` (một chiều) — KHÔNG import `FaceAccessModule`/`AnprModule`.
- **DATA-01**: KHÔNG INSERT/UPDATE/DELETE vào `zone_presence_events` — chỉ ĐỌC.
- **PERF-01**: Watermark cursor BẮT BUỘC, tận dụng `IDX_zpe_count` có sẵn — KHÔNG full-scan bảng log.
- **NO-SCOPE-01**: KHÔNG sửa `CreateAlertRuleDto`/UC-122, KHÔNG code UC-119/120/126 ở đây.

## 6. Residuals / known-gaps

- **`CreateAlertRuleDto.threshold` không bắt buộc theo `alertType`** (RECON §0.2) — Admin có thể vô tình tạo rule `crowd` không có ngưỡng, cron sẽ âm thầm bỏ qua rule đó (không alert, không lỗi). Đề xuất fix riêng ở UC-122 sau (thêm `@ValidateIf`), KHÔNG sửa ở UC-121.
- **Deviation dedup §2.2** — đã chốt chấp nhận với Thiếu Chủ, ghi rõ trong spec để tránh hiểu nhầm là bug khi code review sau này.
- **Rule `crowd` `zoneId=NULL`** — DB không cấm tạo, cron bỏ qua, cần UI/docs Admin cảnh báo (ngoài phạm vi BE).
- **Tần suất `EVERY_MINUTE`** — quyết định suy luận riêng (§2.6), có thể chỉnh nếu team muốn khác.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.
