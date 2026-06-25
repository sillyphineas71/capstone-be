# NSL-001 — No-show lifecycle: cảnh báo → giải phóng + cấu hình ngưỡng

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-20 | Tạo spec NSL-001 (#32/#33/#33b/#35): warn → auto-release → manual release + threshold config. RECON code thật, no-migration. Còn OPEN QUESTIONS chờ chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa plan/tasks/code. 4 UC Group B, KHÔNG IVSS. Early-vacancy (#34/UC-46/48) KHÔNG thuộc feature này.

---

## 0. RECON findings (đã đọc code thật)

### 0.1. "Giải phóng phòng" — enum & cột mutate
- **`room_bookings.status`** = `RoomBookingStatus`: `pending|approved|active|completed|cancelled|**released**` → đã có giá trị `released` ([room-booking.entity.ts:21-28](../../../../src/modules/rooms/entities/room-booking.entity.ts)). Cột phụ: `cancellation_reason` (text).
- **`room_booking_usages`** ([room-booking-usage.entity.ts](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts)): `usage_status` = `RoomUsageStatus` (`not_started|in_use|completed|no_show|early_empty|**released**`), `auto_released`(bool default false), `released_by`(uuid null), `released_at`(tstz null), `release_reason`(text null), `first_presence_at`/`last_presence_at`, `metadata_json`.
- **`rooms.current_status`** = `RoomStatus` tồn tại ([room.entity.ts:59-66](../../../../src/modules/rooms/entities/room.entity.ts)) — **realtime occupancy, do presence/occupancy sở hữu** (ARCH-01). NSL-001 **KHÔNG** mutate cột này (xem OQ-2).
- **`room_events`** ([room-event.entity.ts](../../../../src/modules/rooms/entities/room-event.entity.ts)): `event_type`(varchar60), `event_time`, `old_status`/`new_status`, `actor_user_id`, `booking_id`/`meeting_id`/`room_id`, `reason`(text), `metadata_json` → ghi vết release.
- ⇒ Release mutate **booking + usage + no_show_case (+ room_event)**, KHÔNG đụng `rooms` và KHÔNG hủy `meetings` (owner khác). Vẫn đụng `room_bookings` do người khác sở hữu → xem **OQ-1**.

### 0.2. Người nhận cảnh báo
- **`meetings.organizer_id`** (NOT NULL) + **`host_id`** (nullable) ([meeting.entity.ts:64-68](../../../../src/modules/meetings/entities/meeting.entity.ts)); booking có `booked_by`.
- **`NotificationsService`** ([notifications.service.ts:16-36,69,101](../../../../src/modules/notifications/notifications.service.ts)):
  - `createNotification(dto)` — dto: `{ notificationType, channel, subject?, content, recipientScope?, recipientUserIds?, payloadJson?, relatedEntityType?, relatedEntityId?, priority?, createdBy? }`.
  - `enqueueEmailNotification(dto)` — extends trên + **`toEmails: string[]`** (bắt buộc).
- **`NotificationType.NO_SHOW_ALERT = 'no_show_alert'`** đã có ([notification.entity.ts:15](../../../../src/modules/notifications/entities/notification.entity.ts)) → dùng cho warn. Channel: `IN_APP` / `EMAIL`.
- Email cần **địa chỉ** → phải resolve `users.email` từ user ids (query thêm). Xem OQ-3 recipients.
- **`WebsocketService.emitToRoom(room, event, data)`** — `NoShowService.create` đã emit `meeting.noshow.alert` ([no-show.service.ts:82-92](../../../../src/modules/rooms/services/no-show.service.ts)).

### 0.3. `room_booking_usages` cập nhật gì khi release
Set: `usage_status='released'`, `auto_released=true` (auto) / `false` (manual), `released_by=<actor|null>`, `released_at=now()`, `release_reason=<lý do>`. (Cột presence giữ nguyên để truy vết.)

### 0.4. detection_status đang dùng thực tế (tránh state lạc)
`NoShowDetectionStatus = risk|confirmed|warning_sent|released|dismissed|resolved` (CHỮ THƯỜNG). `NoShowResolutionStatus = released|kept|false_positive|manual_override` ([no-show-case.entity.ts:13-27](../../../../src/modules/rooms/entities/no-show-case.entity.ts)). Trong code:
- `detect()` chỉ tạo `risk` (signal: `room_booking_usages.first_presence_at IS NULL` + booking `IN ('approved','active')` + quá `reserved_start_time + threshold`) ([no-show-detection.service.ts:32-66](../../../../src/modules/rooms/services/no-show-detection.service.ts)).
- `NoShowService.update`: `SYSTEM_OWNED = ['warning_sent','released']` (user KHÔNG set được), `ALLOWED_UPDATE_TARGETS = ['confirmed','dismissed','resolved']`, `TERMINAL = ['resolved','dismissed','released']` (không re-open) ([no-show.service.ts:36-38](../../../../src/modules/rooms/services/no-show.service.ts)).
- Ngưỡng: precedence `system_configs[no_show.threshold_minutes] → env NO_SHOW_THRESHOLD_MINUTES → default 15`. **`system_configs`** cột: `config_key(120)`, `config_value(text)`, `config_json`, `value_type`, **`config_group(80, NOT NULL)`**, `version_no`, `is_active`, `updated_by`, `updated_at` ([system-config.entity.ts](../../../../src/modules/administration/entities/system-config.entity.ts)).

### 0.5. Hạ tầng sẵn có
- **Cron** ([scheduler.service.ts](../../../../src/modules/scheduler/scheduler.service.ts)): `checkNoShow` (EVERY_5_MIN, gate `SCHEDULER_ENABLED && SCHEDULER_NO_SHOW_CHECK_ENABLED` default OFF, đã gọi `detect()`); `autoRelease` (EVERY_5_MIN, gate `SCHEDULER_ENABLED && SCHEDULER_AUTO_RELEASE_ENABLED` default OFF, **hiện TODO stub**). Cả 2 try/catch không ném ra ngoài (ARCH-02).
- **AuditLogsService** ([audit-logs.service.ts](../../../../src/modules/administration/services/audit-logs.service.ts)): `logAction({ userId, actionType, entityType, entityId, severity?, metadataJson? })`, fail-safe, gate `AUDIT_LOG_ENABLED`. Rooms module hiện **chưa** dùng audit.
- **Controller no-show** = `@Controller()` (root), routes `internal/no-show-cases` (InternalTokenGuard) + `no-show-cases/:id` (JwtAuthGuard + MockPermissionsGuard + `@Permissions(...)`), envelope thủ công `{success,message,data}`, `ValidationPipe` **per-route** ([no-show.controller.ts](../../../../src/modules/rooms/controllers/no-show.controller.ts)).
- ⚠ **Admin system-configs controller CHƯA tồn tại** → #35 endpoint là net-new.

### 0.6. No-migration
Tất cả cột cần đã có (0.1–0.4). **Khẳng định KHÔNG migration.** Nếu khi code phát hiện thiếu cột → **DỪNG, báo Thiếu Chủ**, không tự thêm migration.

---

## 1. State machine (sẽ hiện thực)

```
                 detect() (#31, đã có)
   [none] ────────────────────────────────►  risk
                                               │
        (#32 warn cron: grace qua + vẫn no presence)
                                               ▼
                                          warning_sent ──┐
                                               │         │
   (#33 auto-release: quá deadline + no presence)        │ (presence tới muộn bất kỳ lúc nào)
                                               ▼         ▼
                                           released   resolved (false_positive)
   (#33b admin manual release: từ risk|warning_sent) ──► released
   (admin dismiss: từ risk|warning_sent, UC-42 sẵn có) ─► dismissed
```

| Transition | Điều kiện | Cột set |
| :--- | :--- | :--- |
| `risk → warning_sent` (#32) | `detection_status='risk'` AND `now ≥ detected_at + warning_grace` AND booking usage `first_presence_at IS NULL` AND booking `IN ('approved','active')` | `warning_sent_at=now`, `warning_deadline_at = now + auto_release_grace`, `auto_release_eligible_at = warning_deadline_at`, `detection_status='warning_sent'` |
| `warning_sent → released` (#33) | `detection_status='warning_sent'` AND `now ≥ auto_release_eligible_at` AND `first_presence_at IS NULL` | (xem §4 mutate) `detection_status='released'`, `resolution_status='released'`, `released_at=now`, `resolved_by=NULL` |
| `(risk|warning_sent) → released` (#33b manual) | admin gọi endpoint | `detection_status='released'`, `resolution_status='manual_override'`, `resolved_by=<admin>`, `released_at=now` |
| `(risk|warning_sent) → resolved` (presence muộn) | booking usage `first_presence_at IS NOT NULL` (occupant đã tới) | `detection_status='resolved'`, `resolution_status='false_positive'`, `resolved_by=NULL`, `note` |
| `(risk|warning_sent) → dismissed` | admin (UC-42 `update` sẵn có) | `detection_status='dismissed'` |

**Terminal** = `released|dismissed|resolved` (không re-open — đã enforce ở `NoShowService.update`).

---

## 2. #32 / UC-43 — Cảnh báo trước khi release

- **FR-NSL-32-01**: trong **cron warn** (xem OQ-4: gộp vào `checkNoShow` hay cron mới), chọn case `detection_status='risk'`, join booking usage còn `first_presence_at IS NULL`, booking `IN ('approved','active')`, và `now ≥ detected_at + warning_grace_minutes`.
- **FR-NSL-32-02**: set `warning_sent_at`, `warning_deadline_at`, `auto_release_eligible_at`, `detection_status='warning_sent'` (1 UPDATE, SEC-03 bind).
- **FR-NSL-32-03**: gửi **in-app** `createNotification({ notificationType: NO_SHOW_ALERT, channel: IN_APP, recipientUserIds: <organizer + host>, relatedEntityType:'no_show_case', relatedEntityId:<id>, payloadJson: metadata-only })` + **email** `enqueueEmailNotification` **gated** `NO_SHOW_ALERT_EMAIL_ENABLED` (default false), `toEmails=<resolve users.email>`. Best-effort (lỗi notify KHÔNG fail transition; ghi log).
- **FR-NSL-32-04 (idempotent)**: đã `warning_sent` (hoặc terminal) → bỏ qua, KHÔNG gửi lại. Dùng điều kiện `detection_status='risk'` trong WHERE của UPDATE → race-safe (chỉ 1 lần chuyển).
- **FR-NSL-32-05**: cron không ném ra ngoài; 1 case lỗi không chặn batch (try/catch mỗi case).

**AC**: risk đủ grace + no presence → warning_sent + notify 1 lần; chạy lại → no-op; presence đã có → KHÔNG warn (rẽ resolved, §1).

## 3. #33 / UC-44 — Auto-release sau no-show

- **FR-NSL-33-01**: trong **cron `autoRelease`** (thay TODO stub), gate `SCHEDULER_ENABLED && SCHEDULER_AUTO_RELEASE_ENABLED` (default OFF), log enabled-state.
- **FR-NSL-33-02 (tiêu chí)**: case `detection_status='warning_sent'` AND `now ≥ auto_release_eligible_at` AND booking usage `first_presence_at IS NULL` AND booking vẫn `IN ('approved','active')`.
- **FR-NSL-33-03 (mutate — §4, trong TRANSACTION)**: cập nhật no_show_case + room_booking_usage + room_booking + ghi room_event. `auto_released=true`, `resolved_by=NULL`, `resolution_status='released'`.
- **FR-NSL-33-04**: notify organizer/host (in-app + email gated) `no_show_alert` nội dung "phòng đã tự động giải phóng".
- **FR-NSL-33-05 (idempotent + an toàn batch)**: WHERE chứa `detection_status='warning_sent'` (chỉ release 1 lần); mỗi case bọc try/catch — 1 case lỗi rollback case đó, KHÔNG chặn batch; cron không ném ra ngoài (ARCH-02).
- **FR-NSL-33-06**: trước khi release, nếu `first_presence_at IS NOT NULL` → KHÔNG release, chuyển `resolved/false_positive` (§1).

**AC**: warning_sent quá deadline + no presence → booking.status='released' + usage released + case released + room_event + notify; chạy lại → no-op; presence tới sau warn → resolved (không release).

## 4. Mutate chính xác khi release (#33 auto + #33b manual)

Trong **1 transaction** (ARCH cập nhật nhiều bảng):
1. **`no_show_cases`**: `detection_status='released'`, `resolution_status=<'released'|'manual_override'>`, `released_at=now()`, `resolved_by=<NULL|admin>`, `note=COALESCE(...)`. (WHERE guard theo trạng thái nguồn để idempotent.)
2. **`room_booking_usages`**: `usage_status='released'`, `auto_released=<true|false>`, `released_by=<NULL|admin>`, `released_at=now()`, `release_reason=<reason>`. (Nếu chưa có row usage cho booking → tạo? **OQ-5**.)
3. **`room_bookings`**: `status='released'`, `cancellation_reason=<reason>` — ⚠ **OQ-1** (đụng booking owner khác).
4. **`room_events`**: insert `event_type='room_auto_released'|'room_manual_released'`, `actor_user_id=<NULL|admin>`, `booking_id/meeting_id/room_id`, `reason`, `metadata_json={ noShowCaseId }`.
5. **KHÔNG** mutate `rooms.current_status` (OQ-2) và **KHÔNG** hủy `meetings`.

## 5. #33b / UC-45 — Manual release (admin)

- **FR-NSL-33b-01**: `POST no-show-cases/:id/release`, body `{ reason: string }` (required, validate non-empty). Guard `JwtAuthGuard + MockPermissionsGuard + @Permissions('room.noshow.release')` (mirror controller hiện có, SEC-02). `ValidationPipe` per-route.
- **FR-NSL-33b-02**: case không tồn tại → 404 `NO_SHOW_CASE_NOT_FOUND`. Nguồn hợp lệ = `risk|warning_sent`; đã `released` → **idempotent 200** (no-op); `dismissed|resolved` → 400 `INVALID_NO_SHOW_TRANSITION` (không release case đã terminal khác). (**OQ-6** xác nhận hành vi idempotent vs 409.)
- **FR-NSL-33b-03**: mutate §4 với `resolution_status='manual_override'`, `resolved_by=<admin>`, `auto_released=false`.
- **FR-NSL-33b-04**: **audit** `AuditLogsService.logAction({ userId:<admin>, actionType:'no_show_manual_release', entityType:'no_show_case', entityId:<id>, severity: WARNING, metadataJson:{ bookingId, roomId, reason } })` — SEC-01 không lộ secret.
- **FR-NSL-33b-05**: notify organizer/host (in-app + email gated). Envelope `{success,message,data}`.

**AC**: admin release risk/warning_sent → §4 mutate + audit + notify 200; release lại → 200 no-op; release case dismissed → 400; non-admin → 401/403.

## 6. #35 / UC-47 — Cấu hình ngưỡng (admin ghi)

- **FR-NSL-35-01 (whitelist SEC)**: chỉ cho ghi đúng **3 key**: `no_show.threshold_minutes`, `no_show.warning_grace_minutes`, `no_show.auto_release_grace_minutes`. Key ngoài whitelist → 400 `INVALID_CONFIG_KEY` (KHÔNG cho ghi key tùy ý → chặn injection cấu hình).
- **FR-NSL-35-02 (validate)**: value là **số nguyên dương** (`threshold_minutes ≥ 1`, `auto_release_grace_minutes ≥ 1`, `warning_grace_minutes ≥ 0`). Sai → 400.
- **FR-NSL-35-03 (ghi)**: upsert `system_configs` theo `config_key`: `config_value=<string số>`, `value_type='number'`, `config_group='no_show'`, `is_active=true`, `updated_by=<admin>`, `version_no = version_no + 1` (nếu update). Dùng `getRepository(SystemConfigEntity)` (mirror meetings.service) — TypeORM, không raw.
- **FR-NSL-35-04 (API)**: `GET no-show-config` (đọc 3 key hiệu lực + nguồn) + `PUT no-show-config` (body `{ thresholdMinutes?, warningGraceMinutes?, autoReleaseGraceMinutes? }`, set các field gửi lên). Guard admin (SEC-02) + audit `actionType:'no_show_config_update'`.
- **FR-NSL-35-05 (precedence đọc)**: mọi nơi đọc ngưỡng theo **`system_configs[key] → env → default`** (mirror `readThreshold`). GET trả cả `value` + `source`.
- **OQ-7**: host endpoint ở **rooms** (cohesive no-show) hay **administration** (generic system-configs)? Đề xuất rooms (`NoShowConfigController`).

## 7. Config keys (định nghĩa)

| Key (system_configs) | Env fallback | Default | Đơn vị | Ý nghĩa |
| :--- | :--- | :--- | :--- | :--- |
| `no_show.threshold_minutes` | `NO_SHOW_THRESHOLD_MINUTES` | 15 | phút | (đã có) sau `reserved_start + threshold` & no presence → tạo `risk`. |
| `no_show.warning_grace_minutes` | `NO_SHOW_WARNING_GRACE_MINUTES` (**MỚI**) | 0 | phút | sau `detected_at + grace` & no presence → gửi cảnh báo (`warning_sent`). |
| `no_show.auto_release_grace_minutes` | `NO_SHOW_AUTO_RELEASE_GRACE_MINUTES` (**MỚI**) | 5 | phút | sau `warning_sent_at + grace` (= `warning_deadline_at`/`auto_release_eligible_at`) & no presence → auto-release. |

Env gating thêm (**MỚI**): `NO_SHOW_ALERT_EMAIL_ENABLED` (bool, default false) — bật kênh email cho warn/release. (Cron đã có `SCHEDULER_AUTO_RELEASE_ENABLED`.)

## 8. Chiến lược test bằng event giả (không cần phần cứng)

- **Dựng nhánh bằng dữ liệu**: chỉnh `room_bookings.reserved_start_time` về quá khứ + booking status `approved/active`; điều khiển presence qua `room_booking_usages.first_presence_at` (NULL = no-show; set timestamp = đã hiện diện). Chỉnh `system_configs`/env grace để ép thời điểm.
- **#32 warn**: booking quá `threshold`, usage `first_presence_at=NULL`, đã có case `risk` với `detected_at` đủ `warning_grace` → gọi service warn → assert `warning_sent` + cột deadline + notify mock gọi 1 lần; gọi lại → no-op.
- **#33 auto-release**: case `warning_sent`, `auto_release_eligible_at < now`, `first_presence_at=NULL` → gọi service → assert booking/usage/case mutate (§4) + room_event + notify; idempotent lần 2; thêm case có `first_presence_at` → rẽ `resolved/false_positive` (không release).
- **#33b manual**: mock admin → assert §4 + audit `logAction` gọi + envelope; release lại → 200 no-op; case dismissed → 400.
- **#35 config**: PUT key whitelist → upsert system_configs (value_type/group/updated_by); key lạ → 400; value ≤ 0 → 400; GET trả value+source.
- Mock `NotificationsService`, `WebsocketService`, `AuditLogsService`; `dataSource.manager.query` theo SQL chứa từ khóa (mirror các spec hiện có). Cron test: gọi service trực tiếp, không phụ thuộc `@Cron`.

## 9. Constitution mapping
- **SEC-01**: notify/audit/log **metadata-only**, không token/secret; `payloadJson` không chứa PII nhạy cảm thừa.
- **SEC-02**: manual-release + config PUT/GET là admin-only (JwtAuthGuard + PermissionsGuard).
- **SEC-03**: mọi raw SQL bind tham số ($1…); whitelist key #35 chặn ghi tùy ý.
- **DATA-01**: dùng cột sẵn có, **no-migration**; không soft-delete mới.
- **ARCH-01**: warn/release/threshold thuộc **rooms (no-show domain)**; gọi `NotificationsService`/`WebsocketService`/`AuditLogsService` qua boundary; **KHÔNG** mutate `rooms.current_status` (presence/occupancy sở hữu) và **KHÔNG** hủy `meetings`.
- **ARCH-02**: cron warn/auto-release **gated env default OFF**, try/catch mỗi case, **không throw ra cron**, log enabled-state + số liệu.
- Envelope thủ công `{success,message,data}`; `ValidationPipe` per-route (KHÔNG global).

## 10. OPEN QUESTIONS (chốt trước khi plan/tasks)
- **OQ-1** (quan trọng): auto/manual release có **flip `room_bookings.status='released'`** không? Enum có sẵn `released` (free slot cho scheduling) nhưng đụng booking owner khác. Đề xuất **CÓ** + ghi `cancellation_reason` + `room_event`. Xác nhận?
- **OQ-2**: có cập nhật `rooms.current_status` khi release? Đề xuất **KHÔNG** (presence sở hữu). Xác nhận?
- **OQ-3 (recipients)**: cảnh báo gửi cho ai — `organizer_id` + `host_id`? thêm `booking.booked_by`? (đề xuất organizer + host).
- **OQ-4**: cron warn — **gộp vào `checkNoShow`** (detect rồi warn trong cùng tick) hay **cron riêng**? (đề xuất gộp: detect → warn → reconcile-presence trong `checkNoShow`; auto-release ở cron `autoRelease`).
- **OQ-5**: nếu booking **chưa có** row `room_booking_usages` lúc release thì sao — tạo mới row `released` hay chỉ mutate case+booking? (đề xuất: chỉ mutate nếu tồn tại; bỏ qua usage nếu thiếu, ghi note).
- **OQ-6**: manual release case đã `released` → **idempotent 200** hay **409**? (đề xuất 200 no-op).
- **OQ-7**: host #35 endpoint ở **rooms** hay **administration**? (đề xuất rooms `NoShowConfigController`).
- **OQ-8**: `resolution_status` cho nhánh presence-muộn — **`false_positive`** (đề xuất) hay `kept`?

## 11. Residuals / known-gaps
- Early-vacancy (#34/UC-46/48) ngoài phạm vi — feature sau.
- Booking bị release nhưng **meeting vẫn active** → meeting "mất phòng"; re-book/handle ngoài phạm vi (note).
- Cron in-instance: nhiều instance chạy song song có thể double-process; idempotent-WHERE giảm rủi ro nhưng chưa có distributed lock (giống các cron hiện tại).
- Email cần resolve `users.email` từ ids (query phụ); nếu user không có email → chỉ in-app.
- `warning_deadline_at` và `auto_release_eligible_at` đặt trùng giá trị ở v1 (giữ đơn giản); tách nếu sau cần 2 mốc khác nhau.

> **STOP.** Spec-only. Chờ Thiếu Chủ review + chốt OQ-1…OQ-8 trước khi viết plan/tasks.
