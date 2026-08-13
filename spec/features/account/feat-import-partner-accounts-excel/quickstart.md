# Quickstart: Import Excel tài khoản Đối tác/Khách hàng tạm thời

- **Feature ID**: PTA-IMPORT-001
- **Created**: 2026-08-12

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo quickstart | Toàn bộ file |

---

> ⚠️ **CHƯA implement** — tài liệu này mô tả cách dùng SAU KHI feature được code xong, dùng để hình dung luồng thật khi review spec. Không có endpoint nào chạy được tại thời điểm viết tài liệu này (2026-08-12).

## 1. Chuẩn bị
- Đăng nhập bằng tài khoản có permission `account.partner.import` (Business Admin/System Admin, có thể cả Manager — tùy quyết định seed cuối cùng, xem `plan.md` mục 7).
- Chuẩn bị ảnh khuôn mặt cho TỪNG đối tác trong danh sách — đặt tên file = email của người đó (vd `khach1@doitac-x.com.jpg`), gộp thành 1 file `.zip` nếu muốn (khuyến nghị cho đoàn đông).

## 2. Tải template
```bash
curl -X GET "http://localhost:3000/api/v1/users/import-partners/template" \
  -H "Authorization: Bearer <token>" \
  -o partner-accounts-template.xlsx
```
Điền theo 5 cột: `full_name`, `email`, `account_expires_at`, `phone_number`, `license_plate`.

Ví dụ (cả đoàn dùng chung 1 hạn dùng qua `defaultExpiresInDays`, để trống cột `account_expires_at`):
| full_name | email | account_expires_at | phone_number | license_plate |
|---|---|---|---|---|
| Nguyen Van Khach | khach1@doitac-x.com | | 0900000001 | 30A12345 |
| Tran Thi Khach | khach2@doitac-x.com | | | |
| Le Van VIP | khach3@doitac-x.com | 2026-08-20T17:00:00Z | | | (override riêng — hạn dài hơn cả đoàn)

## 3. Bước 1 — Tải lên & Kiểm tra (preview, không tạo, không gọi Cloudinary)
```bash
curl -X POST "http://localhost:3000/api/v1/users/import-partners" \
  -H "Authorization: Bearer <token>" \
  -F "file=@partner-accounts-template.xlsx" \
  -F "photosZip=@anh-doi-tac.zip" \
  -F "defaultExpiresInDays=1"
```
→ Trả `mode=preview`: `validCount`, `invalidCount`, danh sách dòng lỗi kèm lý do (bao gồm dòng thiếu ảnh khớp — `PARTNER_PHOTO_REQUIRED`). **Chưa tạo tài khoản nào, chưa upload ảnh nào lên Cloudinary.**

## 4. Bước 2 — Tiến hành tạo tài khoản (commit)
```bash
curl -X POST "http://localhost:3000/api/v1/users/import-partners" \
  -H "Authorization: Bearer <token>" \
  -F "file=@partner-accounts-template.xlsx" \
  -F "photosZip=@anh-doi-tac.zip" \
  -F "defaultExpiresInDays=1" \
  -F "commit=true"
```
→ Tạo tài khoản cho các dòng hợp lệ (đủ ảnh + hạn dùng tương lai), bỏ qua dòng lỗi. Mỗi tài khoản nhận email chứa email đăng nhập + nhắc "mật khẩu chính là địa chỉ email này" + hạn dùng.

## 5. Đọc kết quả commit
```json
{
  "success": true,
  "message": "Tạo tài khoản đối tác hoàn tất",
  "data": {
    "mode": "commit", "totalRows": 3, "successCount": 2, "failedCount": 1,
    "results": [
      { "row": 2, "email": "khach1@doitac-x.com", "status": "success", "userId": "...", "accountExpiresAt": "2026-08-13T17:00:00.000Z", "vehiclePlateStatus": "attached" },
      { "row": 3, "email": "khach2@doitac-x.com", "status": "success", "userId": "...", "accountExpiresAt": "2026-08-13T17:00:00.000Z" },
      { "row": 4, "email": "khach3@doitac-x.com", "status": "failed", "reason": "PARTNER_PHOTO_REQUIRED" }
    ]
  }
}
```

## 6. Điều đối tác mới nhận được
- Email: địa chỉ đăng nhập = **chính email đó cũng là mật khẩu**.
- Đăng nhập được ngay, **KHÔNG** bị ép đổi mật khẩu (khác luồng nhân viên).
- Chỉ truy cập được các chức năng mở cho đối tác (`@AllowPartnerAccount()`, xem `feat-partner-temporary-account`).

## 7. Lỗi thường gặp
| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `400 IMPORT_ROW_LIMIT_EXCEEDED` | > 50 dòng | Chia nhỏ đoàn khách thành nhiều lượt import |
| Dòng `PARTNER_PHOTO_REQUIRED` | Tên file ảnh không khớp email dòng đó | Kiểm tra chính tả email trong tên file (không phân biệt hoa/thường) |
| Dòng `MISSING_ACCOUNT_EXPIRES_AT` | Để trống cột VÀ không gửi `defaultExpiresInDays` | Điền 1 trong 2 |
| Dòng `EMAIL_ALREADY_EXISTS` | Email đã có tài khoản (nhân viên hoặc đối tác khác) | Dùng email khác |
| `403 FORBIDDEN_ACCESS` | Thiếu permission `account.partner.import` | Xin cấp quyền, hoặc dùng tài khoản Business/System Admin |

## 8. Test cục bộ (sau khi implement)
```bash
npm run test -- partner-account-import.service.spec.ts
npm run build
npm run lint
```
