# Feature Specification: Gán nhân viên sang phòng ban khác qua API đã có sẵn (PATCH /users/:userId)

- **Feature ID**: ACCT-DEPT-MEMBERSHIP-001
- **Feature Name**: Department Membership via existing Users API — API Usage Guide
- **Module / Domain**: accounts
- **Created Date**: 2026-08-12
- **Status**: ✅ Sẵn sàng bàn giao FE (2026-08-12) — tài liệu tích hợp, KHÔNG phải yêu cầu code mới ở BE
- **Related**: ACCT-DEPT-DETAIL-001, ACCT-DEPT-DEACTIVATE-001, ACCT-DEPT-MEMBERS-001 (GET /departments/:id/members)
- **Source Documents**:
  - Quyết định trực tiếp của Thiếu Chủ (2026-08-12): dùng lại `PATCH /users/:id` hiện có, không xây endpoint department-centric mới (`POST/DELETE /departments/:id/members`).
  - Khảo sát code thật: `src/modules/accounts/controllers/users.controller.ts`, `src/modules/accounts/dto/update-user.dto.ts`, `src/modules/accounts/services/users.service.ts`.

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | **Đóng gate cuối cùng (T2, tasks.md)**: re-verify `users.controller.ts`/`users.service.ts`/`update-user.dto.ts` không đổi kể từ lúc khảo sát → mọi trích dẫn dòng vẫn đúng. Đổi Status → Sẵn sàng bàn giao FE. | Status, §11 |
| 2026-08-12 | **Chốt quyết định của Thiếu Chủ**: chấp nhận giới hạn của API hiện có — FE chỉ làm nút "Chuyển sang phòng ban khác", KHÔNG làm nút "Gỡ khỏi phòng ban". Hướng "mở rộng BE để hỗ trợ `null`" (spec.md §9 mục 2 cũ) chính thức **KHÔNG triển khai**. | §9, §11 (mới) |
| 2026-08-12 | Khởi tạo spec. **Phát hiện gap quan trọng khi khảo sát code**: `PATCH /users/:id` chỉ hỗ trợ **chuyển user sang phòng ban KHÁC**, KHÔNG hỗ trợ "gỡ khỏi phòng ban" (đưa về trạng thái không thuộc phòng ban nào) — xem §1.5 và §3 FR-003. | Toàn bộ file |

---

## 1. Context & Goal

### 1.1 Bối cảnh
Trang FE `/business-admin/departments` cần thao tác "thêm/gỡ 1 nhân viên khỏi phòng ban". Trước khi quyết định xây endpoint mới, đã khảo sát: `PATCH /api/v1/users/:userId` (module `users`, cùng `accounts`) đã nhận field `departmentId` trong body và đổi được phòng ban của 1 user.

### 1.2 Mục tiêu ban đầu
Tài liệu hoá cách FE dùng lại `PATCH /users/:userId` để thực hiện "gán/gỡ nhân viên khỏi phòng ban" mà không cần code BE mới.

### 1.3 Quyết định thiết kế
Dùng lại nguyên xi `PATCH /api/v1/users/:userId` — **không thêm endpoint department-centric mới**. Lý do: tránh trùng lặp toàn bộ logic validate user/department/scope đã có sẵn trong `UsersService.updateUser()` (department tồn tại + active, Business Admin bị giới hạn theo department scope) — xây thêm endpoint mới trên `DepartmentsController` sẽ phải chép lại chính xác cùng logic đó, nguy cơ lệch hành vi giữa 2 đường.

### 1.4 ⚠️ Gap phát hiện khi khảo sát code (QUAN TRỌNG — đọc trước khi FE tích hợp)
Khi đối chiếu code thật để viết tài liệu này, phát hiện `PATCH /users/:userId` **KHÔNG hỗ trợ gỡ nhân viên khỏi phòng ban** (đưa `departmentId` về "không có"):

```ts
// users.service.ts:1598-1599
// departmentId: chỉ hỗ trợ đổi sang department khác (không hỗ trợ clear = null trong UC-09)
if (typeof dto.departmentId === 'string') {
  if (dto.departmentId !== targetUser.departmentId) { ... }
}
```

Nếu FE gửi `{ "departmentId": null }`:
1. `UpdateUserDto.departmentId` dùng `@IsOptional() @IsUUID('4')` ([update-user.dto.ts:58-60](../../../../src/modules/accounts/dto/update-user.dto.ts#L58-L60)) — `@IsOptional()` coi `null` là "rỗng" nên **KHÔNG báo lỗi validate**, request vẫn qua `200`.
2. Nhưng trong service, `typeof null !== 'string'` nên điều kiện ở dòng 1599 **không khớp** → **giá trị bị bỏ qua hoàn toàn, không có gì thay đổi** — user vẫn giữ nguyên `departmentId` cũ.
3. Đây **không phải bug** — comment trong code (dòng 1598) xác nhận đây là **chủ đích của UC-09**: chỉ hỗ trợ *chuyển phòng ban*, không hỗ trợ *đưa về không có phòng ban nào*.

**Hệ quả cho tính năng "gỡ khỏi phòng ban" trên trang FE**: KHÔNG thể triển khai đúng nghĩa "gỡ ra, để trống" bằng API hiện có. Chỉ có thể triển khai dưới dạng "**chuyển sang phòng ban khác**". Xem §9 để chọn hướng xử lý.

### 1.5 Quyết định cuối cùng (chốt cùng Thiếu Chủ, 2026-08-12)
**Chấp nhận giới hạn của API hiện có.** FE trang quản lý phòng ban chỉ triển khai nút **"Chuyển sang phòng ban khác"** (yêu cầu chọn phòng ban đích), **KHÔNG** triển khai nút "Gỡ khỏi phòng ban / để trống". Lý do: mọi nhân viên tạo mới đều bắt buộc có `departmentId` (`users.service.ts:151-158`), nên trạng thái "không thuộc phòng ban nào" vốn không tồn tại hợp lệ trong nghiệp vụ hiện tại — không cần API hỗ trợ trạng thái đó. Hướng "mở rộng BE cho phép `null`" (từng nêu ở §9 bản nháp) **chính thức không triển khai**.

---

## 2. Actor & Roles

| Actor | Quyền | Giới hạn |
|---|---|---|
| System Admin | `accounts.user.update` | Không giới hạn — đổi phòng ban cho bất kỳ user nào, sang bất kỳ phòng ban nào ([users.service.ts:1539-1547](../../../../src/modules/accounts/services/users.service.ts#L1539-L1547)) |
| Business Admin | `accounts.user.update` | **Giới hạn theo department scope**: cả user hiện tại LẪN phòng ban mới đều phải nằm trong scope quản lý của actor ([users.service.ts:1682-1686](../../../../src/modules/accounts/services/users.service.ts#L1682-L1686)) — nếu không, `403 FORBIDDEN` |

---

## 3. Functional Requirements (mô tả hành vi API đã tồn tại — KHÔNG yêu cầu code mới)

- **FR-001**: `PATCH /api/v1/users/:userId` với body `{ "departmentId": "<uuid-phòng-ban-mới>" }` SHALL chuyển user sang phòng ban mới, nếu phòng ban đó tồn tại và `isActive=true` (nếu không → `404 DEPARTMENT_NOT_FOUND` hoặc `409 DEPARTMENT_INACTIVE_OR_DELETED`).
- **FR-002**: WHEN actor là Business Admin, THE system SHALL kiểm tra cả `targetUser` hiện tại LẪN phòng ban mới đều nằm trong department scope của actor, nếu không → `403 FORBIDDEN`.
- **FR-003 (GAP đã xác nhận)**: WHEN body gửi `{ "departmentId": null }`, THE system SHALL **bỏ qua field này hoàn toàn** (no-op) — KHÔNG lỗi, KHÔNG đổi gì. Đây KHÔNG phải cách "gỡ khỏi phòng ban".
- **FR-004**: Body chỉ chấp nhận đúng 5 field: `fullName`, `employeeCode`, `phoneNumber`, `positionTitle`, `departmentId` (+ `accountExpiresAt` chỉ dành riêng cho tài khoản đối tác) — `forbidNonWhitelisted` sẽ trả `400` nếu gửi field khác (vd `roleIds`, `accountStatus`).
- **FR-005**: Body rỗng (không field nào) → `400` (mirror `EMPTY_UPDATE_PAYLOAD`, xem `users.service.ts:1485-1492`).

---

## 4. Non-functional Requirements
- Không áp dụng thêm (kế thừa nguyên trạng NFR của `PATCH /users/:userId`, ngoài phạm vi tài liệu này).

---

## 5. Data Model
Không đổi. `users.department_id` (nullable ở tầng DB — [database SQL dòng 859], nhưng tầng service UC-09 không cho set null qua endpoint này — xem §1.4).

---

## 6. Error Handling & Validation Rules (đã tồn tại, liệt kê lại cho FE)

| Case | HTTP | Mã lỗi |
|---|---|---|
| `departmentId` mới không tồn tại | 404 | `DEPARTMENT_NOT_FOUND` |
| `departmentId` mới inactive/đã xoá | 409 | `DEPARTMENT_INACTIVE_OR_DELETED` |
| Business Admin thao tác ngoài scope (user hoặc department) | 403 | `FORBIDDEN` |
| `departmentId = null` | 200 | Không lỗi, nhưng **không có tác dụng** (xem §1.4) |
| Body rỗng | 400 | `EMPTY_UPDATE_PAYLOAD` |
| Field ngoài whitelist | 400 | chuẩn `forbidNonWhitelisted` |
| Thiếu permission `accounts.user.update` | 403 | `FORBIDDEN` |

---

## 7. API Contract (đã tồn tại — trích dẫn cho FE)

```
PATCH /api/v1/users/:userId
Auth: Bearer JWT (JwtAuthGuard + PermissionsGuard, permission accounts.user.update)
```

Ví dụ "chuyển nhân viên sang phòng ban khác":
```json
{ "departmentId": "b3f1c2a0-....-uuid-phong-ban-moi" }
```

Response 200:
```json
{
  "success": true,
  "message": "Cập nhật thông tin tài khoản thành công",
  "data": { "...": "UserDetailResponseDto, bao gồm departmentId mới" }
}
```

---

## 8. Acceptance Criteria (xác nhận hành vi hiện có, không phải tiêu chí cho code mới)

- **AC-001**: Given System Admin gửi `departmentId` hợp lệ khác hiện tại → user được chuyển phòng ban, response 200.
- **AC-002**: Given Business Admin gửi `departmentId` nằm ngoài scope quản lý → `403 FORBIDDEN`.
- **AC-003**: Given `departmentId` trỏ tới phòng ban không tồn tại → `404 DEPARTMENT_NOT_FOUND`.
- **AC-004**: Given `departmentId` trỏ tới phòng ban `isActive=false` → `409 DEPARTMENT_INACTIVE_OR_DELETED`.
- **AC-005**: Given gửi `{ "departmentId": null }` → response 200 nhưng `departmentId` của user KHÔNG đổi (xác nhận lại gap §1.4, KHÔNG phải lỗi hệ thống).

---

## 9. Out of Scope (đã chốt — không còn điểm mở)
- **Không xây** `POST /departments/:id/members` / `DELETE /departments/:id/members/:userId` (đã chốt dùng lại API cũ).
- **Không xây** cơ chế "gỡ khỏi phòng ban" đúng nghĩa (đưa `departmentId` về `null`). **Đã chốt (2026-08-12, xem §1.5)**: chấp nhận giới hạn, KHÔNG mở rộng BE. FE **KHÔNG** có nút "Gỡ khỏi phòng ban" trên UI, chỉ có nút "Chuyển sang phòng ban khác".
- Bulk-assign nhiều user vào 1 phòng ban trong 1 lần gọi — API hiện tại chỉ đổi được 1 user/lần gọi.

---

## 10. Assumptions
- Không có thay đổi code BE trong phạm vi tài liệu này — đây thuần là API Usage Guide để FE tích hợp đúng, dựa trên hành vi thật đã xác minh qua code (không suy đoán).

---

## 11. Trạng thái kết luận

**[Sẵn sàng bàn giao FE]** — Không còn điểm mở. Hướng dẫn tích hợp cho FE trang `/business-admin/departments`, phần "gán nhân viên vào phòng ban":

- Dùng `PATCH /api/v1/users/:userId` với body `{ "departmentId": "<uuid>" }` để chuyển 1 nhân viên sang phòng ban khác.
- Chỉ hiển thị UI dạng "chọn phòng ban đích rồi chuyển" — không thiết kế nút/luồng "gỡ ra, để trống".
- Không cần code BE mới, không cần permission mới.
