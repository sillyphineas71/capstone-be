# Quickstart: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo quickstart cho import tài khoản Excel | Toàn bộ file |

---

## 1. Chuẩn bị
- Đăng nhập bằng tài khoản Business Admin có permission `accounts.user.import`.
- Biết trước `department_code` và `role_code` hợp lệ (đang active).

## 2. Tải template
```bash
curl -X GET "http://localhost:3000/api/v1/users/import/template" \
  -H "Authorization: Bearer <token>" \
  -o employee-accounts-template.xlsx
```
Điền theo 8 cột: `full_name`, `email`, `department_code`, `role_codes`, `employee_code`, `phone_number`, `position_title`, `direct_manager_email`.

Ví dụ:
| full_name | email | department_code | role_codes | employee_code | phone_number | position_title | direct_manager_email |
|---|---|---|---|---|---|---|---|
| Nguyen Van A | a@company.com | ENG | EMPLOYEE | EMP001 | 0900000001 | Dev | lead@company.com |
| Tran Thi B | b@company.com | HR | EMPLOYEE;MANAGER | EMP002 | | HR Lead | |

## 3. Bước 1 — Tải lên & Kiểm tra (preview, không tạo)
```bash
curl -X POST "http://localhost:3000/api/v1/users/import" \
  -H "Authorization: Bearer <token>" \
  -F "file=@employee-accounts-template.xlsx"
```
→ Trả `mode=preview`: `validCount`, `invalidCount`, và danh sách dòng lỗi kèm lý do. **Chưa tạo tài khoản nào.**

## 4. Bước 2 — Tiến hành tạo tài khoản (commit)
```bash
curl -X POST "http://localhost:3000/api/v1/users/import" \
  -H "Authorization: Bearer <token>" \
  -F "file=@employee-accounts-template.xlsx" \
  -F "commit=true"
```
→ Tạo tài khoản cho các dòng hợp lệ, bỏ qua dòng lỗi (BR2). Mỗi tài khoản nhận email chứa email đăng nhập + mật khẩu tạm.

## 5. Đọc kết quả commit
```json
{
  "success": true,
  "message": "Tạo tài khoản hoàn tất",
  "data": {
    "mode": "commit", "totalRows": 2, "successCount": 2, "failedCount": 0,
    "results": [
      { "row": 2, "email": "a@company.com", "status": "success", "userId": "..." },
      { "row": 3, "email": "b@company.com", "status": "success", "userId": "..." }
    ]
  }
}
```
> Mật khẩu tạm KHÔNG có trong response — chỉ gửi qua email (bảo mật).

## 6. Điều tài khoản mới nhận được
- Email: địa chỉ đăng nhập (= email) + mật khẩu tạm.
- Lần đăng nhập đầu tiên **bắt buộc đổi mật khẩu** (BR3).

## 7. Lỗi thường gặp
| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `400 INVALID_FILE_FORMAT` | Không phải `.xlsx` | Dùng template chuẩn |
| `400 FILE_TOO_LARGE` | File > 2MB | Chia nhỏ file |
| `400 INVALID_TEMPLATE` | Sai/thiếu header | Tải lại template |
| `400 IMPORT_ROW_LIMIT_EXCEEDED` | > 200 dòng | Chia nhỏ file |
| Dòng `EMAIL_ALREADY_EXISTS` | Email đã có tài khoản | Bỏ dòng đó / dùng email khác |
| Dòng `DEPARTMENT_NOT_FOUND` | Sai `department_code` | Kiểm tra mã phòng ban active |
| Dòng `ROLE_NOT_FOUND` | Sai `role_code` | Kiểm tra role_code active |

## 8. Test cục bộ
```bash
npm run test -- account-import.service.spec.ts
npm run build
npm run lint
```
