---
name: feat-meeting-face-provisioning-plan
description: Kế hoạch FMP-001 — FaceProvisioningService (provision/deprovision/reconcile) + scheduler cron + env, qua factory+getPortraitBytes.
category: face-access
---

# Implementation Plan: Per-Meeting Face Provisioning (FMP-001)

- **Feature ID**: FMP-001 · **Module**: face-access (+ scheduler) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo plan.md FMP-001 (service raw SQL, factory+getPortraitBytes, scheduler 2 cron gated, env). | Toàn bộ file |
| 2026-06-18 | Gộp constraint-safety hardening (nguyên MCS-001) vào FMP-001 — hardening #46/#47, không phải UC mới. | Mục "Constraint-safety hardening" (cuối file) |

---

## 1. Technical Context (verified)
- media_files.id có DB default (smoke #24) → raw INSERT OK. meeting.room_id tồn tại. MeetingStatus có scheduled/in_progress.
- FaceAccessModule có FaceDeviceProviderFactory; AccountsModule export FaceProfileService.
- device_user_mappings cột đủ (sync_status/metadata_json) → KHÔNG migration. Raw SQL qua DataSource (như #29/#31).

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Mới | `face-access/services/face-provisioning.service.ts` |
| Sửa | `face-access/face-access.module.ts` (+import AccountsModule, +provider/export FaceProvisioningService) |
| Sửa | `scheduler/scheduler.module.ts` (+FaceAccessModule) + `scheduler.service.ts` (inject + 2 cron gated) |
| Sửa | `config/env.validation.ts` (+FACE_SYNC_ENABLED/LEAD/GRACE) + .env.example |
| Mới (test) | `face-provisioning.service.spec.ts` |

## 3. FaceProvisioningService
```text
constructor(DataSource, FaceDeviceProviderFactory, FaceProfileService, ConfigService).
unameOf(userId, meetingId) = `${userId}:${meetingId}`.

provisionUpcomingMeetings():
  lead = config.get('FACE_SYNC_LEAD_MINUTES',5);
  meetings = query(`SELECT id, room_id, start_time, end_time FROM meetings
    WHERE room_id IS NOT NULL AND status IN ('scheduled','in_progress')
      AND start_time <= now() + ($1*interval '1 minute') AND end_time > now()`, [lead]);
  for m: try provisionMeeting(m) catch log.

provisionMeeting(m):
  device = query(SELECT id, metadata_json, ip_address FROM iot_devices WHERE room_id=$1 AND device_type='face_server' LIMIT 1)[0]; !device → return.
  parts = query(SELECT user_id FROM meeting_participants WHERE meeting_id=$1, [m.id]).
  for p (try/catch):
    uname = unameOf(p.user_id, m.id);
    existing = query(SELECT id, sync_status FROM device_user_mappings
      WHERE user_id=$1 AND device_id=$2 AND metadata_json->>'bookingId'=$3, [p.user_id, device.id, m.id]);
    if existing[0]?.sync_status === 'synced' → continue;
    bytes = await faceProfileService.getPortraitBytes(p.user_id); if !bytes → log+continue;
    provider = factory.create({ ipAddress: device.ip_address, metadataJson: device.metadata_json });
    ref = await provider.uploadFace(bytes);
    await provider.addPerson({ uname, faceRef:ref, validFrom:new Date(m.start_time), validTo:new Date(m.end_time) });
    uid = await provider.findUidByName(uname);
    await upsertMapping({ deviceId:device.id, userId:p.user_id, uid, uname, bookingId:m.id,
      validFrom:m.start_time, validTo:m.end_time, status:'synced' });
    catch e: await upsertMapping({ deviceId:device.id, userId:p.user_id, uid:null, uname, bookingId:m.id,
      status:'failed', error: sanitize(e) }).

deprovisionEndedMeetings():
  grace = config.get('FACE_SYNC_GRACE_MINUTES',5);
  meetings = query(SELECT id, room_id FROM meetings WHERE room_id IS NOT NULL AND status <> 'cancelled'
    AND end_time <= now() AND end_time >= now() - ($1*interval '1 minute'), [grace]);
  for m: try deprovisionMeeting(m) catch log.

deprovisionMeeting(m):
  maps = query(SELECT id, device_id, device_person_id FROM device_user_mappings
    WHERE metadata_json->>'bookingId'=$1 AND sync_status='synced', [m.id]);
  for mp (try/catch):
    if mp.device_person_id: device = query(SELECT id, metadata_json, ip_address FROM iot_devices WHERE id=$1)[0];
      if device: await factory.create(device).deletePerson(mp.device_person_id);
    await query(UPDATE device_user_mappings SET sync_status='removed', last_synced_at=now() WHERE id=$1, [mp.id]).

reconcile():
  // stale
  stale = query(SELECT mp.id, mp.device_id, mp.device_person_id, mp.metadata_json
    FROM device_user_mappings mp JOIN meetings me ON me.id = (mp.metadata_json->>'bookingId')::uuid
    WHERE mp.sync_status='synced' AND me.end_time < now());
  for s: try deletePerson + UPDATE removed catch log.
  // dedup: với mỗi synced mapping → findUidByName(uname); nếu >1 uid → giữ device_person_id, delete khác.
  (bound: limit query để không quét vô hạn.)

upsertMapping(...): SELECT id by (user_id,device_id,bookingId); có → UPDATE; không → INSERT. parameterized.
```

## 4. Scheduler
```text
constructor: + inject FaceProvisioningService; faceSyncEnabled = config.get('FACE_SYNC_ENABLED', false).
@Cron(EVERY_MINUTE,{name:'face-sync'}) faceSync(): gate → try provisionUpcoming + deprovisionEnded catch log.
@Cron(EVERY_5_MINUTES,{name:'face-reconcile'}) faceReconcile(): gate → try reconcile catch log.
scheduler.module: imports + FaceAccessModule.
```

## 5. Module + ENV
- face-access.module: imports +AccountsModule; providers +FaceProvisioningService; exports +FaceProvisioningService.
- env.validation: FACE_SYNC_ENABLED(bool def false), FACE_SYNC_LEAD_MINUTES(int def 5), FACE_SYNC_GRACE_MINUTES(int def 5). .env.example.

## 6. Tests (mock, ≥80%)
- provision happy / idempotency skip / isolation (1 fail) / portrait null skip / no device skip.
- deprovision del→removed ; reconcile stale + dedup.
- (scheduler gate test optional.)

## 7. DoD
```
[ ] provision (device/participants/portrait/upload/add/find/upsert) + idempotency + isolation
[ ] deprovision (del→removed) + reconcile (stale+dedup)
[ ] cron 2 job gated OFF; env; module wiring (AccountsModule, FaceAccessModule→scheduler)
[ ] tests ≥80%; build/lint/jest xanh; qua port; KHÔNG migration
```

> Trạng thái: CHỜ REVIEW sau code. Chưa commit.

## Constraint-safety hardening (rev 2026-06-18, nguyên MCS-001)

### Phạm vi (1 file core + counter)
```
faceSync (EVERY_MINUTE)
  provisionUpcomingMeetings()  → {scanned, skipped}        [#2 + counter]
    provisionMeeting(m)                                     (tổng hợp participant result)
      provisionParticipant(m, device, user)                [#2 slot-check TRƯỚC upload]
        ├─ slot trống            → upload+add+find+upsert(synced)   → 'provisioned'
        ├─ slot cùng booking synced → return                        → 'noop'
        ├─ slot cùng booking khác  → upload+add+find+upsert(UPDATE) → 'revived'
        └─ slot khác booking (active) → warn + return (KHÔNG upload) → 'skipped'
      upsertMapping(...)         → UPDATE revive set deleted_at=NULL [#3]
  deprovisionEndedMeetings()
    removeMapping(mp)            → UPDATE ... deleted_at=now()       [#1]
```

### Files
| File | Hành động |
| :--- | :--- |
| `src/modules/face-access/services/face-provisioning.service.ts` | EDIT — #1 `removeMapping` (+`deleted_at=now()`); #3 `upsertMapping` UPDATE (+`deleted_at=NULL`); #2 `provisionParticipant` slot-check + rẽ nhánh; `provisionMeeting`/`provisionUpcomingMeetings` tổng hợp `skipped`. |
| `src/modules/scheduler/scheduler.service.ts` | EDIT (nhỏ) — log thêm `skipped` trong `faceSync` (optional, chỉ chuỗi log). |
| `src/modules/face-access/services/face-provisioning.service.spec.ts` | EDIT — test #1/#2/#3 + counter (≥80% branch). |

### #1 removeMapping (+ #2b cleanup query)
- UPDATE: `SET sync_status='deleted', deleted_at=now(), last_synced_at=now() WHERE id=$1`.
- **null-uid-safe**: giữ guard `if (mp.device_person_id)` → chỉ `deletePerson(mp.device_person_id)` khi uid NOT NULL; null → bỏ qua deletePerson, **vẫn** set `deleted_at`.
- **#2b** `deprovisionEndedMeetings` query: bỏ điều kiện `mp.sync_status='synced'`, đổi thành **`mp.deleted_at IS NULL`** (mọi sync_status) để cleanup luôn row `failed`/`pending` của họp đã kết thúc:
  ```sql
  ... FROM device_user_mappings mp JOIN meetings me ON me.id=(mp.metadata_json->>'bookingId')::uuid
   WHERE mp.deleted_at IS NULL AND me.status <> 'cancelled'
     AND me.end_time <= now() - ($1 * interval '1 minute') LIMIT 500
  ```

### #3 upsertMapping (revive)
- Nhánh UPDATE thêm `deleted_at = NULL` vào SET (mọi revive → row "sống" lại).
- INSERT giữ nguyên (row mới mặc định deleted_at NULL).
- existing-check giữ `(user,device,bookingId)` (không lọc deleted_at) — đúng vì #2 đã đảm bảo chỉ tới upsert khi slot trống / cùng booking (không có row sống khác booking).

### #2 provisionParticipant — slot-check trước upload
> **GỠ idempotency-check cũ** ([:123-131](../../../../src/modules/face-access/services/face-provisioning.service.ts) `SELECT sync_status … if synced → return`). Slot-check dưới đây thay thế hoàn toàn (nhánh "cùng booking + synced → noop"). KHÔNG để 2 chỗ cùng quyết skip.
```
uname = hash(userId, meeting.id)
slot = SELECT id, sync_status, metadata_json->>'bookingId' AS booking_id
        FROM device_user_mappings
       WHERE device_id=$1 AND user_id=$2 AND deleted_at IS NULL LIMIT 1
if (!slot) {
  // trống → bình thường
  bytes = getPortraitBytes(userId); if (!bytes) return 'noop'(skip-enroll)
  ref = uploadFace; addPerson; uid = findUidByName
  upsertMapping(synced); return 'provisioned'
}
if (slot.booking_id === meeting.id) {
  if (slot.sync_status === 'synced') return 'noop'   // idempotent
  // cùng booking, chưa synced → revive
  bytes = getPortraitBytes; if (!bytes) return 'noop'
  upload+add+find; upsertMapping(synced)  // UPDATE row cũ (#3 deleted_at=NULL)
  return 'revived'
}
// slot bận bởi meeting KHÁC đang sống → skip
logger.warn(`slot busy: device=… user=… holder booking=${slot.booking_id} ≠ ${meeting.id} — skip provision (defer).`)
return 'skipped'   // KHÔNG upload, KHÔNG ghi mapping
```
- `provisionMeeting`: gom kết quả participant; trả `{ skipped: n }`.
- `provisionUpcomingMeetings`: cộng dồn `skipped` → `{ scanned, skipped }`.
- Lưu ý `getPortraitBytes` null vẫn skip-enroll như cũ (không tính vào `skipped` constraint — đó là thiếu ảnh, phân biệt rõ trong log nếu cần).

### Quyết định
- **Bất biến 1 slot sống/(device,user)** giữ bằng slot-check trước upload + #1 freed slot + #3 revive — KHÔNG repoint.
- Slot bận → defer (skip), tick sau (sau deprovision M1) tự provision M2 → M2 nhận diện trễ ≤ GRACE (chấp nhận).
- KHÔNG migration; raw parameterized; không đụng FAT/DCO/UMR.
