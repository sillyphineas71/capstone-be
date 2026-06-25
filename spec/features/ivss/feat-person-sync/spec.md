# IPS-001 — IVSS person sync (#37): per-meeting enroll attendee vào IVSS qua bridge

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo spec IPS-001 (#37): enroll attendee per-meeting vào IVSS qua bridge (#36) + lưu mapping + gỡ sau họp. Mirror FMP-001. RECON code thật. OQ chờ chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa plan/tasks/code. Tái dùng bridge IVS-001 (#36, đã commit). KHÔNG enroll thủ công UI; lifecycle = per-meeting bám FMP-001.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. FMP-001 door-terminal provisioning — hook + lifecycle ([face-provisioning.service.ts](../../../../src/modules/face-access/services/face-provisioning.service.ts))
- **Provision trigger**: cron, KHÔNG event. `provisionUpcomingMeetings()` chạy bởi scheduler `faceSync` (EVERY_MINUTE, gate `SCHEDULER_ENABLED && FACE_SYNC_ENABLED` default OFF). Query meetings: `room_id IS NOT NULL AND status IN ('scheduled','in_progress') AND start_time <= now() + (FACE_SYNC_LEAD_MINUTES * interval) AND end_time > now()` ⇒ **pre-provision ~lead phút TRƯỚC giờ bắt đầu** (default lead=5). (KHÔNG provision lúc booking-approved/meeting-create.)
- **Attendee source**: `SELECT user_id FROM meeting_participants WHERE meeting_id=$1` ([:96-100](../../../../src/modules/face-access/services/face-provisioning.service.ts)).
- **Ảnh chân dung**: `FaceProfileService.getPortraitBytes(userId)` → `Buffer | null`. Nguồn: `face_profiles.primary_image_file_id` → `media_files (storage_key, storage_provider)` (chỉ `local`) → `storageService.getFile(storage_key)` ([face-profile.service.ts:125-138](../../../../src/modules/accounts/services/face-profile.service.ts)). **Thiếu portrait → null → skip enroll + log** (FMP [:160-166]).
- **Mapping storage**: `device_user_mappings` — `upsertMapping(...)`; key idempotent per `(device_id, user_id)` (partial-unique `WHERE deleted_at IS NULL`), `bookingId` lưu ở `metadata_json`. Lưu `device_person_id` (uid cam trả), `sync_status` ('synced'/'failed'/'pending'), `last_sync_error`, soft-delete `deleted_at`.
- **uname** đẩy lên cam = `sha256(userId:meetingId).slice(0,32)` (deterministic, dưới giới hạn field) ([:54-59]).
- **Idempotency**: slot-check `(device,user)` còn sống TRƯỚC upload; cùng booking + `synced` → noop; booking KHÁC đang sống → **defer/skip** (1 mapping sống / device+user).
- **Cleanup trigger**: cron, mapping-driven. `deprovisionEndedMeetings()` (cùng faceSync cron): gỡ MỌI mapping còn sống mà họp đã kết thúc ≥ `FACE_SYNC_GRACE_MINUTES` (JOIN qua `metadata.bookingId`). `reconcile()` dọn stale/dedup.

### 0.2. Nguồn ảnh (tái dùng cho IVSS)
`FaceProfileService.getPortraitBytes(userId): Promise<Buffer|null>` (đã có, ở accounts module). Bridge `enrollFace` cần **`imageBase64`** ⇒ IPS-001 convert `Buffer.toString('base64')`. KHÔNG bắt user upload lại (đúng nguồn door terminal).

### 0.3. Mapping storage — ⚠ ràng buộc quyết định OQ-1
`device_user_mappings`: `device_id` **NOT NULL + FK → iot_devices(id) ON DELETE CASCADE**; `user_id` FK users; `device_person_id` (varchar null) = nơi lưu **szUid IVSS**; `sync_status`, `last_sync_error`, `metadata_json` (bookingId/groupId), `deleted_at` (soft delete), partial-unique `(device_id,user_id) WHERE deleted_at IS NULL`.
- ⇒ Tái dùng `device_user_mappings` cho IVSS **đòi 1 `iot_devices` row đại diện bridge** (device_id FK). Đó là **seed 1 row dữ liệu, KHÔNG phải migration**. (Bảng `ivss_face_enrollments` **KHÔNG tồn tại** → tạo = migration → ngoài #37.)
- Hệ quả uniqueness: 1 mapping sống / `(bridge_device, user)` ⇒ mô hình tự nhiên = **enroll user 1 lần vào group** (không phải mỗi meeting 1 szUid); gỡ khi user hết họp active. (Xem OQ-6.)

### 0.4. Attendee + group
- Attendee: `meeting_participants.user_id` (như FMP).
- Group: `IVSS_DEFAULT_GROUP` (env, #36 đã có) — group enroll vào. Bridge `createGroup` / `enrollFace(groupId, personUid, imageBase64)` / `deleteFace(groupId, personUid)`; `enrollFace` trả `IvssFaceRef` (chứa szUid IVSS trả — lưu lại để gỡ).

### 0.5. No-migration
#37 **KHÔNG migration**. Nếu OQ-1 chốt cần bảng mới `ivss_face_enrollments` → **DỪNG báo Thiếu Chủ** (ticket có migration). Seed 1 `iot_devices` row cho bridge KHÔNG phải migration nhưng cần xác nhận (OQ-1).

---

## 1. Scope #37
1. **IvssPersonSyncService** (module `ivss`): enroll attendee per-meeting vào IVSS group qua `IVSS_BRIDGE` (IvssBridgePort) + lưu mapping (szUid ↔ user ↔ meeting/group) + gỡ (`deleteFace`) sau họp.
2. **Lifecycle hook** bám FMP-001: provision (pre-meeting) + cleanup (post-meeting) — qua cron (OQ-3/4), gated default OFF.
3. Convert portrait `Buffer → base64`; thiếu ảnh → skip + log (OQ-7).
4. Degrade khi bridge-down (`IvssResult.ok:false`) → log + đánh dấu, KHÔNG fail họp/booking (OQ-5).

KHÔNG thuộc #37: map event → presence/attendance (#38–40); enroll thủ công UI.

## 2. IvssPersonSyncService (đề xuất)
- Inject: `@Inject(IVSS_BRIDGE) IvssBridgePort`, `FaceProfileService` (portrait), `DataSource` (mapping + participants), `ConfigService` (`IVSS_DEFAULT_GROUP`).
- `provisionUpcoming()`: query meetings sắp diễn ra (mirror FMP window: status scheduled/in_progress, lead phút trước start) → mỗi meeting → participants → `enrollAttendee`.
- `enrollAttendee(meeting, userId)`:
  1. **Dedupe** (OQ-6): nếu đã có mapping sống (synced) cho user trong group → noop.
  2. `getPortraitBytes(userId)` → null → **skip + log** (OQ-7), KHÔNG fail.
  3. `bridge.enrollFace({ groupId: IVSS_DEFAULT_GROUP, personUid: <stable id>, name?, imageBase64 })`.
  4. `IvssResult.ok:false` → **log + upsert mapping `sync_status='failed'` + last_sync_error** (OQ-5), KHÔNG throw, KHÔNG fail provisioning.
  5. `ok:true` → lưu szUid (`device_person_id`) + `sync_status='synced'` + metadata (bookingId, groupId).
- `cleanupEnded()`: mapping-driven (mirror `deprovisionEndedMeetings`): mapping sống mà họp kết thúc ≥ grace → `bridge.deleteFace({groupId, personUid/szUid})` → ok → soft-delete mapping; fail → log + giữ để retry.
- **Per-item try/catch** (1 attendee/meeting lỗi KHÔNG chặn batch). Bridge timeout đã lo bởi client (no-hang).

## 3. Mapping (theo OQ-1 — mặc định tái dùng `device_user_mappings`)
- `device_id` = iot_devices row của **bridge** (seed 1 row, OQ-1); `user_id`; `device_person_id` = szUid IVSS; `sync_status`; `last_sync_error`; `metadata_json = { bookingId, groupId, source:'ivss' }`; `deleted_at` soft-delete khi gỡ.
- Dùng để: (a) dedupe (đã synced → noop); (b) `deleteFace` khi gỡ; (c) #38–40 map event→user (qua szUid).
- SEC-03: mọi raw SQL bind tham số (mirror FMP `upsertMapping`).

## 4. Convert ảnh → base64
`getPortraitBytes(userId)` → `Buffer` → `buf.toString('base64')` (hoặc data-URL nếu bridge cần prefix — chốt theo README bridge). SEC-01: **KHÔNG log base64**.

## 5. Trigger (OQ-3/4) — bám FMP-001
- Provision: cron pre-provision (lead phút trước start) — cron riêng `ivssSync` hoặc fold vào `faceSync`. Gate env default OFF.
- Cleanup: cron mapping-driven sau end + grace.
- ARCH-02: gated default OFF, try/catch per item, KHÔNG throw ra cron, log scanned/enrolled/skipped/removed.

## 6. Test (mock IVSS_BRIDGE port — KHÔNG thiết bị/bridge)
- Mock `IvssBridgePort` (enrollFace/deleteFace/createGroup trả `IvssResult`), mock `FaceProfileService.getPortraitBytes`, mock `DataSource` (participants + mapping SQL theo keyword).
- Ca: enroll ok → mapping synced + szUid; bridge-down (`ok:false`) → mapping failed + KHÔNG throw (OQ-5); portrait null → skip + KHÔNG enroll (OQ-7); dedupe (đã synced) → noop (OQ-6); cleanup ended → deleteFace + soft-delete; deleteFace fail → giữ mapping; batch resilience (1 lỗi không chặn).
- Coverage ≥80% service mới.

## 7. Constitution
- **SEC-01**: ảnh (base64) + token KHÔNG log/audit; mapping metadata KHÔNG chứa ảnh.
- **SEC-02**: #37 chủ yếu cron/service (không route user); nếu thêm route admin trigger → admin-gated.
- **ARCH-01**: gọi IVSS qua **port `IVSS_BRIDGE`** (boundary); đọc portrait qua `FaceProfileService`; KHÔNG đọc NetSDK trong NestJS.
- **ARCH-02**: cron gated default OFF + try/catch per item + no-throw-out-of-cron + log số liệu.
- **DATA-01**: no-migration; tái dùng `device_user_mappings` (+ seed bridge device) — KHÔNG tạo bảng mới trong #37.

## 8. OPEN QUESTIONS (chốt trước plan/tasks)
- **OQ-1 (crux) storage**: tái dùng `device_user_mappings` (+ **seed 1 `iot_devices` row cho bridge** — no-migration) **[đề xuất]** vs bảng mới `ivss_face_enrollments` (**= migration → DỪNG**, để ticket có migration). Đề xuất tái dùng để dùng lại machinery FMP (dedupe/soft-delete/sync_status); chấp nhận "bridge là iot_device tổng hợp". Xác nhận seed device + device_code/room_id (room_id nullable?).
- **OQ-2 group**: 1 group chung `IVSS_DEFAULT_GROUP` (vd 'SMRMPTS' — đơn giản, Sample DB) **[đề xuất]** vs per-room/per-meeting (cô lập nhưng phải createGroup/deleteGroup nhiều + quản vòng đời group). Đề xuất 1 group chung cho v1; ensure group tồn tại (createGroup idempotent lúc khởi tạo/lần enroll đầu).
- **OQ-3 trigger enroll**: pre-provision cron lead phút trước start (**bám FMP-001** [đề xuất]) vs lúc booking-approved/meeting-create. Đề xuất cron để nhất quán + tránh enroll sớm cho họp xa.
- **OQ-4 cleanup trigger**: mapping-driven sau end + grace (**bám FMP-001** [đề xuất]) vs meeting status→completed / booking released.
- **OQ-5 bridge-down/chưa HDD**: enroll `ok:false` → **best-effort: log + mapping `failed` + để cron tick sau retry** [đề xuất], KHÔNG hàng đợi riêng, KHÔNG fail provisioning/booking. Cleanup deleteFace fail → giữ mapping retry. Xác nhận đủ hay cần outbox/retry-count.
- **OQ-6 idempotency / model enroll**: theo §0.3, đề xuất **enroll user 1 lần vào group** (mapping sống/(bridge,user); szUid ở device_person_id); gỡ khi user **hết** họp active (không còn meeting nào đang/ sắp). vs per-meeting szUid (đòi nhiều mapping/user → vướng partial-unique). Xác nhận model. Attendee huỷ/đổi → mapping theo cron cleanup (không còn meeting active → gỡ).
- **OQ-7 ảnh thiếu**: user chưa có portrait → **skip + log, KHÔNG chặn họp** [đề xuất] (mirror FMP). Xác nhận (không cần cảnh báo admin ở #37).

## 9. Residuals / known-gaps
- **Live-runbook owed**: enroll/delete thật chỉ chứng minh khi bridge + IVSS HDD sẵn sàng; #37 test bằng mock port.
- Seed `iot_devices` cho bridge (nếu OQ-1=tái dùng) — owed, ghi rõ device_code/room_id.
- Group lifecycle: nếu OQ-2 = per-room → cần quản createGroup/deleteGroup (defer).
- szUid contract: cần xác nhận bridge `enrollFace` trả szUid ở field nào (IvssFaceRef) + `deleteFace` xoá theo personUid mình gửi hay szUid — chốt theo README khi plan.
- Mô hình enroll-once-per-user (OQ-6) khác per-meeting của door terminal → ghi rõ khác biệt; nếu cần per-meeting validity (IVSS hỗ trợ?) thì xem lại.
- Concurrency cron (in-instance) chưa distributed lock (giống FMP/NSL).

> **STOP.** Spec-only. Chờ Thiếu Chủ review + chốt OQ-1…OQ-7 trước khi plan/tasks.
