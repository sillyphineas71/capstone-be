# DEPT-UPD-001 — plan.md (BE-08: PATCH /departments/:id)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | Tạo plan cùng lượt với spec + code. | Toàn bộ |

> Spec: [spec.md](./spec.md). Không tạo module/entity mới — thêm method vào `DepartmentsService`/`DepartmentsController` có sẵn (module `accounts`).

## 1. File sửa

```
src/modules/accounts/dto/update-department.dto.ts                (mới)
src/modules/accounts/services/departments.service.ts              (thêm updateDepartment + wouldCreateCycle)
src/modules/accounts/controllers/departments.controller.ts        (thêm PATCH :id)
src/database/migrations/20260727000001-SeedDepartmentUpdatePermission.ts (mới)
```

## 2. DTO — `UpdateDepartmentDto`

Tất cả field optional: `departmentName?`, `parentDepartmentId?: string | null`, `managerUserId?: string | null`, `description?: string | null`, `isActive?: boolean`. KHÔNG có `departmentCode`. `departmentName` dùng `@Length(2,150)` + `NoEmojiOrControlConstraint`, KHÔNG dùng `IsDepartmentNameUniqueConstraint` (xem spec §2 mục 2).

## 3. Service — `DepartmentsService.updateDepartment(id, dto, updaterId, clientContext)`

1. Body rỗng (mọi field `undefined`) → `400 EMPTY_UPDATE_PAYLOAD`.
2. Trong transaction: load `dept` theo `id` → không tồn tại/đã xóa mềm → `404 DEPARTMENT_NOT_FOUND`.
3. `departmentName` (nếu gửi và khác giá trị hiện tại) → check trùng loại trừ chính `id` → `409` nếu trùng phòng ban khác.
4. `parentDepartmentId` (nếu gửi):
   - `null` → gỡ cha.
   - `=== id` → `422` (tự làm cha chính mình).
   - Không tồn tại/không active → `404 RESOURCE_NOT_FOUND`.
   - `wouldCreateCycle(em, id, newParentId)` → `true` → `422` (chu trình).
   - `calcDepth(em, newParentId) + 1 > 5` → `422`.
5. `managerUserId` (nếu gửi): `null` → gỡ quản lý; không tồn tại/không active → `404 RESOURCE_NOT_FOUND`.
6. `description`/`isActive` (nếu gửi) → gán trực tiếp (không validate nghiệp vụ thêm).
7. `em.update(DepartmentEntity, id, {...fields, updatedBy})`.
8. Dựng response từ state trong transaction (không re-query) — merge `dept` cũ với field mới.
9. Audit log best-effort (`try/catch`, lỗi chỉ log, không rollback).

`wouldCreateCycle(em, currentId, candidateParentId)`: duyệt `cursor = candidateParentId` lên tổ tiên qua `parentDepartmentId`; gặp `cursor === currentId` → `true`; hết chuỗi (`cursor` null) → `false`.

## 4. Controller — `PATCH /api/v1/departments/:id`

`@RequirePermissions('department.update')`, `ValidationPipe({whitelist:true, transform:true, forbidNonWhitelisted:true})` (đồng bộ `POST /departments`), `@Param('id', ParseUUIDPipe)`, response `{success, message, data}`.

## 5. Migration — seed permission

`20260727000001-SeedDepartmentUpdatePermission.ts` — `department.update`, role đối chiếu đúng `department.create` trong `20260720000005-BackfillRolePermissions.ts`: `MANAGER`, `SYSTEM_ADMIN`. Khuôn: `20260726000003-SeedMeetingReadAllPermission.ts` (idempotent `WHERE NOT EXISTS`, có `down()`).

## 6. Test (mock `EntityManager` — KHÔNG DB)

`departments.service.spec.ts` thêm `describe('updateDepartment', ...)`: body rỗng → 400; not found → 404; đã xóa mềm → 404; tên trùng phòng ban khác → 409; tên trùng CHÍNH NÓ (không đổi) → không lỗi; tự làm cha chính mình → 422; parent là hậu duệ (chu trình) → 422; parent không tồn tại → 404; vượt quá 5 cấp → 422; manager không tồn tại → 404; chỉ đổi 1 field → field khác giữ nguyên; clear parent/manager bằng `null`; audit log được ghi. Coverage đo được: 87.14% stmt / 86.77% branch cho `departments.service.ts` (≥80%).

## 7. Gate

`npx tsc --noEmit -p tsconfig.build.json` sạch; `npx jest departments` xanh (34/34); coverage ≥80%; không đụng `POST`/`GET /departments` hiện có.
