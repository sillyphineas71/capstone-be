# TASKS — UC-82: Xem chi tiết một bản ghi điểm danh

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-14 | Tạo mới tasks.md cho UC-82 (T001–T005). | Toàn bộ file |

> Dựa trên spec.md + plan.md UC-82. CHỈ danh sách task — KHÔNG code. Read-only, additive.

---

## 0. Ràng buộc (mọi task)
- Endpoint `GET /meetings/:meetingId/attendance/:recordId`, 200, `attendance.read` (tái dùng), `{success,message,data}`.
- Route `@Get(':recordId')` SAU `@Get()` list. Load `{id, meetingId}` → 404 `ATTENDANCE_RECORD_NOT_FOUND`.
- editHistory từ audit (`entityId=recordId`, `actionType IN 4`), sort asc, batch 1 query.
- KHÔNG đổi constructor; KHÔNG sửa create/updateStatus/updateProfile/invalidate/list/module khác; test file riêng.

---

## T001 — [CREATE] `AttendanceRecordDetailResponseDto`
**File**: `src/modules/attendance/dto/attendance-record-detail-response.dto.ts`
- `AttendanceEditHistoryItemDto`: `at:string`, `actorUserId:string|null`, `actionType:string`, `changes:Record<string,unknown>|null`.
- `AttendanceRecordDetailResponseDto extends ManualAttendanceResponseDto` + `editHistory: AttendanceEditHistoryItemDto[]`.
**DoD**: kế thừa DTO gốc (KHÔNG sửa gốc); `@ApiProperty` đủ; tsc sạch.

---

## T002 — [MODIFY additive] `AttendanceService.getAttendanceRecordDetail`
**File**: `src/modules/attendance/services/attendance.service.ts`
- Thêm import: `In` (typeorm), `AuditLogEntity` (`../../administration/entities/audit-log.entity.js`), DTO detail, `toManualAttendanceResponse`, `NotFoundException`.
- Method: load `attendanceRecordRepo.findOne({where:{id:recordId, meetingId}})` → null → `NotFoundException` `ATTENDANCE_RECORD_NOT_FOUND`; audit qua `attendanceRecordRepo.manager.getRepository(AuditLogEntity).find({where:{entityId:recordId, actionType:In([4 loại])}, order:{createdAt:'ASC'}})`; map base (`toManualAttendanceResponse`) + `editHistory`.
- **KHÔNG** đổi constructor; **KHÔNG** đụng `getAttendanceList`/helper cũ.
**DoD**: 1 query record + 1 query audit (no N+1); sort asc; read-only (no transaction/audit-ghi); method cũ không đổi; tsc sạch.

---

## T003 — [MODIFY additive] `AttendanceController.getAttendanceRecordDetail`
**File**: `src/modules/attendance/controllers/attendance.controller.ts`
- `@Get(':recordId')` (SAU `@Get()`), `@UseGuards(PermissionsGuard)`, `@RequirePermissions('attendance.read')`, `@Param(...ParseUUIDPipe)` cho meetingId+recordId, `@CurrentUser()`.
- Gọi service, trả `{success:true, message:'Attendance record detail retrieved successfully', data}`.
- `@ApiResponse` 200/400/401/403/404.
**DoD**: route order đúng (sau list); guard+permission `attendance.read`; envelope chuẩn; handler cũ không đổi; tsc sạch.

---

## T004 — [CREATE] Unit test service (file riêng)
**File**: `src/modules/attendance/tests/attendance-record-detail.service.spec.ts`
- **D1**: record tồn tại → trả base + `editHistory` đúng thứ tự (asc), map đúng field.
- **D2**: record không tồn tại (findOne→null) → 404 `ATTENDANCE_RECORD_NOT_FOUND`; record thuộc meeting khác → 404 (where `{id,meetingId}` không khớp).
- **D3**: editHistory **batch 1 query** — assert `auditRepo.find` gọi đúng 1 lần với `In([4 loại])` + `order createdAt ASC` (no N+1).
- **D4**: editHistory rỗng (không audit) → `editHistory: []`.
- **D5**: read-only — KHÔNG gọi `save`/transaction/audit-ghi.
**DoD**: mock `attendanceRecordRepo.findOne` + `attendanceRecordRepo.manager.getRepository(AuditLogEntity).find`; static import; không đụng test cũ.

---

## T005 — [CREATE] Unit test controller (file riêng)
**File**: `src/modules/attendance/tests/attendance-record-detail.controller.spec.ts`
- **C1**: gọi service đúng `(meetingId, recordId, userId)` + trả `{success,message,data}`.
- **C2**: metadata `@RequirePermissions` = `['attendance.read']`; guard handler có `PermissionsGuard` (class có `JwtAuthGuard`).
- **C3** (route order): xác nhận `@Get(':recordId')` khai sau `@Get()` (đọc metadata path / thứ tự khai báo) — không nuốt list.
**DoD**: overrideGuard; static import; không đụng test cũ.

---

## T006 — Cổng chất lượng (KHÔNG commit)
- `tsc --noEmit` net +0 (file mới/sửa sạch).
- `eslint` file đã đụng.
- `jest src/modules/attendance` — 2 suite mới pass (D1–D5, C1–C3) + suite attendance cũ vẫn pass (0 regression, đặc biệt constructor không đổi).
- Phân biệt baseline vs mới bằng `git stash`. **KHÔNG commit.**

---

## Ma trận phủ
| Yêu cầu | Task |
| :--- | :--- |
| Endpoint/route order/permission | T003, T005 (C2/C3) |
| Load 404 (không tồn tại/khác meeting) | T002, T004 (D2) |
| editHistory batch no-N+1 + sort | T002, T004 (D1/D3) |
| editHistory rỗng | T004 (D4) |
| read-only | T002, T004 (D5) |
| DTO base+editHistory | T001 |

## KHÔNG được làm
- KHÔNG migration/seed/commit; KHÔNG mutation/transaction/audit-ghi.
- KHÔNG đổi constructor `AttendanceService`; KHÔNG sửa `getAttendanceList`/manual-attendance/`ManualAttendanceResponseDto`/module khác.
- KHÔNG đụng test UC khác.

## Thứ tự
`T001 → T002 → T003 → T004 → T005 → T006`

> Chưa code — chờ duyệt.
