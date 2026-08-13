# API Contract: Import Excel tài khoản Đối tác/Khách hàng tạm thời

- **Feature ID**: PTA-IMPORT-001
- **Created**: 2026-08-12

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo API contract | Toàn bộ file |

---

## 1. Endpoint: Tải template

### `GET /api/v1/users/import-partners/template`
| Aspect | Detail |
|---|---|
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `account.partner.import` |
| Response | `200` file `.xlsx` |
| Content-Type | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Content-Disposition | `attachment; filename="partner-accounts-template.xlsx"` |

Template gồm 5 cột header: `full_name`, `email`, `account_expires_at`, `phone_number`, `license_plate`; 1-2 dòng ví dụ; sheet hướng dẫn nhắc rõ ảnh sinh trắc học bắt buộc + đặt tên file = email.

---

## 2. Endpoint: Import (preview + commit)

### `POST /api/v1/users/import-partners`
| Aspect | Detail |
|---|---|
| Method | POST |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `account.partner.import` |
| Content-Type | `multipart/form-data` |
| Interceptor | `FileFieldsInterceptor([{file},{photos},{photosZip}])` (memoryStorage) |

### Request (multipart form fields)
| Field | Type | Required | Ghi chú |
|---|---|---|---|
| `file` | binary (.xlsx) | ✅ | Danh sách đối tác |
| `commit` | boolean | ❌ (default `false`) | `false`=preview (không ghi DB, không gọi Cloudinary); `true`=tạo tài khoản |
| `photos` | binary[] | ❌ | Nhiều ảnh rời, tên file = `email` của dòng (không phân biệt hoa/thường, bỏ đuôi mở rộng) |
| `photosZip` | binary | ❌ | 1 file `.zip` gộp nhiều ảnh, mỗi entry = 1 ảnh, tên entry = `email` |
| `defaultExpiresInDays` | number | ❌ | Áp dụng cho dòng nào để trống cột `account_expires_at`. Nếu KHÔNG gửi field này VÀ có dòng để trống cột → dòng đó lỗi `MISSING_ACCOUNT_EXPIRES_AT` |

> **Khác biệt quan trọng so với `POST /users/import` (nhân viên)**: `photos`/`photosZip` ở đây **không phải tùy chọn theo nghĩa best-effort** — mỗi dòng BẮT BUỘC có đúng 1 ảnh khớp, nếu không dòng đó bị loại (`PARTNER_PHOTO_REQUIRED`). Không có field `biometricConsentConfirmed` (khác import nhân viên) — theo đúng hành vi đã chốt ở `PTA-001` đơn lẻ, nơi admin nhập ảnh hộ được xem là hành động tin cậy tại thời điểm tạo, không cần checkbox xác nhận riêng.

### Swagger body schema
```json
{
  "type": "object",
  "properties": {
    "file": { "type": "string", "format": "binary" },
    "commit": { "type": "boolean" },
    "photos": { "type": "array", "items": { "type": "string", "format": "binary" } },
    "photosZip": { "type": "string", "format": "binary" },
    "defaultExpiresInDays": { "type": "number" }
  },
  "required": ["file"]
}
```

---

## 3. Responses

### 3.1 `200` — Preview (`commit=false`)
```json
{
  "success": true,
  "message": "Kiểm tra hoàn tất",
  "data": {
    "mode": "preview",
    "totalRows": 5,
    "validCount": 3,
    "invalidCount": 2,
    "results": [
      { "row": 2, "email": "khach1@doitac-x.com", "status": "valid", "accountExpiresAt": "2026-08-13T17:00:00.000Z" },
      { "row": 3, "email": "khach2@doitac-x.com", "status": "invalid", "reason": "PARTNER_PHOTO_REQUIRED" },
      { "row": 4, "email": "khach3@doitac-x.com", "status": "invalid", "reason": "MISSING_ACCOUNT_EXPIRES_AT" }
    ]
  }
}
```

### 3.2 `200` — Commit (`commit=true`)
```json
{
  "success": true,
  "message": "Tạo tài khoản đối tác hoàn tất",
  "data": {
    "mode": "commit",
    "totalRows": 5,
    "successCount": 3,
    "failedCount": 2,
    "results": [
      {
        "row": 2,
        "email": "khach1@doitac-x.com",
        "status": "success",
        "userId": "uuid",
        "accountExpiresAt": "2026-08-13T17:00:00.000Z",
        "vehiclePlateStatus": "attached"
      },
      { "row": 3, "email": "khach2@doitac-x.com", "status": "failed", "reason": "PARTNER_PHOTO_REQUIRED" }
    ]
  }
}
```
> Mật khẩu (= email) KHÔNG lặp lại trong response — client/FE tự biết quy tắc "mật khẩu = email" từ tài liệu, không cần server trả lại.

### 3.3 Error responses cấp request
| Status | Code | Điều kiện |
|---|---|---|
| 400 | `INVALID_FILE_FORMAT` | Không phải `.xlsx` |
| 400 | `FILE_TOO_LARGE` | Vượt dung lượng Excel (2MB) |
| 400 | `INVALID_TEMPLATE` | File rỗng / sai header |
| 400 | `IMPORT_ROW_LIMIT_EXCEEDED` | > 50 dòng |
| 400 | `INVALID_PHOTOS_ZIP` | `.zip` ảnh lỗi/quá lớn/quá số lượng entry |
| 400 | `INVALID_DEFAULT_EXPIRES_IN_DAYS` | `defaultExpiresInDays` không phải số nguyên dương |
| 401 | — | Chưa đăng nhập |
| 403 | `FORBIDDEN_ACCESS` | Thiếu permission `account.partner.import` |

---

## 4. Mã lỗi cấp dòng (`results[].reason`)
| Reason | Ý nghĩa |
|---|---|
| `MISSING_REQUIRED_FIELD` | Thiếu `full_name`/`email` |
| `INVALID_EMAIL` | Email sai định dạng |
| `DUPLICATE_IN_FILE` | Trùng email trong file |
| `EMAIL_ALREADY_EXISTS` | Email đã tồn tại DB (bất kỳ loại tài khoản nào) |
| `INVALID_ACCOUNT_EXPIRES_AT` | Cột `account_expires_at` không parse được thành ngày |
| `MISSING_ACCOUNT_EXPIRES_AT` | Cột trống VÀ request không có `defaultExpiresInDays` |
| `ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE` | `account_expires_at` hiệu lực không ở tương lai |
| `PARTNER_PHOTO_REQUIRED` | Không tìm thấy ảnh khớp `email` của dòng này |
| `PARTNER_PHOTO_INVALID_IMAGE` | Ảnh khớp nhưng không phải JPEG/PNG/WEBP hợp lệ (magic-bytes) — chỉ phát hiện ở bước **commit** |
| `PARTNER_PHOTO_TOO_LARGE` | Ảnh khớp nhưng > 5MB — chỉ phát hiện ở bước **commit** |

---

## 5. `vehiclePlateStatus` (best-effort, KHÔNG làm lỗi dòng)
Tái dùng nguyên enum `ImportAccountVehiclePlateStatus` của `ACCT-IMPORT-ACCOUNT-001`: `pending_commit | attached | invalid_plate | duplicate_plate | attach_failed`. Chỉ xuất hiện khi dòng có điền `license_plate`.

---

## 6. Ghi chú tuân thủ
- Response bọc format chuẩn `{ success, message, data, error }` (CLAUDE.md §8).
- Endpoint là API người dùng (JWT) → DTO/validation ở boundary; file/ảnh parse trong memory.
- KHÔNG trả mật khẩu trong response.
- Khác `POST /users/import` (nhân viên): route này KHÔNG có field `biometricConsentConfirmed`; ảnh là điều kiện bắt buộc, không phải optional best-effort.
