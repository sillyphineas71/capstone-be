# EVD-001 — tasks.md (Early-vacancy)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-20 | Tạo tasks EVD-001: T0 live → T1 enum+env → T2 config-service → T3 detect+flag → T4 cron → T5 config endpoint → T6 wiring → tests → T-GATE. Map FR. No-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC kiểm được. Code vs test tách. Hướng A (flag-only).

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T5b → T6 → T7 → T-GATE.

---

## T0 — Live read-only verify (plan §8)
- SELECT: `usage_status` thật booking đã-bắt-đầu (R-EVD-2 = `in_use`, đối chiếu occupancy-ingest CASE — bảng rỗng thì xác nhận qua code+enum, ghi rõ); `presence_snapshots` cột `occupancy_count/snapshot_time/meeting_id`; `notifications.notification_type` varchar + **no CHECK**; `room_events` `description/source_type/occupancy_count/metadata_json`; `system_configs` NOT NULL cols.
- **AC**: dán kết quả; **notification_type là DB-enum/CHECK → DỪNG báo** (no-migration). Thiếu cột → DỪNG.

## T1 — NotificationType enum + env (code) — OQ-5, §6
- `notification.entity.ts`: thêm `ROOM_EARLY_VACANCY = 'room_early_vacancy'`.
- `env.validation.ts` (scoped) + `.env.example`: `EARLY_VACANCY_EMPTY_MINUTES`(10), `EARLY_VACANCY_MIN_REMAINING_MINUTES`(15), `EARLY_VACANCY_MIN_ELAPSED_MINUTES`(10), `EARLY_VACANCY_ALERT_EMAIL_ENABLED`(false), `SCHEDULER_EARLY_VACANCY_ENABLED`(false).
- **AC**: build OK; enum member resolve; env validate default đúng.

## T2 — EarlyVacancyConfigService (code) — FR-EVD-48-01/02/03/05
- WHITELIST 3 key `early_vacancy.*`; `getEffectiveValue`/`getAll`/`getValues` (precedence system_configs→env→default 10/15/10); `update(dto,adminId)` validate int (empty≥1, remaining≥0, elapsed≥0) + upsert (`value_type='number'`, `config_group='room_utilization'`, version_no++, updated_by, is_sensitive=false) + audit `early_vacancy_config_update`.
- **AC**: `update({emptyMinutes:8})` → upsert key `early_vacancy.empty_minutes` value '8' group room_utilization version+1; `getValues()` đọc lại 8.

## T2b — Config service test — FR-EVD-48-02/05
- value < min → 400; key lạ chặn (qua DTO ở controller); upsert version_no++; precedence + source.
- **AC**: ≥80% branch file.

## T3 — EarlyVacancyService.detect + flagBooking (code) — FR-EVD-34-01..05, R-EVD-1, OQ-7
- `detect()`: đọc ngưỡng 1 lần; candidate query (plan §3) — `usage_status='in_use'` + `first_presence_at IS NOT NULL` + booking active + `reserved_end - now ≥ min_remaining` + `now - first_presence ≥ min_elapsed` + **R-EVD-1 fresh** (`last_any ≥ now-empty`) + `latest_count=0` + `last_pos ≤ now-empty`. Mỗi candidate try/catch → `flagBooking`.
- `flagBooking()` transaction: (1) `UPDATE room_booking_usages … early_empty … WHERE booking_id=$1 AND usage_status='in_use' RETURNING id` (0 row→skip); (2) INSERT `room_events` `room_early_vacancy`/`source_type='system'`/`occupancy_count=0`/`description`; (3) commit → notify organizer+host (in-app `ROOM_EARLY_VACANCY` + email gated). KHÔNG đụng booking/rooms/meetings.
- **AC**: candidate trống đủ ngưỡng → `usage_status='early_empty'` + room_event + notify 1 lần; chạy lại → 0 (idempotent guard).

## T3b — detect/flag test — R-EVD-1, OQ-7, ARCH-02
- trống đủ → flag; chưa đủ (last_pos > now-empty) → no-op; **camera chết (last_any cũ) → KHÔNG flag (R-EVD-1)**; no-show (first_presence_at NULL) → KHÔNG dính (OQ-7); gần giờ kết thúc (< min_remaining) → no-op; recipients dedupe organizer==host; email OFF→không enqueue; 1 booking lỗi không chặn batch.
- **AC**: ≥80% branch file; các nhánh trên xanh.

## T4 — Cron wire (code) — OQ-4, ARCH-02
- `scheduler.service.ts`: cron `earlyVacancy` EVERY_5_MIN, gate `SCHEDULER_ENABLED && SCHEDULER_EARLY_VACANCY_ENABLED` (default OFF), inject `EarlyVacancyService`, gọi `detect()`, log `scanned/flagged`; try/catch không throw ra cron.
- **AC**: gate OFF → không gọi detect; ON → gọi + log số liệu.

## T4b — scheduler test — ARCH-02
- gate OFF→no-op; ON→detect gọi 1 lần; detect throw → log error, không ném ra cron.
- **AC**: gating + resilience xanh.

## T5 — EarlyVacancyConfigController + DTO (code) — FR-EVD-48-04, OQ-3, SEC-02
- `update-early-vacancy-config.dto.ts`: 3 field optional `@IsInt @Min @Max(1440)` (`@Type(()=>Number)`).
- `early-vacancy-config.controller.ts` `@Controller('early-vacancy-config')`: `GET`+`PUT`, `JwtAuthGuard+MockPermissionsGuard`, `@Permissions('room.early_vacancy.configure')`, ValidationPipe(`whitelist+forbidNonWhitelisted+transform`) per-route, envelope thủ công.
- **AC**: `PUT {emptyMinutes:8}`→200 + service.update; `GET`→3 value+source; key lạ→400; non-admin guard wiring (JwtAuthGuard metadata).

## T5b — Config controller test — FR-EVD-48-04, R4-style
- GET envelope 3 key; PUT propagate 400 (service ném); guard JwtAuthGuard trên GET+PUT.
- **AC**: controller branch (gộp ngưỡng chung) xanh.

## T6 — Wiring (code) — plan §7
- `rooms.module.ts`: providers `EarlyVacancyService`+`EarlyVacancyConfigService`; controller `EarlyVacancyConfigController`; export `EarlyVacancyService`.
- **AC**: build resolve DI; DI-proof (compile AppModule) không circular/UnknownDependencies (Redis infra-only OK).

## T7 — Gom coverage 2 file mới
- jest coverage `early-vacancy.service.ts` + `early-vacancy-config.service.ts` ≥80% branch; bổ sung nhánh thiếu (skip/no-op/rollback) nếu hụt.
- **AC**: ≥80% branch cả 2.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint touched+spec baseline-proof (stash) 0 rule mới; jest spec mới + regression `rooms scheduler presence notifications` xanh; branch ≥80% 2 file mới; live checklist §8 dán.
- **Owed live-runbook** (KHÔNG chạy gate mock): bơm presence_snapshots count>0→=0 ≥ empty_minutes vào meeting in-progress + bật cron → `early_empty` + room_event + notification; camera-chết → KHÔNG flag.
- **AC**: gate xanh + báo cáo: ticket xong, định nghĩa trống (R-EVD-1) hoạt động, guard transition `in_use→early_empty`, perm string, persist system_configs (version_no+config_group), coverage, live checklist. STOP.

## Map task → FR
- T1/T2/T2b/T5/T5b → FR-EVD-48-01..05 (#48 config) + OQ-5 enum
- T3/T3b → FR-EVD-34-01..05 (#34 detect) + R-EVD-1 + OQ-7
- T4/T4b → cron (OQ-4, ARCH-02)
- T6 → wiring
