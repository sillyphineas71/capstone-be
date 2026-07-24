# ARZ-001 — UC-124 (Alerts / SAVP): Xâm nhập khu vực hạn chế

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec ARZ-001 (UC-124): cron đối chiếu `gate_access_logs` + `zone_presence_events` (CẢ 2 nguồn — chốt qua AskUserQuestion) với `alert_rules` (`restricted_hours_json`/`allowed_person_ids_json`) → `recordAlert('intrusion', ...)`. RECON xác nhận `zones` KHÔNG có cột đánh dấu "hạn chế" — trạng thái hạn chế hoàn toàn suy ra từ SỰ TỒN TẠI của 1 `alert_rules` row `alert_type='intrusion'` gắn zone đó (đã thiết kế đúng ý ở UC-122). | Toàn bộ |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Phụ thuộc `../uc122-alert-rules-crud/` (đọc `alert_rules`) + `../uc123-alert-center/` (`recordAlert()`) — code 2 cụm đó XONG trước. Độc lập với 3d/UC-125 (không phụ thuộc nhau, có thể code song song SAU khi UC-122+123 xong).
>
> **STOP.** Chờ Thiếu Chủ duyệt toàn bộ 15 file Bước 3 trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZoneEntity` KHÔNG có cột "hạn chế" ([zone.entity.ts](../../../../src/modules/zones/entities/zone.entity.ts))
Chỉ có `zoneCode/zoneName/zoneType/building/floor/description/metadataJson/status`. Xác nhận đúng thiết kế đã duyệt: "khu vực hạn chế" KHÔNG phải thuộc tính của `zones`, mà là HỆ QUẢ của việc tồn tại 1 `alert_rules` row `(alert_type='intrusion', zone_id=<zone đó>)` — UC-124 KHÔNG cần/KHÔNG được thêm cột vào `zones` (ADD-ONLY đã dùng hết cho 3 bảng alert, không đụng `zones` nữa).

### 0.2. `GateAccessLogEntity` ([gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts), RECON đầy đủ ở `../../gate-access/uc116-pair-gate-sessions/spec.md` §0.1)
`zoneId` (FK zones, RESTRICT), `userId` (nullable — NULL khi xe lạ/chưa map người), `direction` (`'in'|'out'`), `accessTime`, KHÔNG soft-delete (append-only). UC-124 chỉ quan tâm `direction='in'` (vào khu vực).

### 0.3. `ZonePresenceEventEntity` ([zone-presence-event.entity.ts](../../../../src/modules/zones/entities/zone-presence-event.entity.ts))
`zoneId` (NOT NULL, khác `gate_access_logs`), `userId` (nullable — chỉ có khi nguồn là Face Server), `eventType` (varchar, "phân loại enter/exit/count... giữ varchar, không ràng enum ở DB" theo comment entity), `eventTime`, KHÔNG soft-delete. UC-124 chỉ quan tâm `eventType='enter'` (giả định giá trị này — KHÔNG có allowlist enum cứng ở DB, xem §2.2 quyết định suy luận).

### 0.4. Pattern cron watermark tham chiếu ([checkin-alert.service.ts](../../../../src/modules/attendance/services/checkin-alert.service.ts) §0.5 của `../../gate-access/uc116-pair-gate-sessions/spec.md`)
Đọc `system_configs` qua `dataSource.getRepository(SystemConfigEntity).find({where: {configGroup, isActive: true}})`, tìm theo `configKey`, fallback default nếu thiếu dòng. UC-124 dùng đúng pattern này để lưu "watermark" (mốc thời gian đã quét tới) — tránh quét lại toàn bộ 2 bảng log mỗi lần cron chạy (2 bảng append-only, sẽ phình to theo thời gian).

### 0.5. Pattern cron mới tham chiếu ([SchedulerService](../../../../src/modules/scheduler/scheduler.service.ts), đã dùng ở UC-116 Bước 2)
1 method mới trong `SchedulerService`, gate `SCHEDULER_ENABLED && <feature>_ENABLED` (default `false`), try/catch nuốt lỗi + log tóm tắt, business logic thật nằm ở service domain riêng.

### 0.6. Migration mới nhất sau 3d (0 migration) vẫn là `20260723000006` (UC-123). UC-124 KHÔNG cần migration DDL/permission (không có endpoint HTTP — cron-only, mirror UC-116) — nếu cần seed watermark mặc định thì dùng fallback code (KHÔNG seed dòng `system_configs`, giống cách `loadClosingHour` fallback `'22:00'` khi thiếu dòng ở UC-116).

---

## 1. Câu hỏi nghiệp vụ đã chốt (AskUserQuestion, dùng chung cho cả 5 cụm Bước 3)
Câu 4: **Nguồn sự kiện UC-124 = CẢ HAI** `gate_access_logs` VÀ `zone_presence_events`, thuộc phạm vi Bước 3 (Tài làm ngay).

## 2. Quyết định thiết kế suy luận thêm (chưa hỏi riêng — ghi rõ lý do, KHÔNG tự ý đổi khi code)

1. **Chỉ đánh giá rule GẮN ZONE CỤ THỂ** (`alert_rules.zoneId IS NOT NULL`, `alertType='intrusion'`, `enabled=true`) — KHÔNG đánh giá rule "mặc định toàn khuôn viên" (`zoneId IS NULL`) cho `intrusion`. Lý do: `restricted_hours_json`/`allowed_person_ids_json` là cấu hình GẮN VỚI 1 khu vực cụ thể (khung giờ + danh sách người được phép của khu vực ĐÓ) — 1 rule "intrusion toàn khuôn viên" áp cùng 1 danh sách người được phép cho MỌI zone là vô nghĩa về nghiệp vụ (khu vực nào cũng có nhóm người được phép khác nhau). UC-122 KHÔNG cấm tạo rule `intrusion` với `zoneId=NULL` (DB cho phép), nhưng UC-124 sẽ BỎ QUA rule đó khi quét (ghi residual §7, đề xuất UC-122 UI cảnh báo Admin nếu họ cố tạo rule `intrusion` không gắn zone).
2. **`eventType='enter'` là giá trị đại diện "xuất hiện trong zone"** cho `zone_presence_events` — DB KHÔNG ràng buộc enum cứng cột này (RECON §0.3: "giữ varchar, không ràng enum"), suy luận từ tên hợp lý nhất khớp business "người xuất hiện trong khu vực". **RỦI RO**: nếu Hải dùng giá trị khác (`'appear'` thay vì `'enter'`) khi ghi IVSS event thật, UC-124 sẽ KHÔNG bắt được — ghi rõ residual (§7), cần Hải xác nhận giá trị `event_type` thật đang/sẽ ghi trước khi bật flag cron (`SCHEDULER_RESTRICTED_ZONE_ENABLED` mặc định `false`, an toàn để chờ xác nhận).
3. **Logic vi phạm (2 điều kiện AND — trong giờ cho phép = KHÔNG vi phạm bất kể ai; ngoài giờ = chỉ người trong `allowed_person_ids_json` mới KHÔNG vi phạm)**:
   - `restrictedHoursJson` CÓ giá trị (`allowFrom`/`allowTo`): thời điểm entry (`accessTime`/`eventTime`, giờ local server) nằm TRONG khung `[allowFrom, allowTo]` (xử lý qua-đêm nếu `allowFrom > allowTo`, vd `22:00→06:00`) → KHÔNG vi phạm, bỏ qua, KHÔNG gọi `recordAlert`. NGOÀI khung → vi phạm TRỪ KHI `userId` khác NULL VÀ `userId` có trong `allowedPersonIdsJson`.
   - `restrictedHoursJson` là NULL (rule không cấu hình khung giờ) → coi như hạn chế 24/7: MỌI thời điểm áp dụng luật allowlist y hệt nhánh "ngoài khung giờ" ở trên.
   - `userId` là NULL (xe lạ/người chưa định danh) → LUÔN vi phạm khi ở nhánh "phải qua allowlist" (không thể xác minh danh tính → mặc định KHÔNG được phép).
4. **Watermark cursor qua `system_configs`** (2 key riêng, `config_group='restricted_zone_intrusion'`): `restricted_zone.gate_log_watermark` và `restricted_zone.presence_event_watermark` (ISO timestamp string) — đọc trước khi quét (`accessTime`/`eventTime > watermark`), CẬP NHẬT sau khi quét xong (giá trị = `MAX(accessTime/eventTime)` đã xử lý trong lượt quét, hoặc giữ nguyên nếu không có row nào mới). Fallback KHÔNG có dòng → dùng thời điểm cron LẦN ĐẦU chạy (`now()` tại lần chạy đầu tiên, KHÔNG quét lùi về quá khứ — tránh bão alert từ dữ liệu lịch sử/seed cũ khi mới bật tính năng).
5. **Dedup vẫn qua `recordAlert()`** (không thêm dedup riêng ở UC-124) — nhiều vi phạm liên tiếp cùng zone trong khi alert `intrusion` đó CHƯA `resolved` → tự động tăng `occurrenceCount` qua cơ chế `23505` có sẵn của UC-123, KHÔNG cần logic chống trùng riêng ở UC-124.
6. **Không dùng `findEffectiveRule`** (khác 3d/UC-125) — UC-124 tự nhiên chỉ quét rule `enabled=true` (query trực tiếp), rule bị tắt đơn giản KHÔNG nằm trong tập kết quả quét → tự động thỏa AF1 mà KHÔNG cần gọi thêm hàm suppress-check.

---

## 3. Scope (UC-124)

### TRONG scope
1. `RestrictedZoneIntrusionService.evaluateIntrusions()`:
   1. `const rules = await alertRulesService.list({alertType: 'intrusion', enabled: true, zoneIdNotNull: true})` (hoặc query trực tiếp repository nếu `AlertRulesService.list` không hỗ trợ filter `zoneId IS NOT NULL` — xem plan).
   2. Với mỗi rule: đọc watermark tương ứng (§2.4), query `gate_access_logs` (`direction='in', zoneId=rule.zoneId, accessTime > watermark`) VÀ `zone_presence_events` (`eventType='enter', zoneId=rule.zoneId, eventTime > watermark`).
   3. Với mỗi row: áp logic §2.3 → vi phạm → `recordAlert({alertType: 'intrusion', zoneId: rule.zoneId, ruleId: rule.id, payloadJson: {sourceTable, sourceRowId, userId, occurredAt}})`.
   4. Cập nhật 2 watermark sau khi quét xong toàn bộ rule (giá trị lớn nhất đã xử lý mỗi nguồn, gộp qua mọi zone).
   5. Trả `{zonesScanned, gateLogsChecked, presenceEventsChecked, violationsFound}` để `SchedulerService` log.
2. Wiring cron mới vào `SchedulerService` (`evaluateRestrictedZoneIntrusions`, gate `SCHEDULER_ENABLED && SCHEDULER_RESTRICTED_ZONE_ENABLED` mặc định `false`, mirror UC-116).
3. Module: thêm vào `alerts` module HAY module riêng `restricted-zone`? → Quyết định: **module riêng `restricted-zone`** (mirror `gate-access` Bước 2 — tách business logic khỏi `alerts` vì cần import `GateAccessLogEntity`+`ZonePresenceEventEntity` từ `zones`, KHÔNG nhét thêm entity ngoài phạm vi `alerts` vào `AlertsModule`). `RestrictedZoneModule` import `AlertsModule` (đọc `AlertRulesService`+gọi `AlertsService.recordAlert`) + `TypeOrmModule.forFeature([GateAccessLogEntity, ZonePresenceEventEntity])` (import entity từ `zones/entities`, KHÔNG khai lại).

### NGOÀI scope (KHÔNG làm ở đây)
- Thêm cột đánh dấu "hạn chế" vào `zones` — KHÔNG làm (§2.1 lý do).
- API cho Admin xem/sửa watermark thủ công — chưa có UC nào giao việc này.
- Xác nhận giá trị `event_type` thật với Hải — nằm ngoài phạm vi code BE, ghi residual, KHÔNG tự đoán thêm giá trị khác `'enter'`.
- Trigger event-driven (thay vì cron) khi có log/event mới — mirror UC-116 (roadmap "chưa chốt điểm gọi trực tiếp"), chỉ cron định kỳ ở đợt này.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** cron `evaluateRestrictedZoneIntrusions` chạy **→** hệ thống chỉ quét zone có rule `intrusion` ĐANG BẬT VÀ gắn zone cụ thể (`zoneId IS NOT NULL`).
- **R2 (crux)**: **WHEN** một entry (gate log `direction='in'` hoặc presence event `eventType='enter'`) xảy ra TRONG khung `restrictedHoursJson` của rule zone đó **→** hệ thống KHÔNG coi là vi phạm, bất kể `userId`.
- **R3 (crux)**: **WHEN** entry xảy ra NGOÀI khung giờ (hoặc rule KHÔNG có `restrictedHoursJson`) VÀ `userId` KHÔNG có trong `allowedPersonIdsJson` (hoặc `userId` là NULL) **→** hệ thống gọi `recordAlert('intrusion', zoneId, ruleId, payloadJson)`.
- **R4**: **WHEN** entry xảy ra NGOÀI khung giờ VÀ `userId` CÓ trong `allowedPersonIdsJson` **→** hệ thống KHÔNG coi là vi phạm.
- **R5**: **WHILE** watermark chưa từng khởi tạo (lần chạy cron ĐẦU TIÊN) **→** hệ thống KHÔNG quét dữ liệu lịch sử trước thời điểm cron bắt đầu chạy, chỉ khởi tạo watermark = thời điểm hiện tại.
- **R6**: **WHERE** `SCHEDULER_ENABLED` hoặc `SCHEDULER_RESTRICTED_ZONE_ENABLED` là `false` **→** cron KHÔNG chạy logic quét (early-return).
- **R7**: **IF** một bước quét gặp lỗi DB **→** hệ thống bắt lỗi, log, KHÔNG throw ra ngoài cron, KHÔNG crash các job khác.

## 5. Constitution

- **ARCH-01**: Business logic nằm trong `RestrictedZoneIntrusionService` (module `restricted-zone` mới), `SchedulerService` chỉ gọi + log.
- **ARCH-02**: `RestrictedZoneModule` import `AlertsModule` (chiều một chiều) — KHÔNG import `FaceAccessModule`/`AnprModule`.
- **DATA-01**: KHÔNG INSERT/UPDATE/DELETE vào `gate_access_logs`/`zone_presence_events` — chỉ ĐỌC (append-only, đúng vai trò "Tài chỉ đọc").
- **DATA-02**: KHÔNG thêm cột vào `zones` (§2.1).
- **PERF-01**: Watermark cursor BẮT BUỘC (KHÔNG full-scan 2 bảng log mỗi lần cron chạy) — khác UC-116 (Bước 2 chấp nhận full-scan vì dữ liệu seed nhỏ, UC-124 chạy liên tục dài hạn nên cần watermark ngay từ đầu.
- **NO-SCOPE-01**: KHÔNG thêm cột `zones`, KHÔNG code trigger event-driven, KHÔNG code UC-121 crowd (Bước 4).

## 6. Residuals / known-gaps
- **Giá trị `event_type='enter'`** — suy luận, CẦN Hải xác nhận trước khi bật `SCHEDULER_RESTRICTED_ZONE_ENABLED=true` trên môi trường thật.
- **Rule `intrusion` với `zoneId=NULL`** — DB không cấm tạo (UC-122), nhưng UC-124 BỎ QUA khi quét — cần UI/docs Admin cảnh báo (ngoài phạm vi BE).
- **Xử lý qua-đêm `restrictedHoursJson`** (`allowFrom > allowTo`) — đã tính trong logic §2.3, cần test kỹ case biên (23:59, 00:00).
- **API xem/sửa watermark thủ công** — chưa có UC giao việc này.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 5 cụm Bước 3 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
