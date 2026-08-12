# Implementation Plan: Deactivate / Reactivate Department

- **Feature ID**: ACCT-DEPT-DEACTIVATE-001
- **Created**: 2026-08-12
- **Status**: Draft

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo plan. | Toàn bộ file |

---

> Spec: [spec.md](./spec.md). Không tạo module/entity mới — thêm 2 method + 2 route vào `DepartmentsService`/`DepartmentsController` có sẵn (module `accounts`), sửa `UpdateDepartmentDto` (bỏ `isActive`), thêm 1 migration seed permission.

## 1. Technical Context
- **Module**: `accounts`.
- **Auth**: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('department.deactivate')` (permission mới — cần migration seed).
- **Database**: Không đổi schema (không cột/bảng mới) — chỉ dùng `departments.is_active` đã có.

## 2. Constitution Check
- **DB Gate**: PASS — không thêm/xoá bảng/cột.
- **Security Gate**: PASS — permission mới, guard đầy đủ, transaction cho toàn bộ đọc-kiểm tra-ghi.
- **Scope Gate**: PASS — KHÔNG xây `DELETE` (chốt ở spec §1); không cascade tự động.
- **Breaking Change Gate**: **CẦN LƯU Ý** — bỏ `isActive` khỏi `UpdateDepartmentDto` là thay đổi phá vỡ tương thích. Đã đánh giá rủi ro thấp (spec.md §11 mục 1) — FE chưa tích hợp thật.
- **Test Gate**: PASS — unit test đủ 2×4 nhánh BR (deactivate BR-01→05, reactivate BR-06→08) + test DTO không còn nhận `isActive`.

**Complexity Justification**: Logic dạng "action endpoint + guard clause tuần tự" quen thuộc, tương tự `updateDepartment` — không cần Complexity Tracking, không tách service mới.

## 3. File sửa
```
src/modules/accounts/dto/update-department.dto.ts                          (MODIFY — bỏ field isActive)
src/modules/accounts/services/departments.service.ts                       (MODIFY — thêm deactivateDepartment, reactivateDepartment; bỏ xử lý isActive trong updateDepartment)
src/modules/accounts/controllers/departments.controller.ts                 (MODIFY — thêm POST :id/deactivate, POST :id/reactivate)
src/database/migrations/20260812000001-SeedDepartmentDeactivatePermission.ts (CREATE)
src/modules/accounts/services/departments.service.spec.ts                  (MODIFY)
src/modules/accounts/controllers/departments.controller.spec.ts            (MODIFY)
```

## 4. DTO — `UpdateDepartmentDto`
Xoá field `isActive?: boolean` (`update-department.dto.ts:55-57` hiện tại). 4 field còn lại giữ nguyên: `departmentName?`, `parentDepartmentId?`, `managerUserId?`, `description?`.

Cập nhật điều kiện "body rỗng" trong `updateDepartment()` (`departments.service.ts:264-276`): bỏ `dto.isActive === undefined` khỏi điều kiện kiểm tra `EMPTY_UPDATE_PAYLOAD`, và bỏ toàn bộ khối xử lý `isActive` (`departments.service.ts:407-410` + field `isActive` trong `em.update(...)`/`updatedDept`/audit `before`/`newValueJson`).

## 5. Service — 2 method mới trong `DepartmentsService`

### 5.1 `deactivateDepartment(id, actorId, clientContext): Promise<DepartmentResponseDto>`
Trong `dataSource.transaction(async (em) => {...})`:
1. `id === PARTNER_DEPARTMENT_ID` → `403 PARTNER_DEPARTMENT_PROTECTED` (BR-02, tái dùng đúng error shape từ `updateDepartment` dòng 257-263).
2. Load `dept` theo `id`; không có/`deletedAt` → `404 DEPARTMENT_NOT_FOUND` (BR-01).
3. `dept.isActive === false` → `409 DEPARTMENT_ALREADY_INACTIVE` (BR-03).
4. `em.count(DepartmentEntity, { where: { parentDepartmentId: id, isActive: true, deletedAt: IsNull() } })` > 0 → `409 DEPARTMENT_HAS_ACTIVE_CHILDREN`, `details.childDepartmentIds` lấy qua `em.find(..., select: ['id'])` (BR-04).
5. `em.count(UserEntity, { where: { departmentId: id, deletedAt: IsNull(), accountStatus: AccountStatus.ACTIVE, employmentStatus: In([EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION]) } })` > 0 → `409 DEPARTMENT_HAS_ACTIVE_MEMBERS`, `details.activeMemberCount` (BR-05).
6. `em.update(DepartmentEntity, id, { isActive: false, updatedBy: actorId })`.
7. Audit log best-effort: `actionType='deactivate'`, `entityType='department'`, `oldValueJson:{isActive:true}`, `newValueJson:{isActive:false}` (mirror try/catch pattern `updateDepartment` dòng 432-459).
8. Return `toResponse({...dept, isActive:false, updatedBy:actorId, updatedAt:new Date()})`.

### 5.2 `reactivateDepartment(id, actorId, clientContext): Promise<DepartmentResponseDto>`
Trong transaction:
1. Load `dept`; không có/`deletedAt` → `404 DEPARTMENT_NOT_FOUND` (BR-06).
2. `dept.isActive === true` → `409 DEPARTMENT_ALREADY_ACTIVE` (BR-07).
3. NẾU `dept.parentDepartmentId` không null: load phòng ban cha, nếu `!parent.isActive` → `409 PARENT_DEPARTMENT_INACTIVE`, `details.parentDepartmentId` (BR-08).
4. `em.update(DepartmentEntity, id, { isActive: true, updatedBy: actorId })`.
5. Audit log best-effort: `actionType='reactivate'`.
6. Return `toResponse({...})`.

Không có bảo vệ `PARTNER_DEPARTMENT_ID` trong reactivate (spec §4.2 lưu ý).

## 6. Controller — 2 route mới

```ts
@Post(':id/deactivate')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('department.deactivate')
@ApiBearerAuth()
async deactivateDepartment(
  @Param('id', ParseUUIDPipe) id: string,
  @Req() request: Request,
  @Ip() ipAddress: string,
  @Headers('user-agent') userAgent?: string,
  @Headers('x-request-id') requestId?: string,
) { /* ...actorId từ request['user'], gọi service, trả {success,message,data} */ }

@Post(':id/reactivate')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('department.deactivate')
@ApiBearerAuth()
async reactivateDepartment(/* cùng khuôn */) { }
```
Đặt 2 route này SAU `PATCH :id`, TRƯỚC `GET :id/members` (giữ nhóm route theo `:id` gần nhau, không ảnh hưởng matching vì method HTTP khác nhau).

## 7. Migration — seed permission
`20260812000001-SeedDepartmentDeactivatePermission.ts` — permission `department.deactivate`, gán role `MANAGER`, `SYSTEM_ADMIN` (đối chiếu đúng role của `department.update` trong `20260720000005-BackfillRolePermissions.ts`). Khuôn mẫu: `20260727000001-SeedDepartmentUpdatePermission.ts` (idempotent `WHERE NOT EXISTS`, có `down()`).

## 8. Test (mock `EntityManager` — KHÔNG DB)
`departments.service.spec.ts`:
- `describe('deactivateDepartment', ...)`: not found → 404; đã xoá mềm → 404; là `PARTNER_DEPARTMENT_ID` → 403; đã inactive → 409 `DEPARTMENT_ALREADY_INACTIVE`; còn con active → 409 `DEPARTMENT_HAS_ACTIVE_CHILDREN` (kèm đúng `childDepartmentIds`); còn nhân viên active → 409 `DEPARTMENT_HAS_ACTIVE_MEMBERS` (kèm đúng count); happy path → `isActive=false` + audit log ghi đúng `actionType='deactivate'`.
- `describe('reactivateDepartment', ...)`: not found → 404; đã active → 409 `DEPARTMENT_ALREADY_ACTIVE`; cha inactive → 409 `PARENT_DEPARTMENT_INACTIVE`; không có cha → happy path; cha active → happy path; `PARTNER_DEPARTMENT_ID` inactive → happy path (KHÔNG bị chặn, khác deactivate).
- `describe('updateDepartment', ...)` (regression): gửi `isActive` trong body → `forbidNonWhitelisted` trả 400 (test ở tầng controller/DTO, không phải service).

`departments.controller.spec.ts`:
- 2 route mới: guard/permission đúng (`department.deactivate`); response shape đúng; `id` sai UUID → 400.
- Regression: `PATCH :id` với `isActive` trong body → 400.

Coverage mục tiêu ≥80% cho phần thêm mới trong `departments.service.ts`.

## 9. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Breaking change: FE cũ (nếu có) gửi `isActive` qua PATCH sẽ nhận 400 thay vì 200 | Low | Low | FE `/business-admin/departments` đang mock data, chưa tích hợp — không có consumer thật. Ghi rõ trong báo cáo bàn giao FE. |
| Race condition: 2 request deactivate/reactivate đồng thời cùng 1 `id` | Low | Low | Nằm trong transaction DB (mức isolation mặc định của TypeORM/Postgres đủ để tránh lost-update ở quy mô capstone); không cần pessimistic lock thêm. |
| Đếm nhân viên active chậm nếu phòng ban rất đông | Low | Low | `em.count()` có index sẵn trên `users.department_id` (đã dùng bởi `listDepartmentMembers`); phù hợp NFR đã chốt ở ACCT-DEPT-MEMBERS-001. |

## 10. Acceptance Criteria Traceability
| AC | Task |
|---|---|
| AC-001, AC-004 | T2, T5 |
| AC-002 | T2, T5 |
| AC-003 | T2, T5 |
| AC-005 | T2, T5 |
| AC-006, AC-008 | T3, T5 |
| AC-007 | T3, T5 |
| AC-009 | T4, T6 |
| AC-010 | T1, T6 |
| AC-011 | T2, T3, T5 |

## 11. Gate
`npx tsc --noEmit -p tsconfig.build.json` sạch; `npx jest departments` xanh; coverage ≥80%; **KHÔNG chạy migration lên RDS chung** (chờ review, đúng tiền lệ các seed permission trước — xem T-GATE trong tasks.md).
