# DCO-001 — PLAN

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo plan DCO-001 — đọc Direction trong parseVerifyPayload, nhánh OUT trong onVerify, env mapping. | Toàn bộ |
| 2026-06-18 | Re-review: util PURE (trích directionRaw), map hướng ở service (ConfigService), checkOut idempotent + event chỉ khi đổi, source_type='camera', post-grace=FACE_SYNC_GRACE_MINUTES. | Sơ đồ, Files, parseVerifyPayload, onVerify, Quyết định |

## Kiến trúc (tái dùng, không module mới)
```
Door Terminal verify (IN/OUT)
  → iot.receiveVerifyEvent
      → parseVerifyPayload(body)               [SỬA] +directionRaw/opendoorWay (PURE, KHÔNG env)
      → direction = String(directionRaw) === FACE_DIRECTION_OUT_VALUE ? 'out' : 'in'   [service, ConfigService]
      → hook.onVerify({...FaceVerifyInput, direction})   [SỬA port +direction]
          → FaceAttendanceService.onVerify     [SỬA] rẽ nhánh IN / OUT
              ├─ IN  → logic FAT-001 cũ (check_in / face_detected)
              └─ OUT → set check_out_time (idempotent) + left_early + event check_out
```
- Mapping IN/OUT đọc 1 nơi (`iot-devices.service`) qua env `FACE_DIRECTION_OUT_VALUE`; `parseVerifyPayload` giữ PURE (chỉ trích `directionRaw`).
- KHÔNG migration: `check_out_time`, `left_early`, `attendance_events` đều có sẵn.

## Files
| File | Hành động |
| :--- | :--- |
| `src/modules/iot/utils/face-verify-payload.util.ts` | EDIT — **PURE**: chỉ trích `directionRaw` (=`info.Direction`) + `opendoorWay` vào `ParsedVerify`. KHÔNG env, KHÔNG suy 'in'/'out'. |
| `src/common/ports/face-verify-hook.ts` | EDIT — `FaceVerifyInput` +`direction: 'in'\|'out'` (+`directionRaw?`/`opendoorWay?` optional). |
| `src/modules/iot/services/iot-devices.service.ts` | EDIT — đọc `FACE_DIRECTION_OUT_VALUE` (ConfigService), tính `direction`, truyền `direction`(+raw) vào `faceVerifyHook.onVerify({...})` trong block FAT-001. |
| `src/modules/face-access/services/face-attendance.service.ts` | EDIT — rẽ nhánh: `direction==='out'` → `checkOut()`; else giữ check_in. Thêm private `checkOut(...)`. |
| `src/config/env.validation.ts` | EDIT — `FACE_DIRECTION_OUT_VALUE` (Joi string default `'2'`), scoped, KHÔNG prettier cả file. |
| `.env.example` | EDIT — `FACE_DIRECTION_OUT_VALUE=2` + comment "giả định, xác nhận live". |
| `*.spec.ts` (util + service) | EDIT — thêm test parse direction + nhánh OUT. |

## parseVerifyPayload (sửa) — GIỮ PURE
- Trích thêm `directionRaw = info.Direction ?? null`, `opendoorWay = info.OpendoorWay ?? null` vào `ParsedVerify`.
- **KHÔNG đọc env, KHÔNG tính 'in'/'out'.** Giữ `isValid`/`personId`/`personName` như cũ (gate VerifyPush + VerifyStatus===1 áp cho cả IN/OUT).

## Suy hướng — ở iot-devices.service (KHÔNG ở util)
- `outValue = this.configService.get('FACE_DIRECTION_OUT_VALUE', '2')`.
- `direction = String(directionRaw ?? '') === outValue ? 'out' : 'in'` (thiếu/khác → `'in'`).
- Truyền `direction` (+`directionRaw`/`opendoorWay`) vào `faceVerifyHook.onVerify({...})`.

## onVerify (sửa) — rẽ nhánh
1. resolve mapping (giữ nguyên: guard `synced` + `deleted_at IS NULL`) → null → unmatched, return.
2. load meeting (id, start_time, end_time, actual_end_time, status).
3. **IF `direction === 'out'`** → `checkOut(meeting, userId, verifyTime, deviceId, roomId)`:
   - `effectiveEnd = actual_end_time ?? end_time`; `grace = configService.get('FACE_SYNC_GRACE_MINUTES', 5)`.
   - `status === 'cancelled'` → warn, return.
   - `verifyTime > effectiveEnd + grace*60_000` → warn, return (§6; khớp mốc deprovision).
   - SELECT record `(meeting_id, user_id)`; không có HOẶC `check_in_time IS NULL` → warn (chưa từng check-in), return.
   - **idempotent (FR-007)**: nếu `check_out_time IS NOT NULL` AND `verifyTime <= check_out_time` → **return (KHÔNG UPDATE, KHÔNG event)**.
   - else: `left_early = verifyTime < effectiveEnd`; `UPDATE attendance_records SET check_out_time=$2, left_early=$3, updated_at=now() WHERE id=$1`; **rồi mới** INSERT `attendance_events (... event_type='check_out', event_time=verifyTime, source_type='camera')` — `source_type='camera'` KHỚP event check_in cửa (đã verify).
4. **ELSE (`in`)** → logic FAT-001 hiện tại (gate họp mở + upsert check_in/face_detected + event) — KHÔNG đổi.

## Quyết định (CHỐT)
- Direction map ở **service** qua `FACE_DIRECTION_OUT_VALUE` (giả định 2=out/1=in) — `parseVerifyPayload` giữ PURE; comment "cần xác nhận live".
- KHÔNG migration; `check_out_method` né bằng `attendance_events` (event_type=`check_out`, `source_type='camera'`).
- **Post-grace OUT = `FACE_SYNC_GRACE_MINUTES` (tái dùng grace deprovision, KHÔNG env mới)**: chặn `cancelled`; ghi tới `effectiveEnd + grace`; ngoài → warn+skip. Khớp mốc deprovision (§8.1 spec) → không có vùng OUT-hợp-lệ-nhưng-mapping-mất.
- event `check_out` chỉ INSERT khi `check_out_time` thực ghi/đổi (idempotent).
