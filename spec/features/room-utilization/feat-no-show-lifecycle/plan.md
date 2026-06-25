# NSL-001 — plan.md (No-show lifecycle: warn → release + config)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-20 | Tạo plan NSL-001 sau khi spec DUYỆT (8 OQ chốt). Ticket breakdown #35→#32+R1→§4→#33→#33b; file list; release dùng chung + guard rows-affected; wiring; gate. No-migration. | Toàn bộ |

> Spec đã duyệt: [spec.md](./spec.md). Plan này **không mở lại OQ**. R1–R4 + OQ-1…OQ-8 là quyết định cuối.

## 0. Quyết định đã chốt (tham chiếu nhanh)
- **OQ-1** flip `room_bookings.status='released'` + `cancellation_reason` + `room_event`; **guard** `UPDATE … WHERE id=$1 AND status IN ('approved','active')`, 0 row → **abort transaction, skip case**. KHÔNG đụng `meetings`.
- **OQ-2** KHÔNG mutate `rooms.current_status`.
- **OQ-3** recipients = `organizer_id` + `host_id`, dedupe + bỏ null. KHÔNG `booked_by`.
- **OQ-4** gộp vào `checkNoShow`: **detect → reconcile-presence → warn**; `detect()` commit trước khi warn re-query. Auto-release ở cron `autoRelease` riêng.
- **OQ-5** usage = **mutate-if-exists**; thiếu row → bỏ qua phần usage, ghi outcome ở case + room_event + note. KHÔNG INSERT usage mới (v1).
- **OQ-6** manual release case đã `released` → **200 no-op**; `dismissed|resolved` → **400 INVALID_NO_SHOW_TRANSITION**.
- **OQ-7** endpoint #35 ở **rooms** (`NoShowConfigController`).
- **OQ-8** nhánh presence-muộn → `resolution_status='kept'`.
- **R1** reconcile-presence là FR + task + test RIÊNG, chạy **trước** warn.
- **R2** hàm release dùng chung (auto+manual), 1 transaction, **guard rows-affected** ở cả case UPDATE và booking UPDATE → 0 row thì abort/skip (chống double-release giữa tick/instance).
- **R3** permission: `room.noshow.release` (manual) + `room.noshow.configure` (GET/PUT config) — vẫn MockPermissionsGuard pattern.
- **R4** GET no-show-config admin-gated (không public).

## 1. Ticket breakdown (thứ tự + lý do phụ thuộc)

| # | Ticket | Lý do thứ tự |
| :-- | :--- | :--- |
| 1 | **#35 config** (`NoShowConfigService` + `NoShowConfigController`) | Cung cấp `warning_grace`/`auto_release_grace` mà warn/release đọc → làm trước để các bước sau đọc ngưỡng nhất quán (precedence system_configs→env→default). |
| 2 | **#32 warn + R1 reconcile** (`NoShowLifecycleService.reconcilePresence()` + `.warnBatch()`) | Cần grace từ #1. Reconcile phải đứng trước warn trong `checkNoShow` (OQ-4). |
| 3 | **§4 release dùng chung** (`NoShowLifecycleService.release()`) | Lõi mutate; auto (#33) và manual (#33b) đều gọi. Làm trước 2 ticket tiêu thụ nó. |
| 4 | **#33 auto-release cron** (`NoShowLifecycleService.autoReleaseBatch()` + wire `scheduler.autoRelease`) | Tiêu thụ §4; chỉ chọn case `warning_sent` quá deadline. |
| 5 | **#33b manual release endpoint** (`POST no-show-cases/:id/release`) | Tiêu thụ §4 + audit + guard admin. Độc lập cron, làm cuối. |

## 2. File list (net-new vs modified)

### Net-new
- `src/modules/rooms/services/no-show-config.service.ts` — get/update 3 key (whitelist, validate, upsert `system_configs`).
- `src/modules/rooms/services/no-show-config.service.spec.ts`
- `src/modules/rooms/controllers/no-show-config.controller.ts` — **NET-NEW** `GET/PUT no-show-config`, admin-gated (R4).
- `src/modules/rooms/controllers/no-show-config.controller.spec.ts`
- `src/modules/rooms/services/no-show-lifecycle.service.ts` — `reconcilePresence()`, `warnBatch()`, `release()`, `autoReleaseBatch()`.
- `src/modules/rooms/services/no-show-lifecycle.service.spec.ts`
- `src/modules/rooms/dto/release-no-show.dto.ts` — `{ reason: string }` (required, non-empty).
- `src/modules/rooms/dto/update-no-show-config.dto.ts` — `{ thresholdMinutes?, warningGraceMinutes?, autoReleaseGraceMinutes? }` (int, bound).

### Modified
- `src/modules/rooms/controllers/no-show.controller.ts` — thêm `POST no-show-cases/:id/release` (guard `room.noshow.release`).
- `src/modules/rooms/rooms.module.ts` — import `NotificationsModule` + `AdministrationModule`; providers `NoShowLifecycleService`, `NoShowConfigService`; controller `NoShowConfigController`; **export `NoShowLifecycleService`** (scheduler dùng).
- `src/modules/scheduler/scheduler.service.ts` — `checkNoShow`: sau `detect()` (đã commit) gọi `reconcilePresence()` → `warnBatch()`; `autoRelease`: **thay TODO stub** bằng `autoReleaseBatch()`; inject `NoShowLifecycleService`; log enabled-state + số liệu (ARCH-02).
- `src/config/env.validation.ts` — **CHỈ thêm scoped** 3 dòng Joi (KHÔNG prettier --write cả file).
- `.env.example` — thêm 3 key.

## 3. Hàm release dùng chung (§4) — vị trí + chữ ký + guard

**Vị trí**: `NoShowLifecycleService.release()` (rooms). Inject: `DataSource`, `WebsocketService`, `NotificationsService`, `AuditLogsService` (audit chỉ ghi ở nhánh manual), `NoShowConfigService` (đọc grace cho batch).

**Chữ ký**:
```ts
release(params: {
  caseId: string;
  actor: string | null;          // null = system (auto), uuid = admin (manual)
  reason: string;
  mode: 'auto' | 'manual';
}): Promise<{ released: boolean; skipped?: 'already_released' | 'booking_changed' | 'invalid_transition' }>
```

**Trong 1 transaction (`queryRunner`)** — SEC-03 bind toàn bộ:
1. `UPDATE no_show_cases SET detection_status='released', resolution_status=$x, released_at=now(), resolved_by=$actor, note=COALESCE($reason,note) WHERE id=$caseId AND detection_status IN (<nguồn hợp lệ>)`
   - auto: nguồn hợp lệ = `('warning_sent')`; manual: `('risk','warning_sent')`.
   - **0 row affected → rollback, return `skipped:'already_released'`** (R2 chống double-release).
   - `$x` = auto→`'released'`, manual→`'manual_override'`.
2. Đọc case (booking_id/meeting_id/room_id) — trong cùng txn.
3. `UPDATE room_bookings SET status='released', cancellation_reason=$reason WHERE id=$bookingId AND status IN ('approved','active')`
   - **0 row affected → rollback, return `skipped:'booking_changed'`** (OQ-1 guard, không clobber booking đã đổi).
4. `UPDATE room_booking_usages SET usage_status='released', auto_released=$isAuto, released_by=$actor, released_at=now(), release_reason=$reason WHERE booking_id=$bookingId`
   - mutate-if-exists (0 row OK; ghi note "no usage row" vào case note/room_event metadata) — OQ-5, KHÔNG INSERT.
5. `INSERT INTO room_events (room_id, meeting_id, booking_id, event_type, actor_user_id, reason, metadata_json) VALUES (...)` — `event_type='room_auto_released'|'room_manual_released'`, `metadata_json={ noShowCaseId, usageMutated:boolean }`.
6. commit. **Sau commit**: notify organizer+host (in-app + email gated, best-effort), WS emit best-effort. Manual: `AuditLogsService.logAction(...)` (có thể trước/sau commit; fail-safe).

> Manual controller xử lý OQ-6 mã trả: tồn-tại? → 404; `dismissed|resolved` → 400 trước khi gọi release; `released` → 200 no-op (release trả `already_released`).

## 4. Lifecycle batch (cron) — chữ ký
- `reconcilePresence(): Promise<{ scanned:number; resolved:number }>` — UPDATE non-terminal (`risk|warning_sent`) có `first_presence_at IS NOT NULL` → `detection_status='resolved', resolution_status='kept'` (guard WHERE detection_status IN(...)). **R1**, chạy trước warn.
- `warnBatch(): Promise<{ scanned:number; warned:number }>` — đọc grace 1 lần (NC-2); chọn `risk` + no presence + `now ≥ detected_at + warning_grace`; per-case `UPDATE … WHERE detection_status='risk'` (idempotent) → notify. try/catch mỗi case.
- `autoReleaseBatch(): Promise<{ scanned:number; released:number; skipped:number }>` — chọn `warning_sent` + `now ≥ auto_release_eligible_at` + no presence + booking approved/active; per-case `release({mode:'auto',actor:null,reason})` trong try/catch (ARCH-02, 1 lỗi không chặn batch).

## 5. Wiring
- **RoomsModule**: thêm `imports: [NotificationsModule, AdministrationModule]` (đã verify exports: `NotificationsService`, `AuditLogsService`); `SystemConfigEntity` đọc/ghi qua `dataSource.getRepository(SystemConfigEntity)` (entity ở global data-source, mirror `meetings.service`). Providers + `NoShowConfigController` + export `NoShowLifecycleService`.
- **SchedulerModule**: đã `imports: [RoomsModule]` → inject `NoShowLifecycleService` vào `SchedulerService`.
- **Env mới** (Joi scoped — chỉ thêm dòng, KHÔNG format cả file):
  - `NO_SHOW_WARNING_GRACE_MINUTES: Joi.number().integer().min(0).default(0)`
  - `NO_SHOW_AUTO_RELEASE_GRACE_MINUTES: Joi.number().integer().min(1).default(5)`
  - `NO_SHOW_ALERT_EMAIL_ENABLED: Joi.boolean().default(false)`
  - (đã có: `NO_SHOW_THRESHOLD_MINUTES`, `SCHEDULER_AUTO_RELEASE_ENABLED`, `SCHEDULER_NO_SHOW_CHECK_ENABLED`.)

## 6. Live read-only checklist (xác minh TRƯỚC khi tin mock — không sửa DB)
1. `room_booking_usages` thật có cột `usage_status, auto_released, released_by, released_at, release_reason, first_presence_at` (đối chiếu entity).
2. `room_bookings.status` enum giá trị thật chứa `released` (kiểm distinct hiện có + cột `cancellation_reason`).
3. `system_configs`: `config_group` NOT NULL, `value_type` giá trị hợp lệ (`number`), thử đọc 1 key `no_show.*` xem `version_no` để xác nhận upsert tăng version.
4. `room_events.event_type` varchar(60) đủ chứa `room_auto_released`/`room_manual_released`; cột `reason`, `actor_user_id`, `metadata_json` tồn tại.

## 7. Gate (mock-level, STOP — KHÔNG commit)
- `npm run build` = 0.
- `npx eslint` các file đụng + spec → chứng minh **baseline HEAD** (stash so sánh), **0 lỗi rule mới** (chỉ chấp nhận `any`-family debt nếu mirror pattern sẵn có).
- `npx jest` các spec mới (`no-show-lifecycle`, `no-show-config`, controller) + regression `src/modules/rooms src/modules/scheduler src/modules/notifications`.
- **Branch coverage ≥80%** cho file mới (`no-show-lifecycle.service.ts`, `no-show-config.service.ts`).
- Live read-only checklist §6 chạy + dán kết quả.
- **Owed live-runbook** (KHÔNG chạy trong gate mock, ghi follow-up): dựng booking quá hạn + bật cron → quan sát warn notification → quá deadline → booking thật `released` + room_event; manual release qua endpoint; PUT config đổi grace.

## 8. Kỷ luật
- **No-migration**: chỉ cột sẵn có; thiếu cột → **DỪNG báo Thiếu Chủ**.
- **SEC-01** notify/audit/log metadata-only; **SEC-02** admin guard cho manual-release + config; **SEC-03** bind raw-SQL + whitelist config key; **DATA-01** no-migration; **ARCH-01** boundary rooms↔notifications/presence, KHÔNG mutate `rooms`/`meetings`; **ARCH-02** cron gated default OFF + try/catch mỗi case + không throw ra cron + log enabled-state.
- Envelope thủ công `{success,message,data}`; `ValidationPipe` per-route; KHÔNG global pipe.

> **STOP.** Plan + tasks chờ review trước khi code.
