# IPS-001 — plan.md (#37 IVSS person sync)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo plan IPS-001 sau spec DUYỆT (OQ-1…7 + C1–C3). Tái dùng device_user_mappings + seed bridge iot_devices; cron ivssSync riêng; enroll-once-while-active. No-migration. C1 RECON cross-cron. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. C1 — Cross-cron isolation (RECON code thật, KẾT LUẬN)
Đọc [face-provisioning.service.ts:207-314](../../../../src/modules/face-access/services/face-provisioning.service.ts):
- **`deprovisionEndedMeetings()`** (FMP cron cleanup): `SELECT … FROM device_user_mappings mp JOIN meetings me ON me.id=(mp.metadata_json->>'bookingId')::uuid WHERE mp.deleted_at IS NULL AND me.status<>'cancelled' AND me.end_time<=now()-grace` — **KHÔNG lọc device_id / device_type**. JOIN theo `metadata.bookingId`: IVSS mapping **nếu mang `bookingId`** sẽ bị vợt; nếu KHÔNG mang bookingId thì JOIN trượt (thoát).
- **`reconcile()` STALE**: tương tự (JOIN bookingId, no device filter).
- **`reconcile()` DEDUP**: `SELECT … WHERE sync_status='synced'` — **KHÔNG JOIN, KHÔNG lọc device** → **CHẮC CHẮN vợt MỌI synced mapping kể cả IVSS** → rồi `findDeviceById(mp.device_id)` + `factory.create(...)` (FaceGate provider) gọi `findUidByName` trên **bridge device** = SAI (bridge không phải FaceGate CGI).
- **`provisionUpcomingMeetings()`**: query `meetings` rồi `findFaceDevice(room_id)` (chỉ `device_type='face_server'`) → **KHÔNG bao giờ enroll vào bridge** → provision-side đã cô lập bằng device-type.

**KẾT LUẬN**: FMP **cleanup/reconcile CÓ đụng** mapping IVSS (chắc chắn ở reconcile-dedup; ở deprovision/stale nếu IVSS mang bookingId). **Cô lập được KHÔNG cần migration** (đúng hướng Thiếu Chủ cho phép):
1. **Mọi query IVSS** (provision/cleanup/dedupe) lọc `device_id = <bridge>` **AND** `metadata_json->>'source' = 'ivss'`.
2. **Patch 3 query FMP** thêm loại trừ IVSS (sửa CODE FMP, KHÔNG schema): `AND COALESCE(mp.metadata_json->>'source','') <> 'ivss'` vào `deprovisionEndedMeetings`, `reconcile`-stale, `reconcile`-dedup.
3. **Bridge device có `device_type='ivss_bridge'` RIÊNG** (FMP `findFaceDevice` chỉ `face_server` → provision FMP không chạm bridge; mapping IVSS có source='ivss').
→ 2 cron (`faceSync` door ↔ `ivssSync` IVSS) KHÔNG đụng mapping của nhau. (Nếu sau này không cô lập được mà không sửa schema → DỪNG; hiện KHÔNG cần.)

## 1. Quyết định đã chốt (OQ + C)
OQ-1 tái dùng `device_user_mappings` + seed 1 `iot_devices` bridge (no-migration) · OQ-2 1 group chung `IVSS_DEFAULT_GROUP`, `createGroup` idempotent · OQ-3 cron pre-provision lead phút trước start · OQ-4 cron cleanup mapping-driven · OQ-5 best-effort (ok:false→log+mapping failed+last_sync_error, cron retry, KHÔNG fail họp) · OQ-6 **enroll-once-while-active** (1 mapping sống/(bridge,user); gỡ khi user hết mọi họp active) · OQ-7 thiếu ảnh→skip+log.
- **C2** cron riêng `ivssSync` gate `SCHEDULER_IVSS_SYNC_ENABLED` default OFF.
- **C3** szUid: `enrollFace.personUid` = **stable per-user** (`sha256(userId).slice(0,32)`, KHÔNG gắn meeting); szUid IVSS trả lưu `device_person_id`; `deleteFace` xoá theo personUid-gửi. ⚠ field chứa szUid trong `IvssFaceRef` + deleteFace-by (personUid vs szUid) **chốt theo README bridge** (owed, §7).

## 2. Seed bridge device (no-migration — data) — RECON verified
`iot_devices.room_id` **nullable** ✓, `device_type` varchar **no CHECK** ✓ (giá trị mới `'ivss_bridge'` OK), `device_code`/`status` NOT NULL. Seed 1 row: `device_code='IVSS-BRIDGE'`, `device_type='ivss_bridge'`, `room_id=NULL`, `status='online'`. IVSS code resolve bridge device qua `device_code='IVSS-BRIDGE'` (raw SQL, KHÔNG cần thêm value vào TS enum IoTDeviceType). **Owed**: seed row khi deploy (ghi runbook); service tự ensure (find-or-create) hoặc seed script — chốt ở task.

## 3. IvssPersonSyncService (module ivss)
- Inject: `@Inject(IVSS_BRIDGE) IvssBridgePort` (import type), `FaceProfileService`, `DataSource`, `ConfigService`.
- `private resolveBridgeDeviceId()`: `SELECT id FROM iot_devices WHERE device_code='IVSS-BRIDGE' AND device_type='ivss_bridge' LIMIT 1` → null → log + cron no-op (chưa seed).
- `private ensureGroup()` (OQ-2): `createGroup({name: IVSS_DEFAULT_GROUP})` idempotent — gọi 1 lần đầu provision/cron; ok:false → log, vẫn thử enroll (bridge tự lo nếu group có sẵn).
- `personUidOf(userId)` = `sha256(userId).slice(0,32)` (C3 stable per-user).
- **`provisionUpcoming()`**: window mirror FMP (`status IN ('scheduled','in_progress') AND room_id IS NOT NULL AND start_time <= now()+lead AND end_time>now()`) → participants (`meeting_participants.user_id`) → `enrollAttendee`. Per-item try/catch.
- **`enrollAttendee(userId, meeting)`**:
  1. **Dedupe (OQ-6)**: mapping sống `(device=bridge, user, source='ivss', sync_status='synced')` → **noop**.
  2. `getPortraitBytes(userId)` null → **skip+log** (OQ-7).
  3. `Buffer→base64`; `bridge.enrollFace({groupId, personUid, name?, imageBase64})`.
  4. `ok:false` → upsert mapping `sync_status='failed'`, `last_sync_error`, source='ivss' (OQ-5, KHÔNG throw).
  5. `ok:true` → upsert mapping `device_person_id=<szUid>`, `sync_status='synced'`, `metadata_json={source:'ivss', groupId, lastMeetingId}`.
- **`cleanupEnded()`** (mapping-driven, OQ-6): IVSS mapping sống (`device=bridge, source='ivss'`) mà user **KHÔNG còn họp active/upcoming** (NOT EXISTS meeting_participants JOIN meetings status active AND end_time > now()-grace) → `bridge.deleteFace({groupId, personUid})` → ok → **soft-delete** mapping; fail → log + giữ (retry). Per-item try/catch.
- SEC-03: raw SQL bind tham số (mirror FMP `upsertMapping`/`removeMapping`). SEC-01: KHÔNG log base64/token.

## 4. FMP isolation patch (C1 — sửa face-provisioning.service.ts, no-migration)
Thêm `AND COALESCE(mp.metadata_json->>'source','') <> 'ivss'` vào 3 query: `deprovisionEndedMeetings`, `reconcile` stale, `reconcile` dedup. (Chỉ thêm điều kiện WHERE — KHÔNG đổi logic khác.) ⚠ chạm file FMP — flag rõ; baseline-proof lint.

## 5. Env + cron wiring
- **Env (Joi scoped)**: `SCHEDULER_IVSS_SYNC_ENABLED` (bool default false); `IVSS_SYNC_LEAD_MINUTES` (int min 1 default 5), `IVSS_SYNC_GRACE_MINUTES` (int min 0 default 5). (IVSS-riêng để tune độc lập FMP.) `IVSS_DEFAULT_GROUP` đã có (#36).
- **scheduler.service.ts**: cron `ivssSync` EVERY_MINUTE, gate `SCHEDULER_ENABLED && SCHEDULER_IVSS_SYNC_ENABLED` (default OFF), inject `IvssPersonSyncService`, gọi `provisionUpcoming()` + `cleanupEnded()`, log `scanned/enrolled/skipped/removed/failed`, try/catch không throw ra cron (ARCH-02).
- **ivss.module.ts**: provider `IvssPersonSyncService` (+ export nếu cần); cần `FaceProfileService` → import module export nó (AccountsModule?) — xác nhận export ở task wiring.

## 6. File list
### Net-new
- `src/modules/ivss/services/ivss-person-sync.service.ts` (+ `.spec.ts`).
### Modified
- `src/modules/ivss/ivss.module.ts` — provider + import module cấp `FaceProfileService`.
- `src/modules/scheduler/scheduler.service.ts` (+ `.spec.ts`) — cron `ivssSync` + inject.
- `src/modules/face-access/services/face-provisioning.service.ts` — **C1 isolation patch** (3 query). (+ test cập nhật nếu spec assert SQL.)
- `src/config/env.validation.ts` — Joi scoped (KHÔNG prettier cả file). `.env.example` — 3 key.
- (Module cấp `FaceProfileService`: xác nhận `AccountsModule`/`FaceProfileService` export — import vào IvssModule.)

## 7. Test (mock port + mock FaceProfileService + mock DataSource — KHÔNG thiết bị)
- enroll ok → mapping synced + szUid lưu `device_person_id`; bridge ok:false → mapping failed + last_sync_error + **KHÔNG throw** (OQ-5); portrait null → skip + KHÔNG enroll (OQ-7); dedupe synced → noop (OQ-6); cleanup user-hết-active → deleteFace + soft-delete; deleteFace fail → giữ mapping; batch resilience (1 lỗi không chặn); query có lọc `device_id` + `source='ivss'` (C1); bridge chưa seed → no-op.
- scheduler: gate OFF → không gọi; ON → provision+cleanup gọi; throw → không ném ra cron.
- FMP patch: (nếu có spec) assert 3 query chứa loại trừ `source <> 'ivss'`.
- Coverage **≥80%** `ivss-person-sync.service.ts`.

## 8. Gate (STOP, KHÔNG commit)
- build=0; eslint touched+spec baseline-proof (stash `face-provisioning.service.ts`/`scheduler.service.ts`/`app.module? no`/`env.validation.ts`) **0 rule mới**, file mới 0; `npx jest src/modules/ivss src/modules/scheduler src/modules/face-access` xanh; coverage ≥80% service mới; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies). **KHÔNG live.**
- **Owed**: live-runbook enroll/delete thật (bridge+HDD) · seed bridge `iot_devices` (IVSS-BRIDGE/ivss_bridge) · arm Face Comparison khớp `IVSS_DEFAULT_GROUP` · chốt szUid field + deleteFace-by theo README bridge (C3).

## 9. Kỷ luật
- **No-migration**: bảng/cột mới → DỪNG. Seed `iot_devices` row = **data, OK** (ghi runbook). Patch FMP = chỉ thêm WHERE, no-schema.
- **SEC-01** ảnh/token KHÔNG log/audit; **SEC-03** bind raw SQL (mirror FMP); **ARCH-01** qua port `IVSS_BRIDGE`, KHÔNG NetSDK trong NestJS; **ARCH-02** cron gated OFF + try/catch per item + no-throw + log số liệu.
- Envelope/route: #37 không route user (chỉ service/cron); nếu thêm admin-trigger route → admin-gated (defer).

> **STOP.** Plan + tasks chờ review trước khi code.
