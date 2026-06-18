# Tasks: Per-Meeting Face Provisioning (FMP-001)

- **Feature ID**: FMP-001 · **Module**: face-access (+ scheduler)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> provision/deprovision/reconcile qua factory(A)+getPortraitBytes(D). Idempotent per (user,device,bookingId). Cron gated OFF. Qua port, per-participant try/catch, parameterized, KHÔNG migration.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo tasks.md FMP-001. | Toàn bộ file |
| 2026-06-18 | Gộp constraint-safety hardening (nguyên MCS-001) vào FMP-001 — hardening #46/#47, không phải UC mới. | Mục "Constraint-safety hardening" (cuối file) |

---

## 1. Service
**File**: `face-access/services/face-provisioning.service.ts` (mới)
- [ ] provisionUpcomingMeetings + provisionMeeting (device/parts/portrait/upload/add/find/upsert; idempotency skip synced; isolation try/catch → failed). **Ref**: FR-001..005.
- [ ] deprovisionEndedMeetings + deprovisionMeeting (del→removed). **Ref**: FR-006.
- [ ] reconcile (stale→deprovision; dedup uid). **Ref**: FR-007.
- [ ] upsertMapping helper (parameterized). **Ref**: FR-009.

## 2. Module
- [ ] face-access.module: +import AccountsModule; +provider/export FaceProvisioningService.

## 3. Scheduler + ENV
- [ ] scheduler.module +FaceAccessModule; scheduler.service inject + 2 cron (face-sync EVERY_MINUTE, face-reconcile EVERY_5_MIN) gated SCHEDULER_ENABLED && FACE_SYNC_ENABLED. **Ref**: FR-008.
- [ ] env FACE_SYNC_ENABLED/LEAD/GRACE (Joi scoped) + .env.example.

## 4. Tests (mock, ≥80%)
- [ ] provision happy/idempotency/isolation/portrait-null/no-device; deprovision; reconcile stale+dedup.

## 5. Verify
- [ ] build · lint per-file · jest (face-access + scheduler) + coverage. STOP code-review gate.

---
> Trạng thái: CHỜ REVIEW sau code.

## Constraint-safety hardening (rev 2026-06-18, nguyên MCS-001)

### Implementation
- [ ] **T1 (#1)** — `removeMapping`: UPDATE `SET sync_status='deleted', deleted_at=now(), last_synced_at=now() WHERE id=$1`. **null-uid-safe**: giữ guard `if (mp.device_person_id)` → chỉ `deletePerson` khi uid NOT NULL.
- [ ] **T1b (#2b)** — `deprovisionEndedMeetings` query: bỏ `mp.sync_status='synced'`, đổi thành `mp.deleted_at IS NULL` (cleanup mọi `failed`/`pending`/`synced` của họp đã kết thúc).
- [ ] **T2 (#3)** — `upsertMapping` nhánh UPDATE: thêm `deleted_at = NULL` vào SET. INSERT giữ nguyên.
- [ ] **T3 (#2)** — `provisionParticipant`: **GỠ idempotency-check cũ (:123-131)**; SELECT slot `(device_id,user_id, deleted_at IS NULL)` **TRƯỚC** upload; rẽ nhánh provisioned / noop(synced cùng booking — thay idempotency cũ) / revived / **skipped** (slot khác booking → warn, KHÔNG upload, KHÔNG ghi).
- [ ] **T4 (counter)** — `provisionMeeting` gom kết quả; `provisionUpcomingMeetings` trả `{ scanned, skipped }`; `scheduler.faceSync` log thêm `skipped` (optional).
- [ ] **T5** — Test (mock factory/profile/dataSource) ≥80% branch — xem checklist.
- [ ] **T6** — build + lint per-file + jest; STOP code-review gate, KHÔNG commit, KHÔNG migration.

### Test checklist (≥80% branch)
#### #1 removeMapping / deprovision (+ #2b cleanup)
- [ ] `removeMapping` UPDATE chứa `deleted_at = now()` (assert SQL).
- [ ] vẫn gọi `deletePerson(device_person_id)` khi có uid.
- [ ] **null-uid-safe**: `device_person_id NULL` → KHÔNG gọi `deletePerson`, vẫn UPDATE `deleted_at`.
- [ ] **#2b**: `deprovisionEndedMeetings` query chứa `mp.deleted_at IS NULL` và **KHÔNG** `mp.sync_status='synced'` (lấy cả failed/pending).
- [ ] row `failed` (uid NULL) của họp đã kết thúc → removeMapping freed (deleted_at set, no deletePerson) → tick sau provision cùng (device,user) **KHÔNG skip**.

#### #3 upsertMapping revive
- [ ] nhánh UPDATE (reuse row) chứa `deleted_at = NULL` (assert SQL).

#### #2 provisionParticipant (slot-check — thay idempotency cũ)
- [ ] **idempotency hợp nhất**: chỉ slot-check quyết "synced cùng booking → noop"; KHÔNG còn check `sync_status` riêng ở đầu method (không double-skip).
- [ ] **free**: slot-check rỗng → `uploadFace` được gọi + INSERT → kết quả `provisioned`.
- [ ] **same booking synced**: slot sống cùng booking + `sync_status='synced'` → **factory KHÔNG gọi**, không ghi (`noop`).
- [ ] **same booking re-provision** (pending/failed cùng booking): → upload + `upsertMapping` UPDATE (`deleted_at=NULL`), KHÔNG INSERT mới (`revived`).
- [ ] **busy (back-to-back)**: slot sống **khác bookingId** → **factory KHÔNG gọi**, KHÔNG INSERT/UPDATE mapping, `logger.warn`, kết quả `skipped`.
- [ ] portrait null khi slot free → skip-enroll (không upload), KHÔNG tính skipped-constraint.

#### counter
- [ ] `provisionMeeting` nhiều participant (free + busy) → `skipped` đếm đúng.
- [ ] `provisionUpcomingMeetings` cộng dồn `skipped` qua nhiều meeting.

#### invariant / regression
- [ ] không kịch bản nào sinh 2 INSERT cho cùng `(device,user)` (busy → 0 INSERT).
- [ ] deprovision (set deleted_at) → resolveMapping/list loại đúng (regression FAT/UMR vẫn xanh).

### Ràng buộc
- DATA-01 KHÔNG migration; SEC-03 parameterized; import `.js`.
- KHÔNG repoint; KHÔNG đụng FAT/DCO/UMR; KHÔNG module mới.
- STOP code-review gate, chưa commit.
