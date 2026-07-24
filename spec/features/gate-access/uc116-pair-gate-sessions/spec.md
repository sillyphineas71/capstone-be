# GAP-001 — UC-116 (Gate Access / SAVP): Ghép cặp bản ghi ra-vào cổng

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec GAP-001 (UC-116): ghép cặp `gate_access_logs` (in↔out) để tính thời gian trong khuôn viên. RECON code thật (entity `GateAccessLogEntity` schema-only, index `IDX_gate_logs_unpaired`, pattern cron `SchedulerService`). 4 câu hỏi nghiệp vụ đã hỏi Thiếu Chủ qua AskUserQuestion trước khi viết spec (tiêu chí ghép cặp, giờ đóng cửa, phạm vi UC-114, nguồn ảnh UC-117) — chốt: ghép theo `user_id` chính/`plate_number` fallback, giờ đóng cửa qua `system_configs`. | Toàn bộ |

> Bước 2 lộ trình SAVP của Tài (`LO_TRINH_SAVP_TAI.md`) gồm 3 UC: **UC-116 (file này)**, UC-117 (tra cứu lịch sử — xem `../uc117-gate-access-history/spec.md`), UC-114 (thống kê lưu lượng — xem `../uc114-vehicle-traffic-stats/spec.md`). UC-116 làm trước vì UC-117/UC-114 đọc dữ liệu do UC-116 ghi ra (`paired_log_id`, `duration_seconds`).
>
> **STOP.** Spec+Plan+Tasks viết cùng lượt (OQ nghiệp vụ đã chốt trực tiếp với Thiếu Chủ trước khi viết). Chờ Thiếu Chủ duyệt cả 3 file trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Entity đã tồn tại, schema-only ([gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts))
`GateAccessLogEntity` (bảng `gate_access_logs`): `zoneId` (FK zones, RESTRICT), `deviceId`/`eventId` (nullable), `userId` (nullable — NULL khi xe lạ không rõ người), `vehicleRegistrationId`/`plateNumber` (nullable), `direction` (`'in'|'out'`), `accessTime`, `pairedLogId` (self-FK, nullable), `durationSeconds` (nullable, chỉ có giá trị khi đã ghép), `metadataJson`, `createdAt`. **KHÔNG có `deletedAt`** — append-only log, không soft-delete. Comment entity xác nhận: "Schema-only: KHÔNG logic nghiệp vụ (ingestion, ghép cặp in/out, tính duration = UC sau)" → UC-116 chính là UC đó.

### 0.2. Index thật đã tạo (migration `20260721000004-CreateGateAccessLogsTable.ts`)
- `IDX_gate_logs_user_time (user_id, access_time DESC)`, `IDX_gate_logs_zone_time (zone_id, access_time DESC)`, `IDX_gate_logs_plate (plate_number)`.
- `IDX_gate_logs_unpaired (user_id, direction) WHERE paired_log_id IS NULL` — **hot-path tìm log chưa ghép, đánh trên `user_id`** → xác nhận thiết kế DB nghiêng về ghép theo `user_id` là chính (khớp quyết định đã chốt với Thiếu Chủ).
- **KHÔNG có index nào trên `plate_number WHERE paired_log_id IS NULL`** → nhánh fallback (user_id NULL, ghép theo `plate_number`) sẽ quét chậm hơn nếu dữ liệu lớn, nhưng KHÔNG thêm index mới ở UC-116 (out of scope — xem §Residuals; Bước 2 tự seed dữ liệu nhỏ để dev, chưa cần tối ưu).

### 0.3. `zones.deleted_at` trap (CLAUDE.md §5.5 quy tắc 1)
Mọi JOIN `zones` (nếu cần lấy `zone_type='gate'` để lọc phạm vi) PHẢI kèm `zones.deleted_at IS NULL` — FK không tự NULL khi zone bị xóa mềm.

### 0.4. Pattern cron thật — `SchedulerService` ([scheduler.service.ts](../../../../src/modules/scheduler/scheduler.service.ts))
Toàn bộ cron job của hệ thống gom vào **1 file `SchedulerService`** (KHÔNG mỗi module tự khai `@Cron` riêng). Mỗi job: gate `SCHEDULER_ENABLED && <feature>_ENABLED` (ConfigService, default thường `false` cho job mới), `try/catch` nuốt lỗi + `Logger.error` (KHÔNG throw ra ngoài cron), log tóm tắt kết quả (`scanned`/`created`/...). Job business logic luôn nằm trong service domain riêng (`NoShowDetectionService`, `EarlyVacancyService`...), `SchedulerService` chỉ gọi + log. UC-116 mirror đúng pattern này: thêm 1 method `pairGateAccessLogs` cron mới vào `SchedulerService`, business logic thật nằm trong `GateAccessPairingService` (module `gate-access`).

### 0.5. Pattern đọc `system_configs` thật ([checkin-alert.service.ts:93-114](../../../../src/modules/attendance/services/checkin-alert.service.ts))
`dataSource.getRepository(SystemConfigEntity).find({where: {configGroup: 'xxx', isActive: true}})` → tìm theo `configKey` trong mảng kết quả, có `defaultValue` fallback nếu thiếu dòng. UC-116 dùng đúng pattern này để đọc giờ đóng cửa, KHÔNG hard-code.

### 0.6. `SystemConfigEntity` ([system-config.entity.ts](../../../../src/modules/administration/entities/system-config.entity.ts))
Cột: `configKey`, `configValue` (text), `valueType` (enum `string/number/boolean/json/secret_ref`), `configGroup`, `isActive`. Không tìm thấy migration nào seed "default config row" idempotent kiểu permission — UC-116 sẽ là migration đầu tiên seed 1 dòng `system_configs` thật (mirror cấu trúc INSERT ... ON CONFLICT của permission seed, nhưng bảng khác).

---

## 1. Câu hỏi nghiệp vụ đã chốt (AskUserQuestion, trước khi viết spec — áp dụng cho cả 3 UC Bước 2)

1. **Tiêu chí ghép cặp**: theo `user_id` là chính (khớp `IDX_gate_logs_unpaired`); khi `user_id IS NULL` (xe lạ/chưa map người), fallback ghép theo `plate_number`.
2. **Giờ đóng cửa quy định** (dùng để coi phiên "chưa hoàn tất" là đã chốt/không chờ ghép nữa trong ngày): thêm 1 key vào `system_configs` (`config_group='gate_access'`, `config_key='gate_access.closing_hour_local'`), KHÔNG hard-code, cho phép Admin đổi sau qua API `system-configs` có sẵn (KHÔNG cần API riêng ở UC-116).

## 2. Quyết định thiết kế suy luận thêm (chưa hỏi riêng — ghi rõ lý do, KHÔNG tự ý đổi khi code)

Các điểm sau **không có trong 4 câu hỏi đã chốt** nhưng cần quyết định để viết được thuật toán; suy luận trực tiếp từ ràng buộc schema + CLAUDE.md, nêu rõ để Thiếu Chủ duyệt cùng lúc với spec:

1. **KHÔNG tạo synthetic "out" log khi tự đóng phiên cuối ngày.** SRS EX1 nói "tự động đóng phiên tại giờ đóng cửa quy định", nhưng bảng `gate_access_logs` append-only + CLAUDE.md cấm agent tự bịa dữ liệu thiết bị + phân công đã chốt "Hải ghi event, Tài chỉ đọc+cảnh báo". → Diễn giải "tự đóng phiên" là hành vi TÍNH TOÁN/ĐỌC, không phải hành vi GHI: sau giờ đóng cửa của một ngày, log `in` còn `paired_log_id IS NULL` được coi là "Chưa hoàn tất" **vĩnh viễn cho ngày đó** — KHÔNG insert row `out` giả, KHÔNG set `duration_seconds` ước lượng. Trạng thái "Chưa hoàn tất" là **derived tại thời điểm đọc** (UC-117), không lưu cột status riêng.
2. **"Ngày làm việc" (BR1 FIFO) = ngày dương lịch của `access_time`**, theo timezone server (Postgres `timestamptz`, convention repo dùng UTC lưu trữ + convert hiển thị theo nhu cầu FE — KHÔNG có timezone nghiệp vụ riêng nào được cấu hình trong repo). Cửa sổ ghép cặp giữa 1 log `in` và ứng viên `out` KHÔNG giới hạn cứng theo "cùng ngày dương lịch" (vì EX2 cho phép ghép `out` với `in` trong **24h trước đó**, có thể lệch ngày) — chỉ BR1 (ưu tiên FIFO gần nhất) áp dụng khi có nhiều ứng viên.
3. **Ghép đối xứng 2 chiều**: khi ghép thành công, `UPDATE` **cả 2 dòng** (`in` và `out`): mỗi dòng tự set `paired_log_id` trỏ sang dòng kia, và **cả 2 dòng cùng lưu `duration_seconds`** (giá trị giống nhau) — để bất kỳ dòng nào trong cặp cũng tự đủ dữ liệu khi UC-117 SELECT từng dòng, không cần luôn JOIN sang dòng đối ứng.
4. **Trigger chạy**: CHỈ cron định kỳ (`SchedulerService`, `EVERY_5_MINUTES`, gate `SCHEDULER_ENABLED && SCHEDULER_GATE_ACCESS_PAIRING_ENABLED` mặc định `false`). **KHÔNG** chờ/triển khai điểm gọi trực tiếp từ phía Hải khi có log `out` mới (roadmap ghi "chưa chốt điểm gọi với Hải") — expose thêm 1 public method `pairPendingLogs()` trên service để Bước sau (hoặc Hải) có thể gọi trực tiếp nếu cần, nhưng KHÔNG wiring event/hook nào ở UC-116.
5. **Phạm vi ghép**: quét TOÀN BỘ `gate_access_logs` chưa ghép (không giới hạn `zones.zone_type='gate'`) vì theo thiết kế của Hải, bảng này production ra chỉ khi có sự kiện ra/vào cổng — KHÔNG filter zone_type để tránh phụ thuộc dữ liệu zone chưa chuẩn hoá đầy đủ trong lúc Bước 2 tự seed.

---

## 3. Scope (UC-116)

### TRONG scope
1. `GateAccessPairingService.pairPendingLogs()`: quét log `direction='out'` chưa ghép (`paired_log_id IS NULL`), với mỗi log tìm ứng viên `in` chưa ghép:
   - `userId` khác NULL → tìm `in` cùng `userId`, `accessTime <= out.accessTime`, `accessTime >= out.accessTime - 24h`, `paired_log_id IS NULL`, `ORDER BY accessTime DESC LIMIT 1`.
   - `userId` là NULL → tìm `in` cùng `plateNumber` (điều kiện tương tự, thay `userId` bằng `plateNumber IS NOT NULL AND plateNumber = out.plateNumber`).
   - Tìm thấy → `UPDATE` cả 2 dòng: `pairedLogId` trỏ chéo, `durationSeconds = out.accessTime - in.accessTime` (giây, cả 2 dòng cùng giá trị).
   - Không tìm thấy → giữ nguyên (case EX2 — "Không xác định thời điểm vào", không có hành động ghi).
2. Đọc giờ đóng cửa từ `system_configs` (`config_group='gate_access'`, `config_key='gate_access.closing_hour_local'`, format `HH:mm`, default `'22:00'` nếu thiếu dòng) — dùng để log cảnh báo số lượng phiên "Chưa hoàn tất" tồn đọng sau giờ đóng cửa mỗi lần cron chạy (KHÔNG ghi gì vào DB cho việc này, chỉ phục vụ observability/log).
3. Migration seed 1 dòng `system_configs` mặc định (`gate_access.closing_hour_local = '22:00'`), idempotent (`ON CONFLICT DO NOTHING` theo `config_key`).
4. Wiring cron mới vào `SchedulerService` (`pairGateAccessLogs`, `EVERY_5_MINUTES`, gate `SCHEDULER_ENABLED && SCHEDULER_GATE_ACCESS_PAIRING_ENABLED` mặc định `false`) — mirror pattern `checkNoShow`/`earlyVacancy`.
5. Module mới `gate-access` (`TypeOrmModule.forFeature([GateAccessLogEntity, SystemConfigEntity])`, import entity từ `zones/entities` — KHÔNG khai lại entity, KHÔNG nhét logic vào `zones` module theo đúng ghi chú roadmap).

### NGOÀI scope (UC sau — KHÔNG làm ở đây)
- API tra cứu lịch sử (UC-117 — feature riêng `../uc117-gate-access-history/`).
- API thống kê lưu lượng (UC-114 — feature riêng `../uc114-vehicle-traffic-stats/`).
- Ghi `gate_access_logs` mới (INSERT raw event) — thuộc phía Hải, KHÔNG phải UC-116.
- Đối chiếu control-list khi xe qua cổng (đã làm ở Bước 1, `VehicleControlAlertService` — không đụng).
- Index mới trên `plate_number WHERE paired_log_id IS NULL` (tối ưu — chưa cần ở quy mô seed nhỏ Bước 2).
- API cho phép Admin sửa `gate_access.closing_hour_local` riêng — dùng chung API `system-configs` sẵn có của module `administration` (nếu route đó tồn tại; nếu chưa có PATCH endpoint chung, việc đó KHÔNG thuộc UC-116).
- Đối soát thủ công phiên "Chưa hoàn tất"/"Không xác định thời điểm vào" (SRS chỉ nói "giữ lại để đối soát thủ công" — không có UC thao tác thủ công nào được giao ở Bước 2).

---

## 4. Service (đề xuất — `GateAccessPairingService` mới, module `gate-access`)

- `pairPendingLogs(): Promise<{ scanned: number; paired: number; unmatched: number }>`:
  1. Đọc `closingHourLocal` từ `system_configs` (helper `loadClosingHour()`, default `'22:00'` nếu thiếu dòng/parse lỗi).
  2. `SELECT` toàn bộ `gate_access_logs` có `direction='out' AND paired_log_id IS NULL` (không giới hạn số lượng cứng ở Bước 2 — dữ liệu seed nhỏ; KHÔNG thêm phân trang/batch ở bản đầu).
  3. Với mỗi `out` log: build query ứng viên `in` theo quyết định §2.1 (ưu tiên `userId`, fallback `plateNumber`), lấy 1 ứng viên gần nhất.
  4. Có ứng viên → transaction `UPDATE` cả 2 dòng (`pairedLogId` chéo nhau + `durationSeconds` giống nhau) → tăng `paired`.
  5. Không có ứng viên → tăng `unmatched`, KHÔNG ghi gì.
  6. Trả `{scanned, paired, unmatched}` để `SchedulerService` log.
- `loadClosingHour(): Promise<string>` — helper private, đọc `system_configs` theo pattern §0.5, parse `HH:mm`, fallback default nếu sai format.
- **KHÔNG** có method ghi `gate_access_logs` mới (INSERT) — chỉ `UPDATE` 2 cột (`paired_log_id`, `duration_seconds`) trên dòng đã tồn tại.

## 5. Requirements (EARS)

- **R1**: **WHEN** cron `pairGateAccessLogs` chạy và tồn tại log `direction='out'` chưa ghép **→** hệ thống tìm ứng viên `in` chưa ghép theo thứ tự ưu tiên `user_id` rồi `plate_number` (khi `user_id` NULL), trong cửa sổ 24 giờ trước `access_time` của log `out`.
- **R2 (crux)**: **IF** tìm thấy ứng viên `in` phù hợp **→** hệ thống ghi `paired_log_id` chéo nhau và `duration_seconds` giống nhau lên CẢ HAI dòng, KHÔNG tạo dòng mới.
- **R3**: **IF** không tìm thấy ứng viên `in` nào trong 24h trước (case EX2 SRS) **→** hệ thống giữ nguyên log `out`, KHÔNG ghi gì, coi là "Không xác định thời điểm vào" (trạng thái derived, không lưu cột riêng).
- **R4**: **WHILE** một log `in` chưa được ghép và ngày dương lịch của `access_time` đã qua giờ đóng cửa cấu hình trong `system_configs` **→** hệ thống coi phiên đó là "Chưa hoàn tất" khi đọc (UC-117), KHÔNG tự tạo dòng `out` giả, KHÔNG set `duration_seconds`.
- **R5**: **WHERE** `SCHEDULER_ENABLED` hoặc `SCHEDULER_GATE_ACCESS_PAIRING_ENABLED` là `false` **→** cron KHÔNG chạy logic ghép cặp (early-return, mirror các job khác trong `SchedulerService`).
- **R6**: **IF** một bước ghép gặp lỗi DB **→** hệ thống bắt lỗi, log `Logger.error`, KHÔNG throw ra ngoài cron, KHÔNG làm crash các job cron khác cùng tiến trình.

## 6. Constitution

- **ARCH-01**: Business logic nằm trong `GateAccessPairingService` (module `gate-access`, file mới hoàn toàn) — `SchedulerService` chỉ gọi + log, mirror `checkNoShow`/`earlyVacancy`.
- **ARCH-02**: KHÔNG nhét logic ghép cặp vào module `zones` (roadmap đã chốt: `zones` là schema-only cho phần Zone).
- **DATA-01 (crux)**: KHÔNG hard-delete, KHÔNG soft-delete, KHÔNG INSERT dòng mới vào `gate_access_logs` — chỉ `UPDATE` 2 cột `paired_log_id`/`duration_seconds` trên dòng đã tồn tại (đúng bản chất append-only log).
- **DATA-02**: Mọi UPDATE ghép cặp PHẢI trong transaction (2 dòng cùng thành công hoặc cùng rollback — tránh trạng thái nửa vời 1 dòng có `paired_log_id`, dòng kia không).
- **DATA-03**: Đọc `system_configs` qua repository, KHÔNG hard-code giờ đóng cửa trong code (mục 1.2 đã chốt).
- **PERF-01**: KHÔNG thêm index mới ở UC-116 (out of scope, xem §3 Ngoài scope) — chấp nhận quét chậm hơn ở nhánh fallback `plate_number` tại quy mô dữ liệu seed Bước 2.
- **NO-SCOPE-01**: KHÔNG code API tra cứu (UC-117)/thống kê (UC-114) ở feature này — 2 feature riêng.

## 7. Residuals / known-gaps

- **Index `plate_number WHERE paired_log_id IS NULL`** — chưa thêm, cần nếu dữ liệu lớn dần (production thật với Hải ghi liên tục).
- **Điểm gọi trực tiếp từ Hải khi có log `out` mới** (thay vì chờ cron 5 phút) — roadmap ghi "chưa chốt điểm gọi", `pairPendingLogs()` để public sẵn cho việc này nhưng KHÔNG wiring.
- **Batch/phân trang khi số log chưa ghép rất lớn** — chưa cần ở Bước 2 (seed nhỏ), cần xem xét khi có dữ liệu thật.
- **API cho Admin sửa giờ đóng cửa** — dùng chung API `system-configs` (nếu đã có generic PATCH), KHÔNG làm route riêng ở đây.
- **Đối soát thủ công** phiên "Chưa hoàn tất"/"Không xác định thời điểm vào" — chưa có UC nào giao việc này, để ngỏ.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 3 UC Bước 2 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
