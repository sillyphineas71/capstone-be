# SPEC — UC-82: Xem chi tiết một bản ghi điểm danh (View attendance record detail)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-14 | Tạo mới spec.md cho UC-82 (xem chi tiết 1 bản ghi điểm danh + lịch sử chỉnh sửa). [Missing]. | Toàn bộ file |

> Phạm vi: **CHỈ UC-82** — đọc chi tiết 1 attendance record + editHistory (từ audit_logs).
> READ-only. KHÔNG create/update/invalidate/list. KHÔNG migration/seed.

---

## 0. Khảo sát hiện trạng (bám code thật)
- `attendance.controller.ts` (read-side): `@Controller('meetings/:meetingId/attendance')`, có `@Get()` list, permission **`attendance.read`**, chỉ guard permission (KHÔNG relationship-check meeting).
- `manual-attendance.controller.ts` (write-side): 4 endpoint (POST create, PATCH `:recordId/status`, PATCH `:recordId`, POST `:recordId/invalidate`). Route tĩnh khai TRƯỚC route động.
- `AttendanceRecordEntity`: `id, meetingId, userId, participantId, checkInMethod, attendanceSource, checkInTime, checkOutTime, isLate, lateMinutes, leftEarly, attendanceStatus, verifiedBy, verifiedAt, note, createdAt, updatedAt`. **KHÔNG có `@DeleteDateColumn`** (invalidate dùng status, không soft-delete).
- `ManualAttendanceResponseDto` + `toManualAttendanceResponse(entity)` (mapper thuần chọn field) — **tái dùng** cho base detail.
- `audit_logs`: các mutation manual-attendance ghi `entityId=recordId`, `actionType ∈ {create_manual_attendance, update_attendance_status, update_attendance_record, invalidate_attendance}` → **nguồn "lịch sử chỉnh sửa"**.
- `AttendanceService` inject `@InjectRepository(AttendanceRecordEntity) attendanceRecordRepo` → đọc record + audit (qua `attendanceRecordRepo.manager.getRepository(AuditLogEntity)`) mà **KHÔNG đổi constructor**.
- `attendance.read` gán `[SYSTEM_ADMIN, MANAGER, BUSINESS_ADMIN]` (seed sẵn).

→ **UC-82 = [Missing]**. Chỉ THÊM 1 endpoint đọc + 1 service method + 1 response DTO. Không migration/seed.

---

## 1. Tổng quan

| Thuộc tính | Giá trị |
| :--- | :--- |
| **UC ID** | UC-82 |
| **Tên** | Xem chi tiết một bản ghi điểm danh |
| **Module** | Attendance & Presence Management (`src/modules/attendance`) |
| **Primary Actor** | Business Admin / Internal User (Host) / Manager (theo role của `attendance.read`) |
| **Trigger** | Người có quyền mở chi tiết 1 bản ghi điểm danh. |
| **Expected Output** | Hiển thị người, cuộc họp, thời gian, phương thức + **lịch sử chỉnh sửa** (editHistory). |
| **Pre-condition** | Actor có permission `attendance.read`; bản ghi tồn tại và thuộc meeting. |
| **Related** | UC-81 (list), UC-79/80/91 (create/update), UC-83 (invalidate). |

---

## 2. Actor & Pre-condition
- Actor: user có permission `attendance.read` (`[SYSTEM_ADMIN, MANAGER, BUSINESS_ADMIN]`).
- PRE-01: JWT hợp lệ (`JwtAuthGuard`).
- PRE-02: có permission `attendance.read` (`PermissionsGuard`).
- PRE-03: `recordId` tồn tại và thuộc `meetingId` → không có ⇒ 404.

---

## 3. Endpoint
```
GET /api/v1/meetings/:meetingId/attendance/:recordId
```
| | |
| :--- | :--- |
| Method / status | `GET` / **200** |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | **`attendance.read`** (tái dùng — KHÔNG tạo mới) |
| Handler | `AttendanceController.getAttendanceRecordDetail` (THÊM) |
| Service | `AttendanceService.getAttendanceRecordDetail` (THÊM) |
| Param | `meetingId` (`ParseUUIDPipe`), `recordId` (`ParseUUIDPipe`) |

**⚠️ Route order**: đặt `@Get(':recordId')` **SAU** `@Get()` (list) trong `attendance.controller.ts`. Không có route GET tĩnh nào khác trong controller này ⇒ `:recordId` động không nuốt path. (Write-side `:recordId/status` v.v. nằm ở controller khác — khác HTTP method, không liên quan.)

---

## 4. Main Flow
1. Actor gọi `GET /meetings/:meetingId/attendance/:recordId`.
2. `JwtAuthGuard` → `PermissionsGuard('attendance.read')` (thiếu → 403).
3. `AttendanceService.getAttendanceRecordDetail(meetingId, recordId, currentUserId)`:
   1. Load `attendanceRecordRepo.findOne({ where: { id: recordId, meetingId } })` → null → **404 `ATTENDANCE_RECORD_NOT_FOUND`** (gồm cả trường hợp record tồn tại nhưng không thuộc meeting).
   2. Query audit editHistory **BATCH 1 query**: `getRepository(AuditLogEntity).find({ where: { entityId: recordId, actionType: In([...4 loại...]) }, order: { createdAt: 'ASC' } })`.
   3. Map: base = `toManualAttendanceResponse(record)`; `editHistory[]` = từ audit rows.
4. Trả 200 `{ success, message, data }`.

---

## 5. Response shape

`data` = `AttendanceRecordDetailResponseDto`:
- **Base** (tái dùng `ManualAttendanceResponseDto` fields): `id, meetingId, userId, participantId, checkInMethod, attendanceSource, checkInTime, checkOutTime, isLate, lateMinutes, leftEarly, attendanceStatus, verifiedBy, verifiedAt, note, createdAt, updatedAt`.
- **`editHistory: AttendanceEditHistoryItemDto[]`** (sort `at` asc), mỗi item:
  | Field | Nguồn (audit_logs) |
  | :--- | :--- |
  | `at` | `createdAt` (ISO) |
  | `actorUserId` | `userId` |
  | `actionType` | `actionType` (1 trong 4 loại) |
  | `changes` | `newValueJson` (thay đổi ghi nhận; có thể kèm `oldValueJson` nếu cần) |

Envelope: `{ success: true, message: 'Attendance record detail retrieved successfully', data }`.

---

## 6. Quyền / RBAC
- Chỉ dùng permission **`attendance.read`** sẵn có (mirror GET list — cùng chỉ guard permission, **KHÔNG** relationship-check meeting/host).
- KHÔNG tạo permission mới, KHÔNG seed.

## 7. Ranh giới (read-only)
- UC-82 CHỈ đọc. KHÔNG mutation/transaction/ghi audit.
- KHÔNG đụng create (UC-79)/updateStatus-updateProfile (UC-80/91)/invalidate (UC-83)/list (UC-81).
- editHistory là **đọc lại** từ audit_logs (do các UC mutation đã ghi) — UC-82 không tự ghi.

---

## 8. Functional Requirements
- **FR-01**: `GET /meetings/:meetingId/attendance/:recordId` trả chi tiết record + editHistory.
- **FR-02**: Chỉ `attendance.read` gọi được (thiếu → 403).
- **FR-03**: Record không tồn tại / không thuộc meeting → 404 `ATTENDANCE_RECORD_NOT_FOUND`.
- **FR-04**: `editHistory` lấy từ audit_logs (`entityId=recordId`, `actionType IN 4 loại`), sort `at` asc.
- **FR-05**: editHistory query **batch 1 lần** (KHÔNG N+1).
- **FR-06**: READ-only — không mutation/audit-ghi.
- **FR-07**: Base fields tái dùng `toManualAttendanceResponse` (không lộ field ngoài schema §5).

## 9. Acceptance Criteria
- **AC-01**: record tồn tại → 200, data đủ base fields + `editHistory` đúng thứ tự thời gian.
- **AC-02**: `recordId` không tồn tại → 404 `ATTENDANCE_RECORD_NOT_FOUND`.
- **AC-03**: record thuộc meeting KHÁC (id đúng nhưng meetingId khác) → 404.
- **AC-04**: record chưa có mutation nào → 200, `editHistory: []`.
- **AC-05**: thiếu permission → 403; chưa đăng nhập → 401; `recordId` sai uuid → 400.

## 10. Exception Flows
- **EC-01**: 404 record không tồn tại/không thuộc meeting.
- **EC-02**: 400 param sai uuid (`ParseUUIDPipe`).
- **EC-03**: 401/403 auth/permission.

---

## 11. [Missing] — Tóm tắt
[Missing] — chưa có endpoint xem chi tiết 1 attendance record. Cần THÊM: 1 handler `@Get(':recordId')` + 1 service method `getAttendanceRecordDetail` + 1 response DTO (base + editHistory). Tái dùng `attendance.read` + `toManualAttendanceResponse`. KHÔNG migration/seed/mutation.
