---
name: feat-recording-errors-plan
description: Kế hoạch REC-007 — no-data probe khi start (RECORDING_NO_VIDEO 502), captured ở stop, errorMessage ở getStatus.
category: recording
---

# Implementation Plan: Recording Error Handling (REC-007)

- **Feature ID**: REC-007 · **Module**: recording · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo plan.md REC-007 (probeStart poll file>0, no_data→502, captured stop, getStatus errorMessage/captured). D-1..4 chốt. | Toàn bộ file |

---

## 1. Technical Context (RECON spec §2)
- startVideo grace 2s → thay bằng probeStart (poll file>0). manager.get/has/stop sẵn. ffmpeg frag → file>0 sớm.
- stopVideo empty-file branch sẵn → thêm captured. getStatus SELECT thêm error_message.
- DATA-01: KHÔNG migration (dùng status/error_message có sẵn). KHÔNG endpoint mới (D-3).

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Sửa | `recording/services/recording-session.service.ts` (probeStart + startVideo no_data; stopVideo captured; getStatus errorMessage/captured) |
| Sửa | `recording/controllers/recording-session.controller.ts` (stop message theo captured) |
| Sửa (test) | `recording/services/recording-session.service.spec.ts` (start probe; stop captured; getStatus) |

## 3. A — probeStart + startVideo
```ts
private static readonly START_PROBE_MS = 5000;
private static readonly POLL_MS = 250;

private async probeStart(sessionId, outPath): Promise<'capturing'|'exited'|'no_data'> {
  const deadline = Date.now() + START_PROBE_MS;
  for (;;) {
    const proc = this.processManager.get(sessionId);
    if (!this.processManager.has(sessionId) || (proc && proc.exitCode !== null)) return 'exited';
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return 'capturing';
    if (Date.now() >= deadline) return 'no_data';
    await this.sleep(POLL_MS);
  }
}
// startVideo sau manager.start:
const res = await this.probeStart(sessionId, outPath);
if (res === 'exited') throw 500 RECORDING_START_FAILED;
if (res === 'no_data') {
  await this.processManager.stop(sessionId);               // markStopping+kill+cleanup
  await UPDATE recording_sessions SET status='failed', error_message='no video data received from camera', stopped_at=now WHERE id;
  throw new BadGatewayException({ code:'RECORDING_NO_VIDEO', message:'Camera không gửi dữ liệu video (kiểm tra camera đã bật và tới được).' });
}
// 'capturing' → trả 201 recording (như cũ).
```
- `sleep(ms)` private (new Promise setTimeout). KHÔNG url/cred trong message.

## 4. B — stopVideo captured + controller
```text
stopVideo: empty-file branch return {…, captured:false}; file branch return {…, captured:true}.
controller stop: message = captured ? 'Video recording stopped' : 'Đã dừng nhưng không ghi được video'; data gồm captured.
```

## 5. C — getStatus
```text
SELECT thêm error_message.
response thêm: errorMessage (s.error_message ?? null),
  captured = live ? (file hiện>0) : (Number(file_size_bytes||0) > 0).
```

## 6. Tests (mock fs + manager + fake timers, ≥80%)
- start: capturing (statSync size>0 vòng đầu→201, KHÔNG stop); no_data (size 0 → hết cửa sổ → manager.stop gọi + UPDATE failed + BadGateway RECORDING_NO_VIDEO); exited (has→false/exitCode→500). SEC message KHÔNG cred.
- stop: empty→captured false; file→captured true.
- getStatus: failed có error_message → errorMessage + captured đúng.
- #23 start tests cập nhật theo probe; #24/#25/#26/#27 xanh.

## 7. [NEEDS CLARIFICATION]
- Không còn (D-1..4 chốt).

## 8. DoD
```
[ ] probeStart poll file>0 (capturing/exited/no_data), giới hạn cửa sổ
[ ] startVideo: no_data→stop+failed+502 RECORDING_NO_VIDEO; exited→500; capturing→201
[ ] stopVideo captured (false/true) + controller message
[ ] getStatus errorMessage + captured (SELECT error_message)
[ ] SEC message không cred; KHÔNG migration; tests ≥80%; build/lint/jest/boot xanh
```

> Trạng thái: CHỜ REVIEW sau implement. Chưa commit.
