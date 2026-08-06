# API Contract: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-06 | Theo yêu cầu FE (`Docs/Nam_Sent/BE_REQUIREMENTS.md`): template đổi header sang tiếng Việt + thêm cột STT (7 cột), validate số cột thực tế với message riêng, `Loại` chấp nhận giá trị tiếng Việt | Mục 1, 3.3 |
| 2026-07-10 | Khởi tạo API contract cho import Excel | Toàn bộ file |

---

## 1. Endpoint: Tải template

### `GET /api/v1/meetings/:meetingId/participants/import/template`

| Aspect | Detail |
|---|---|
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `meeting.participant.import` |
| Param | `meetingId` (UUID, `ParseUUIDPipe`) |
| Response | `200` file `.xlsx` (stream/buffer) |
| Content-Type | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Content-Disposition | `attachment; filename="meeting-participants-template.xlsx"` |

Template gồm: header 7 cột, đúng thứ tự trái→phải: `STT`, `Loại`, `Email`, `Mã nhân viên`, `Họ và tên`, `Tổ chức`, `Số điện thoại`; 3 dòng ví dụ (2 internal, 1 external); sheet hướng dẫn.

Cột `Loại` chấp nhận `Nội bộ`/`internal` (nhân viên nội bộ) hoặc `Khách ngoài`/`external` (khách ngoài) khi parse file upload.

---

## 2. Endpoint: Import

### `POST /api/v1/meetings/:meetingId/participants/import`

| Aspect | Detail |
|---|---|
| Method | POST |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `meeting.participant.import` |
| Content-Type | `multipart/form-data` |
| Interceptor | `FileInterceptor('file')` (memoryStorage) |

### Request (multipart form fields)
| Field | Type | Required | Ghi chú |
|---|---|---|---|
| `file` | binary (.xlsx) | ✅ | File danh sách thành viên |
| `forceAddWithWarnings` | boolean | ❌ (default `false`) | `true` để xác nhận thêm cả dòng cảnh báo |

### Swagger body schema
```json
{
  "type": "object",
  "properties": {
    "file": { "type": "string", "format": "binary" },
    "forceAddWithWarnings": { "type": "boolean" }
  },
  "required": ["file"]
}
```

---

## 3. Responses

### 3.1 `200 OK` — Đã commit
```json
{
  "success": true,
  "message": "Import hoàn tất",
  "data": {
    "totalRows": 20,
    "successCount": 17,
    "failedCount": 2,
    "warningCount": 1,
    "results": [
      { "row": 2, "type": "internal", "identifier": "a@x.com", "status": "success", "participantId": "uuid" },
      { "row": 5, "type": "external", "identifier": "guest@ext.com", "status": "success", "participantId": "uuid" },
      { "row": 4, "type": "internal", "identifier": "ghost@x.com", "status": "failed", "reason": "USER_NOT_FOUND" }
    ]
  }
}
```

### 3.2 `422 Unprocessable Entity` — Có cảnh báo, cần xác nhận
```json
{
  "success": false,
  "error": {
    "code": "WARNING_CONFIRMATION_REQUIRED",
    "message": "Có dòng cảnh báo. Vui lòng xem lại và xác nhận.",
    "details": {
      "totalRows": 20,
      "warningCount": 2,
      "errorCount": 1,
      "results": [
        { "row": 2, "type": "internal", "identifier": "a@x.com", "status": "valid" },
        { "row": 3, "type": "internal", "identifier": "b@x.com", "status": "warning", "reason": "SCHEDULE_CONFLICT" },
        { "row": 4, "type": "internal", "identifier": "ghost@x.com", "status": "error", "reason": "USER_NOT_FOUND" }
      ]
    }
  }
}
```

### 3.3 Error responses cấp request
| Status | Code | Điều kiện |
|---|---|---|
| 400 | `INVALID_FILE_FORMAT` | Không phải `.xlsx` |
| 400 | `INVALID_TEMPLATE` | File rỗng / sai tên cột hoặc sai thứ tự / thừa cột (> 7 cột thực tế theo `sheet.columnCount`) — message: `"Sai nguyên mẫu. Vui lòng không tự ý thêm cột."` |
| 400 | `IMPORT_ROW_LIMIT_EXCEEDED` | > 200 dòng |
| 400 | `FILE_TOO_LARGE` | Vượt giới hạn kích thước |
| 400 | `INVALID_MEETING_STATUS` | Meeting không ở `scheduled`/`in_progress` |
| 403 | `FORBIDDEN_ACCESS` | Private meeting, actor không đủ quyền |
| 404 | `MEETING_NOT_FOUND` | Meeting không tồn tại |
| 422 | `WARNING_CONFIRMATION_REQUIRED` | Có dòng cảnh báo, `forceAddWithWarnings=false` |

---

## 4. Mã lỗi cấp dòng (trong `results[].reason`)

| Reason | Ý nghĩa |
|---|---|
| `INVALID_ROW_TYPE` | `Loại` không phải internal/external (hoặc Nội bộ/Khách ngoài) |
| `MISSING_IDENTIFIER` | Internal thiếu cả Email và Mã nhân viên |
| `USER_NOT_FOUND` | Không tìm thấy user hoặc inactive |
| `INVALID_EXTERNAL_ROW` | External thiếu full_name/email hợp lệ |
| `DUPLICATE_IN_FILE` | Trùng trong chính file |
| `PARTICIPANT_ALREADY_EXISTS` | Đã có trong cuộc họp |
| `SCHEDULE_CONFLICT` | (warning) Người dùng trùng lịch |
| `ROOM_CAPACITY_WARNING` | (warning) Vượt sức chứa, policy=warning |
| `ROOM_CAPACITY_EXCEEDED` | (error) Vượt sức chứa policy=block hoặc không có quyền override |

---

## 5. Ghi chú tuân thủ
- Response bọc theo format chuẩn dự án `{ success, message, data, error }` (AGENTS.md §8).
- Endpoint là API người dùng (JWT), KHÔNG phải device callback → bắt buộc DTO/validation ở boundary.
- File chỉ parse trong memory, không lưu DB.
