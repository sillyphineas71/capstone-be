# PLAN — UC-82: Xem chi tiết một bản ghi điểm danh

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-14 | Tạo mới plan.md cho UC-82. | Toàn bộ file |

> Dựa trên spec.md UC-82 đã duyệt. CHỈ kế hoạch — KHÔNG code. Read-only, additive.

---

## 0. Ràng buộc chốt
- Endpoint `GET /meetings/:meetingId/attendance/:recordId`, 200, `attendance.read` (tái dùng), response `{success,message,data}`.
- Route `@Get(':recordId')` SAU `@Get()` trong `attendance.controller.ts`.
- Load `{id, meetingId}` (entity không có deletedAt) → 404 `ATTENDANCE_RECORD_NOT_FOUND`.
- editHistory từ audit_logs (`entityId=recordId`, `actionType IN 4`), sort asc, **batch 1 query**.
- READ-only. KHÔNG đổi constructor. KHÔNG sửa method/endpoint cũ.

---

## 1. Kiến trúc & luồng
```
GET /meetings/:meetingId/attendance/:recordId
  → AttendanceController.getAttendanceRecordDetail (THÊM vào attendance.controller.ts read-side)
      JwtAuthGuard(class) → PermissionsGuard('attendance.read')
      @Param meetingId, recordId (ParseUUIDPipe)
  → AttendanceService.getAttendanceRecordDetail(meetingId, recordId, currentUserId) (THÊM)
      1. record = attendanceRecordRepo.findOne({ where:{ id:recordId, meetingId } }) → null → 404
      2. audit = attendanceRecordRepo.manager.getRepository(AuditLogEntity)
                   .find({ where:{ entityId:recordId, actionType: In([4 loại]) }, order:{ createdAt:'ASC' } })   // batch 1 query
      3. base = toManualAttendanceResponse(record); editHistory = audit.map(...)
      4. return { ...base, editHistory }
  → 200 { success, message, data }
```

### 1.1. Mirror
- Controller handler mirror `AttendanceController.getAttendanceList` (cùng controller, `attendance.read`, envelope `{success,message,data}`).
- Service mirror cách `AttendanceService` đọc bằng `attendanceRecordRepo` sẵn có; audit đọc qua `.manager.getRepository(AuditLogEntity)` (KHÔNG cần inject DataSource/đổi constructor).
- Base mapper tái dùng `toManualAttendanceResponse` (`dto/manual-attendance-response.dto.ts`).

---

## 2. File TẠO / SỬA

### 2.1. TẠO
| File | Vai trò |
| :--- | :--- |
| `src/modules/attendance/dto/attendance-record-detail-response.dto.ts` | `AttendanceRecordDetailResponseDto` (base + `editHistory`) + `AttendanceEditHistoryItemDto`. |
| `src/modules/attendance/tests/attendance-record-detail.service.spec.ts` | Unit test service (file riêng). |
| `src/modules/attendance/tests/attendance-record-detail.controller.spec.ts` | Unit test controller (file riêng). |

### 2.2. SỬA (additive)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/attendance/services/attendance.service.ts` | THÊM method `getAttendanceRecordDetail` (+ import `In` từ typeorm, `AuditLogEntity`, `AttendanceRecordDetailResponseDto`). **KHÔNG** đổi constructor; KHÔNG đụng `getAttendanceList` và helper cũ. |
| `src/modules/attendance/controllers/attendance.controller.ts` | THÊM handler `@Get(':recordId')` (+ import DTO detail). **KHÔNG** đụng `getAttendanceList`. |

> KHÔNG migration/seed (tái dùng `attendance.read`). KHÔNG sửa `manual-attendance.*`/module khác. KHÔNG sửa `ManualAttendanceResponseDto` (chỉ tái dùng mapper).

---

## 3. Thiết kế service `getAttendanceRecordDetail`
```
async getAttendanceRecordDetail(meetingId, recordId, currentUserId): Promise<AttendanceRecordDetailResponseDto> {
  const record = await this.attendanceRecordRepo.findOne({ where: { id: recordId, meetingId } });
  if (!record) throw new NotFoundException({ success:false, message:'...', error:{ code:'ATTENDANCE_RECORD_NOT_FOUND', details:{ meetingId, recordId } }, ... });

  const auditRepo = this.attendanceRecordRepo.manager.getRepository(AuditLogEntity);
  const rows = await auditRepo.find({
    where: {
      entityId: recordId,
      actionType: In([
        'create_manual_attendance',
        'update_attendance_status',
        'update_attendance_record',
        'invalidate_attendance',
      ]),
    },
    order: { createdAt: 'ASC' },
  });

  const editHistory = rows.map((r) => ({
    at: r.createdAt.toISOString(),
    actorUserId: r.userId,
    actionType: r.actionType,
    changes: r.newValueJson ?? null,
  }));

  return { ...toManualAttendanceResponse(record), editHistory };
}
```
- **Batch**: 1 query record + 1 query audit → không N+1.
- `In` import từ `typeorm` (nếu chưa có — line 10 hiện có `Repository, IsNull, Not, LessThanOrEqual, MoreThan`, thêm `In`).
- `AuditLogEntity` import từ `../../administration/entities/audit-log.entity.js`.
- (Tùy chọn) thêm filter `entityType` nếu chuỗi entityType manual-attendance được xác nhận — không bắt buộc vì `entityId + actionType IN 4` đã đủ chính xác.

---

## 4. DTO — `AttendanceRecordDetailResponseDto`
```
class AttendanceEditHistoryItemDto {
  at: string;              // ISO
  actorUserId: string | null;
  actionType: string;      // 1 trong 4
  changes: Record<string, unknown> | null;
}

class AttendanceRecordDetailResponseDto extends ManualAttendanceResponseDto {
  editHistory: AttendanceEditHistoryItemDto[];
}
```
- Kế thừa `ManualAttendanceResponseDto` (17 base field) + thêm `editHistory[]`. KHÔNG sửa DTO gốc.

---

## 5. Controller handler
```
@Get(':recordId')                                  // SAU @Get() list — không nuốt path
@UseGuards(PermissionsGuard)
@RequirePermissions('attendance.read')
async getAttendanceRecordDetail(
  @Param('meetingId', ParseUUIDPipe) meetingId,
  @Param('recordId', ParseUUIDPipe) recordId,
  @CurrentUser() currentUser: { userId: string },
) {
  const data = await this.attendanceService.getAttendanceRecordDetail(meetingId, recordId, currentUser.userId);
  return { success: true, message: 'Attendance record detail retrieved successfully', data };
}
```
- Class đã có `@UseGuards(JwtAuthGuard)`; method thêm `@UseGuards(PermissionsGuard)` + `@RequirePermissions` (mirror list).
- `@ApiResponse` 200/400/401/403/404.

---

## 6. Error handling
| Tình huống | Exception | HTTP | code |
| :--- | :--- | :--- | :--- |
| record không tồn tại / khác meeting | NotFoundException | 404 | `ATTENDANCE_RECORD_NOT_FOUND` |
| param sai uuid | ParseUUIDPipe | 400 | — |
| chưa auth | JwtAuthGuard | 401 | — |
| thiếu quyền | PermissionsGuard | 403 | — |

## 7. Route order (xác minh)
- `attendance.controller.ts`: `@Get()` (list) → `@Get(':recordId')` (detail). GET collection vs GET param không đụng nhau; không route GET tĩnh nào sau `:recordId` ⇒ an toàn.

## 8. Rủi ro & xác minh
| Rủi ro | Xử lý |
| :--- | :--- |
| Đổi constructor phá test AttendanceService | Dùng `attendanceRecordRepo.manager.getRepository(AuditLogEntity)` — KHÔNG inject thêm. |
| N+1 editHistory | 1 query `find(In[...])` — test D3 assert. |
| Route nuốt path | `:recordId` sau `@Get()`; test D4. |
| Lộ field ngoài schema | Base qua `toManualAttendanceResponse` (chỉ field cho phép). |
| `In`/`AuditLogEntity` chưa import | Thêm import additive. |
| Test đụng UC khác | File test riêng. |

## 9. Tác động code người khác
- SỬA additive: `attendance.service.ts` (+method), `attendance.controller.ts` (+handler). KHÔNG đụng `getAttendanceList`/manual-attendance/module khác/`ManualAttendanceResponseDto`.
- KHÔNG đổi constructor. KHÔNG migration/seed/mutation.

## 10. Checklist
**TẠO**: `dto/attendance-record-detail-response.dto.ts`, 2 test spec (riêng).
**SỬA (additive)**: `attendance.service.ts` (+`getAttendanceRecordDetail`), `attendance.controller.ts` (+`@Get(':recordId')`).
**KHÔNG**: migration; seed; đổi constructor; sửa method/endpoint cũ; mutation/audit-ghi.
