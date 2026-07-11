# Quickstart: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo quickstart cho import Excel | Toàn bộ file |

---

## 1. Chuẩn bị
- Đăng nhập tài khoản có permission `meeting.participant.import` (ADMIN/MANAGER/EMPLOYEE).
- Có `meetingId` của cuộc họp đang `scheduled` hoặc `in_progress`.

## 2. Tải template
```bash
curl -X GET \
  "http://localhost:3000/api/v1/meetings/<meetingId>/participants/import/template" \
  -H "Authorization: Bearer <token>" \
  -o template.xlsx
```
Điền dữ liệu theo 6 cột: `type`, `email`, `employee_code`, `full_name`, `organization_name`, `phone_number`.

Ví dụ nội dung:
| type | email | employee_code | full_name | organization_name | phone_number |
|---|---|---|---|---|---|
| internal | an@company.com | | | | |
| internal | | EMP0123 | | | |
| external | guest@ext.com | | Nguyen Van B | Cty ABC | 0900000000 |

## 3. Import (lần 1 — dry-run nếu có cảnh báo)
```bash
curl -X POST \
  "http://localhost:3000/api/v1/meetings/<meetingId>/participants/import" \
  -H "Authorization: Bearer <token>" \
  -F "file=@template.xlsx"
```
- Nếu **không** có dòng cảnh báo → import luôn, trả `200` với báo cáo.
- Nếu có dòng cảnh báo (trùng lịch / quá sức chứa) → trả `422 WARNING_CONFIRMATION_REQUIRED` + preview từng dòng, **chưa ghi DB**.

## 4. Import (lần 2 — xác nhận cảnh báo)
```bash
curl -X POST \
  "http://localhost:3000/api/v1/meetings/<meetingId>/participants/import" \
  -H "Authorization: Bearer <token>" \
  -F "file=@template.xlsx" \
  -F "forceAddWithWarnings=true"
```
→ Thêm tất cả dòng không lỗi cứng (gồm dòng cảnh báo), trả `200` với `results[]`.

## 5. Đọc kết quả
```json
{
  "success": true,
  "message": "Import hoàn tất",
  "data": {
    "totalRows": 3, "successCount": 2, "failedCount": 1, "warningCount": 0,
    "results": [
      { "row": 2, "type": "internal", "identifier": "an@company.com", "status": "success", "participantId": "..." },
      { "row": 4, "type": "external", "identifier": "guest@ext.com", "status": "success", "participantId": "..." },
      { "row": 3, "type": "internal", "identifier": "EMP0123", "status": "failed", "reason": "USER_NOT_FOUND" }
    ]
  }
}
```

## 6. Kết quả kênh thông báo
- **Nội bộ** thêm thành công: nhận **thông báo in-app** (không email).
- **Khách ngoài** thêm thành công: nhận **email mời** riêng.

## 7. Các lỗi thường gặp
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `400 INVALID_FILE_FORMAT` | Không phải `.xlsx` | Dùng đúng file template |
| `400 INVALID_TEMPLATE` | Sai/thiếu header | Tải lại template chuẩn |
| `400 IMPORT_ROW_LIMIT_EXCEEDED` | > 200 dòng | Chia nhỏ file |
| `403 FORBIDDEN_ACCESS` | Họp private, không phải Organizer/Host/Admin | Nhờ Organizer import |
| Dòng `MISSING_IDENTIFIER` | Internal trống cả email lẫn mã NV | Điền ít nhất 1 |
| Dòng `DUPLICATE_IN_FILE` | Trùng email/mã trong file | Xóa dòng trùng |

## 8. Test cục bộ
```bash
npm run test -- participant-import.service.spec.ts
npm run build
npm run lint
```
