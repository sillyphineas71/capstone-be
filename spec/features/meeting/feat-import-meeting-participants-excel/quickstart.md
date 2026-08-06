# Quickstart: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-06 | Theo yêu cầu FE (`Docs/Nam_Sent/BE_REQUIREMENTS.md`): header đổi sang tiếng Việt + thêm cột STT (7 cột), `Loại` chấp nhận giá trị tiếng Việt, cập nhật bảng lỗi thường gặp | Mục 2, 7 |
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
Điền dữ liệu theo đúng 7 cột, đúng thứ tự (không tự ý thêm/bớt/đổi tên cột): `STT`, `Loại`, `Email`, `Mã nhân viên`, `Họ và tên`, `Tổ chức`, `Số điện thoại`.

Cột `Loại` chấp nhận `Nội bộ` / `internal` (nhân viên nội bộ) hoặc `Khách ngoài` / `external` (khách ngoài).

Ví dụ nội dung:
| STT | Loại | Email | Mã nhân viên | Họ và tên | Tổ chức | Số điện thoại |
|---|---|---|---|---|---|---|
| 1 | Nội bộ | an@company.com | | | | |
| 2 | Nội bộ | | EMP0123 | | | |
| 3 | Khách ngoài | guest@ext.com | | Nguyen Van B | Cty ABC | 0900000000 |

Dòng hoàn toàn trống, hoặc chỉ điền `STT` mà các cột còn lại đều trống, sẽ tự động được bỏ qua (không tính là lỗi).

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
| `400 INVALID_TEMPLATE` ("Sai nguyên mẫu. Vui lòng không tự ý thêm cột.") | Sai/thiếu header, hoặc thừa cột (> 7 cột) | Tải lại template chuẩn, không tự ý thêm cột |
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
