# Implementation Plan: Xem chi tiết 1 phòng ban (GET /departments/:id)

- **Feature ID**: ACCT-DEPT-DETAIL-001
- **Created**: 2026-08-12
- **Status**: Draft

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo plan. | Toàn bộ file |

---

> Spec: [spec.md](./spec.md). Không tạo module/entity mới — thêm 1 method + 1 route vào `DepartmentsService`/`DepartmentsController` có sẵn (module `accounts`).

## 1. Technical Context
- **Module**: `accounts` (`src/modules/accounts/`) — cùng file với `createDepartment`/`updateDepartment`/`listDepartments`/`listDepartmentMembers` hiện có.
- **Auth**: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('department.read')` — **tái dùng permission đã tồn tại** (đã seed cho `MANAGER`, `SYSTEM_ADMIN`), không seed mới.
- **Database**: Không đổi schema.

## 2. Constitution Check
- **DB Gate**: PASS — không thêm/xoá bảng/cột, không migration.
- **Security Gate**: PASS — JWT + permission guard, chỉ trả field trong `DepartmentResponseDto`.
- **Scope Gate**: PASS — không đổi `POST`/`GET (list)`/`PATCH`/`:id/members` hiện có.
- **Auth Gate**: PASS — tái dùng `department.read`.
- **Test Gate**: PASS — unit test service + controller test.

**Complexity Justification**: 1 query đọc theo PK, tái dùng `toResponse()` private method đã có sẵn trong `DepartmentsService` — không cần Complexity Tracking.

## 3. Files sửa
```
src/modules/accounts/services/departments.service.ts              (thêm method getDepartmentById)
src/modules/accounts/controllers/departments.controller.ts        (thêm GET :id)
src/modules/accounts/services/departments.service.spec.ts         (thêm test)
src/modules/accounts/controllers/departments.controller.spec.ts   (thêm test)
```
Không có migration/seed nào cần tạo.

## 4. Service — `DepartmentsService.getDepartmentById(id: string): Promise<DepartmentResponseDto>`
1. `dataSource.getRepository(DepartmentEntity).findOne({ where: { id, deletedAt: IsNull() } })`.
2. Không thấy → `throw NotFoundException({ code: 'DEPARTMENT_NOT_FOUND', details: { id } })` (mirror `listDepartmentMembers`).
3. `return this.toResponse(dept)` — tái dùng private method `toResponse()` đã có (`departments.service.ts:634-646`), không viết lại logic map.

Không cần transaction (chỉ đọc). Không cần audit log.

## 5. Controller — `GET /api/v1/departments/:id`
- Đặt route NGAY SAU `GET()` (list) và TRƯỚC `GET(':id/members')` trong file controller (thứ tự khai báo không xung đột về mặt kỹ thuật vì path pattern khác nhau, nhưng đặt path ngắn trước path dài hơn cùng tiền tố cho dễ đọc).
- `@RequirePermissions('department.read')`, `@Param('id', ParseUUIDPipe)`, response `{success, message, data}` — đồng bộ style các route khác trong cùng controller.
- Swagger: `@ApiOperation`, `@ApiParam({ name: 'id', format: 'uuid' })`, `@ApiResponse(200, DepartmentResponseDto)`, `@ApiResponse(404)`.

```ts
@Get(':id')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('department.read')
@ApiBearerAuth()
async getDepartmentDetail(
  @Param('id', ParseUUIDPipe) id: string,
): Promise<{ success: boolean; message: string; data: DepartmentResponseDto }> {
  const data = await this.departmentsService.getDepartmentById(id);
  return { success: true, message: 'Lấy chi tiết phòng ban thành công', data };
}
```

## 6. Test (mock `DataSource`/repository — KHÔNG DB thật, mirror pattern test hiện có của `departments.service.spec.ts`)
- `departments.service.spec.ts` → `describe('getDepartmentById', ...)`: tìm thấy → trả đúng shape; không tìm thấy → `NotFoundException` mã `DEPARTMENT_NOT_FOUND`; đã soft-delete → coi như không tìm thấy (filter `deletedAt: IsNull()` chặn ở query); `isActive=false` vẫn trả về bình thường.
- `departments.controller.spec.ts` → route `GET :id`: 200 đúng shape `{success, message, data}`; 404 khi service throw; guard/permission đúng (`department.read`); `id` không phải UUID → 400 (test path param, chuẩn `ParseUUIDPipe`).

## 7. Gate
`npx tsc --noEmit -p tsconfig.build.json` sạch; `npx jest departments` xanh; coverage ≥80% cho phần thêm mới; không đụng hành vi `POST`/`GET (list)`/`PATCH`/`:id/members` hiện có.
