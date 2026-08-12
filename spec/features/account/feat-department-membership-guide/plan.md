# Implementation Plan: Department Membership via existing Users API

- **Feature ID**: ACCT-DEPT-MEMBERSHIP-001
- **Created**: 2026-08-12
- **Status**: Draft — **KHÔNG có phần "implementation" thực sự, đây là tài liệu tích hợp**

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Chốt quyết định: chấp nhận giới hạn (§6 giờ chỉ còn giá trị tham khảo, KHÔNG triển khai). | §6 |
| 2026-08-12 | Khởi tạo plan. | Toàn bộ file |

---

## 1. Feature Summary
Không có code BE mới. Toàn bộ "plan" ở đây là kế hoạch **bàn giao tài liệu API cho FE** + đề xuất theo dõi 1 quyết định còn treo (gap ở spec.md §9).

## 2. Technical Context
- **Module liên quan**: `accounts` — `users.controller.ts` (`PATCH :userId`), `users.service.ts` (`updateUser`).
- **Không đụng**: `DepartmentsController`/`DepartmentsService` — feature này không thêm gì vào 2 file đó.

## 3. Constitution Check
- **DB Gate**: PASS — không đổi schema.
- **Scope Gate**: PASS — không code mới, không permission mới, không migration.
- **Security Gate**: N/A — không có endpoint mới để đánh giá.
- **Test Gate**: N/A — không có code mới cần test tự động; xác nhận hành vi bằng cách đọc code (đã làm ở spec.md, có trích dẫn dòng cụ thể).

**Complexity Justification**: Không áp dụng — đây là tài liệu, không phải implementation.

## 4. Scope Confirmation

### Trong scope
- Tài liệu API contract (`PATCH /users/:userId`) dành cho FE tích hợp trang quản lý phòng ban.
- Cảnh báo rõ gap "không hỗ trợ gỡ khỏi phòng ban" (`departmentId: null` bị bỏ qua âm thầm).

### Ngoài scope
- Bất kỳ thay đổi code nào ở `users.controller.ts`/`users.service.ts`/`update-user.dto.ts`.
- Endpoint department-centric mới (`POST`/`DELETE /departments/:id/members`).
- Sửa gap `departmentId: null` — nếu Thiếu Chủ chốt cần, đây sẽ là 1 feature/spec riêng (xem đề xuất ở mục 6).

## 5. Files liên quan (KHÔNG sửa, chỉ tham chiếu để viết tài liệu)
```
src/modules/accounts/controllers/users.controller.ts   (PATCH :userId, dòng 541-614)
src/modules/accounts/dto/update-user.dto.ts             (departmentId, dòng 58-60)
src/modules/accounts/services/users.service.ts          (updateUser, dòng 1460-1690; gap dòng 1598-1599)
```

## 6. [KHÔNG TRIỂN KHAI — chỉ lưu tham khảo] Đề xuất hỗ trợ "gỡ khỏi phòng ban"
**Đã chốt 2026-08-12: KHÔNG triển khai mục này.** Thiếu Chủ đã chọn hướng "chấp nhận giới hạn" (spec.md §1.5) — giữ lại nội dung dưới đây chỉ để tham khảo nếu sau này nghiệp vụ đổi và cần làm lại.

1. `UpdateUserDto.departmentId`: đổi kiểu `string | undefined` → `string | null | undefined`, thay `@IsUUID('4')` bằng custom validator chấp nhận cả `null` và UUID hợp lệ (mirror cách `UpdateDepartmentDto.parentDepartmentId`/`managerUserId` đã làm — `update-department.dto.ts:36-42`).
2. `users.service.ts:1598-1599`: đổi điều kiện `typeof dto.departmentId === 'string'` → `dto.departmentId !== undefined`, thêm nhánh xử lý `null` (set `changed.departmentId = null`, bỏ qua bước validate "department tồn tại + active" khi giá trị là `null`).
3. Cần làm rõ nghiệp vụ: nhân viên "không thuộc phòng ban nào" có hợp lệ không? (Tạo mới hiện đang BẮT BUỘC có `departmentId` — `users.service.ts:151-158` — nên đây là thay đổi quy tắc nghiệp vụ, không chỉ kỹ thuật, cần chốt riêng.)

## 7. Testing Strategy
Không có test tự động mới. Đề xuất FE làm 1 lượt test thủ công qua Swagger trước khi tích hợp thật:
- Chuyển 1 user sang phòng ban khác hợp lệ → xác nhận 200 + `departmentId` đổi đúng.
- Gửi `departmentId` trỏ phòng ban không tồn tại → xác nhận 404.
- Gửi `departmentId: null` → xác nhận **response 200 nhưng `departmentId` KHÔNG đổi** (đúng như gap đã ghi nhận — nếu hành vi thực tế khác mô tả, đây là dấu hiệu code đã thay đổi từ lúc khảo sát, cần cập nhật lại tài liệu này).

## 8. Implementation Phases
Không có — xem tasks.md (chỉ có task tài liệu/xác minh, không có task code).

## 9. Files to Create / Modify
Không có file code nào cần tạo/sửa trong phạm vi feature này.

## 10. Dependencies & Integration Points
| Dependency | Integration | Ghi chú |
|---|---|---|
| `PATCH /api/v1/users/:userId` (đã có sẵn) | FE gọi trực tiếp | Không qua `DepartmentsController` |
| `GET /api/v1/departments` hoặc `GET /api/v1/departments/:id` (ACCT-DEPT-DETAIL-001) | FE dùng để lấy danh sách phòng ban đích cho dropdown "chuyển sang phòng ban khác" | Không phải dependency code, chỉ là luồng UX |
