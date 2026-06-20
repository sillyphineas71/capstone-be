# EVD-001 — plan.md (Early-vacancy: detect + config)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-20 | Tạo plan EVD-001 sau spec DUYỆT (7 OQ + R-EVD-1/2). Flag-only (A), path riêng, config controller riêng, cron riêng, NotificationType.ROOM_EARLY_VACANCY. No-migration. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ. Hướng A (flag-only).

## 0. Quyết định đã chốt
- **OQ-1=A**: chỉ FLAG (`usage_status='early_empty'` + `room_event` + notify). **KHÔNG** đụng `room_bookings`/`rooms`/`meetings`.
- **OQ-2**: path early-vacancy **riêng**, KHÔNG refactor `release()` của NSL (nó coupled `no_show_cases`).
- **OQ-3**: `EarlyVacancyConfigController` + `EarlyVacancyConfigService` **riêng**; route `early-vacancy-config`, perm `room.early_vacancy.configure`. KHÔNG phá `no-show-config`.
- **OQ-4**: cron **riêng** `earlyVacancy`, gate `SCHEDULER_EARLY_VACANCY_ENABLED` default **OFF**.
- **OQ-5**: recipients organizer+host (dedupe, bỏ null) + **thêm `NotificationType.ROOM_EARLY_VACANCY='room_early_vacancy'`** (✅ verify live: `notifications.notification_type` varchar(60), **no CHECK** → no-migration; nếu sau phát hiện DB-enum/CHECK → DỪNG báo). Email gate `EARLY_VACANCY_ALERT_EMAIL_ENABLED` (default false).
- **OQ-6**: `empty_minutes=10`, `min_remaining_minutes=15`, `min_elapsed_minutes=10`.
- **OQ-7**: query early-vacancy disjoint no-show (`first_presence_at IS NOT NULL` vs no-show `IS NULL`).
- **R-EVD-1**: "trống" = có reading FRESH (≤ empty_minutes) và reading mới nhất =0 và không count>0 trong empty_minutes. Reading cũ (camera chết/mất tín hiệu) → **KHÔNG flag**.
- **R-EVD-2** (RECON): occupancy-ingest set `usage_status='in_use'` khi `not_started`+count>0 ([occupancy-ingest.service.ts:206-208](../../../../src/modules/presence/services/occupancy-ingest.service.ts)). ⇒ booking đã-bắt-đầu = **`in_use`**; guard transition **`in_use → early_empty`** (đúng giá trị thật, không đoán).

## 1. Ticket breakdown (thứ tự + lý do)
| # | Ticket | Lý do |
| :-- | :--- | :--- |
| 1 | **#34 detect** (`EarlyVacancyConfigService` [read] + `EarlyVacancyService.detect` + `NotificationType.ROOM_EARLY_VACANCY` + env) | Lõi nghiệp vụ. detect đọc ngưỡng qua config-service nên config-service (read) phải có trước. |
| 2 | **cron wire** (`scheduler.earlyVacancy`) | Tiêu thụ detect; gate độc lập default OFF. |
| 3 | **#48 config** (`EarlyVacancyConfigController` + DTO, GET/PUT) | Surface admin ghi ngưỡng; build sau khi service read ổn. |

## 2. File list

### Net-new
- `src/modules/rooms/services/early-vacancy.service.ts` — `detect()` + mutate hướng A + notify.
- `src/modules/rooms/services/early-vacancy.service.spec.ts`
- `src/modules/rooms/services/early-vacancy-config.service.ts` — read (precedence) + update (whitelist/upsert/audit).
- `src/modules/rooms/services/early-vacancy-config.service.spec.ts`
- `src/modules/rooms/controllers/early-vacancy-config.controller.ts` — GET/PUT admin-gated.
- `src/modules/rooms/controllers/early-vacancy-config.controller.spec.ts`
- `src/modules/rooms/dto/update-early-vacancy-config.dto.ts` — 3 field optional int bound.

### Modified
- `src/modules/rooms/rooms.module.ts` — providers `EarlyVacancyService`+`EarlyVacancyConfigService`; controller `EarlyVacancyConfigController`; export `EarlyVacancyService` (scheduler dùng). (NotificationsModule/AdministrationModule/WebsocketModule đã import sẵn từ NSL-001.)
- `src/modules/scheduler/scheduler.service.ts` — cron `earlyVacancy` (EVERY_5_MIN, gate `SCHEDULER_ENABLED && SCHEDULER_EARLY_VACANCY_ENABLED`), inject `EarlyVacancyService`, log số liệu.
- `src/modules/notifications/entities/notification.entity.ts` — thêm enum member `ROOM_EARLY_VACANCY='room_early_vacancy'` (no-migration; varchar60 no-CHECK).
- `src/config/env.validation.ts` — **CHỈ thêm scoped** Joi (KHÔNG prettier cả file).
- `.env.example` — thêm 5 key.

## 3. Chữ ký service detect + định nghĩa "trống" (R-EVD-1)

`EarlyVacancyService.detect(): Promise<{ scanned: number; flagged: number }>`
- Đọc ngưỡng 1 lần/đợt (NC-2) qua `EarlyVacancyConfigService.getValues()` → `{ emptyMinutes, minRemainingMinutes, minElapsedMinutes }`.
- **Candidate query** (SEC-03 bind; nguồn trống = time-series `presence_snapshots.occupancy_count`):
```sql
SELECT u.booking_id, u.meeting_id, u.room_id
  FROM room_booking_usages u
  JOIN room_bookings b ON b.id = u.booking_id
  LEFT JOIN LATERAL (
    SELECT MAX(ps.snapshot_time) FILTER (WHERE ps.occupancy_count > 0) AS last_pos,
           MAX(ps.snapshot_time)                                       AS last_any,
           (ARRAY_AGG(ps.occupancy_count ORDER BY ps.snapshot_time DESC))[1] AS latest_count
      FROM presence_snapshots ps
     WHERE ps.meeting_id = u.meeting_id
  ) s ON true
 WHERE u.usage_status = 'in_use'                              -- R-EVD-2 (đã bắt đầu)
   AND u.first_presence_at IS NOT NULL                        -- OQ-7 disjoint no-show
   AND b.status IN ('approved','active')
   AND u.reserved_end_time - now() >= ($1 * interval '1 minute')   -- min_remaining: còn đáng xử lý
   AND now() - u.first_presence_at >= ($2 * interval '1 minute')   -- min_elapsed từ khi có người
   AND s.last_any IS NOT NULL
   AND s.last_any >= now() - ($3 * interval '1 minute')       -- R-EVD-1 FRESH (camera còn sống)
   AND s.latest_count = 0                                     -- reading mới nhất = trống
   AND (s.last_pos IS NULL OR s.last_pos <= now() - ($3 * interval '1 minute'))  -- trống liên tục ≥ empty
```
  ($1=minRemaining, $2=minElapsed, $3=emptyMinutes). **R-EVD-1**: `last_any` cũ (< now−empty) ⇒ KHÔNG vào candidate (phân biệt "trống" vs "mất tín hiệu").
- Mỗi candidate (try/catch riêng) → `flagBooking(...)`.

## 4. Cột mutate (hướng A — §3 spec)
`flagBooking({bookingId,meetingId,roomId,emptyMinutes})` trong 1 transaction:
1. `UPDATE room_booking_usages SET usage_status='early_empty', metadata_json = COALESCE(metadata_json,'{}'::jsonb) || $json WHERE booking_id=$1 AND usage_status='in_use' RETURNING id` — guard idempotent (chỉ `in_use→early_empty`); **0 row → skip** (đã xử lý / không còn in_use).
2. `INSERT INTO room_events (room_id, meeting_id, booking_id, event_type, source_type, actor_user_id, description, occupancy_count, metadata_json) VALUES ($1,$2,$3,'room_early_vacancy','system',NULL,$4,0,$5::jsonb)` — cột `description` (KHÔNG `reason`).
3. commit → notify organizer+host (in-app `ROOM_EARLY_VACANCY` + email gated) best-effort.
- **KHÔNG** đụng `room_bookings`, `rooms.current_status`, `meetings` (ARCH-01).
- `metadata_json` early-vacancy: `{ early_vacancy: { detected_at, empty_minutes } }`.

## 5. Config service/controller (#48)
- `EarlyVacancyConfigService` (mirror NoShowConfigService): WHITELIST 3 key `early_vacancy.{empty_minutes,min_remaining_minutes,min_elapsed_minutes}`; `getEffectiveValue`/`getAll`/`getValues` (precedence system_configs→env→default); `update(dto,adminId)` validate int + upsert (`value_type='number'`, `config_group='room_utilization'`, version_no++, `updated_by`, `is_sensitive=false`) + audit `early_vacancy_config_update`.
- `EarlyVacancyConfigController` `@Controller('early-vacancy-config')`: `GET` + `PUT`, `JwtAuthGuard+MockPermissionsGuard`, `@Permissions('room.early_vacancy.configure')`, ValidationPipe per-route (`forbidNonWhitelisted` → key lạ 400), envelope `{success,message,data}`.

## 6. Config keys + env
| Key | Env | Default | Min | Ý nghĩa |
| :-- | :-- | :-- | :-- | :-- |
| `early_vacancy.empty_minutes` | `EARLY_VACANCY_EMPTY_MINUTES` | 10 | 1 | trống liên tục ≥ → flag (cũng là freshness bound R-EVD-1) |
| `early_vacancy.min_remaining_minutes` | `EARLY_VACANCY_MIN_REMAINING_MINUTES` | 15 | 0 | còn ≥ tới reserved_end mới xử lý |
| `early_vacancy.min_elapsed_minutes` | `EARLY_VACANCY_MIN_ELAPSED_MINUTES` | 10 | 0 | đã trôi ≥ từ first_presence_at |

Thêm: `EARLY_VACANCY_ALERT_EMAIL_ENABLED` (bool default false), `SCHEDULER_EARLY_VACANCY_ENABLED` (bool default false). Joi scoped — chỉ thêm dòng.

## 7. Wiring
- RoomsModule đã có NotificationsModule + AdministrationModule + WebsocketModule (NSL-001) → chỉ thêm providers/controller/export. EarlyVacancyService inject: DataSource, ConfigService, WebsocketService, NotificationsService, EarlyVacancyConfigService. ConfigService cho EARLY_VACANCY_ALERT_EMAIL_ENABLED. EarlyVacancyConfigService inject: DataSource, ConfigService, AuditLogsService.
- SchedulerModule đã import RoomsModule → inject EarlyVacancyService.

## 8. Live read-only checklist (TRƯỚC khi tin mock)
1. **R-EVD-2**: `usage_status` thật của booking đã-bắt-đầu = `in_use` (đối chiếu occupancy-ingest CASE; bảng hiện rỗng → xác nhận qua code + enum, ghi rõ).
2. `presence_snapshots`: cột `occupancy_count`(int null), `snapshot_time`(tstz NOT NULL), `meeting_id` — verify ✅ (đã liếc).
3. `notifications.notification_type` varchar(60) **no CHECK** → enum member OK ✅ (đã verify); nếu khác → DỪNG.
4. `room_events`: `description`/`source_type`/`occupancy_count`/`metadata_json` tồn tại ✅ (NSL T0).
5. `system_configs`: `config_group` NOT NULL + `value_type` + `version_no` ✅.

## 9. Gate (mock-level, STOP — KHÔNG commit)
- `npm run build`=0.
- `npx eslint` file đụng + spec → baseline-proof (stash), **0 lỗi rule mới** (chấp nhận `req.user`/`any`-family mirror sibling).
- `npx jest` spec mới + regression `src/modules/rooms src/modules/scheduler src/modules/presence src/modules/notifications`.
- **Branch ≥80%** `early-vacancy.service.ts` + `early-vacancy-config.service.ts`.
- Live checklist §8 dán kết quả.
- **Owed live-runbook** (KHÔNG chạy gate mock): bơm presence_snapshots count>0 rồi =0 ≥ empty_minutes vào 1 meeting in-progress + bật cron → quan sát `usage_status='early_empty'` + `room_events` + notification; camera-chết (reading cũ) → KHÔNG flag.

## 10. Kỷ luật
- **No-migration**: cột/enum-DB thiếu → **DỪNG báo Thiếu Chủ**.
- **SEC-01** notify/audit/log metadata-only; **SEC-02** config admin-gated; **SEC-03** bind raw-SQL + whitelist key; **DATA-01** no-migration; **ARCH-01** KHÔNG mutate rooms/meetings (hướng A cũng không đụng room_bookings); **ARCH-02** cron gated default OFF + try/catch mỗi booking + không throw ra cron + log số liệu.
- Envelope thủ công `{success,message,data}`; ValidationPipe per-route; KHÔNG global pipe.

> **STOP.** Plan + tasks chờ review trước khi code.
