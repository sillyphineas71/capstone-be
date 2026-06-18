# DCO-001 — Suy ra & lưu check-out tại cửa (door check-out)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo spec DCO-001 (Face-access #18): đọc info.Direction từ verify → suy ra IN/OUT → ghi check_out_time + left_early. NC-1 attendance-only, không migration. | Toàn bộ |
| 2026-06-18 | Re-review: parseVerifyPayload PURE (map IN/OUT ở service), event check_out idempotent (chỉ ghi khi check_out_time đổi), source_type='camera' (đã verify), chốt post-grace = FACE_SYNC_GRACE_MINUTES + giao deprovision #47. | §2,§3,§4,§5,§6,§7,§8,§9 |

## 1. Mục tiêu
Door Face Terminal gửi verify event mỗi lần quét mặt ở cửa — **cả lúc vào lẫn lúc ra**. Hiện C (FAT-001) chỉ xử lý chiều VÀO (check-in). DCO-001 đọc thêm **`info.Direction`** từ payload để suy ra hướng, và khi người **ra** (OUT) thì ghi **`check_out_time`** vào `attendance_records`, đồng thời đánh dấu **`left_early`** nếu ra sớm hơn giờ kết thúc họp.

**NC-1 (kế thừa FAT-001): chỉ ghi điểm danh, KHÔNG gác/deny cửa.** Backend chỉ ghi sổ; thiết bị tự quyết mở cửa.

Nối tiếp C: tái dùng `parseVerifyPayload` (iot) + `FaceAttendanceService.onVerify` (face-access) + `FACE_VERIFY_HOOK`. **KHÔNG migration** — dùng cột có sẵn.

## 2. RECON (đã kiểm chứng)
- **Payload thật** (event `face_verify` lưu trong `iot_device_events.payload_json`, đã xác nhận live): `info.*` có **`Direction`**, **`OpendoorWay`**, **`VerfyType`**, ngoài PersonID/Name/CreateTime/VerifyStatus/Similarity1.
- **`attendance_records`** ([attendance-record.entity.ts](../../../../src/modules/attendance/entities/attendance-record.entity.ts)): có sẵn **`check_out_time` (timestamptz, nullable)** + **`left_early` (boolean, default false)**. Có `check_in_method` nhưng **KHÔNG có `check_out_method`**.
- **`attendance_events`**: `event_type` (varchar), `event_time`, `source_type` — đã dùng `check_in`/`face_detected`; thêm `check_out` không cần migration. **Đã verify trong code**: event check_in của cửa dùng **`source_type='camera'`** (record-level `check_in_method='door_camera'`, `attendance_source='camera'`) → event `check_out` PHẢI dùng đúng **`source_type='camera'`** cho khớp.
- **`parseVerifyPayload`** ([face-verify-payload.util.ts](../../../../src/modules/iot/utils/face-verify-payload.util.ts)) hiện **chưa đọc** `Direction`/`OpendoorWay`. `FaceVerifyInput` ([face-verify-hook.ts](../../../../src/common/ports/face-verify-hook.ts)) chưa có trường hướng.
- **`onVerify`** ([face-attendance.service.ts](../../../../src/modules/face-access/services/face-attendance.service.ts)) chỉ ghi `check_in` (record mới) / `face_detected` (verify lặp); gate "họp còn mở" (`completed/cancelled` hoặc `verifyTime > effectiveEnd` → bỏ qua).

## 3. ⚠ Giả định cần xác nhận live
Giá trị `info.Direction` cho IN vs OUT **chưa được xác nhận** trên cam thật. Mapping cấu hình qua env, **NHƯNG suy diễn ở tầng service — KHÔNG ở util pure**:
- **`parseVerifyPayload` (pure) CHỈ trích `directionRaw` (= `info.Direction` thô, hoặc null) + `opendoorWay`** — KHÔNG đọc env, KHÔNG tự quyết IN/OUT.
- **`iot-devices.service` đọc `FACE_DIRECTION_OUT_VALUE`** (qua `ConfigService.get`, default **`'2'`**) rồi tính `direction = String(directionRaw ?? '') === outValue ? 'out' : 'in'` (thiếu/khác → `'in'`), truyền vào `onVerify`.
- **Giả định mặc định: `2=out`, `1=in`** — PHẢI verify bằng quét ra/vào thật + `[VERIFY RAW]` (FACE_VERIFY_DEBUG=true) trước production.
- `info.OpendoorWay` trích kèm để debug/đối chiếu, **không** quyết hướng ở v1.

## 4. Functional Requirements (EARS)
- **FR-DCO-001-001**: `parseVerifyPayload` **PURE** — chỉ trích thêm `directionRaw` (= `info.Direction` thô, hoặc null) và `opendoorWay` (= `info.OpendoorWay`, hoặc null) vào `ParsedVerify`. **KHÔNG đọc env, KHÔNG suy 'in'/'out'.**
- **FR-DCO-001-002**: `iot-devices.service` suy hướng: `outValue = configService.get('FACE_DIRECTION_OUT_VALUE','2')`; `direction = String(directionRaw ?? '') === outValue ? 'out' : 'in'` (thiếu/khác → `'in'`). Truyền `direction` (+`directionRaw`/`opendoorWay` optional) vào `faceVerifyHook.onVerify({...})`. `FaceVerifyInput` (port) mang `direction: 'in' | 'out'` (+`directionRaw?`/`opendoorWay?`).
- **FR-DCO-001-003**: WHEN `direction === 'in'`, `onVerify` giữ NGUYÊN logic FAT-001 (resolve → gate họp mở → upsert check_in/face_detected + event).
- **FR-DCO-001-004**: WHEN `direction === 'out'` VÀ đã có `attendance_records` cho `(meeting_id, user_id)` có `check_in_time` IS NOT NULL → ghi **`check_out_time`** (idempotent, FR-007) + tính **`left_early`** (FR-006). **CHỈ khi `check_out_time` thực sự được ghi/đổi** (trong nhánh idempotent FR-007) mới INSERT `attendance_events` (`event_type='check_out'`, `event_time=verifyTime`, `source_type='camera'` — khớp event check_in cửa, §2). OUT bị bỏ qua (FR-007) → **KHÔNG UPDATE, KHÔNG INSERT event**.
- **FR-DCO-001-005** (NC-4): WHEN `direction === 'out'` nhưng **chưa từng check-in** (không có record, hoặc record có `check_in_time` IS NULL) → **`logger.warn` + return**, KHÔNG tạo record, KHÔNG ghi check_out.
- **FR-DCO-001-006**: `left_early = (check_out_time < effectiveEnd)` với `effectiveEnd = actual_end_time ?? end_time`. Ra đúng/sau giờ kết thúc → `left_early=false`.
- **FR-DCO-001-007** (NC-3 idempotent): chỉ set `check_out_time` khi đang NULL **hoặc** `verifyTime` muộn hơn `check_out_time` hiện tại (lấy lần ra MUỘN NHẤT). OUT sớm hơn giá trị đã lưu → bỏ qua (không lùi).
- **FR-DCO-001-008** (NC-5): KHÔNG cột `check_out_method` mới. Phương thức/chiều lưu gián tiếp qua `attendance_events` (event_type=`check_out`, source_type=`camera`) và/hoặc `note`/evidence; KHÔNG migration.

## 5. Non-Functional / Constraints
- **NFR-SEC-03**: SQL parameterized, raw qua `DataSource`.
- **NFR-DATA-01**: KHÔNG migration — chỉ dùng `check_out_time`, `left_early`, `attendance_events`.
- **NFR-ARCH**: tái dùng `parseVerifyPayload` + `onVerify` + `FACE_VERIFY_HOOK`; không thêm module. import `.js`.
- **NFR-ENG-01**: unit test ≥ 80% branch (util + service).
- **NFR-CFG**: `FACE_DIRECTION_OUT_VALUE` (Joi scoped, string default `'2'`) đọc ở `iot-devices.service`; **post-grace OUT tái dùng `FACE_SYNC_GRACE_MINUTES` (KHÔNG env mới)**. Chỉ chèn dòng Joi scoped, KHÔNG prettier cả file.

## 6. Gate "họp còn mở" cho OUT (CHỐT v1)
Người ra **đúng lúc/sau** giờ kết thúc là hợp lệ, nên nhánh OUT KHÔNG dùng gate "đóng" cứng của IN. **Chốt v1 (bỏ phương án để-mở):**
- `status === 'cancelled'` → **bỏ qua** (warn, return).
- Cho ghi `check_out_time` tới **`effectiveEnd + GRACE`**; `verifyTime > effectiveEnd + GRACE` → **`logger.warn` + skip** (tránh ghi nhiễu).
- **`GRACE` = `FACE_SYNC_GRACE_MINUTES`** (đọc qua `ConfigService`, default 5) — **TÁI DÙNG grace của deprovision, KHÔNG đẻ env mới**. Lý do: deprovision gỡ mapping ở `end_time + FACE_SYNC_GRACE_MINUTES` (§8.1); cho cửa sổ OUT trùng đúng mốc đó → sau grace mapping cũng không còn để resolve, hai mốc khớp nhau.
- Nhánh IN giữ NGUYÊN gate cũ (không check-in khi họp `completed/cancelled` hoặc quá end).

## 7. Acceptance Criteria
- **AC-001a** (util pure): parse trả `directionRaw = info.Direction` (hoặc null) + `opendoorWay`; **KHÔNG** có 'in'/'out', **KHÔNG** đọc env.
- **AC-001b** (service map): `directionRaw === outValue` → `direction='out'`; khác/thiếu → `'in'`; truyền vào onVerify.
- **AC-002**: OUT + đã check-in, ra trước end → `check_out_time=verifyTime`, `left_early=true`, +1 event `check_out` (`source_type='camera'`).
- **AC-003**: OUT + đã check-in, ra ≥ end (trong `GRACE`) → `check_out_time` set, `left_early=false`, +1 event `check_out`.
- **AC-004**: OUT lặp — lần ra MUỘN hơn → UPDATE `check_out_time` + INSERT event mới.
- **AC-004b** (idempotent-skip): OUT sớm hơn `check_out_time` đã lưu → **KHÔNG UPDATE, KHÔNG INSERT event**.
- **AC-005**: OUT mà chưa từng check-in (no record / check_in_time NULL) → 0 record, 0 event, warn.
- **AC-006**: IN → hành vi FAT-001 giữ nguyên (regression: present/late, gate họp mở).
- **AC-007**: OUT khi `status='cancelled'` → bỏ qua, không ghi.
- **AC-008**: OUT khi `verifyTime > effectiveEnd + GRACE` → warn + skip (mapping cũng đã/đang bị deprovision).

## 8. Edge cases (phải có test)
- OUT chưa từng IN → skip (AC-005).
- Nhiều OUT liên tiếp → giữ lần MUỘN NHẤT, mỗi lần thực ghi mới +1 event (AC-004); OUT sớm hơn → no-op, no-event (AC-004b).
- OUT đúng/sau giờ kết thúc trong `GRACE` → ghi (`left_early=false`); ngoài `GRACE` → warn/skip (AC-008).
- `Direction` thiếu/giá trị lạ → coi như IN (không vô tình check-out).
- OUT cho meeting không tồn tại / mapping deleted → unmatched, no record (kế thừa `resolveMapping` của C: lọc `sync_status='synced' AND deleted_at IS NULL`).

### 8.1. Giao với deprovision (#47) — RÀNG BUỘC v1
`resolveMapping` chỉ khớp mapping còn sống (`sync_status='synced' AND deleted_at IS NULL`). Cron `deprovisionEndedMeetings` gỡ mapping (→ `sync_status='deleted'`) khi `end_time ≤ now() - FACE_SYNC_GRACE_MINUTES`. ⇒ **Sau mốc `end_time + FACE_SYNC_GRACE_MINUTES`, OUT quét tới KHÔNG resolve được → mất check-out.**
- **Hành vi v1 (chấp nhận)**: check-out chỉ ghi khi mapping còn sống — người ra **trong/trước lúc deprovision**. Cửa sổ OUT (§6, `effectiveEnd + GRACE`) **dùng đúng `FACE_SYNC_GRACE_MINUTES`** nên khớp mốc deprovision: KHÔNG có vùng "OUT hợp lệ nhưng mapping đã mất".
- Người ra **rất muộn** (sau khi mapping đã gỡ) → không có check-out (chấp nhận v1, xem §9).

## 9. Out of scope
- Tính `presence_duration_minutes` (defer).
- Dùng `OpendoorWay`/`VerfyType` để quyết hướng (chỉ log v1).
- Cột `check_out_method` riêng (né bằng event/note).
- Check-out cho người ra **sau khi mapping đã deprovision** (ngoài `FACE_SYNC_GRACE_MINUTES`) — defer; cần cơ chế khác (nới grace hoặc tra `iot_device_events`).
- Gác/deny cửa (NC-1).
