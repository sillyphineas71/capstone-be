# Tasks: Xem danh sách nhân viên theo phòng ban

- **Feature ID**: ACCT-DEPT-MEMBERS-001
- **Created**: 2026-08-05
- **Based on**: spec.md, plan.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-05 | Khởi tạo tasks | Toàn bộ file |

---

## Phase 1: DTO

- [x] **T001** [P] `src/modules/accounts/dto/department-member-item.dto.ts`
  - Class `DepartmentMemberItemDto` với field: `id`, `employeeCode`, `fullName`, `email`, `phoneNumber`, `avatarUrl`, `positionTitle`, `employmentStatus`, `isDepartmentManager`
  - Dùng `@ApiProperty` (Swagger) theo đúng style `manage-user-item.dto.ts`
  - Outcome: DTO sẵn sàng dùng làm kiểu trả về của service + controller

---

## Phase 2: Service

- [x] **T002** `src/modules/accounts/services/departments.service.ts`
  - Thêm method `async listDepartmentMembers(departmentId: string): Promise<DepartmentMemberItemDto[]>`
  - Bước 1: `getRepository(DepartmentEntity).findOne({ where: { id: departmentId, deletedAt: IsNull() } })` → không thấy → `throw new NotFoundException({ success: false, message: 'Không tìm thấy phòng ban', error: { code: 'DEPARTMENT_NOT_FOUND', details: { departmentId } } })`
  - Bước 2: `getRepository(UserEntity).find({ where: { departmentId, deletedAt: IsNull(), accountStatus: AccountStatus.ACTIVE, employmentStatus: In([EmploymentStatus.ACTIVE, EmploymentStatus.PROBATION]) }, select: { id: true, employeeCode: true, fullName: true, email: true, phoneNumber: true, avatarUrl: true, positionTitle: true, employmentStatus: true }, order: { fullName: 'ASC' } })`
  - Bước 3: map → `DepartmentMemberItemDto[]`, gắn `isDepartmentManager = (user.id === department.managerUserId)`
  - Bước 4: sort in-memory `isDepartmentManager` desc trước, `fullName` asc sau (`Array.prototype.sort`, KHÔNG dựa vào order của query DB vì `managerUserId` không nằm trong `users`)
  - Import `EmploymentStatus`, `AccountStatus`, `In`, `IsNull` (đã có sẵn import `IsNull` trong file; thêm `In` nếu chưa có)
  - Outcome: method trả đúng danh sách đã lọc + sort + gắn cờ trưởng phòng

---

## Phase 3: Controller

- [x] **T003** `src/modules/accounts/controllers/departments.controller.ts`
  - Thêm route:
    ```ts
    @Get(':id/members')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermissions('accounts.user.list')
    @ApiBearerAuth()
    async listDepartmentMembers(
      @Param('id', ParseUUIDPipe) id: string,
    ): Promise<{ success: boolean; message: string; data: DepartmentMemberItemDto[] }> {
      const data = await this.departmentsService.listDepartmentMembers(id);
      return { success: true, message: 'Lấy danh sách nhân viên phòng ban thành công', data };
    }
    ```
  - Thêm Swagger decorator (`@ApiOperation`, `@ApiParam`, `@ApiResponse`, `@ApiUnauthorizedResponse`, `@ApiForbiddenResponse`) theo đúng style các route khác trong file này
  - Import `DepartmentMemberItemDto`
  - Outcome: endpoint `GET /api/v1/departments/:id/members` hoạt động end-to-end

---

## Phase 4: Testing

- [x] **T004** [P] Unit test bổ sung trong `src/modules/accounts/services/departments.service.spec.ts`
  - Trả đúng N nhân viên active/probation của đúng phòng ban
  - Loại nhân viên `employment_status` không thuộc {active, probation}
  - Loại nhân viên `account_status` khác active
  - Loại nhân viên thuộc phòng ban con (không đệ quy)
  - `isDepartmentManager=true` đúng người khớp `manager_user_id`, đứng đầu danh sách
  - Phòng ban 0 nhân viên hợp lệ → mảng rỗng, không throw
  - Phòng ban không tồn tại / đã xoá mềm → throw `NotFoundException` mã `DEPARTMENT_NOT_FOUND`
  - Object trả về không có field `passwordHash`
  - Outcome: coverage đầy đủ AC-001..004, AC-006, AC-008

- [x] **T005** [P] Controller test bổ sung trong `src/modules/accounts/controllers/departments.controller.spec.ts`
  - 200 với đúng shape `{ success, message, data }`
  - 404 khi service throw `DEPARTMENT_NOT_FOUND`
  - Guard/permission tích hợp (`accounts.user.list`)
  - Outcome: coverage AC-005, AC-007

---

## Phase 5: Verification

- [x] **T006** [P] `npm run build`
- [x] **T007** [P] `npm run lint`

---

## Requirements Coverage

| FR | Task |
|---|---|
| FR-001, FR-002 (filter) | T002 |
| FR-003 (404) | T002 |
| FR-004 (không lọc theo is_active) | T002 |
| FR-005, FR-006 (manager flag + sort) | T002 |
| FR-007 (không phân trang) | T002, T003 |
| FR-008 (không tính conflict) | Thiết kế — không có task, đây là việc KHÔNG làm |

| AC | Task |
|---|---|
| AC-001..004 | T002, T004 |
| AC-005 | T002, T003, T004, T005 |
| AC-006 | T002, T004 |
| AC-007 | T003, T005 |
| AC-008 | T001, T002, T004 |

---

## Dependency Graph
```
T001 (dto) ─→ T002 (service) ─→ T003 (controller) ─→ T004 + T005 (test) ─→ T006 → T007
```

## Parallel Execution Opportunities
| Task | Song song với | Lý do |
|---|---|---|
| T004 | T005 | Khác file test |
| T006 | T007 | Build/lint độc lập |

## Implementation Strategy (MVP — feature nhỏ, làm tuần tự trong 1 wave)
T001 → T002 → T003 → (T004 + T005) → T006 → T007
