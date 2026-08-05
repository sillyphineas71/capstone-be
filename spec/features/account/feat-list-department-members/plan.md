# Implementation Plan: Xem danh sách nhân viên theo phòng ban

- **Feature ID**: ACCT-DEPT-MEMBERS-001
- **Created**: 2026-08-05
- **Status**: Draft

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-05 | Khởi tạo plan — 1 endpoint đọc duy nhất, không đổi schema/permission/CreateMeetingDto | Toàn bộ file |

---

## 1. Feature Summary
Thêm 1 endpoint đọc `GET /departments/:departmentId/members` trong module `accounts`, trả về danh sách nhân viên trực thuộc trực tiếp 1 phòng ban (lọc active/probation + account active), kèm `positionTitle` và cờ `isDepartmentManager`. FE dùng kết quả này để nạp nhanh cả phòng ban vào `participantUserIds` khi đặt lịch — không cần BE thay đổi luồng tạo cuộc họp.

---

## 2. Technical Context
- **Module**: `accounts` (`src/modules/accounts/`) — cùng module với `DepartmentsController`/`DepartmentsService` đã có.
- **Framework**: NestJS, TypeORM (`DataSource.getRepository`, theo đúng pattern hiện có trong `departments.service.ts`).
- **Auth**: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.list')` — **tái dùng permission đã tồn tại**, không seed mới.
- **Database**: PostgreSQL v3.2 Compact — KHÔNG đổi schema.
- **Không đụng**: `meetings` module, `CreateMeetingDto`, `MeetingsService.checkParticipantConflicts` — feature này độc lập hoàn toàn, chỉ đọc `departments` + `users`.

---

## 3. Constitution Check
- **DB Gate**: PASS — không thêm/xóa bảng/cột, không migration.
- **Security Gate**: PASS — JWT + permission guard, chỉ trả field liệt kê tường minh (không trả `passwordHash`).
- **Scope Gate**: PASS — không đổi `POST /meetings`, không thêm permission, không đệ quy phòng ban con, không phân trang (bounded UX).
- **Module Gate**: PASS — toàn bộ nằm trong `accounts` (đúng vị trí `DepartmentsController` hiện có); không cần import/export chéo module `meetings`.
- **API Gate**: PASS — response chuẩn `{ success, message, data }`, HTTP codes đúng bảng lỗi.
- **Auth Gate**: PASS — tái dùng `accounts.user.list`.
- **Test Gate**: PASS — unit test service (filter/sort/manager flag) + controller test (guard, 404, response shape).

**Complexity Justification**: Không có phần nào vượt mức đơn giản — đây là 1 query đọc duy nhất trên 2 bảng đã có sẵn, không cần refactor, không cần Complexity Tracking.

---

## 4. Scope Confirmation

### In scope
- Endpoint `GET /departments/:departmentId/members`
- DTO response `DepartmentMemberItemDto`
- Service method `DepartmentsService.listDepartmentMembers(departmentId)`
- Test: service unit test + controller test

### Out of scope (xem spec.md mục 9)
- `includeSubDepartments` (đệ quy phòng ban con)
- Tính `scheduleConflict` (dùng `POST /scheduling/participant-conflicts/check` sẵn có)
- Bất kỳ thay đổi nào trong `meetings` module
- Permission mới / migration mới
- Phân trang

---

## 5. Data Model Impact
**Không đổi schema.** Chỉ đọc `departments` (xác định tồn tại + `manager_user_id`) và `users` (danh sách + field trả về). Chi tiết field mapping ở mục 8.

---

## 6. API / Contract Plan

| Endpoint | Method | Permission |
|---|---|---|
| `/departments/:departmentId/members` | GET | `accounts.user.list` (đã tồn tại) |

Không có DTO cho query params — path param `departmentId` validate qua `ParseUUIDPipe` (giống `updateDepartment` hiện có trong `departments.controller.ts`).

### Response DTO: `DepartmentMemberItemDto`
```ts
export class DepartmentMemberItemDto {
  id: string;
  employeeCode: string | null;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  positionTitle: string | null;
  employmentStatus: string;
  isDepartmentManager: boolean;
}
```

---

## 7. Authorization Plan
1. `JwtAuthGuard` → `request['user']`.
2. `PermissionsGuard` → check `accounts.user.list` (permission đã seed sẵn cho các role hiện tạo được cuộc họp — không cần seed mới, không cần migration).
3. Không có ràng buộc phạm vi phòng ban theo actor — hành vi giống hệt `GET /users` hiện tại (tìm người tham dự không giới hạn theo phòng ban của người tìm).

---

## 8. Business Logic Plan

### Service mới (method) trong `DepartmentsService` (đã có sẵn service, chỉ thêm method)

```
async listDepartmentMembers(departmentId: string): Promise<DepartmentMemberItemDto[]>
```

**Bước 1 — Xác nhận phòng ban tồn tại**
1. `dataSource.getRepository(DepartmentEntity).findOne({ where: { id: departmentId, deletedAt: IsNull() } })`.
2. Không thấy → `throw NotFoundException({ code: 'DEPARTMENT_NOT_FOUND' })`.

**Bước 2 — Query nhân viên**
3. `dataSource.getRepository(UserEntity).find({ where: { departmentId, deletedAt: IsNull(), accountStatus: AccountStatus.ACTIVE, employmentStatus: In([EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION]) }, select: { id, employeeCode, fullName, email, phoneNumber, avatarUrl, positionTitle, employmentStatus }, order: { fullName: 'asc' } })`.
   - Dùng `select` tường minh — không trả `passwordHash`/field khác (NFR-002).

**Bước 3 — Gắn cờ trưởng phòng + sắp xếp cuối**
4. So khớp `user.id === department.managerUserId` → `isDepartmentManager`.
5. Sort lại in-memory: `isDepartmentManager` desc trước, `fullName` asc sau (TypeORM `order` chỉ sort theo cột DB, không biết `managerUserId` của bảng khác — sort 2 cấp làm ở tầng service sau khi map).

**Bước 4 — Map & return**
6. Map sang `DepartmentMemberItemDto[]`, return.

Không cần transaction (chỉ đọc). Không cần audit log (đọc, không có side effect).

---

## 9. Validation Plan
| Check | Cơ chế | Lỗi |
|---|---|---|
| `departmentId` là UUID hợp lệ | `ParseUUIDPipe` ở controller | `400` (chuẩn Nest, không cần custom code) |
| Phòng ban tồn tại | Query bước 1 trong service | `404 DEPARTMENT_NOT_FOUND` |

---

## 10. Error Handling Plan
- 404 khi phòng ban không tồn tại/đã xoá mềm — throw `NotFoundException` chuẩn response format của dự án.
- Không có lỗi cấp dòng (không phải batch operation).
- Guard xử lý 401/403 tự động (không cần code thêm).

---

## 11. Testing Strategy

### 11.1 Unit — `departments.service.spec.ts` (bổ sung test case)
- Trả đúng danh sách khi phòng ban có N nhân viên active/probation.
- Loại nhân viên `resigned`/`transferred` không hợp lệ theo NFR? — chỉ loại theo FR-002 (`employment_status` không thuộc active/probation).
- Loại nhân viên `account_status` khác `active`.
- Loại nhân viên thuộc phòng ban con (khác `department_id` chính xác).
- `isDepartmentManager=true` đúng người khớp `manager_user_id`, và người đó đứng đầu danh sách sau sort.
- Phòng ban 0 nhân viên hợp lệ → trả mảng rỗng, không throw.
- Phòng ban không tồn tại → throw `NotFoundException` mã `DEPARTMENT_NOT_FOUND`.
- Response object không có field `passwordHash`.

### 11.2 Controller — `departments.controller.spec.ts` (bổ sung test case)
- 200 với đúng shape `{ success, message, data }`.
- 404 khi service throw not-found.
- Guard/permission tích hợp đúng (`accounts.user.list`).
- `departmentId` không phải UUID → 400 (test path param invalid, chuẩn `ParseUUIDPipe`).

---

## 12. Implementation Phases

### Phase A: DTO (T001)
- **T001** [P] `src/modules/accounts/dto/department-member-item.dto.ts` — response DTO.

### Phase B: Service (T002)
- **T002** `src/modules/accounts/services/departments.service.ts` — thêm method `listDepartmentMembers()`.

### Phase C: Controller (T003)
- **T003** `src/modules/accounts/controllers/departments.controller.ts` — thêm route `GET :id/members`.
  - **Route order**: đặt SAU route `PATCH :id` không xung đột (khác HTTP method + có suffix `/members`), không cần lo thứ tự như case `manage` vs `:userId` ở `users.controller.ts`.

### Phase D: Testing (T004–T005)
- **T004** [P] Unit test service (mục 11.1).
- **T005** [P] Controller test (mục 11.2).

### Phase E: Verification (T006–T007)
- **T006** [P] `npm run build`.
- **T007** [P] `npm run lint`.

---

## 13. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Phòng ban có bất thường nhiều nhân viên (>500), phản hồi chậm do không phân trang | Low | Low | NFR-001 đặt ngưỡng; ngoài phạm vi capstone thực tế. Nếu phát sinh, bổ sung phân trang optional sau (không breaking, thêm query param mới). |
| FE quên dedupe khi merge với danh sách đã chọn thủ công → trùng `participantUserIds` | Medium | Low | Đã nêu rõ trong spec.md mục 1.4/2.4.3 bước 5 là trách nhiệm FE; `POST /meetings` vốn đã tự dedupe (`new Set(...)` tại `meetings.service.ts:574`) nên kể cả FE gửi trùng cũng không lỗi. |
| Nhầm lẫn giữa endpoint này và `POST /scheduling/participant-conflicts/check` (ai gọi trước/sau) | Low | Low | Nêu rõ thứ tự 2 bước trong spec.md mục 2.4.3 + báo cáo gửi FE (xem `Docs/Fix_Bug_Sent_FE/`). |

---

## 14. Acceptance Criteria Traceability
| AC | Task |
|---|---|
| AC-001, AC-002, AC-003 (lọc đúng tập) | T002, T004 |
| AC-004 (cờ trưởng phòng + sort) | T002, T004 |
| AC-005 (404) | T002, T003, T004, T005 |
| AC-006 (mảng rỗng) | T002, T004 |
| AC-007 (permission) | T003, T005 |
| AC-008 (không lộ field nhạy cảm) | T001, T002, T004 |

---

## 15. Files to Create / Modify
| File | Action | Mục đích |
|---|---|---|
| `src/modules/accounts/dto/department-member-item.dto.ts` | CREATE | Response DTO |
| `src/modules/accounts/services/departments.service.ts` | MODIFY | Thêm `listDepartmentMembers()` |
| `src/modules/accounts/controllers/departments.controller.ts` | MODIFY | Thêm route `GET :id/members` |
| `src/modules/accounts/services/departments.service.spec.ts` | MODIFY | Unit test |
| `src/modules/accounts/controllers/departments.controller.spec.ts` | MODIFY | Controller test |

Không có file migration/seed nào cần tạo.

---

## 16. Dependencies & Integration Points
| Dependency | Integration | Ghi chú |
|---|---|---|
| `DepartmentEntity`, `UserEntity` | Query trực tiếp qua `DataSource` | Đã có sẵn, cùng module |
| `AuthModule` | `JwtAuthGuard`, `PermissionsGuard`, `accounts.user.list` | Đã có sẵn, không seed mới |
| `scheduling` module (`POST /scheduling/participant-conflicts/check`) | **Không gọi từ BE** — FE gọi riêng sau khi có danh sách từ endpoint này | Chỉ tham chiếu, không phải dependency code |
