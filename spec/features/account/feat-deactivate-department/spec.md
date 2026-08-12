# Feature Specification: Vô hiệu hoá / Kích hoạt lại phòng ban (Deactivate / Reactivate Department)

- **Feature ID**: ACCT-DEPT-DEACTIVATE-001
- **Feature Name**: Deactivate / Reactivate Department
- **Module / Domain**: accounts
- **Created Date**: 2026-08-12
- **Status**: ✅ Sẵn sàng bàn giao FE (2026-08-12)
- **Related**: DEPT-UPD-001 (PATCH /departments/:id, BE-08), feat-delete-user-account (UC-10, tiền lệ xử lý lifecycle nhạy cảm cho entity business-critical)
- **Source Documents**:
  - Quyết định trực tiếp của Thiếu Chủ (2026-08-12): **"chỉ nên deactivate phòng ban thôi chứ không nên xoá"** — chốt hướng KHÔNG xây `DELETE /departments/:id`.
  - Quyết định trực tiếp của Thiếu Chủ (2026-08-12): xây **endpoint riêng + business rule chặn** (thay vì tiếp tục dùng `PATCH isActive` không kiểm tra gì).
  - Khảo sát code thật: `src/modules/accounts/services/departments.service.ts`, `src/modules/accounts/entities/department.entity.ts`, `database_v4_current_41_tables.sql`.
  - CLAUDE.md / AGENTS.md — DATA-01 tinh thần hạn chế xoá cho entity business-critical.

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | **Fix role gap phát hiện lúc soạn báo cáo bàn giao FE**: permission `department.deactivate` lúc seed ban đầu chỉ có `MANAGER`, `SYSTEM_ADMIN` — thiếu `BUSINESS_ADMIN`, trong khi `department.create`/`department.read`/`department.update` (3 permission chị em cùng resource) đều có `BUSINESS_ADMIN` (xác nhận bằng query trực tiếp trên RDS). Trang FE tiêu thụ là `/business-admin/departments` nên đây là gap rõ ràng, không phải quyết định nghiệp vụ cần hỏi lại. Đã tạo + chạy migration `20260812000002-GrantDepartmentDeactivateToBusinessAdmin.ts`, xác nhận lại: `department.deactivate` giờ có đủ `BUSINESS_ADMIN, MANAGER, SYSTEM_ADMIN`. | §2 |
| 2026-08-12 | Khởi tạo spec. Thay thế hoàn toàn ý tưởng ban đầu "DELETE /departments/:id" bằng deactivate/reactivate có business rule, theo quyết định trực tiếp của Thiếu Chủ. | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

| Thành phần | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| `DELETE /departments/:id` | ❌ **Missing**, và theo quyết định 2026-08-12 **sẽ KHÔNG xây** (xem §1 Quyết định 1) | — |
| Toggle `isActive` qua `PATCH /departments/:id` | ✅ Có sẵn nhưng **KHÔNG có bất kỳ validation nào** — chỉ gán thẳng giá trị | [departments.service.ts:407-410](../../../../src/modules/accounts/services/departments.service.ts#L407-L410): `if (dto.isActive !== undefined) { isActive = dto.isActive; }` |
| Cột `deletedAt` (soft-delete) | ✅ Có sẵn trên entity nhưng **không có API nào set nó** | [department.entity.ts:57](../../../../src/modules/accounts/entities/department.entity.ts#L57) (`@DeleteDateColumn`) |
| Bảo vệ `PARTNER_DEPARTMENT_ID` | ✅ Có sẵn, áp dụng cho `PATCH` | [departments.service.ts:257-263](../../../../src/modules/accounts/services/departments.service.ts#L257-L263) |
| FK `departments.parent_department_id → departments.id` | `ON DELETE SET NULL` | [department.entity.ts:61-66](../../../../src/modules/accounts/entities/department.entity.ts#L61-L66); SQL baseline dòng 853 |
| FK `users.department_id → departments.id` | `ON DELETE SET NULL` | SQL baseline dòng 859 |
| Permission `department.delete` / `department.deactivate` | ❌ Không tồn tại (đã grep migrations/seeds — 0 kết quả) | — |

**Kết luận khảo sát**: hạ tầng bật/tắt (`isActive`) đã có nhưng thiếu toàn bộ business rule bảo vệ tính nhất quán của cây tổ chức và dữ liệu nhân sự đang hoạt động.

---

## 1. Quyết định thiết kế (chốt cùng Thiếu Chủ, 2026-08-12)

1. **KHÔNG xây `DELETE /departments/:id`** dưới bất kỳ hình thức nào (cứng hay mềm). Lý do: yêu cầu trực tiếp "chỉ nên deactivate, không nên xoá". Phù hợp tinh thần DATA-01 (hạn chế xoá cho entity business-critical), tránh việc `ON DELETE SET NULL` âm thầm gỡ liên kết `parentDepartmentId`/`users.departmentId` của dữ liệu tổ chức — rủi ro nghiệp vụ cao hơn lợi ích một thao tác xoá hiếm khi cần.
2. **Bỏ field `isActive` ra khỏi `UpdateDepartmentDto`** (`PATCH /departments/:id`). Toàn bộ logic bật/tắt chuyển sang 2 endpoint action riêng có business rule chặn (mục 4). Đây là **thay đổi phá vỡ tương thích** với hành vi `PATCH {isActive}` hiện tại — nhưng **rủi ro thấp**: trang FE `/business-admin/departments` hiện vẫn dùng mock data, chưa có consumer thật nào phụ thuộc hành vi cũ.
3. **Một permission `department.deactivate` dùng chung cho cả deactivate và reactivate** (2 mặt đối xứng của cùng 1 vòng đời, cùng mức độ nhạy cảm) — không tách `department.reactivate` riêng để tránh phình bảng permission không cần thiết.
4. **Ràng buộc theo hướng "bottom-up khi tắt, top-down khi bật"**: deactivate yêu cầu không còn phòng ban con ACTIVE và không còn nhân viên ACTIVE trực thuộc; reactivate yêu cầu phòng ban cha (nếu có) đang ACTIVE. Mục tiêu: cây tổ chức không bao giờ có phòng ban active nằm dưới phòng ban inactive, và không "mồ côi" nhân viên đang active dưới 1 phòng ban đã tắt.
5. **`managerUserId` không bị đụng tới khi deactivate/reactivate** — chỉ là field mô tả, không có ràng buộc nghiệp vụ nào yêu cầu gỡ quản lý trước khi tắt phòng ban (đồng nhất với quyết định đã có trong DEPT-UPD-001 §2 mục 1: đổi manager không cần cùng phòng ban).

---

## 2. Actor & Roles

| Actor | Quyền |
|---|---|
| User có permission `department.deactivate` | Deactivate/reactivate bất kỳ phòng ban nào (trừ `PARTNER_DEPARTMENT_ID` khi deactivate — xem BR-02) |

- Guard: `JwtAuthGuard` + `PermissionsGuard`, `@RequirePermissions('department.deactivate')`.
- Seed cùng role với `department.update`: `BUSINESS_ADMIN`, `MANAGER`, `SYSTEM_ADMIN` — cùng nhóm actor quản lý phòng ban (xác nhận qua query trực tiếp trên RDS 2026-08-12, đã fix thiếu `BUSINESS_ADMIN` ở seed ban đầu — xem CHANGELOG).

---

## 3. Endpoint đề xuất

```text
POST /api/v1/departments/:id/deactivate
POST /api/v1/departments/:id/reactivate
```
- Không body.
- Response `200` — `DepartmentResponseDto` (department sau khi đổi trạng thái), cùng shape với `PATCH`/`GET :id`.

---

## 4. Cơ chế & Business Rules

### 4.1 Deactivate (`POST /departments/:id/deactivate`)

| # | Rule | Vi phạm → |
| :--- | :--- | :--- |
| BR-01 | Department không tồn tại hoặc đã soft-delete | `404 DEPARTMENT_NOT_FOUND` |
| BR-02 | `id === PARTNER_DEPARTMENT_ID` | `403 PARTNER_DEPARTMENT_PROTECTED` (mirror `updateDepartment`) |
| BR-03 | Department đã `isActive=false` (idempotency) | `409 DEPARTMENT_ALREADY_INACTIVE` |
| BR-04 | Tồn tại ≥1 phòng ban con (`parentDepartmentId = :id`) có `isActive=true AND deletedAt IS NULL` | `409 DEPARTMENT_HAS_ACTIVE_CHILDREN`, `details: { childDepartmentIds: string[] }` |
| BR-05 | Tồn tại ≥1 nhân viên active thuộc phòng ban (`users.departmentId = :id AND deletedAt IS NULL AND accountStatus='active' AND employmentStatus IN ('active','probation')`) | `409 DEPARTMENT_HAS_ACTIVE_MEMBERS`, `details: { activeMemberCount: number }` |

Thành công: `isActive=false`, `updatedBy=actorId`, audit log `actionType='deactivate'`.

### 4.2 Reactivate (`POST /departments/:id/reactivate`)

| # | Rule | Vi phạm → |
| :--- | :--- | :--- |
| BR-06 | Department không tồn tại hoặc đã soft-delete | `404 DEPARTMENT_NOT_FOUND` |
| BR-07 | Department đã `isActive=true` (idempotency) | `409 DEPARTMENT_ALREADY_ACTIVE` |
| BR-08 | `parentDepartmentId != null` và phòng ban cha đó có `isActive=false` | `409 PARENT_DEPARTMENT_INACTIVE`, `details: { parentDepartmentId }` |

Thành công: `isActive=true`, `updatedBy=actorId`, audit log `actionType='reactivate'`.

> **Lưu ý BR-02 chỉ áp dụng cho deactivate, KHÔNG áp dụng cho reactivate** — nếu vì lý do nào đó `PARTNER_DEPARTMENT_ID` đang ở trạng thái inactive, vẫn cho phép reactivate để tự sửa (không có lý do nghiệp vụ nào cần chặn việc BẬT LẠI department đối tác).

---

## 5. Functional Requirements (EARS)

- **FR-001**: THE system SHALL cung cấp `POST /api/v1/departments/:id/deactivate` và `POST /api/v1/departments/:id/reactivate`.
- **FR-002**: WHEN deactivate và còn phòng ban con active hoặc nhân viên active trực thuộc, THE system SHALL từ chối với `409` tương ứng BR-04/BR-05 (KHÔNG tự động cascade tắt con hoặc gỡ nhân viên).
- **FR-003**: WHEN reactivate và phòng ban cha đang inactive, THE system SHALL từ chối với `409 PARENT_DEPARTMENT_INACTIVE` (BR-08).
- **FR-004**: WHEN gọi deactivate/reactivate trên phòng ban đã ở đúng trạng thái đó, THE system SHALL trả `409` (không coi là no-op thành công) — giúp FE/actor nhận biết rõ thao tác không có tác dụng thay vì hiểu nhầm đã xử lý.
- **FR-005**: THE system SHALL từ chối deactivate `PARTNER_DEPARTMENT_ID` với `403 PARTNER_DEPARTMENT_PROTECTED` (BR-02), nhưng KHÔNG áp dụng chặn này cho reactivate.
- **FR-006**: THE system SHALL KHÔNG còn chấp nhận field `isActive` trong body `PATCH /departments/:id` (`forbidNonWhitelisted` sẽ trả `400` nếu FE vẫn gửi field này).
- **FR-007**: THE system SHALL ghi `audit_logs` cho mỗi lần deactivate/reactivate thành công (`entityType='department'`, `actionType` tương ứng).
- **FR-008**: THE system SHALL yêu cầu permission `department.deactivate` cho cả 2 endpoint.

---

## 6. Constitution
- **ARCH-01**: Logic nằm trong `DepartmentsService` (thêm method `deactivateDepartment`/`reactivateDepartment`), cùng service với các method hiện có — không tách service riêng.
- **DATA-01**: Deactivate/reactivate thay thế hoàn toàn nhu cầu xoá — không có hard-delete, không set `deletedAt` (soft-delete cột này vẫn để dành cho một quyết định khác trong tương lai nếu có, KHÔNG dùng trong feature này).
- **SEC-01**: `@RequirePermissions('department.deactivate')`, transaction cho mọi bước đọc-kiểm tra-ghi.
- **AUDIT-01**: Ghi `audit_logs` mọi lần đổi trạng thái thành công (best-effort — lỗi audit không rollback transaction, mirror pattern hiện có trong `createDepartment`/`updateDepartment`).

---

## 7. Error Handling & Validation Rules

| Case | HTTP | Mã lỗi |
| :--- | :--- | :--- |
| `id` không phải UUID hợp lệ | 400 | chuẩn `ParseUUIDPipe` |
| Department không tồn tại / đã xoá mềm | 404 | `DEPARTMENT_NOT_FOUND` |
| Deactivate `PARTNER_DEPARTMENT_ID` | 403 | `PARTNER_DEPARTMENT_PROTECTED` |
| Deactivate khi đã inactive | 409 | `DEPARTMENT_ALREADY_INACTIVE` |
| Deactivate khi còn phòng ban con active | 409 | `DEPARTMENT_HAS_ACTIVE_CHILDREN` |
| Deactivate khi còn nhân viên active | 409 | `DEPARTMENT_HAS_ACTIVE_MEMBERS` |
| Reactivate khi đã active | 409 | `DEPARTMENT_ALREADY_ACTIVE` |
| Reactivate khi phòng ban cha inactive | 409 | `PARENT_DEPARTMENT_INACTIVE` |
| Thiếu permission `department.deactivate` | 403 | `FORBIDDEN` |
| Gửi `isActive` trong `PATCH /departments/:id` | 400 | chuẩn `forbidNonWhitelisted` |

---

## 8. API Contract (Proposed)

### 8.1 Deactivate — thành công
```
POST /api/v1/departments/:id/deactivate
```
```json
{
  "success": true,
  "message": "Vô hiệu hoá phòng ban thành công",
  "data": { "id": "uuid", "...": "...", "isActive": false }
}
```

### 8.2 Deactivate — 409 còn ràng buộc
```json
{
  "success": false,
  "message": "Không thể vô hiệu hoá: phòng ban còn nhân viên đang hoạt động.",
  "error": {
    "code": "DEPARTMENT_HAS_ACTIVE_MEMBERS",
    "details": { "activeMemberCount": 5 }
  }
}
```

### 8.3 Reactivate — 409 cha inactive
```json
{
  "success": false,
  "message": "Không thể kích hoạt lại: phòng ban cha đang không hoạt động.",
  "error": {
    "code": "PARENT_DEPARTMENT_INACTIVE",
    "details": { "parentDepartmentId": "uuid" }
  }
}
```

---

## 9. Acceptance Criteria

- **AC-001**: Given phòng ban active, không con active, không nhân viên active → deactivate thành công, `isActive=false`.
- **AC-002**: Given phòng ban còn ≥1 con active → deactivate trả `409 DEPARTMENT_HAS_ACTIVE_CHILDREN`.
- **AC-003**: Given phòng ban còn ≥1 nhân viên active → deactivate trả `409 DEPARTMENT_HAS_ACTIVE_MEMBERS`.
- **AC-004**: Given phòng ban đã inactive → deactivate lại trả `409 DEPARTMENT_ALREADY_INACTIVE`.
- **AC-005**: Given `id = PARTNER_DEPARTMENT_ID` → deactivate trả `403 PARTNER_DEPARTMENT_PROTECTED`.
- **AC-006**: Given phòng ban inactive, cha (nếu có) đang active hoặc không có cha → reactivate thành công, `isActive=true`.
- **AC-007**: Given phòng ban inactive nhưng cha đang inactive → reactivate trả `409 PARENT_DEPARTMENT_INACTIVE`.
- **AC-008**: Given phòng ban đã active → reactivate lại trả `409 DEPARTMENT_ALREADY_ACTIVE`.
- **AC-009**: Given actor không có permission `department.deactivate` → cả 2 endpoint trả `403`.
- **AC-010**: Given gửi `PATCH /departments/:id` với body chứa `isActive` → trả `400` (field bị chặn).
- **AC-011**: Mỗi lần deactivate/reactivate thành công đều có 1 bản ghi `audit_logs` tương ứng.

---

## 10. Out of Scope
- `DELETE /departments/:id` dưới mọi hình thức (đã chốt không làm — §1 Quyết định 1).
- Deactivate/reactivate hàng loạt (bulk).
- Tự động cascade deactivate xuống toàn bộ cây con — cố tình CHẶN thay vì tự động, buộc actor xử lý từng cấp theo đúng thứ tự (an toàn hơn, tránh tắt nhầm cả nhánh tổ chức).
- Thông báo/notification khi deactivate/reactivate — có thể bổ sung sau nếu team yêu cầu.
- Đổi `managerUserId`/gán lại nhân viên tự động khi deactivate — actor phải tự dùng `PATCH /users/:id` để chuyển nhân viên trước (xem feature liên quan ACCT-DEPT-MEMBERSHIP-001).

---

## 11. Assumptions / Điểm cần chốt
1. **[Migration]** Field `isActive` bị gỡ khỏi `UpdateDepartmentDto` là thay đổi phá vỡ tương thích API — chấp nhận được vì FE `/business-admin/departments` vẫn đang mock data (chưa tích hợp thật), nhưng vẫn cần thông báo FE cập nhật Swagger/tài liệu khi bàn giao.
2. **[Permission]** Dùng chung `department.deactivate` cho cả 2 endpoint — nếu sau này team muốn phân quyền tinh hơn (vd chỉ SYSTEM_ADMIN mới được deactivate, MANAGER chỉ được reactivate), cần tách permission — hiện chưa có yêu cầu này.
3. **[Đếm nhân viên active]** BR-05 chỉ đếm nhân viên **trực tiếp** thuộc phòng ban (`users.departmentId = :id`), không đệ quy phòng ban con — vì BR-04 đã chặn deactivate khi còn con active, nên tại thời điểm deactivate hợp lệ, phòng ban chắc chắn không còn con active nào để phải đệ quy.
