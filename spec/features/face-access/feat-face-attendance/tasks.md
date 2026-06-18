# FAT-001 — TASKS

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Tạo tasks FAT-001. | Toàn bộ |

- [ ] **T1** — `common/ports/face-verify-hook.ts`: `FaceVerifyInput` (deviceId, roomId, personId, personName, verifyTime), `FaceVerifyHook { onVerify(input): Promise<void> }`, `FACE_VERIFY_HOOK` token.
- [ ] **T2** — `FaceAttendanceService implements FaceVerifyHook`: onVerify + resolveMapping + upsertRecord + insertEvent + getLateGraceMinutes. Raw SQL parameterized.
- [ ] **T3** — `face-access.module.ts`: `@Global()`, provide `{provide: FACE_VERIFY_HOOK, useExisting: FaceAttendanceService}`, export token + service.
- [ ] **T4** — `iot-devices.service.ts`: `@Optional() @Inject(FACE_VERIFY_HOOK) faceHook?`; sau commit gọi `await this.faceHook?.onVerify({...})` trong try/catch (log lỗi, KHÔNG throw).
- [ ] **T5** — env: `ATTENDANCE_LATE_GRACE_MINUTES` (Joi scoped) + `.env.example`.
- [ ] **T6** — spec test ≥80% branch: AC-001..006 (present, late, repeat, no-mapping, no-meeting, hook try/catch nuốt lỗi).
- [ ] **T7** — build + lint per-file + jest coverage; STOP code-review gate, KHÔNG commit.
