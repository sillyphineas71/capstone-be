# Quickstart: UC-AM-01 Create New Account

## Mục tiêu kiểm thử nhanh

Xác minh backend `POST /api/v1/accounts` đáp ứng đúng spec và clarification đã chốt, đặc biệt ở các điểm: authorization, validation, transaction boundary, username generation, và warning path khi email fail.

## Pre-conditions

- Có `Administrator` token với `accounts:create` hoặc `accounts:write`.
- Có ít nhất 1 `department` còn hiệu lực và 1 `role` nằm trong whitelist assignable của actor.
- DB có unique constraints cho `email`, `username`, `employee_code`.
- Notification integration có thể được mock/stub để mô phỏng success và failure.

## Happy path

1. Gọi `POST /api/v1/accounts` với payload hợp lệ:

```json
{
  "employeeCode": "EMP0012",
  "fullName": "Nguyen Thi Thanh",
  "email": "THANH.NGUYEN@company.com",
  "phoneNumber": "+84901234567",
  "departmentId": "dep_01",
  "roleId": "role_manager"
}
```

2. Kỳ vọng:
- Response `201 Created`.
- `username` được trả về từ system-generated value.
- `email` được lưu lowercase.
- `status = ACTIVE`.
- `force_change_password = true` trong DB.
- Có record ở `users`, `user_roles`, `audit_logs`.

## Validation scenarios

- Thiếu `fullName`, `employeeCode`, `email`, hoặc `roleId` -> field validation error.
- `employeeCode = emp-01` -> fail regex.
- `phoneNumber = abc123` -> `INVALID_PHONE_NUMBER` hoặc field validation error.
- `email` duplicate -> `DUPLICATE_EMAIL`.
- `employeeCode` duplicate -> `DUPLICATE_EMPLOYEE_CODE`.

## Authorization scenarios

- Token không có `accounts:create` và `accounts:write` -> `FORBIDDEN`.
- Role tồn tại nhưng không thuộc whitelist assignable -> `ROLE_ASSIGNMENT_NOT_ALLOWED`.

## Edge scenarios

- Mock username generation collision 10 lần -> `USERNAME_GENERATION_FAILED`.
- `roleId` invalid tại thời điểm submit -> `INVALID_ROLE_SELECTION`.
- `departmentId` invalid tại thời điểm submit -> `INVALID_DEPARTMENT_SELECTION`.
- Mock Brevo failure sau DB commit -> account vẫn được tạo thành công, response có warning.
