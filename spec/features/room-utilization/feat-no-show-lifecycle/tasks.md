# NSL-001 — tasks.md (No-show lifecycle)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-20 | Tạo tasks NSL-001: T1 config → T2 warn+reconcile → T3 release dùng chung → T4 auto-release cron → T5 manual release → T6 wiring/env → tests → T-gate. Map FR spec. | Toàn bộ |

> Map: [spec.md](./spec.md) §2–§7, [plan.md](./plan.md) §1–§7. Mỗi task có 1 AC kiểm được. Code vs test tách rõ. No-migration.

## Thứ tự thực thi
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T5b → T6 → T7 → T8(tests gom) → T-GATE.
(Trong đó *b = test của task code ngay trước; có thể viết liền.)

---

## T0 — Live read-only verify (plan §6)
- Chạy SELECT read-only xác nhận: cột `room_booking_usages`, `room_bookings.status` chứa `released` + `cancellation_reason`, `system_configs.config_group` NOT NULL + `value_type` + `version_no`, `room_events.event_type/reason/actor_user_id/metadata_json`.
- **AC**: dán 4 kết quả; nếu thiếu cột bất kỳ → **DỪNG, báo Thiếu Chủ** (no-migration). Không sang T1 nếu DỪNG.

## T1 — #35 Config service (code) — FR-NSL-35-01/02/03/05
- `NoShowConfigService`: `WHITELIST = {thresholdMinutes:'no_show.threshold_minutes', warningGraceMinutes:'no_show.warning_grace_minutes', autoReleaseGraceMinutes:'no_show.auto_release_grace_minutes'}`.
- `getEffective()`: 3 key, precedence `system_configs → env → default` (15/0/5), trả `{ key:{value,source} }`.
- `update(dto, adminId)`: mỗi field gửi lên → validate int (`threshold≥1`, `autoRelease≥1`, `warningGrace≥0`); upsert `getRepository(SystemConfigEntity)` theo `config_key` (update: `config_value`, `value_type='number'`, `config_group='no_show'`, `is_active=true`, `updated_by`, `version_no+1`; insert: `version_no=1`). Key ngoài whitelist KHÔNG tồn tại trong DTO (whitelist tại DTO + service). Audit `actionType:'no_show_config_update'` (metadata = field đổi, không secret).
- **AC**: gọi `update({thresholdMinutes:20})` → repo upsert key `no_show.threshold_minutes` value '20' group 'no_show' version+1; `getEffective()` trả value 20 source 'system_configs'.

## T1b — Config service test — FR-NSL-35-01/02/05
- value ≤ 0 → throw 400; key lạ (không qua DTO) bị chặn; upsert tăng `version_no`; `getEffective` fallback env/default khi thiếu row + đúng `source`.
- **AC**: ≥80% branch file; các nhánh validate/upsert/precedence xanh.

## T2 — #32 warn + R1 reconcile (code) — FR-NSL-32-01..05, R1
- `NoShowLifecycleService.reconcilePresence()`: UPDATE case `detection_status IN ('risk','warning_sent')` có booking usage `first_presence_at IS NOT NULL` → `detection_status='resolved', resolution_status='kept', note` (guard WHERE). Trả `{scanned,resolved}`.
- `NoShowLifecycleService.warnBatch()`: đọc `warning_grace` 1 lần (NoShowConfigService); chọn `risk` + usage `first_presence_at IS NULL` + booking `IN('approved','active')` + `now ≥ detected_at + grace`; per-case `UPDATE … SET warning_sent_at=now, warning_deadline_at=now+autoReleaseGrace, auto_release_eligible_at=now+autoReleaseGrace, detection_status='warning_sent' WHERE id=$1 AND detection_status='risk'` (idempotent); nếu 1 row → notify organizer+host (dedupe, bỏ null): `createNotification(IN_APP)` + email gated `NO_SHOW_ALERT_EMAIL_ENABLED`. try/catch mỗi case.
- **AC**: risk đủ grace + no presence → 1 case `warning_sent` + deadline set + notify mock 1 lần; gọi lại → 0 warned (idempotent).

## T2b — warn + reconcile test — FR-NSL-32-04, R1
- reconcile: case risk + `first_presence_at` set → `resolved/kept`, KHÔNG notify; warn: presence đã có → KHÔNG warn; recipients dedupe organizer==host → 1 id; email OFF → không enqueue; lỗi notify không fail transition.
- **AC**: reconcile resolved nhánh riêng xanh; warn idempotent + recipients dedupe xanh; ≥80% branch.

## T3 — §4 release dùng chung (code) — FR-NSL-33-03, FR-NSL-33b-03, R2, OQ-1/5
- `NoShowLifecycleService.release({caseId,actor,reason,mode})` trong transaction (plan §3):
  1. UPDATE no_show_cases guard `detection_status IN (<auto:'warning_sent' | manual:'risk','warning_sent'>)`; 0 row → rollback `skipped:'already_released'`.
  2. UPDATE room_bookings guard `status IN ('approved','active')`; 0 row → rollback `skipped:'booking_changed'`.
  3. UPDATE room_booking_usages WHERE booking_id (mutate-if-exists; 0 row OK).
  4. INSERT room_events (`room_auto_released|room_manual_released`, metadata `{noShowCaseId, usageMutated}`).
  5. commit → notify (best-effort) + (manual) audit.
- **AC**: case `warning_sent` + booking `active` → trả `{released:true}`, 4 mutate đúng §4 (booking 'released', usage 'released', case 'released', room_event insert); booking đã `cancelled` → `skipped:'booking_changed'` + KHÔNG mutate case (rollback).

## T3b — release test — R2, OQ-1/5/8
- double-release: case đã `released` → `skipped:'already_released'` (0 row guard); booking guard 0-row → rollback toàn bộ (case không đổi); usage thiếu row → vẫn release case+booking+room_event, `usageMutated=false`; auto vs manual: `resolution_status` + `auto_released` + `resolved_by` đúng.
- **AC**: cả 3 nhánh skip + 2 mode xanh; ≥80% branch.

## T4 — #33 auto-release cron (code) — FR-NSL-33-01/02/05/06
- `NoShowLifecycleService.autoReleaseBatch()`: chọn `warning_sent` + `now ≥ auto_release_eligible_at` + usage `first_presence_at IS NULL` + booking `IN('approved','active')`; per-case `release({mode:'auto',actor:null,reason})` try/catch; trả `{scanned,released,skipped}`.
- `scheduler.service.ts`: `autoRelease` thay TODO stub → gate `SCHEDULER_ENABLED && SCHEDULER_AUTO_RELEASE_ENABLED`, gọi `autoReleaseBatch()`, log `released/skipped`; không throw ra cron. `checkNoShow`: sau `detect()` → `reconcilePresence()` → `warnBatch()` (OQ-4), log số liệu.
- **AC**: batch chọn đúng case warning_sent quá deadline → release; case có presence → KHÔNG (đã resolved ở reconcile); cron gate OFF → no-op + log enabled-state.

## T4b — auto-release + scheduler test — FR-NSL-33-05, ARCH-02
- 1 case lỗi (release throw) không chặn case còn lại; gate OFF → service không gọi; thứ tự checkNoShow detect→reconcile→warn.
- **AC**: batch resilience + gating xanh.

## T5 — #33b manual release endpoint (code) — FR-NSL-33b-01..05, OQ-6, R3
- `release-no-show.dto.ts`: `{ reason: string }` `@IsString @IsNotEmpty @MaxLength`.
- `no-show.controller.ts` thêm `POST no-show-cases/:id/release` (`JwtAuthGuard + MockPermissionsGuard + @Permissions('room.noshow.release')`, ValidationPipe per-route): load case → 404 nếu không có; `dismissed|resolved` → 400 `INVALID_NO_SHOW_TRANSITION`; `released` → 200 no-op; else `release({mode:'manual',actor:adminId,reason})`; envelope `{success,message,data}`.
- **AC**: admin release `warning_sent` → 200 + §4 mutate + audit logAction gọi; release lại → 200 no-op; case `dismissed` → 400; non-admin guard → 401/403.

## T5b — manual release controller test — OQ-6, SEC-02
- 404 / 400 (dismissed) / 200 no-op (released) / 200 success (warning_sent); audit metadata không secret.
- **AC**: 4 nhánh mã trả + audit xanh.

## T6 — Wiring + env (code) — plan §5
- `rooms.module.ts`: import `NotificationsModule` + `AdministrationModule`; providers `NoShowLifecycleService` + `NoShowConfigService`; controllers thêm `NoShowConfigController`; export `NoShowLifecycleService`.
- `no-show-config.controller.ts` (NET-NEW): `GET no-show-config` + `PUT no-show-config` (`@Permissions('room.noshow.configure')`, admin-gated R4, ValidationPipe per-route, envelope thủ công).
- `update-no-show-config.dto.ts`: 3 field optional, int bound (whitelist tại DTO → key tùy ý bị `forbidNonWhitelisted`/không map).
- `env.validation.ts`: **CHỈ thêm** 3 dòng Joi scoped (plan §5). `.env.example`: 3 key.
- **AC**: app khởi động (build) resolve DI; `PUT no-show-config {warningGraceMinutes:2}` → 200 + system_configs cập nhật; `GET` admin trả 3 value+source; field ngoài whitelist → 400.

## T7 — Config controller test — FR-NSL-35-04, R4
- GET admin trả 3 key; PUT validate + audit; non-admin → 401/403; body key lạ → 400.
- **AC**: GET/PUT + guard + whitelist xanh.

## T8 — Gom coverage các file mới
- Chạy jest coverage cho `no-show-lifecycle.service.ts` + `no-show-config.service.ts` (+ controller) → **≥80% branch**; bổ sung test nhánh thiếu (rollback/skip/precedence) nếu hụt.
- **AC**: branch ≥80% 2 service file mới.

## T-GATE — (STOP, KHÔNG commit) — plan §7
- `npm run build`=0; `npx eslint` file đụng + spec, chứng minh baseline HEAD (stash) **0 lỗi rule mới**; `npx jest` spec mới + regression `src/modules/rooms src/modules/scheduler src/modules/notifications` xanh; branch ≥80% file mới; live read-only checklist §6 dán kết quả.
- **Owed live-runbook** (ghi follow-up, KHÔNG chạy trong gate mock): cron warn→deadline→auto-release booking thật `released` + room_event; manual release endpoint; PUT config đổi grace ảnh hưởng warn/release.
- **AC**: tất cả mục gate xanh + báo cáo: ticket nào xong, release dùng chung guard rows-affected hoạt động, permission strings, cách persist system_configs (version_no upsert), coverage, live checklist. STOP.

## Map task → FR
- T1/T1b/T6/T7 → FR-NSL-35-01..05 (#35)
- T2/T2b → FR-NSL-32-01..05 (#32) + R1 reconcile
- T3/T3b → §4 mutate (FR-NSL-33-03, FR-NSL-33b-03) + R2
- T4/T4b → FR-NSL-33-01..06 (#33)
- T5/T5b → FR-NSL-33b-01..05 (#33b) + OQ-6
