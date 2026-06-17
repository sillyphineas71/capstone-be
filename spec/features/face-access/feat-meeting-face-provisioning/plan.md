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
