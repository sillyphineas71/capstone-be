# Tasks: Per-Meeting Face Provisioning (FMP-001)

- **Feature ID**: FMP-001 · **Module**: face-access (+ scheduler)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> provision/deprovision/reconcile qua factory(A)+getPortraitBytes(D). Idempotent per (user,device,bookingId). Cron gated OFF. Qua port, per-participant try/catch, parameterized, KHÔNG migration.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo tasks.md FMP-001. | Toàn bộ file |

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
