# FAT-001 — Runtime Face Attendance (verify → resolve → attendance)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-17 | Tạo spec FAT-001 (Face-access C): nhận verify event → resolve user/meeting qua device_user_mappings → ghi attendance_records + attendance_events. NC-1 chỉ ghi điểm danh, không gác cửa. | Toàn bộ |

## 1. Mục tiêu
Khi Door Face Terminal gửi verify event (người được nhận diện ở cửa phòng họp), backend ghi điểm danh **check-in** cho đúng (meeting, user). **NC-1: chỉ ghi nhận điểm danh, KHÔNG chặn/deny cửa** — thiết bị tự quyết mở cửa; backend chỉ là người ghi sổ.

Đây là Ticket C, nối tiếp B (FMP-001 đã tạo `device_user_mappings` per-meeting). Mapping mang **cả user lẫn meeting** nên resolve không cần "tìm meeting active trong room" riêng (NC-5).

## 2. RECON (file:line — đã kiểm chứng trên DB thật)

### 2.1. Enum (attendance-record.entity.ts:14-36)
- `CheckInMethod`: manual | door_camera | room_camera | qr | system → **chọn `door_camera`** (Face Terminal đặt ở cửa).
- `AttendanceSource`: manual | camera | presence_snapshot | mixed → **chọn `camera`**.
- `AttendanceRecordStatus`: present | absent | late | left_early | invalidated | pending_review → **`present`** (đúng giờ) / **`late`** (trễ).
- `attendance_events.source_type` (entity:39) — string default `system` → ghi `camera`.

### 2.2. Cột NOT NULL + DB default (information_schema — DB thật)
**attendance_records**: `id=gen_random_uuid()`, `created_at/updated_at=now()` → raw INSERT bỏ qua được (như media_files). NOT NULL không default: **meeting_id, user_id** (bắt buộc trong INSERT). check_in_method/attendance_source/is_present/is_late/left_early/attendance_status đều có default.

**attendance_events**: `id=gen_random_uuid()` (KHÔNG có cột created_at). NOT NULL không default: **meeting_id, event_type, event_time** (bắt buộc). source_type default `system`.

### 2.3. ⚠ Phát hiện ràng buộc — anomaly KHÔNG ghi được vào attendance_events
`attendance_events.meeting_id` là **NOT NULL + FK → meetings(id)**. Hai ca anomaly:
- **no-mapping**: không có user lẫn meeting → không có `meeting_id` hợp lệ.
- **no-meeting**: có `meetingId` (giá trị) từ mapping nhưng row `meetings` không tồn tại → INSERT vi phạm FK.

→ **Quyết định:** ca anomaly chỉ `logger.warn` + return (không record, không deny). **Audit trail vẫn đủ** vì raw event đã được `iot` lưu vào `iot_device_events` TRƯỚC khi gọi hook. Đây là sai lệch có chủ đích so với wording "ghi attendance_events anomaly", do ràng buộc DB; ghi rõ tại đây.

### 2.4. Điểm chèn hook (iot-devices.service.ts:1376)
`receiveVerifyEvent()` — ngay **sau** `commitTransaction()` (raw event đã lưu + device set ONLINE), **trước** `return`. Biến sẵn: `device` (`.id`, `.roomId` — entity:52), `extractedFields.person_id`, `extractedFields.person_name`, `extractedFields.verify_time`, `now`.

## 3. Functional Requirements (EARS)
- **FR-FAT-001-001**: WHEN nhận verify event, hệ thống resolve `(user_id, meetingId)` từ `device_user_mappings` theo `device_id` + `device_person_id = person_id`; fallback `device_person_code = person_name`. `meetingId = metadata_json.bookingId`.
- **FR-FAT-001-002**: IF không resolve được mapping (hoặc thiếu bookingId), hệ thống `logger.warn` (unmatched) và return — KHÔNG tạo record, KHÔNG deny.
- **FR-FAT-001-003**: IF meeting (theo meetingId) không tồn tại, hệ thống `logger.warn` (no-meeting) và return.
- **FR-FAT-001-004**: WHEN chưa có `attendance_records` cho `(meeting_id, user_id)`, hệ thống INSERT check-in: `check_in_method=door_camera`, `attendance_source=camera`, `check_in_time = first_detected_at = last_detected_at = verify_time`, `is_present=true`, `is_late`+`late_minutes` theo grace, `attendance_status ∈ {present, late}`.
- **FR-FAT-001-005**: WHEN đã có record cho `(meeting_id, user_id)`, hệ thống CHỈ UPDATE `last_detected_at = verify_time` (NC-3: KHÔNG ghi đè check-in).
- **FR-FAT-001-006**: Mỗi verify ghi 1 `attendance_events` (`event_type = check_in` lần đầu, `face_detected` lần sau; `event_time=verify_time`; `source_type=camera`; link `attendance_record_id`).
- **FR-FAT-001-007** (NC-2): `grace = system_configs['attendance.late_grace_minutes'] → env ATTENDANCE_LATE_GRACE_MINUTES → default 0`. `is_late = verify_time > start_time + grace`; `late_minutes = max(0, phút sau start)`.
- **FR-FAT-001-008** (NC-4): `iot` gọi hook qua port `FACE_VERIFY_HOOK` (`@Optional() @Inject`), trong try/catch — **lỗi attendance KHÔNG làm hỏng response 200** của verify callback.

## 4. Non-Functional / Constraints
- **NFR-SEC-03**: mọi SQL parameterized, raw qua `DataSource`.
- **NFR-DATA-01**: KHÔNG migration (id/created_at có DB default; cột dùng đều tồn tại).
- **NFR-ARCH (NC-4 no-cycle)**: interface + token `FACE_VERIFY_HOOK` đặt ở `common` (leaf); `face-access` là `@Global()` provide `useExisting`; `iot` inject token mà KHÔNG import `face-access` → không cycle.
- **NFR-ENG-01**: test ≥80% branch.
- import suffix `.js`.

## 5. Acceptance Criteria
- **AC-001**: verify hợp lệ, đúng giờ → INSERT record `present`, `is_late=false`, `late_minutes=0`; +1 event `check_in`.
- **AC-002**: verify trễ (sau start+grace) → record `late`, `is_late=true`, `late_minutes>0`.
- **AC-003**: verify lặp → KHÔNG INSERT record thứ 2, chỉ UPDATE `last_detected_at`; event `face_detected`.
- **AC-004**: no-mapping → warn, 0 record, 0 event, không throw.
- **AC-005**: no-meeting → warn, 0 record, không throw.
- **AC-006**: hook trong `iot` nuốt lỗi attendance (try/catch) → verify callback vẫn trả 200.

## 6. Out of scope
check-out / left_early / presence-duration (defer); anomaly persistence vào attendance_events (xem 2.3); gác cửa/deny (NC-1).
