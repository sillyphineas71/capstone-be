# Quickstart: Kiểm thử tính năng Logout (AUTH-002)

Tài liệu này hướng dẫn cách gọi và kiểm thử API Logout trong môi trường phát triển (Local).

## Điều kiện tiên quyết
1. Backend đang chạy ở `http://localhost:3000` (hoặc port được cấu hình).
2. Bạn đã gọi thành công API Login (`POST /api/v1/auth/login`) và nhận được một `accessToken` hợp lệ. Access token này phải đang ở trạng thái active (chưa hết hạn, chưa bị revoke).

## 1. Test Case: Logout Thành Công (Luồng chuẩn)

Sử dụng cURL hoặc Postman để gửi một request POST:

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer <NHẬP_ACCESS_TOKEN_VÀO_ĐÂY>"
```

**Kỳ vọng (200 OK):**
```json
{
  "success": true,
  "data": {
    "revoked": true,
    "revokedAt": "2026-05-27T10:15:30.000Z"
  },
  "meta": {}
}
```

## 2. Test Case: Idempotent Logout (Gọi lại cùng 1 token)

Gửi chính xác request cURL ở Bước 1 thêm một lần nữa.

**Kỳ vọng (200 OK):**
Hệ thống vẫn phải trả về 200 OK và JSON tương tự, không được văng lỗi 400 hay 404. Tính chất này giúp frontend an tâm khi retry logic.

## 3. Test Case: Kiểm tra Protected API sau khi Logout

Cố gắng truy cập vào bất kỳ một API nội bộ nào đó yêu cầu xác thực bằng chính `accessToken` vừa bị logout. Ví dụ: gọi API lấy danh sách user hoặc room.

```bash
curl -X GET http://localhost:3000/api/v1/accounts/me \
  -H "Authorization: Bearer <NHẬP_ACCESS_TOKEN_VỪA_LOGOUT_VÀO_ĐÂY>"
```

**Kỳ vọng (401 Unauthorized):**
Hệ thống phải từ chối ngay lập tức vì session đã bị thu hồi trong Database.
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

## 4. Test Case: Thiếu Token

Gửi request tới API Logout nhưng không đính kèm Header Authorization.

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout
```

**Kỳ vọng (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Unauthorized"
}
```
