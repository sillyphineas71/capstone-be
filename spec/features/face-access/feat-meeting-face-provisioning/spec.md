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
  - Ticket A `FaceDeviceProviderFactory.create(device)`; Ticket D `FaceProfileService.getPortraitBytes(userId)` [xem FPB-001, commit `b2c34ce`: đã lọc `status = 'active'` từ 2026-06-30, KHÔNG có method mới]
  - `src/modules/iot/entities/device-user-mapping.entity.ts`, `meetings/entities/meeting.entity.ts`, `meeting-participant.entity.ts`, `iot-device.entity.ts`
  - `src/modules/scheduler/scheduler.service.ts`

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo spec FMP-001 (Ticket B): FaceProvisioningService (provision/deprovision/reconcile) qua factory+getPortraitBytes; idempotent per (user,device,bookingId); cron gated FACE_SYNC_ENABLED OFF. KHÔNG migration. | Toàn bộ file (bản đầu) |
| 2026-06-18 | Gộp constraint-safety hardening (nguyên MCS-001) vào FMP-001 — hardening #46/#47, không phải UC mới. | Mục "Constraint-safety hardening" (cuối file) |
| 2026-07-29 | BUG-FIX (nghi vấn, phát hiện khi tách avatar/biometric — xem `spec/features/account/feat-split-avatar-and-biometric/plan.md` BUG-01): ghi nhận nghi vấn `getPortraitBytes(userId)` không lọc theo `face_profiles.status`. | Mục 3 (bước 3.c), FR-FMP-001-002, AC mới AC-FMP-001-010 |
| 2026-07-29 | **ĐÍNH CHÍNH**: nghi vấn BUG-01 ở dòng trên là SAI — đã kiểm tra `git log -S "R2 + VAL-01"` xác nhận `getPortraitBytes` đã được vá lọc `status = 'active'` từ trước, tại commit `b2c34ce` ("fix(accounts): getPortraitBytes lấy ảnh ACTIVE từ Cloudinary cho IVSS enroll (FPB-001)", 2026-06-30) — TRƯỚC cả khi spec BUG-FIX ở trên được viết. KHÔNG có method `getActivePortraitBytes` nào được tạo mới; tên method thật vẫn là `getPortraitBytes`, chỉ hành vi bên trong đã lọc ACTIVE. Các đoạn bên dưới ghi `getActivePortraitBytes`/`[SỬA 2026-07-29]` đã được sửa lại về đúng tên `getPortraitBytes` + ghi chú tham chiếu FPB-001. | Header (dòng Source Documents), mục 3 (bước 3.c), mục 2 (bảng RECON), FR-FMP-001-002, AC-FMP-001-010, mục 8 (Test Plan) |

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
| Ticket D | `FaceProfileService.getPortraitBytes(userId): Buffer|null` (export từ AccountsModule) — đã lọc `face_profiles.status = 'active'` từ commit `b2c34ce` (FPB-001, 2026-06-30), KHÔNG có method riêng `getActivePortraitBytes`. |
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
     c. bytes = getPortraitBytes(userId) — [ĐÍNH CHÍNH 2026-07-29] đã lọc `status = 'active'` từ commit `b2c34ce` (FPB-001): chỉ trả bytes khi user có `face_profiles` với `status = 'active'`; mọi status khác (`pending_review`/`rejected`/`disabled`/`revoked`) hoặc không có row nào → trả null. null → log + SKIP (không enroll).
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
FR-FMP-001-002 [ĐÍNH CHÍNH 2026-07-29]: Mỗi participant SHALL getPortraitBytes (đã lọc `face_profiles.status = 'active'` từ FPB-001/commit `b2c34ce`); null (không có portrait HOẶC portrait tồn tại nhưng chưa được duyệt: `pending_review`/`rejected`/`disabled`/`revoked`) → bỏ qua (log), KHÔNG enroll.
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
AC-FMP-001-010 (pending/rejected portrait — xác nhận hành vi FPB-001 đã có, ghi rõ thành AC ở đây 2026-07-29): Given participant có `face_profiles` nhưng `status` là `pending_review`, `rejected`, `disabled`, hoặc `revoked` (chưa có row nào `active`); When provisionMeeting; Then getPortraitBytes trả null, SKIP participant đó (KHÔNG uploadFace, KHÔNG addPerson, KHÔNG tạo/update mapping), giống hệt trường hợp không có portrait nào (AC-FMP-001-004).
```

## 8. Test Plan (Jest — mock factory/FaceProfileService/dataSource/scheduler)

```text
provisioning.service.spec:
- provision happy (upload→add→find→upsert mapping synced) ; idempotency skip ; isolation (1 lỗi không chặn) ;
  portrait null skip ; no device skip ; portrait pending_review/rejected/disabled/revoked → skip giống null (AC-FMP-001-010 — hành vi đã có sẵn từ FPB-001, xác nhận có test case).
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

## Constraint-safety hardening (rev 2026-06-18, nguyên MCS-001)

### 1. Mục tiêu
Provisioning B (`FaceProvisioningService`) hiện có thể **vi phạm 2 partial-unique index** của `device_user_mappings` khi 2 cuộc họp back-to-back cùng phòng + cùng người (collision trên `(device_id, user_id)`). MCS-001 vá B để **bất biến: KHÔNG bao giờ tạo/ghi mapping vi phạm 2 index**, bằng 3 thay đổi nhỏ (KHÔNG migration — `deleted_at` đã có cột; KHÔNG repoint để tránh orphan + tránh phá meeting đang chạy).

**KHÔNG đụng FAT-001/DCO-001/UMR-001** — chúng match theo `device_person_id` (uid) + guard `synced AND deleted_at IS NULL`, giữ nguyên.

### 2. RECON (đã kiểm chứng — nền tảng spec)
- **2 partial-unique index** trên `device_user_mappings`:
  - `ux_device_user_mappings_device_user` UNIQUE **`(device_id, user_id)` WHERE `deleted_at IS NULL`**.
  - `ux_device_user_mappings_person_id` UNIQUE **`(device_id, device_person_id)` WHERE `device_person_id IS NOT NULL AND deleted_at IS NULL`**.
- **`removeMapping`** ([face-provisioning.service.ts:297](../../../../src/modules/face-access/services/face-provisioning.service.ts)) hiện `UPDATE ... SET sync_status='deleted', last_synced_at=now()` — **KHÔNG set `deleted_at`** → row "deleted" vẫn `deleted_at IS NULL` → **vẫn chiếm slot partial-unique**. Xoá face cam bằng `provider.deletePerson(mp.device_person_id)` (theo **uid**).
- **`upsertMapping`** existing-check theo `(user_id, device_id, metadata_json->>'bookingId')` (KHÔNG lọc deleted_at); UPDATE **không** set `deleted_at`. `uploadFace`/`addPerson` chạy **TRƯỚC** `upsertMapping` trong `provisionParticipant` (uid = `findUidByName(uname)` sau addPerson).
- **Cron**: `faceSync` `@Cron(EVERY_MINUTE)` gọi `provisionUpcomingMeetings()` **TRƯỚC** `deprovisionEndedMeetings()`. Provision quét `start_time ≤ now()+LEAD AND end_time > now()`; deprovision quét `end_time ≤ now()-GRACE`.
- **Back-to-back** M1(…–10:00) → M2(10:00–…) cùng phòng+user: cửa sổ M2-đã-provision & M1-chưa-deprovision = **[now+LEAD …, now-GRACE …] ≈ LEAD+GRACE phút** → 2 row sống cùng `(device,user)` → **collision** (INSERT row M2 ném unique violation). Đổi thứ tự cron KHÔNG cứu (hở eligibility = LEAD+GRACE).

#### 2.1. Giả định bất biến `(device, device_person_id)`
Bất biến trên `ux_..._person_id` dựa vào: **cam cấp `uid` MỚI mỗi `addPerson`** (uname = hash per (user,meeting) → device-person khác nhau) **+ #1 freed `uid` cũ** (deprovision set `deleted_at` → giải phóng slot uid). ⚠ **Nếu thiết bị TÁI DÙNG một `uid` đang sống** (cấp lại uid trùng cho người khác khi chưa freed) → có thể đụng `ux_..._person_id`. Ca này **hiếm** (FaceGate cấp uid tăng dần, deprovision xoá face theo uid) → **OUT-OF-SCOPE** MCS-001; ghi nhận làm rủi ro tồn dư.

### 3. Functional Requirements (EARS)

#### 3.1. #1 — Deprovision soft-delete thật (giải phóng slot)
- **FR-MCS-001-001**: `removeMapping` UPDATE bổ sung **`deleted_at = now()`**:
  ```sql
  UPDATE device_user_mappings
     SET sync_status = 'deleted', deleted_at = now(), last_synced_at = now()
   WHERE id = $1
  ```
  → giải phóng cả `ux_device_user_mappings_device_user` lẫn `ux_..._person_id` (cả 2 đều `WHERE deleted_at IS NULL`).
- **FR-MCS-001-002** (an toàn với mọi reader): set `deleted_at` KHÔNG phá reader nào vì **không reader nào dựa vào `sync_status='deleted' AND deleted_at IS NULL`**; các query đều tự loại row deprovision (xem §4 bảng).
- **FR-MCS-001-002b** (cleanup MỌI row non-synced của họp đã kết thúc): `deprovisionEndedMeetings` (query chọn mapping) phải lấy **mọi mapping còn sống** (`deleted_at IS NULL`, **mọi `sync_status`** gồm `failed`/`pending`/`synced`) của họp `end_time ≤ now()-GRACE AND status<>'cancelled'` → `removeMapping`. (Hiện query lọc `sync_status='synced'` → bỏ sót row `failed`/`pending` chiếm slot vĩnh viễn.) → đổi điều kiện thành `mp.deleted_at IS NULL` (bỏ `mp.sync_status='synced'`).
- **FR-MCS-001-002c** (`removeMapping` null-uid-safe): chỉ gọi `provider.deletePerson(device_person_id)` khi `device_person_id` **NOT NULL**; nếu NULL (vd row `failed` chưa kịp lấy uid) → **bỏ qua deletePerson**, vẫn `UPDATE ... deleted_at=now()` (freed slot). (removeMapping hiện đã guard `if (mp.device_person_id)` — giữ + xác nhận hành vi này.)

#### 3.2. #3 — Revive clear deleted_at
- **FR-MCS-001-003**: nhánh **UPDATE** của `upsertMapping` (reuse row cùng `(user,device,bookingId)`) phải set **`deleted_at = NULL`**. Lý do: sau #1 row cũ có `deleted_at=now()`; nếu revive mà không clear → ra row `sync_status='synced'` NHƯNG `deleted_at` cũ → `resolveMapping` (`deleted_at IS NULL`) **trượt** → điểm danh hỏng. (Áp cho mọi UPDATE revive, kể cả ghi `failed` để row "sống" và tick sau retry.)

#### 3.3. #2 — Slot-check TRƯỚC upload (skip khi bận)
- **FR-MCS-001-004**: trong `provisionParticipant`, **trước** `uploadFace`/`addPerson`, SELECT mapping **còn sống** theo slot `(device_id, user_id)`. **Slot-check này THAY THẾ idempotency-check cũ** ([:123-131](../../../../src/modules/face-access/services/face-provisioning.service.ts) — `SELECT sync_status WHERE (user,device,bookingId); if synced → return`): **GỠ** check cũ, hợp nhất vào nhánh "cùng booking + synced → noop" của slot-check. KHÔNG để 2 chỗ cùng quyết "đã synced thì skip".
  ```sql
  SELECT id, sync_status, metadata_json->>'bookingId' AS booking_id
    FROM device_user_mappings
   WHERE device_id = $1 AND user_id = $2 AND deleted_at IS NULL
   LIMIT 1
  ```
- **FR-MCS-001-005**: rẽ nhánh theo kết quả:
  - **Không có row sống** → slot trống → `uploadFace`+`addPerson`+`findUidByName`+`upsertMapping(synced)` (luồng bình thường). Kết quả: `provisioned`.
  - **Có, cùng `bookingId`**:
    - `sync_status='synced'` → **idempotent skip** (không upload, không ghi). Kết quả: `noop`.
    - khác (pending/failed) → **revive**: `uploadFace`+`addPerson`+`findUidByName` rồi `upsertMapping` UPDATE refresh `device_person_id` + `deleted_at=NULL` (cùng row). Kết quả: `revived`.
  - **Có, khác `bookingId`** (meeting khác đang giữ slot — sau #1, row sống = chắc chắn đang active, không phải deleted) → **SKIP + `logger.warn`**, **KHÔNG upload**, **KHÔNG ghi mapping**. Kết quả: `skipped` (defer — tick sau tự thử lại sau khi M1 deprovision).
- **FR-MCS-001-006** (counter): `provisionUpcomingMeetings` đếm riêng `skipped` (không phải lỗi): trả `{ scanned, skipped }` (hoặc `{ scanned, provisioned, skipped }`). `provisionMeeting` tổng hợp kết quả từng participant.

#### 3.4. Bất biến
- **FR-MCS-001-007**: **KHÔNG BAO GIỜ** INSERT/UPDATE tạo ra >1 row sống (`deleted_at IS NULL`) trên `(device_id, user_id)`, hay >1 trên `(device_id, device_person_id)`.
- **FR-MCS-001-008**: **KHÔNG repoint** slot sang meeting khác (tránh orphan face trên cam + tránh phá meeting đang chạy). Slot bận → skip, KHÔNG ghi đè.

### 4. #1 an toàn với mọi reader (bảng xác nhận)
| Reader | Lọc | Set `deleted_at=now()` lúc deprovision |
| :--- | :--- | :--- |
| C `resolveMapping` ×2 | `synced AND deleted_at IS NULL` | ✅ tự loại |
| UMR list NOT EXISTS | `synced AND deleted_at IS NULL` | ✅ tự loại |
| UMR map byPerson/byUser | `deleted_at IS NULL` | ✅ tự loại (row deprovision freed) |
| B `deprovisionEndedMeetings` (sau #2b) | `deleted_at IS NULL` (mọi sync_status) | ✅ tự loại (deleted_at set → khỏi quét lại) |
| B `deprovisionMeeting` | `sync_status='synced'` | ✅ (sync_status đã loại) |
| B reconcile stale | `sync_status='synced'` | ✅ |
| B reconcile dedup | `sync_status='synced'` | ✅ |
| B idempotency-check | đọc `sync_status` (no deleted_at) | ✅ không đọc deleted_at |
→ KHÔNG reader nào dựa vào `sync_status='deleted' AND deleted_at IS NULL` → set `deleted_at` an toàn 100%.

### 5. Non-Functional / Constraints
- **NFR-DATA-01**: KHÔNG migration (cột `deleted_at` đã có).
- **NFR-SEC-03**: SQL parameterized, raw qua `DataSource`.
- **NFR-ARCH**: KHÔNG đụng FAT/DCO/UMR; KHÔNG module mới; import `.js`.
- **NFR-ENG-01**: unit test ≥ 80% branch (face-provisioning).

### 6. Acceptance Criteria
- **AC-001** (#1): `removeMapping` UPDATE chứa `deleted_at = now()`; sau deprovision row có `deleted_at` ≠ NULL.
- **AC-002** (#1 safety): sau deprovision, `resolveMapping`/list/reconcile KHÔNG còn thấy row (hành vi không đổi).
- **AC-003** (#3): revive UPDATE set `deleted_at = NULL` → row `synced` + `deleted_at NULL` → `resolveMapping` match lại.
- **AC-004** (#2 free): không có row sống `(device,user)` → upload + INSERT (`provisioned`).
- **AC-005** (#2 same booking synced): row sống cùng booking + synced → **idempotent skip**, KHÔNG upload (`noop`).
- **AC-006** (#2 same booking re-provision): row cùng booking pending/failed → revive (UPDATE refresh uid + `deleted_at=NULL`), KHÔNG INSERT mới (`revived`).
- **AC-007** (#2 busy): row sống `(device,user)` **khác bookingId** → **SKIP** + warn, **factory KHÔNG được gọi**, KHÔNG INSERT/UPDATE mapping (`skipped`).
- **AC-008** (counter): `provisionUpcomingMeetings` trả `skipped` đếm riêng.
- **AC-009** (invariant): không kịch bản nào tạo 2 row sống cùng `(device,user)`.
- **AC-010** (#2b cleanup non-synced): row `failed` (`deleted_at NULL`, `device_person_id NULL`) của họp đã kết thúc (`end_time ≤ now()-GRACE`) → được `removeMapping` (`deleted_at` set, **KHÔNG** gọi `deletePerson`) → freed slot.
- **AC-011** (#2b hệ quả): sau khi freed (AC-010), provision tiếp theo của cùng `(device,user)` (meeting mới) → slot-check thấy trống → **KHÔNG bị skip** → provision bình thường.

### 7. Edge cases (phải có test)
- **sequential** (M1 đã deprovision, deleted_at set → slot free): provision M2 cùng user → INSERT bình thường.
- **re-provision cùng bookingId** (row M1 vừa deleted_at=now(), M1 vẫn trong provision window): slot-check (deleted_at IS NULL) → none → upsert reuse row M1 (cùng booking) → UPDATE set `deleted_at=NULL`+synced → resolveMapping match lại.
- **back-to-back** (M1 active giữ slot, provision M2): slot-check thấy row M1 sống khác bookingId → **skip**, KHÔNG upload, KHÔNG orphan, `skipped++`.
- **deprovision rồi resolveMapping**: sau #1, verify cho mapping đã deprovision → `resolveMapping` loại đúng (deleted_at set).
- **counter**: 1 meeting có participant free + participant bị skip → `{ scanned, skipped }` đúng.
- **cleanup non-synced** (#2b): họp đã kết thúc còn row `failed`/`pending` (`deleted_at NULL`) → deprovision freed (set `deleted_at`); row `failed` uid NULL → KHÔNG `deletePerson`. Sau đó provision cùng `(device,user)` meeting mới → không skip.

### 8. Out of scope
- **Repoint slot** sang meeting khác (orphan face + phá meeting đang chạy) — loại bỏ có chủ đích (FR-008).
- Đổi `uname=hash(userId)` (1 device-person/user) — redesign lớn, defer.
- Rút ngắn cửa sổ chồng bằng LEAD/GRACE — không giải quyết gốc; skip + retry là đủ.
- Hồi tố điểm danh cho participant bị skip trong lúc chờ (verify sau khi provision thành công ở tick sau sẽ ghi bình thường).
