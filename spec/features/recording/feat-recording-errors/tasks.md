# Tasks: Recording Error Handling (REC-007)

- **Feature ID**: REC-007 · **Module**: recording
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> A: no-data probe (502 RECORDING_NO_VIDEO). B: stop captured. C: getStatus errorMessage/captured. SEC no-cred. KHÔNG migration/endpoint. Test MOCK fs+manager+fake timers.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo tasks.md REC-007 (probeStart, no_data→502, captured, errorMessage). | Toàn bộ file |

---

## 1. A — No-data detection
**File**: `recording/services/recording-session.service.ts`
- [ ] Hằng số START_PROBE_MS=5000, POLL_MS=250; `sleep(ms)` private.
- [ ] `probeStart(sessionId, outPath)`: loop tới deadline — exit→'exited'; file>0→'capturing'; hết→'no_data'.
- [ ] startVideo thay waitForGrace: exited→500 RECORDING_START_FAILED; capturing→201; no_data→manager.stop + UPDATE failed(error_message no-data, stopped_at) + BadGateway RECORDING_NO_VIDEO (no cred). **Ref**: FR-001..005, NFR-001..003.

## 2. B — Stop captured
**File**: service `stopVideo` + `controllers/recording-session.controller.ts`
- [ ] empty-file branch return captured:false; file branch captured:true.
- [ ] controller stop: message theo captured; data + captured. **Ref**: FR-006/007.

## 3. C — getStatus surface
**File**: service `getStatus`
- [ ] SELECT thêm error_message; response thêm errorMessage + captured. **Ref**: FR-008.

## 4. Tests (mock, ≥80%)
**File**: `recording/services/recording-session.service.spec.ts`
- [ ] start: capturing(201, no stop) / no_data(stop+UPDATE failed+BadGateway) / exited(500); SEC message no-cred.
- [ ] stop: empty→captured false / file→captured true.
- [ ] getStatus: failed errorMessage + captured.
- [ ] #23 start cập nhật probe; #24/#25/#26/#27 xanh.

## 5. Verify
- [ ] build · lint per-file · jest modules/recording + coverage · boot smoke (started + 0 DI).

---
> Trạng thái: CHỜ REVIEW sau implement.
