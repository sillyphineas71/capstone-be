# DCO-001 — TASKS

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo tasks DCO-001. | Toàn bộ |
| 2026-06-18 | Re-review: T1 util PURE (directionRaw), tách T3 map hướng ở service, T4 event idempotent + source_type='camera', T5 post-grace=FACE_SYNC_GRACE_MINUTES (không env mới); test checklist tách util/service + thêm idempotent-skip/source_type. | T1–T5, test checklist |

## Implementation
- [ ] **T1** — `face-verify-payload.util.ts` (**GIỮ PURE**): trích `directionRaw = info.Direction ?? null` + `opendoorWay = info.OpendoorWay ?? null` vào `ParsedVerify`. **KHÔNG đọc env, KHÔNG suy 'in'/'out'.**
- [ ] **T2** — `face-verify-hook.ts`: `FaceVerifyInput` +`direction: 'in'|'out'` (+`directionRaw?`/`opendoorWay?`).
- [ ] **T3** — `iot-devices.service.ts`: đọc `FACE_DIRECTION_OUT_VALUE` (ConfigService, default `'2'`), tính `direction = String(directionRaw ?? '') === outValue ? 'out' : 'in'`, truyền `direction`(+raw) vào `faceVerifyHook.onVerify({...})`. **Comment: giả định 2=out/1=in, CẦN xác nhận live.** Không đổi logic verify khác.
- [ ] **T4** — `face-attendance.service.ts`: rẽ nhánh `direction==='out'` → `checkOut()`; else giữ check_in. `checkOut`: gate `cancelled` + post-grace = `FACE_SYNC_GRACE_MINUTES`; yêu cầu đã check-in (record + `check_in_time` NOT NULL); idempotent `check_out_time` (chỉ ghi nếu NULL/muộn hơn); `left_early`; INSERT event `check_out` (`source_type='camera'`) **CHỈ khi thực ghi/đổi** check_out_time.
- [ ] **T5** — env: **chỉ thêm** `FACE_DIRECTION_OUT_VALUE` (Joi string default `'2'`, scoped) + `.env.example` (comment giả định). **Post-grace OUT tái dùng `FACE_SYNC_GRACE_MINUTES` — KHÔNG env mới.** KHÔNG prettier cả file.
- [ ] **T6** — Test (mock dataSource/config) ≥80% branch — xem checklist dưới.
- [ ] **T7** — build + lint per-file + jest; STOP code-review gate, KHÔNG commit, KHÔNG migration.
- [ ] **T8** (post-merge, manual) — bật `FACE_VERIFY_DEBUG=true`, quét RA/VÀO thật, đọc `info.Direction` → **xác nhận giá trị OUT** → chỉnh `FACE_DIRECTION_OUT_VALUE` nếu khác `2`.

## Test checklist (≥80% branch)
### parseVerifyPayload (util — PURE)
- [ ] trích `directionRaw = info.Direction` (hoặc null khi thiếu).
- [ ] trích `opendoorWay = info.OpendoorWay`.
- [ ] **KHÔNG** trả 'in'/'out', **KHÔNG** đọc env.
- [ ] gate cũ vẫn đúng (operator≠VerifyPush / VerifyStatus≠1 → isValid=false).

### direction map (iot-devices.service)
- [ ] `directionRaw === outValue` → truyền `direction='out'`.
- [ ] `directionRaw !== outValue` / thiếu → `direction='in'`.
- [ ] đọc `FACE_DIRECTION_OUT_VALUE` qua ConfigService (override default `'2'`).

### onVerify — nhánh OUT
- [ ] OUT + đã check-in, ra trước end → set `check_out_time`, `left_early=true`, +1 event `check_out` (`source_type='camera'`).
- [ ] OUT + đã check-in, ra ≥ end (trong grace) → `check_out_time` set, `left_early=false`, +1 event.
- [ ] OUT idempotent: ra MUỘN hơn → UPDATE + INSERT event mới.
- [ ] **OUT idempotent-skip: ra SỚM hơn `check_out_time` đã lưu → KHÔNG UPDATE, KHÔNG INSERT event.**
- [ ] OUT chưa từng check-in (no record) → 0 ghi, warn.
- [ ] OUT record tồn tại nhưng `check_in_time` NULL → 0 ghi, warn.
- [ ] OUT khi `status='cancelled'` → bỏ qua.
- [ ] OUT `verifyTime > effectiveEnd + FACE_SYNC_GRACE_MINUTES` → warn/skip.
- [ ] OUT mapping deleted/unmatched → no record (resolveMapping `synced`+`deleted_at IS NULL`).
- [ ] event `check_out` `source_type='camera'` (khớp check_in).

### onVerify — nhánh IN (regression)
- [ ] IN giữ nguyên FAT-001 (present/late, gate họp mở, verify lặp → face_detected).

## Ràng buộc
- SEC-03 parameterized; DATA-01 KHÔNG migration; import `.js`.
- Tái dùng `parseVerifyPayload` + `onVerify` + `FACE_VERIFY_HOOK`; không module mới.
- STOP ở code-review gate; chưa commit.
