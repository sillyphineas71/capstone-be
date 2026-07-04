# Task List: Search Meeting Minutes by Person

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo tasks cho feat-search-minutes-by-person | Toàn bộ file |

## Checklist
- [ ] T001 [US1] Đọc lại `minutes.service.ts` + `minutes-list.controller.ts` thật kỹ trước khi sửa (xác nhận chưa có route `GET :id` nào xung đột thứ tự với `search-by-person`)
- [ ] T002 [US1] Request DTO → `src/modules/minutes/dto/search-minutes-by-person-query.dto.ts`
- [ ] T003 [US1] `PersonSummaryDto` → `src/modules/minutes/dto/person-summary.dto.ts`
- [ ] T004 [US1] Service logic → `MinutesService.searchMinutesByPerson` trong `src/modules/minutes/services/minutes.service.ts`
- [ ] T005 [US1] Controller endpoint `GET meeting-minutes/search-by-person` → `src/modules/minutes/controllers/minutes-list.controller.ts` (đặt TRƯỚC route `:id` nếu có)
- [ ] T006 [US1] Migration seed permission `meeting.minutes.search_by_person` (chỉ MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN) → `src/database/migrations/<timestamp>-SeedMeetingMinutesSearchByPersonPermission.ts`
- [ ] T007 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts` (bổ sung case `searchMinutesByPerson`)
- [ ] T008 [US1] Unit test controller → route mới trong controller test tương ứng
- [ ] T009 [US1] Lint/build/test toàn repo

## Phase 0: Xác minh code hiện tại

### Task T001 [US1] — Đọc lại code trước khi sửa
**File**: `src/modules/minutes/services/minutes.service.ts`, `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Xác nhận (1) cấu trúc thật của `minutes.service.ts` sau các feature trước đã chèn code (`updateDraft`/`deleteDraft` nếu đã implement), (2) `minutes-list.controller.ts` chưa có route `GET :id` nào — nếu ĐÃ có (do `feat-view-meeting-minutes-detail` được implement trước), PHẢI đặt route `GET search-by-person` (static) TRƯỚC route `GET :id` (dynamic) trong file để tránh NestJS hiểu nhầm `search-by-person` là giá trị `:id`.
**Outcome**: Biết chính xác vị trí chèn code an toàn.
**Verification**: `npm run build` pass trước khi thêm code của feature này.

## Phase 1: Preparation

### Task T002 [US1] — Tạo request DTO
**File**: `src/modules/minutes/dto/search-minutes-by-person-query.dto.ts`
**Action**: Tạo `SearchMinutesByPersonQueryDto` theo data-model.md mục 3.1 (`userId` bắt buộc UUID, `page`/`limit` optional).
**Outcome**: DTO dùng cho `@Query()`, validate qua `ValidationPipe`.
**Verification**: Compile OK, reject `userId` không phải UUID.

### Task T003 [US1] — Tạo `PersonSummaryDto`
**File**: `src/modules/minutes/dto/person-summary.dto.ts`
**Action**: Tạo type theo data-model.md mục 3.2 (`id, fullName, email`).
**Outcome**: Dùng cho `meta.person` trong response.
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T004 [US1] — Viết `MinutesService.searchMinutesByPerson`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1:
```text
async searchMinutesByPerson(dto, authUser):
  targetUser = dataSource.getRepository(UserEntity).findOne({ where: { id: dto.userId, deletedAt: IsNull() } })
  if (!targetUser) throw NotFoundException(USER_NOT_FOUND)

  { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId)
  isAdmin = roles.some(r => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN')

  managedDepartmentIds = []
  if (!isAdmin) {
    managedDepartmentIds = dataSource.getRepository(DepartmentEntity)
      .find({ where: { managerUserId: authUser.userId, deletedAt: IsNull(), isActive: true } })
      .map(d => d.id)
    if (managedDepartmentIds.length === 0)
      return { items: [], total: 0, page, limit, person: toPersonSummary(targetUser) }
  }

  qb = dataSource.getRepository(MeetingMinutesEntity).createQueryBuilder('minutes')
    .leftJoin('minutes.meeting', 'meeting')
    .leftJoin(RoomEntity, 'room', 'room.id = meeting.roomId')
    .leftJoin(UserEntity, 'host', 'host.id = meeting.hostId')
    .leftJoin(UserEntity, 'organizer', 'organizer.id = meeting.organizerId')  // MỚI so với findMinutesList
    .select([...])
    .where('minutes.deletedAt IS NULL')
    .andWhere(new Brackets(sub => sub
      .where('minutes.preparedBy = :targetUserId', { targetUserId: dto.userId })
      .orWhere('EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = meeting.id AND mp.user_id = :targetUserId)', { targetUserId: dto.userId })
    ))

  if (isAdmin) {
    qb.andWhere('minutes.status IN (:...statuses)', { statuses: ['draft','published','archived'] })
  } else {
    qb.andWhere('minutes.status IN (:...statuses)', { statuses: ['published','archived'] })
    qb.andWhere(new Brackets(sub => sub
      .where('host.departmentId IN (:...deptIds)', { deptIds: managedDepartmentIds })
      .orWhere('meeting.hostId IS NULL AND organizer.departmentId IN (:...deptIds)', { deptIds: managedDepartmentIds })
    ))
  }

  qb.orderBy('meeting.actualStartTime', 'DESC').skip(skip).take(limit)
  [items, total] = qb.getManyAndCount()
  return { items: items.map(toMinutesListItemDto), total, page, limit, person: toPersonSummary(targetUser) }
```
**Outcome**: Method hoàn chỉnh, throw đúng exception cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T007 pass toàn bộ các nhánh.

## Phase 3: Controller Endpoint

### Task T005 [US1] — Thêm route `GET search-by-person`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm method controller `searchByPerson` với `@Get('search-by-person')` — đặt TRƯỚC bất kỳ route `@Get(':id')` nào trong file (xem T001), guard `JwtAuthGuard, PermissionsGuard`, `@RequirePermissions('meeting.minutes.search_by_person')`, `ValidationPipe` cho query DTO, gọi `minutesService.searchMinutesByPerson`, trả `{ success: true, message: 'Danh sach bien ban lien quan den nhan su', data: result.items, meta: {...} }` với `HttpCode(200)`.
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T008.

## Phase 4: Seed & Tests

### Task T006 [US1] — Seed permission mới
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesSearchByPersonPermission.ts`
**Action**: Copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`, đổi permission_code=`meeting.minutes.search_by_person`, module_code=`minutes`, action_code=`minutes.search_by_person`, roles=**CHỈ** `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` (KHÔNG có `INTERNAL_USER` — khác các migration permission `minutes.*` trước đó, cần cẩn thận khi copy-paste).
**Outcome**: Migration chạy được, permission + role_permissions insert đúng, KHÔNG có dòng nào cho `INTERNAL_USER`.
**Verification**: Chạy thử theo quickstart.md mục 2, kiểm tra `role_permissions` không có role `INTERNAL_USER`.

### Task T007 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Test các case ở plan.md mục 10.1: Manager đúng phòng ban (participant + preparedBy), Manager sai phòng ban, Manager không phụ trách phòng ban nào (short-circuit rỗng), Business/System Admin thấy cả draft, Manager không thấy draft, userId không tồn tại/đã xóa (404), host null fallback organizer đúng, loại trừ deleted, meta.person đúng.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path.
**Verification**: `npm run test` pass.

### Task T008 [US1] — Unit test controller
**File**: controller spec tương ứng
**Action**: Test controller gọi đúng service method, trả đúng response shape (bao gồm `meta.person`), guard chặn `INTERNAL_USER` (403).
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T009 [US1] — Lint/build/test
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo.
**Outcome**: Build pass, test module `minutes` pass toàn bộ (cũ + mới).
**Verification**: Ghi lại kết quả thực tế trong changelog của file này sau khi hoàn thành.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001 | T004, T007 |
| FR-002, FR-003 | T002, T004 |
| FR-004, FR-011, FR-012 | T004, T007 |
| FR-005, FR-007, FR-009 | T004, T007 |
| FR-006 | T003, T004 |
| FR-008 | T004, T007 |
| FR-013 | T005 (guard) |
| FR-014 | T002, T007 |
| FR-017, FR-018, FR-019 | T004 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002, AC-004 | T007 |
| AC-003, AC-008 | T007 |
| AC-005 | T003, T004, T007 |
| AC-006, AC-015 | T004, T007 |
| AC-007 | T005 (guard), T006 |
| AC-009 | T004, T007 |
| AC-010, AC-011 | T002, T007 |
| AC-012, AC-013 | T004, T007 |
| AC-014 | T004 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| VALIDATION_ERROR | 400 | T002, T007 |
| FORBIDDEN | 403 | T005 (guard) |
| USER_NOT_FOUND | 404 | T004, T007 |

## Dependencies Graph
```text
T001 ─> T002 ─┐
       T003 ─┼─> T004 ─> T005 ─> T006
                    │
                    └──> T007, T008 ──> T009
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001 | 0 | Xác minh code hiện tại + route ordering |
| 2 | T002, T003 | 1 | DTOs |
| 3 | T004 | 2 | Service |
| 4 | T005 | 3 | Controller |
| 5 | T006 | 4 | Seed permission (chỉ 3 role) |
| 6 | T007, T008 | 4 | Tests |
| 7 | T009 | 4 | Lint/build/test toàn repo |
