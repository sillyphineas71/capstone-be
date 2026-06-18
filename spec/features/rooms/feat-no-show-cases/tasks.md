# Tasks: No-show Cases (NSC-001)

- **Feature ID**: NSC-001 · **Module**: rooms (+ scheduler)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> UC-41 create (internal token, idempotent) + UC-42 update (JWT perm) + detect() cron (gate OFF). Atomic dedup, candidate LEFT JOIN, threshold precedence, WS best-effort. KHÔNG migration. Test MOCK.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Khởi tạo tasks.md NSC-001. | Toàn bộ file |

---

## 1. ENV + Guard
- [ ] env.validation +NOSHOW_INTERNAL_TOKEN (allow '' default '') +NO_SHOW_THRESHOLD_MINUTES (int min1 default15); .env.example +.env.
- [ ] `rooms/guards/internal-token.guard.ts`: constant-time compare header x-internal-token; fail-closed; KHÔNG log token. **Ref**: FR-004, NFR-001.

## 2. DTO
- [ ] `create-no-show.dto.ts` (bookingId/meetingId/roomId @IsUUID; detectionStatus? IsIn risk/confirmed; evidenceJson? IsObject).
- [ ] `update-no-show.dto.ts` (detectionStatus? IsString; resolutionStatus? IsIn kept/false_positive/manual_override; note? IsString).

## 3. NoShowService
**File**: `rooms/services/no-show.service.ts`
- [ ] create: atomic INSERT...WHERE NOT EXISTS RETURNING; 0 row → SELECT existing (idempotent); WS emit best-effort chỉ khi created. **Ref**: FR-001/002/008.
- [ ] update: 404; terminal→400; transition {warning_sent,released}→400 INVALID_NO_SHOW_TRANSITION; ngoài {confirmed,dismissed,resolved}→400 INVALID_DETECTION_STATUS; resolved_by=user. **Ref**: FR-005/006/007.

## 4. NoShowDetectionService
**File**: `rooms/services/no-show-detection.service.ts`
- [ ] readThreshold: system_configs→env→15. candidate query (bind threshold, LEFT JOIN usage, NOT EXISTS). per-booking try/catch. detect không throw. **Ref**: FR-009/011.

## 5. Controller + Module + Scheduler
- [ ] `no-show.controller.ts`: POST internal/no-show-cases (InternalTokenGuard, 201/200 động) + PATCH no-show-cases/:id (JWT+MockPerm+@Permissions('room.noshow.update')+ParseUUIDPipe).
- [ ] rooms.module +WebsocketModule +NoShowController +NoShow*Service, export NoShowDetectionService.
- [ ] scheduler.module +RoomsModule; scheduler.service inject DetectionService, checkNoShow→try detect catch (gate OFF). **Ref**: FR-010.

## 6. Tests (mock, ≥80%)
- [ ] service create/update; detection threshold/candidate/isolation; controller token/passthrough.

## 7. Verify
- [ ] build · lint per-file · jest (rooms+scheduler+presence) + coverage · boot smoke (2 route mapped + 0 DI). STOP code-review gate.

---
> Trạng thái: CHỜ REVIEW sau implement.
