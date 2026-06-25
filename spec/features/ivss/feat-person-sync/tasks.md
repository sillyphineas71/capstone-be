# IPS-001 — tasks.md (#37 IVSS person sync)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo tasks IPS-001: T0 RECON-verify → T1 service enroll → T2 cleanup → T3 FMP isolation patch (C1) → T4 cron+env → T5 wiring → tests → T-GATE. No-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration (seed iot_devices = data).

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T6 → T-GATE.

---

## T0 — Live verify (no-migration guard) — plan §0/§2
- Xác nhận: `device_user_mappings` cột (device_id/device_person_id/sync_status/last_sync_error/metadata_json/deleted_at) ✓ (RECON); `iot_devices.room_id` nullable + `device_type` no-CHECK ✓ (RECON); `meeting_participants.user_id` tồn tại; `FaceProfileService.getPortraitBytes` export + `AccountsModule` export nó (cho IvssModule import).
- **AC**: dán xác nhận; thiếu cột/không export được FaceProfileService → DỪNG báo (không tạo bảng/cột mới).

## T1 — IvssPersonSyncService: provision + enroll (code) — §3, OQ-1/2/5/6/7, C3
- `resolveBridgeDeviceId()` (device_code='IVSS-BRIDGE'); `ensureGroup()` (createGroup idempotent); `personUidOf(userId)=sha256(userId)[:32]`.
- `provisionUpcoming()`: window mirror FMP + participants → `enrollAttendee` (per-item try/catch).
- `enrollAttendee`: dedupe (live synced source=ivss → noop) → portrait null → skip+log → base64 → `enrollFace` → ok: mapping synced + szUid(`device_person_id`) + metadata{source:'ivss',groupId} / ok:false: mapping failed+last_sync_error. KHÔNG throw, KHÔNG log base64/token.
- **AC**: enroll ok → upsert mapping `sync_status='synced'` + `device_person_id=szUid` + `metadata.source='ivss'`; query enroll/dedupe lọc `device_id=bridge AND source='ivss'`.

## T1b — provision/enroll test — OQ-5/6/7
- ok→synced+szUid; bridge ok:false→failed+last_sync_error+KHÔNG throw; portrait null→skip (không enrollFace); dedupe synced→noop; bridge chưa seed→no-op; batch resilience.
- **AC**: ≥80% branch nhánh enroll.

## T2 — cleanupEnded (code) — §3, OQ-4/6
- `cleanupEnded()`: IVSS mapping sống (`device=bridge, source='ivss'`) mà user KHÔNG còn họp active/upcoming (NOT EXISTS … end_time > now()-grace) → `deleteFace({groupId, personUid})` → ok→soft-delete; fail→giữ+log. Per-item try/catch.
- **AC**: user hết active → deleteFace gọi + mapping `deleted_at` set; deleteFace fail → mapping KHÔNG xoá.

## T2b — cleanup test
- ended→deleteFace+soft-delete; user vẫn còn họp active→KHÔNG gỡ; deleteFace ok:false→giữ mapping; query lọc device+source.
- **AC**: các nhánh xanh.

## T3 — FMP isolation patch (C1, code) — plan §4
- `face-provisioning.service.ts`: thêm `AND COALESCE(mp.metadata_json->>'source','') <> 'ivss'` vào `deprovisionEndedMeetings`, `reconcile` stale, `reconcile` dedup. CHỈ thêm WHERE, không đổi logic khác.
- **AC**: 3 query chứa loại trừ `source <> 'ivss'`; build + FMP test cũ vẫn xanh.

## T3b — FMP patch test
- (Nếu FMP spec assert SQL) cập nhật/them assert 3 query loại trừ ivss; FMP regression xanh.
- **AC**: FMP spec xanh, không hồi quy.

## T4 — Cron ivssSync + env (code) — C2, ARCH-02
- `env.validation.ts` (scoped): `SCHEDULER_IVSS_SYNC_ENABLED`(false), `IVSS_SYNC_LEAD_MINUTES`(5), `IVSS_SYNC_GRACE_MINUTES`(5). `.env.example` 3 key.
- `scheduler.service.ts`: cron `ivssSync` EVERY_MINUTE, gate `SCHEDULER_ENABLED && SCHEDULER_IVSS_SYNC_ENABLED` (default OFF), inject `IvssPersonSyncService`, gọi `provisionUpcoming()`+`cleanupEnded()`, log số liệu, try/catch không throw ra cron.
- **AC**: gate OFF→không gọi; ON→provision+cleanup gọi; build resolve DI.

## T4b — scheduler test — ARCH-02
- gate OFF→no-op; ON→provision+cleanup 1 lần; service throw→log, không ném ra cron.
- **AC**: gating + resilience xanh.

## T5 — Wiring (code) — plan §5/§6
- `ivss.module.ts`: provider `IvssPersonSyncService`; import module export `FaceProfileService` (AccountsModule). SchedulerModule đã import RoomsModule/face-access — thêm import module chứa IvssPersonSyncService (IvssModule export service) nếu cần.
- **AC**: build resolve DI; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies).

## T6 — Gom coverage service mới
- jest coverage `ivss-person-sync.service.ts` ≥80% branch; bổ sung nhánh thiếu.
- **AC**: ≥80% branch.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- build=0; eslint touched+spec baseline-proof (stash `face-provisioning.service.ts`/`scheduler.service.ts`/`env.validation.ts`) 0 rule mới, file mới 0; `npx jest src/modules/ivss src/modules/scheduler src/modules/face-access` xanh; coverage ≥80% service mới; DI-proof. **KHÔNG live.**
- **Owed (ghi, KHÔNG chạy)**: live-runbook enroll/delete thật (bridge+HDD) · seed bridge `iot_devices` (IVSS-BRIDGE / ivss_bridge / room_id NULL) · arm Face Comparison khớp `IVSS_DEFAULT_GROUP` · chốt szUid field trong IvssFaceRef + deleteFace-by theo README bridge (C3).
- **AC**: bảng gate đầy đủ + báo cáo: C1 isolation (IVSS query lọc device+source · FMP 3 query patch) hoạt động · enroll-once-while-active (OQ-6) · bridge-down best-effort (OQ-5) · szUid lưu device_person_id (C3) · coverage · DI-proof. STOP.

## Map task → scope #37
- T1/T1b → enroll attendee per-meeting (provision)
- T2/T2b → gỡ sau họp (cleanup, enroll-once-while-active)
- T3/T3b → C1 cross-cron isolation (FMP patch)
- T4/T4b/T5 → cron ivssSync + env + wiring
