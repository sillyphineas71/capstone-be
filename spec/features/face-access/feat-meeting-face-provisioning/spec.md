---
name: feat-meeting-face-provisioning
description: Per-meeting face provisioning — push whitelist lúc họp bắt đầu / gỡ lúc kết thúc + reconcile, qua FaceDeviceProviderFactory. Cron gated OFF. Face-access Pha 1 / B.
category: face-access
---

# Feature Specification: Per-Meeting Face Provisioning + Sync

- **Feature ID**: FMP-001 (Face-access Pha 1 · Ticket B)
- **Module / Domain**: face-access (+ scheduler wiring)
- **Created Date**: 2026-06-17
- **Status**: Draft (RECON xong)
- **Source Documents**:
  - `spec/global/constitution.md` (SEC-03 parameterize; ARCH-02 no-hang; DATA-01 no migration)
  - `CLAUDE.md` (§11.3 adapter/port; §11.8 boundary; §19 background jobs)
  - Ticket A `FaceDeviceProviderFactory.create(device)`; Ticket D `FaceProfileService.getPortraitBytes(userId)`
  - `src/modules/iot/entities/device-user-mapping.entity.ts`, `meetings/entities/meeting.entity.ts`, `meeting-participant.entity.ts`, `iot-device.entity.ts`
  - `src/modules/scheduler/scheduler.service.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo spec FMP-001 (Ticket B): FaceProvisioningService (provision/deprovision/reconcile) qua factory+getPortraitBytes; idempotent per (user,device,bookingId); cron gated FACE_SYNC_ENABLED OFF. KHÔNG migration. | Toàn bộ file (bản đầu) |

---

## 1. Giới thiệu

### 1.1 Bối cảnh
Có Ticket A (đẩy/gỡ FaceGate qua port) + D (portrait bytes). **Ticket B** điều phối theo cuộc họp: **lúc họp sắp bắt đầu** → đẩy khuôn mặt participant lên cam của phòng (validity = giờ họp); **lúc kết thúc** → gỡ. Lớp validity của cam là lưới an toàn nếu gỡ sót. Cron gated OFF.

### 1.2 Mục tiêu
- `FaceProvisioningService.provisionMeeting(meeting)` / `deprovisionMeeting(meeting)` / `reconcile()`.
- Cron: provision meeting trong cửa sổ `[now, now+LEAD]`; deprovision `[now-GRACE, now]`; gate `SCHEDULER_ENABLED && FACE_SYNC_ENABLED` (default OFF).
- Ghi vết `device_user_mappings` (sync_status pending/synced/failed/removed).

### 1.3 Out-of-scope (C/khác)
- Runtime attendance khi verify (Ticket C).
- Điều khiển cửa (NC-1: cửa không quan trọng).
- Đổi schema/migration (DATA-01).

---

## 2. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| media_files id default | `@PrimaryGeneratedColumn('uuid')`; **DB có default** (smoke #24/#26 tạo media_files raw thật OK) ⇒ raw INSERT của D hợp lệ, KHÔNG migration. |
| meeting | [meeting.entity.ts:34-41,70,103-106]: `MeetingStatus`(draft/pending_approval/scheduled/in_progress/completed/cancelled); **`room_id`**? (:70); `start_time`/`end_time`(NN). ⇒ provision khi status ∈ {scheduled,in_progress}, room_id NOT NULL. |
| meeting_participants | `MeetingParticipantEntity`: `meeting_id`, `user_id`, `attendance_required`. ⇒ list user. |
| iot_devices | `IoTDeviceEntity`: `device_type='face_server'`, `room_id`. ⇒ device theo room: `WHERE room_id=$1 AND device_type='face_server'`. |
| device_user_mappings | [device-user-mapping.entity.ts]: `device_id`, `user_id`, `device_person_id`(=uid), `device_person_code`/`device_person_name`(=uname), `face_registered`(bool), `registered_at`?, `sync_status`(def pending), `last_synced_at`?, `last_sync_error`?, `metadata_json`? (chứa bookingId+validity). ⇒ ghi đủ, KHÔNG cột mới. |
| Ticket A | `FaceDeviceProviderFactory.create(device)` → port (uploadFace/addPerson/findUidByName/deletePerson), timeout sẵn (no-hang). |
| Ticket D | `FaceProfileService.getPortraitBytes(userId): Buffer|null` (export từ AccountsModule). |
| Scheduler | [scheduler.service.ts]: pattern `@Cron` + gate + per-item try/catch (như #31). Thêm job face-sync, gate FACE_SYNC_ENABLED. |

---

## 3. FaceProvisioningService

```text
DI: DataSource, FaceDeviceProviderFactory, FaceProfileService.
Hằng: uname = `${userId}:${meetingId}` (meetingId = "bookingId" — khoá duy nhất per-enrollment).

provisionUpcomingMeetings(): query meetings start_time ∈ [now, now+LEAD] & status ∈ {scheduled,in_progress}
  & room_id NOT NULL → for each → try provisionMeeting(m) catch log. (cron gọi)

provisionMeeting(meeting):
  1. device = SELECT * FROM iot_devices WHERE room_id=$1 AND device_type='face_server' LIMIT 1.
     none → log + return (phòng không có face device).
  2. participants = SELECT user_id FROM meeting_participants WHERE meeting_id=$1.
  3. for each participant (try/catch per — RP):
     a. uname = `${userId}:${meetingId}`; bookingId = meetingId.
     b. IDEMPOTENCY: mapping (user_id, device_id, metadata.bookingId) sync_status='synced' → SKIP.
     c. bytes = getPortraitBytes(userId); null → log + SKIP (không enroll).
     d. provider = factory.create(device).
     e. ref = await provider.uploadFace(bytes).
     f. await provider.addPerson({ uname, faceRef:ref, validFrom:start_time, validTo:end_time }).
     g. uid = await provider.findUidByName(uname).
     h. UPSERT device_user_mappings { device_id, user_id, device_person_id:uid, device_person_code:uname,
        device_person_name:uname, face_registered:true, sync_status:'synced', last_synced_at:now,
        registered_at:now, metadata_json:{bookingId, validFrom, validTo} }.
     catch → UPSERT mapping sync_status='failed', last_sync_error=<msg sạch>. KHÔNG chặn participant khác.

deprovisionEndedMeetings(): query meetings end_time ∈ [now-GRACE, now] & status ≠ cancelled & room_id NOT NULL
  → for each → try deprovisionMeeting(m) catch log. (cron gọi)

deprovisionMeeting(meeting):
  mappings = SELECT * FROM device_user_mappings WHERE metadata_json->>'bookingId'=$1 AND sync_status='synced'.
  for each (try/catch): device = SELECT iot_devices WHERE id=mapping.device_id;
    provider.create(device).deletePerson(device_person_id) → UPDATE mapping sync_status='removed', last_synced_at=now.

reconcile(): (cron định kỳ)
  - STALE: mappings sync_status='synced' mà meeting (bookingId) end_time < now → deprovision (deletePerson + removed).
  - DEDUP: với mapping synced, findUidByName(uname) trả >1 uid → giữ device_person_id, deletePerson các uid còn lại.
  (Retry failed/pending: tự nhiên qua provisionMeeting tick — idempotency chỉ skip 'synced'.)
```

---

## 4. Scheduler

```text
@Cron(EVERY_MINUTE, {name:'face-sync'}) faceSyncTick():
  if (!schedulerEnabled || !faceSyncEnabled) return;
  try { await faceProvisioning.provisionUpcomingMeetings(); } catch(log);
  try { await faceProvisioning.deprovisionEndedMeetings(); } catch(log);
@Cron(EVERY_5_MINUTES, {name:'face-reconcile'}) faceReconcileTick():
  if (gate off) return; try { await faceProvisioning.reconcile(); } catch(log);
- detect/provision KHÔNG ném ra ngoài cron. Gate FACE_SYNC_ENABLED default OFF.
- SchedulerModule import FaceAccessModule (export FaceProvisioningService) — như scheduler→rooms #31.
```

---

## 5. Functional Requirements (EARS)

```text
FR-FMP-001-001: provisionMeeting SHALL tìm device face_server theo room; KHÔNG device → bỏ qua (log).
FR-FMP-001-002: Mỗi participant SHALL getPortraitBytes; null → bỏ qua (log), KHÔNG enroll.
FR-FMP-001-003: SHALL uploadFace → addPerson(validity=start..end) → findUidByName → upsert device_user_mappings (synced, uid, uname, metadata bookingId/validity).
FR-FMP-001-004 (Idempotency): IF mapping (user,device,bookingId) đã 'synced', THEN SKIP (cron mỗi phút KHÔNG đẩy lại).
FR-FMP-001-005 (Isolation): lỗi 1 participant → mapping 'failed' + last_sync_error; KHÔNG chặn participant khác (try/catch per).
FR-FMP-001-006: deprovisionMeeting SHALL deletePerson(uid) cho mỗi mapping synced của bookingId → 'removed'.
FR-FMP-001-007: reconcile SHALL gỡ stale (synced + meeting ended) + dedup uid trùng.
FR-FMP-001-008: Cron face-sync SHALL gate SCHEDULER_ENABLED && FACE_SYNC_ENABLED (default OFF); detect KHÔNG ném ra cron.
FR-FMP-001-009: Mọi query parameterized (SEC-03); call thiết bị qua port (timeout no-hang); KHÔNG migration (DATA-01).
```

## 6. Non-functional

```text
NFR-FMP-001-001 (Adapter): chỉ gọi qua FaceDeviceProviderFactory/port — KHÔNG FaceGateClient trực tiếp.
NFR-FMP-001-002 (No-hang): per-call timeout từ Ticket A; cron không treo; bound số việc/tick nếu cần.
NFR-FMP-001-003 (SEC-03): parameterized; last_sync_error sạch (không creds).
NFR-FMP-001-004 (DATA-01): device_user_mappings có sẵn; KHÔNG migration.
NFR-FMP-001-005 (Idempotent): atomic-ish check mapping synced trước khi đẩy.
```

## 7. Acceptance Criteria

```text
AC-FMP-001-001 (provision happy): Given meeting có device + participant có portrait; When provisionMeeting; Then uploadFace→addPerson→findUidByName gọi, mapping synced (uid, uname, metadata).
AC-FMP-001-002 (idempotency): Given mapping đã 'synced'; When provisionMeeting lần 2; Then SKIP (KHÔNG uploadFace/addPerson lại).
AC-FMP-001-003 (isolation): Given 2 participant, người 1 addPerson lỗi; Then người 1 mapping 'failed', người 2 vẫn synced.
AC-FMP-001-004 (no portrait): Given getPortraitBytes=null; Then SKIP, KHÔNG enroll, KHÔNG mapping synced.
AC-FMP-001-005 (no device): Given room không có face_server; Then provisionMeeting bỏ qua (KHÔNG ném).
AC-FMP-001-006 (deprovision): Given mapping synced của bookingId; When deprovisionMeeting; Then deletePerson(uid) gọi, mapping 'removed'.
AC-FMP-001-007 (reconcile stale): Given mapping synced mà meeting đã kết thúc; When reconcile; Then deprovision.
AC-FMP-001-008 (reconcile dedup): Given findUidByName trả nhiều uid; When reconcile; Then giữ 1, deletePerson còn lại.
AC-FMP-001-009 (cron gate): Given FACE_SYNC_ENABLED=false; When tick; Then KHÔNG chạy provisioning.
```

## 8. Test Plan (Jest — mock factory/FaceProfileService/dataSource/scheduler)

```text
provisioning.service.spec:
- provision happy (upload→add→find→upsert mapping synced) ; idempotency skip ; isolation (1 lỗi không chặn) ;
  portrait null skip ; no device skip.
- deprovision (del→removed) ; reconcile (stale→deprovision ; dedup→delete extra).
scheduler: gate OFF → service không gọi ; ON → gọi (mock).
≥80%.
```

---

## 9. [NEEDS CLARIFICATION]
| # | Vấn đề | Đề xuất |
|---|---|---|
| NC-1 | bookingId = meetingId? | Dùng `meetingId` làm khoá duy nhất per-enrollment (uname=userId:meetingId, metadata.bookingId=meetingId). Nếu cần room_booking.id riêng → đổi sau. |
| NC-2 | status provision. | scheduled + in_progress (đang/ sắp họp). |
| NC-3 | bound việc/tick. | Pha 1 tuần tự; nếu nhiều → giới hạn N meeting/tick (đề xuất, chưa bắt buộc). |

---

> Trạng thái: **CHỜ REVIEW** sau code (STOP code-review gate). Chưa commit.
