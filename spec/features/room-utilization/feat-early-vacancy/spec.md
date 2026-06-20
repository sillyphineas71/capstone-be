# EVD-001 — Early-vacancy: phát hiện phòng trống sớm + cấu hình ngưỡng

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-20 | Tạo spec EVD-001 (#34/UC-46 + #34-cfg/UC-48): phát hiện phòng trống sớm khi họp đã bắt đầu + config ngưỡng. RECON code thật, no-migration. Còn OQ chờ chốt. | Toàn bộ |
| 2026-06-20 | Ghi rõ N1 (empty_minutes kiêm freshness bound) + N2 (không un-flag sau early_empty) vào Residuals; ghi chú R-EVD-1 đã xử lý ca camera-chết. | §10 |

> **SPEC-ONLY.** Chưa plan/tasks/code. 2 UC Group B, KHÔNG IVSS. Khác no-show (NSL-001): early-vacancy = họp **đã bắt đầu** rồi phòng trống sớm.

---

## 0. RECON findings (đã đọc code thật)

### 0.1. Tín hiệu "phòng đang trống" — ⚠ `last_presence_at` KHÔNG đáng tin
[occupancy-ingest.service.ts:200-211](../../../../src/modules/presence/services/occupancy-ingest.service.ts): mỗi occupancy event (kể cả `occupancyCount=0`) đều chạy `UPDATE room_booking_usages SET last_presence_at = <eventTime>` **không gate theo count**. ⇒ `last_presence_at` thực chất là "thời điểm event gần nhất", **không phải** "lần cuối có người". Tương tự, presence_snapshots được insert với `presence_status='present'` **hardcode** (kể cả count=0) — nhưng **CÓ lưu `occupancy_count` + `snapshot_time`** ([:193-198](../../../../src/modules/presence/services/occupancy-ingest.service.ts)). `room_events` cũng lưu `occupancy_count` + `event_time`, `source_type='camera'` ([:167-179](../../../../src/modules/presence/services/occupancy-ingest.service.ts)).
- ⇒ **Suy "trống liên tục ≥ X phút" phải dùng time-series `occupancy_count`**, KHÔNG dùng `last_presence_at`. Định nghĩa: snapshot/event mới nhất có `occupancy_count=0` **VÀ** không có `occupancy_count>0` trong X phút gần đây ⇔ `MAX(snapshot_time WHERE occupancy_count>0) ≤ now − X` (xem OQ về nguồn presence_snapshots vs room_events).
- Nguồn ưu tiên đề xuất: **`presence_snapshots`** (gắn meeting, có occupancy_count + snapshot_time). `room_events` là fallback per-room. (Cardinality nhiều snapshot/meeting — dùng MAX/ORDER BY time.)

### 0.2. Phát hiện họp đang diễn ra + giờ kết thúc
- `meetings`: `status` enum có `in_progress` ([meeting.entity.ts:34-41](../../../../src/modules/meetings/entities/meeting.entity.ts)), `actual_start_time`/`actual_end_time` (nullable, [:109-112](../../../../src/modules/meetings/entities/meeting.entity.ts)).
- Tín hiệu "đã bắt đầu" có 2 cách: (a) `meetings.status='in_progress'` + `actual_start_time IS NOT NULL`; (b) booking `IN ('approved','active')` + `room_booking_usages.first_presence_at IS NOT NULL` (đã từng có người — đây là điểm phân biệt với no-show). Đề xuất kết hợp `first_presence_at IS NOT NULL` (chắc chắn đã có presence) — xem OQ-7.
- "Trước giờ kết thúc": `reserved_end_time` có ở **cả** `room_bookings` và `room_booking_usages` ([room-booking-usage.entity.ts:47-48](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts)). Dùng `reserved_end_time − now ≥ min_remaining` để biết còn đáng xử lý.

### 0.3. `release()` của NSL — COUPLED với no_show_cases
[no-show-lifecycle.service.ts:149-170](../../../../src/modules/rooms/services/no-show-lifecycle.service.ts): `release({caseId,…})` bắt đầu bằng `UPDATE no_show_cases WHERE id=$caseId … RETURNING booking_id,meeting_id,room_id` rồi mới mutate booking/usage/room_event. **Early-vacancy KHÔNG có `no_show_case`** ⇒ KHÔNG tái dùng trực tiếp. Phần mutate booking+usage+room_event (transaction + guard rows-affected) là tái dùng được nếu **tách** khỏi bước case. → **OQ-2**.

### 0.4. Không có bảng/cột riêng cho early-vacancy
Chỉ có `RoomUsageStatus.EARLY_EMPTY='early_empty'` ([room-booking-usage.entity.ts:18](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts)). KHÔNG có table case riêng (no_show_cases chỉ cho no-show). ⇒ early-vacancy ghi trạng thái qua **`room_booking_usages` (usage_status + metadata_json) + `room_events`** (không cần bảng mới, no-migration). Idempotent phải dựa trên `usage_status` (tránh xử lý lặp).

### 0.5. Hạ tầng tái dùng (NSL-001)
- `NoShowConfigController` `@Controller('no-show-config')`, whitelist key `no_show.*`, perm `room.noshow.configure`, upsert `system_configs` (version_no++, config_group, value_type='number', audit) ([no-show-config.controller.ts](../../../../src/modules/rooms/controllers/no-show-config.controller.ts), [no-show-config.service.ts](../../../../src/modules/rooms/services/no-show-config.service.ts)). → OQ-3 (mở rộng vs riêng).
- Cron `scheduler.service.ts`: `checkNoShow` (EVERY_5_MIN, gate `SCHEDULER_NO_SHOW_CHECK_ENABLED`), `autoRelease` (gate `SCHEDULER_AUTO_RELEASE_ENABLED`). → OQ-4.
- `room_events`: cột **`description`** (KHÔNG `reason`), `source_type` NOT NULL (NSL dùng `'system'`), `occupancy_count`, `metadata_json`, `actor_user_id`.

### 0.6. No-migration
Mọi cột cần đã có (0.1–0.4). **Khẳng định KHÔNG migration.** Thiếu cột khi code → **DỪNG báo Thiếu Chủ**.

---

## 1. Định nghĩa "trống sớm" (early-vacancy)
Một booking là early-vacancy tại thời điểm quét khi **TẤT CẢ** đúng:
1. **Đã bắt đầu**: `room_booking_usages.first_presence_at IS NOT NULL` (đã từng có người) — phân biệt no-show.
2. **Đang trong giờ**: booking `IN ('approved','active')` và `now < reserved_end_time`.
3. **Đang trống liên tục ≥ `empty_minutes`**: từ time-series occupancy_count — không có `occupancy_count>0` trong `empty_minutes` phút gần nhất (snapshot/event mới nhất = 0).
4. **Còn đáng xử lý**: `reserved_end_time − now ≥ min_remaining_minutes` (OQ-6).
5. (tùy OQ-6) **Đã trôi đủ từ start**: `now − actual_start_time ≥ min_elapsed_minutes` (chống flag ngay lúc mới vào/ra vặt).
6. **Chưa xử lý**: `usage_status` chưa phải `early_empty`/`released`/`completed` (idempotent).

Loại trừ no-show: no-show có `first_presence_at IS NULL`; early-vacancy có `first_presence_at IS NOT NULL` → **2 query tách bạch** (OQ-7).

## 2. #34 / UC-46 — Phát hiện (FR)
- **FR-EVD-34-01**: trong cron (OQ-4), quét booking thoả §1 (đọc ngưỡng `empty_minutes`/`min_remaining_minutes`/`min_elapsed_minutes` theo precedence config — §5).
- **FR-EVD-34-02 (mutate — theo OQ-1)**: xem §3.
- **FR-EVD-34-03 (notify)**: organizer + host (dedupe, bỏ null) in-app + email gated (OQ-5). `NotificationType` — xem OQ-5 (tái dùng `NO_SHOW_ALERT` hay thêm loại mới; lưu ý `no_show_alert` sai ngữ nghĩa).
- **FR-EVD-34-04 (idempotent + an toàn batch)**: WHERE guard theo `usage_status` (chỉ chuyển 1 lần); try/catch mỗi booking; cron KHÔNG throw ra ngoài (ARCH-02).
- **FR-EVD-34-05 (false-positive)**: ngưỡng `empty_minutes` + `min_elapsed` (OQ-6) chống người tạm ra ngoài. SEC-03 bind tham số.

## 3. Cột mutate (phụ thuộc OQ-1)

### Hướng A — CHỈ FLAG (đề xuất mặc định, an toàn)
1. `room_booking_usages`: `usage_status='early_empty'`, ghi `metadata_json` (vd `{ early_vacancy:{ detected_at, empty_since } }`). **KHÔNG** đụng `auto_released`/`released_*`. Guard `WHERE booking_id=$1 AND usage_status IN ('in_use')` (chỉ từ in_use → early_empty).
2. `room_events`: `event_type='room_early_vacancy'`, `source_type='system'`, `description`, `occupancy_count=0`, `metadata_json={ bookingId, emptyMinutes }`.
3. **KHÔNG** đụng `room_bookings`, `rooms.current_status`, `meetings`.
- Downstream: scheduling/availability coi `early_empty` là **tín hiệu cảnh báo**, phòng **vẫn thuộc booking** (chưa free). An toàn, không cướp phòng họp đang diễn ra.

### Hướng B — RELEASE sớm (mạnh tay)
Như A + flip `room_bookings.status='released'` (+ `cancellation_reason`) + `usage_status='released'`, `auto_released=true`, `released_at`. Free phần giờ còn lại cho người khác đặt.
- Hệ quả: **chấm dứt** booking họp đang-trong-giờ; nếu người chỉ tạm ra ngoài → mất phòng. Downstream scheduling thấy slot trống → cho đặt đè phần còn lại. Rủi ro nghiệp vụ cao hơn no-show (no-show là họp chưa từng bắt đầu).
- Nếu chọn B: tái dùng phần mutate booking+usage+room_event (OQ-2), guard `room_bookings WHERE status IN ('approved','active')` như NSL.

> **Quyết định A/B = OQ-1 (crux).** Spec mặc định mô tả A; B là tuỳ chọn chốt sau.

## 4. #34-cfg / UC-48 — Cấu hình ngưỡng (admin ghi)
- **FR-EVD-48-01 (whitelist SEC)**: chỉ cho ghi key `early_vacancy.*` (§5). Key ngoài → 400.
- **FR-EVD-48-02 (validate)**: số nguyên ≥ ràng buộc (empty_minutes ≥1, min_remaining ≥0, min_elapsed ≥0).
- **FR-EVD-48-03 (ghi)**: upsert `system_configs` (`value_type='number'`, `config_group='room_utilization'` hoặc `'early_vacancy'`, version_no++, updated_by, audit) — mirror NoShowConfigService.
- **FR-EVD-48-04 (API)**: GET + PUT, admin-gated (SEC-02). Host endpoint — **OQ-3**.
- **FR-EVD-48-05 (precedence đọc)**: `system_configs → env → default`.

## 5. Config keys (đề xuất)
| Key | Env fallback | Default | Đơn vị | Ý nghĩa |
| :--- | :--- | :--- | :--- | :--- |
| `early_vacancy.empty_minutes` | `EARLY_VACANCY_EMPTY_MINUTES` | 10 | phút | trống liên tục ≥ ngần này → early-vacancy |
| `early_vacancy.min_remaining_minutes` | `EARLY_VACANCY_MIN_REMAINING_MINUTES` | 15 | phút | còn ≥ ngần này tới `reserved_end_time` mới xử lý |
| `early_vacancy.min_elapsed_minutes` | `EARLY_VACANCY_MIN_ELAPSED_MINUTES` | 10 | phút | đã trôi ≥ ngần này từ `actual_start_time` (OQ-6) |

Email gate: tái dùng `NO_SHOW_ALERT_EMAIL_ENABLED` hay thêm `EARLY_VACANCY_ALERT_EMAIL_ENABLED` — OQ-5. Cron gate env default OFF (vd `SCHEDULER_EARLY_VACANCY_ENABLED`) — OQ-4.

## 6. Cron + gating
- Gate `SCHEDULER_ENABLED && SCHEDULER_EARLY_VACANCY_ENABLED` (default **OFF**), log enabled-state + số liệu. Try/catch mỗi booking, KHÔNG throw ra cron (ARCH-02). Vị trí cron — OQ-4.

## 7. Test bằng event giả (không phần cứng)
- Dựng booking + usage `first_presence_at` set (đã bắt đầu) + `reserved_end_time` tương lai; bơm presence_snapshots/room_events occupancy_count theo mốc thời gian: chuỗi `>0` rồi `=0` cách `empty_minutes`.
- Nhánh: trống đủ ngưỡng → early_empty (+ notify); vừa trống chưa đủ → no-op; gần giờ kết thúc (< min_remaining) → no-op; no-show (first_presence_at NULL) → KHÔNG dính early-vacancy (OQ-7); idempotent (chạy lại không lặp).
- Mock NotificationsService/WebsocketService/AuditLogsService; `dataSource.manager.query` theo SQL keyword. Cron test gọi service trực tiếp.

## 8. Constitution
- **SEC-01** notify/audit/log metadata-only. **SEC-02** config admin-gated. **SEC-03** bind raw-SQL + whitelist config key.
- **DATA-01** no-migration (cột sẵn có). **ARCH-01** thuộc rooms; gọi Notifications/Websocket/Audit qua boundary; **KHÔNG** mutate `rooms.current_status`/`meetings` (kể cả hướng B chỉ đụng `room_bookings`, không `meetings`). **ARCH-02** cron gated default OFF + try/catch + không throw ra cron + log số liệu.
- Envelope `{success,message,data}`; ValidationPipe per-route.

## 9. OPEN QUESTIONS (chốt trước plan/tasks)
- **OQ-1 (crux)**: #34 **FLAG-only (A)** hay **RELEASE sớm (B)**? Nêu rõ downstream: A → `early_empty` là cảnh báo, phòng vẫn của booking; B → `released` free slot, có thể bị đặt đè phần còn lại, chấm dứt họp đang diễn ra. Đề xuất **A** cho v1 (an toàn), B làm sau nếu nghiệp vụ cần.
- **OQ-2**: tái dùng `release()` (cần **refactor tách** phần mutate booking+usage+room_event ra hàm không-phụ-thuộc-case, rồi NSL `release()` gọi lại) hay viết path early-vacancy **riêng**? (đề xuất: nếu OQ-1=A thì path riêng nhẹ; nếu B thì tách hàm chung.)
- **OQ-3**: ngưỡng — **mở rộng** `NoShowConfigController` (đổi tên generic `RoomUtilizationConfigController`, whitelist thêm `early_vacancy.*`) hay **config riêng** `EarlyVacancyConfigController`? (đề xuất mở rộng generic để tránh trùng pattern; cân nhắc breaking route `no-show-config`.)
- **OQ-4**: cron **riêng** (`earlyVacancy`) hay nhét vào `checkNoShow`? Query khác hẳn (in-progress + presence-rồi-trống). Đề xuất **cron riêng** gate độc lập.
- **OQ-5**: recipients = organizer + host (như NSL)? `NotificationType` — tái dùng `NO_SHOW_ALERT` (sai ngữ nghĩa) hay thêm loại mới (vd `ROOM_EARLY_VACANCY`)? Email gate riêng hay chung?
- **OQ-6**: chống false-positive — có cần `min_elapsed_minutes` (đã trôi từ actual_start) + `min_remaining_minutes` (còn đủ giờ đáng xử lý)? Giá trị default?
- **OQ-7**: xác nhận query early-vacancy (`first_presence_at IS NOT NULL` + trống) **tách bạch** no-show (`IS NULL`) — không double-count, không cùng booking dính cả 2.

## 10. Residuals / known-gaps
- **N1 — `empty_minutes` kiêm freshness bound**: cùng 1 ngưỡng vừa là "trống liên tục ≥" vừa là cửa sổ FRESH (R-EVD-1). Ràng buộc vận hành: `empty_minutes` **≥ nhịp gửi snapshot của camera**. Camera gửi **thưa hơn** `empty_minutes` → reading mới nhất rớt khỏi cửa sổ fresh → KHÔNG flag = **false-negative an toàn** (không bao giờ false-positive). Nếu cần tách freshness khỏi empty thì thêm config riêng sau.
- **N2 — không un-flag**: sau khi `usage_status='early_empty'`, nếu người **quay lại** thì hệ thống **KHÔNG** tự revert về `in_use` (occupancy-ingest chỉ nâng `not_started→in_use`, không hạ từ `early_empty`). early-vacancy là cảnh báo 1 chiều ở v1; revert/clear là việc sau.
- `last_presence_at` bị bump bởi count=0 (0.1) → KHÔNG dùng làm mốc; nếu sau muốn dùng phải sửa occupancy-ingest (ngoài phạm vi).
- presence_snapshots ghi `presence_status='present'` cứng kể cả count=0 (chỉ tin `occupancy_count`).
- Cron in-instance: chưa distributed lock (giống NSL).
- Camera chết/mất tín hiệu: **R-EVD-1 đã xử lý** (đòi reading FRESH `last_any ≥ now−empty` → reading cũ KHÔNG flag). Phân biệt sâu hơn "trống" vs "mất tín hiệu" qua heartbeat/event-age có thể bổ sung sau.
- Hướng B (nếu chọn): booking released giữa giờ nhưng `meetings` vẫn `in_progress` → orphan (như NSL known-gap).

> **STOP.** Spec-only. Chờ Thiếu Chủ review + chốt OQ-1…OQ-7 trước khi plan/tasks.
