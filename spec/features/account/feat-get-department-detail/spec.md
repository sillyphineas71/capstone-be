# Feature Specification: Xem chi tiết 1 phòng ban (GET /departments/:id)

- **Feature ID**: ACCT-DEPT-DETAIL-001
- **Feature Name**: Get Department Detail
- **Module / Domain**: accounts
- **Created Date**: 2026-08-12
- **Status**: Draft
- **Related**: DEPT-UPD-001 (PATCH /departments/:id, BE-08), ACCT-DEPT-MEMBERS-001 (GET /departments/:id/members)
- **Source Documents**:
  - Yêu cầu trực tiếp của Thiếu Chủ (2026-08-12): rà soát API cho trang FE `/business-admin/departments` (đang mock data).
  - Khảo sát code thật `src/modules/accounts/controllers/departments.controller.ts`, `src/modules/accounts/services/departments.service.ts`.
  - CLAUDE.md / AGENTS.md (Backend Agent Guide v1.1).

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo spec. Phát hiện gap: FE hiện phải gọi `GET /departments` (list) rồi lọc client-side để lấy chi tiết 1 phòng ban — không có endpoint detail-by-id. | Toàn bộ file |

---

## 1. Context & Goal

### 1.1 Bối cảnh
`DepartmentsController` (`src/modules/accounts/controllers/departments.controller.ts`) hiện có `POST /departments` (tạo), `GET /departments` (list phân trang), `GET /departments/:id/members` (danh sách nhân viên), `PATCH /departments/:id` (sửa) — nhưng **không có `GET /departments/:id`**. Muốn xem/nạp form sửa 1 phòng ban, FE buộc phải gọi `GET /departments` (có thể nhiều trang) rồi tự lọc theo `id` ở client, tốn băng thông và có thể sai nếu bản ghi cần xem không nằm trong trang hiện tại đang tải.

### 1.2 Mục tiêu
Cung cấp endpoint đọc 1 bản ghi phòng ban theo `id`, dùng để nạp trang chi tiết/form sửa trên `/business-admin/departments`.

### 1.3 Giá trị mang lại
- FE nạp đúng 1 bản ghi cần thiết, không phụ thuộc trang/limit của danh sách.
- Chuẩn hoá thao tác "xem chi tiết" độc lập khỏi "danh sách" — đúng REST convention (CLAUDE.md §7.3).

### 1.4 Giả định
- FE đã biết `id` (UUID) của phòng ban cần xem (từ danh sách, hoặc từ URL route `/business-admin/departments/:id`).

---

## 2. Actor & Roles

| Actor | Quyền |
|---|---|
| User đã đăng nhập có permission `department.read` | Xem chi tiết bất kỳ phòng ban nào (không giới hạn scope — đồng nhất hành vi với `GET /departments` hiện tại, vốn cũng không lọc theo scope của actor) |

- Guard: `JwtAuthGuard` + `PermissionsGuard`, `@RequirePermissions('department.read')` — **tái dùng permission đã tồn tại** (đã seed cho `MANAGER`, `SYSTEM_ADMIN` — xem migration seed `department.read`), không cần permission/migration mới.

---

## 2.4 User Scenarios & Workflow

### 2.4.1 Preconditions
- PRE-1: Actor đã đăng nhập, có permission `department.read`.
- PRE-2: `id` là UUID hợp lệ.

### 2.4.2 Postconditions
- POST-1: Endpoint chỉ **đọc** — không ghi/thay đổi bất kỳ bảng nào.

### 2.4.3 Normal Flow
1. FE điều hướng tới trang chi tiết/sửa phòng ban với `id` đã biết.
2. FE gọi `GET /api/v1/departments/:id`.
3. Hệ thống trả về đúng 1 bản ghi `DepartmentResponseDto` (kể cả khi `isActive=false` — không lọc theo trạng thái hoạt động, đồng nhất với `GET /departments`).
4. FE hiển thị/nạp vào form sửa.

### 2.4.4 Exceptions
- **EX1**: `id` không tồn tại hoặc đã soft-delete (`deletedAt IS NOT NULL`) → `404 DEPARTMENT_NOT_FOUND`.
- **EX2**: `id` không đúng định dạng UUID → `400` (chuẩn `ParseUUIDPipe`, mirror `PATCH /departments/:id`).

---

## 3. Functional Requirements

- **FR-001**: THE system SHALL cung cấp endpoint `GET /api/v1/departments/:id` trả về đúng 1 phòng ban theo `id`.
- **FR-002**: THE system SHALL trả về phòng ban kể cả khi `isActive=false` (không lọc theo trạng thái hoạt động).
- **FR-003**: IF `id` không tồn tại hoặc `deletedAt IS NOT NULL`, THE system SHALL trả `404 DEPARTMENT_NOT_FOUND`.
- **FR-004**: IF `id` không phải UUID hợp lệ, THE system SHALL trả `400` (chuẩn `ParseUUIDPipe`).
- **FR-005**: THE system SHALL dùng lại `DepartmentResponseDto` — cùng shape với từng phần tử trong `GET /departments` (không tạo DTO mới, đảm bảo FE tái dùng nguyên xi kiểu dữ liệu).
- **FR-006**: THE system SHALL yêu cầu permission `department.read` (tái dùng, không seed mới).

---

## 4. Non-functional Requirements
- **NFR-001**: THE system SHALL phản hồi dưới 200ms trong điều kiện bình thường (1 query theo primary key, có index).
- **NFR-002**: THE system SHALL KHÔNG trả field nào ngoài `DepartmentResponseDto` (không lộ thêm dữ liệu quan hệ chưa yêu cầu).

---

## 5. Data Model

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `departments` | Nguồn dữ liệu duy nhất | READ theo PK `id` |

**Không đổi schema.** Không thêm bảng/cột/permission/migration.

---

## 6. Error Handling & Validation Rules

| Case | HTTP | Mã lỗi |
|---|---|---|
| `id` không phải UUID hợp lệ | 400 | chuẩn `ParseUUIDPipe` |
| Phòng ban không tồn tại / đã xoá mềm | 404 | `DEPARTMENT_NOT_FOUND` |
| Thiếu permission `department.read` | 403 | `FORBIDDEN` (chuẩn `PermissionsGuard`) |

---

## 7. API Contract (Proposed)

### 7.1 Endpoint
```
GET /api/v1/departments/:id
Auth: Bearer JWT (JwtAuthGuard + PermissionsGuard, permission department.read)
```

### 7.2 Response 200
```json
{
  "success": true,
  "message": "Lấy chi tiết phòng ban thành công",
  "data": {
    "id": "uuid",
    "departmentCode": "IT",
    "departmentName": "Phòng Công nghệ thông tin",
    "parentDepartmentId": null,
    "managerUserId": "uuid",
    "description": "Mô tả phòng ban",
    "isActive": true,
    "createdAt": "2026-08-12T00:00:00.000Z",
    "updatedAt": "2026-08-12T00:00:00.000Z"
  }
}
```

### 7.3 Response 404
```json
{
  "success": false,
  "message": "Phòng ban không tồn tại hoặc đã bị xóa.",
  "error": { "code": "DEPARTMENT_NOT_FOUND", "details": { "id": "uuid" } }
}
```

---

## 8. Acceptance Criteria

- **AC-001**: Given phòng ban `isActive=true` tồn tại, khi gọi đúng `id`, trả về đúng bản ghi.
- **AC-002**: Given phòng ban `isActive=false`, vẫn trả về bình thường (không bị lọc/ẩn).
- **AC-003**: Given `id` không tồn tại, trả `404 DEPARTMENT_NOT_FOUND`.
- **AC-004**: Given `id` đã soft-delete, trả `404 DEPARTMENT_NOT_FOUND`.
- **AC-005**: Given `id` sai định dạng UUID, trả `400`.
- **AC-006**: Given actor không có permission `department.read`, trả `403`.
- **AC-007**: Response body không chứa field nào ngoài 9 field của `DepartmentResponseDto`.

---

## 9. Out of Scope
- Trả kèm object `parentDepartment` lồng nhau hoặc danh sách `children` — FE tự gọi thêm `GET /departments?parentId=...` nếu cần.
- Trả kèm số lượng thành viên (`memberCount`) — FE tự gọi `GET /departments/:id/members` nếu cần đếm.
- Bất kỳ thay đổi nào ở `POST`/`GET (list)`/`PATCH`/`:id/members` hiện có.

---

## 10. Assumptions
- Không cần scope-restriction theo phòng ban của actor (đồng nhất hành vi đọc hiện tại của `GET /departments`, vốn không giới hạn theo scope).
