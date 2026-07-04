# Implementation Plan: Search Meeting Minutes by Person

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo plan cho feat-search-minutes-by-person (UC-MKM-07 / UC-135) | Toàn bộ file |

## 1. Feature Summary
Thêm 1 endpoint mới `GET /api/v1/meeting-minutes/search-by-person?userId=<uuid>` cho Manager (giới hạn theo `departments.manager_user_id`) hoặc Business Admin/System Admin (không giới hạn) tra cứu toàn bộ biên bản họp liên quan tới 1 nhân sự chỉ định. Tách biệt hoàn toàn khỏi `findMinutesList` (dùng cho tự xem) vì 2 mô hình phân quyền khác nhau. Không thêm bảng/cột mới; thêm 1 permission mới chỉ cấp cho `MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN`.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL. Không migration bảng mới, chỉ seed 1 permission mới.

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/services/minutes.service.ts`: đã có `findMinutesList` (dùng chung `MinutesQueryDto`) — feature này thêm method **hoàn toàn mới** `searchMinutesByPerson(dto, authUser)`, KHÔNG tái sử dụng/sửa `findMinutesList` (tránh trộn 2 mô hình phân quyền, đã quyết định ở spec.md mục 1.5).
- `src/modules/minutes/controllers/minutes-list.controller.ts` (`@Controller('meeting-minutes')`): thêm route `GET search-by-person`. **Lưu ý thứ tự route quan trọng**: nếu sau này `feat-view-meeting-minutes-detail` (UC-MKM-03) được implement với route `GET :id` trên cùng controller, route `GET search-by-person` (static) PHẢI được khai báo TRƯỚC route `GET :id` (dynamic) trong file, nếu không NestJS sẽ hiểu nhầm `search-by-person` là giá trị của `:id`. Tại thời điểm viết plan này, `GET :id` chưa tồn tại trong code nên chưa có xung đột — nhưng phải ghi chú rõ cho người implement sau.
- `src/modules/auth/repositories/authz-read.repository.ts` (`AuthzReadRepository.getEffectiveRolesAndPermissions`): dùng để xác định `roles` của actor (`MANAGER` hay `BUSINESS_ADMIN`/`SYSTEM_ADMIN`).
- `src/modules/accounts/entities/department.entity.ts` (`DepartmentEntity`): có sẵn `managerUserId`, `isActive`, `deletedAt` — dùng để tính `managedDepartmentIds`.
- `src/modules/accounts/entities/user.entity.ts` (`UserEntity`): dùng để validate `userId` tồn tại + lấy `departmentId` của host/organizer qua join.
- `src/modules/meetings/entities/meeting.entity.ts` (`MeetingEntity`): có `hostId` (nullable), `organizerId` (bắt buộc) — dùng suy luận phòng ban cuộc họp qua 2 field này (`meetings` không có `departmentId` trực tiếp).
- `src/modules/minutes/dto/minutes-list-item.dto.ts`, `minutes-meeting-summary.dto.ts`: tái sử dụng nguyên vẹn cho response `data[]` của feature này (cùng shape).
- `src/modules/accounts/controllers/users.controller.ts` (`GET /api/v1/users`): endpoint autocomplete nhân sự đã có sẵn, feature này KHÔNG động vào.
- **KHÔNG dùng** `AttendanceService.getDirectReportIds`/`checkAccess` (module `attendance`) — đó là pattern `direct_manager_id` 1-cấp-theo-participant, khác model đã chốt cho feature này (`departments.manager_user_id`).

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data, meta }`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.search_by_person')`.
- `ValidationPipe({ transform: true, whitelist: true })` cho query DTO (giống `findMinutesList`).
- QueryBuilder với LEFT JOIN, tránh N+1 (giống `findMinutesList`).

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `GET /api/v1/meeting-minutes/search-by-person`.
- Model phân quyền theo `departments.manager_user_id` (Manager) / không giới hạn (Admin).
- Validate `userId` tồn tại → 404 nếu không.
- 1 permission mới (seed qua migration), chỉ cấp `MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN`.
- Unit test cho service (happy path + toàn bộ nhánh lỗi/scope) và controller.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + scope theo phòng ban trong service |
| SEC-03 (input validation) | PASS — `userId` UUID validate, `limit` max 20 |
| ARCH-01 (service boundary) | PASS — chỉ dùng entity đã có qua injection sẵn có (`minutes`, `meetings`, `accounts`) |
| ARCH-02 (async cho >2s) | PASS — read-only, đồng bộ |
| ARCH-03 (idempotency) | PASS — GET thuần túy |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng |
| ENG-03 (error không lộ stack trace) | PASS |

### 3.4 Complexity Tracking
Điểm phức tạp chính: suy luận `managedDepartmentIds` + điều kiện scope 2 nhánh (Manager theo phòng ban vs Admin không giới hạn) trong cùng 1 QueryBuilder. Không cần ADR riêng nhưng cần test kỹ (xem mục 10). Route ordering risk đã ghi chú ở mục 2.2.

## 4. Data Model Impact
Tóm tắt: 0 bảng mới, 0 cột mới, 1 permission mới (migration).

### 4.1 Bảng bị ảnh hưởng (chỉ đọc)
`meeting_minutes`, `meetings`, `meeting_participants`, `departments`, `users`, `rooms`.

### 4.2 Bảng được INSERT
`permissions` + `role_permissions` (qua migration, không phải runtime). Không insert bảng nghiệp vụ nào khác (read-only feature).

### 4.3 Seed / Migration
1 migration mới: `SeedMeetingMinutesSearchByPersonPermission` (copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`), seed permission `meeting.minutes.search_by_person`, module_code=`minutes`, action_code=`minutes.search_by_person`, roles=`MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` (**KHÔNG** có `INTERNAL_USER` — khác toàn bộ permission `minutes.*` trước đó).

## 5. API / Contract Plan

### 5.1 Endpoint
- `GET /api/v1/meeting-minutes/search-by-person`

### 5.2 Request / Response
Xem spec.md mục 5.2/5.3.

### 5.3 Success Response
`200 OK`.

### 5.4 Error Responses
`400 VALIDATION_ERROR`, `401 Unauthorized`, `403 FORBIDDEN`, `404 USER_NOT_FOUND`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.search_by_person`, module_code=`minutes`, roles=`MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.search_by_person')` (chặn `INTERNAL_USER` ngay từ guard vì không được cấp permission).
3. Service tính `isAdmin` (SYSTEM_ADMIN/BUSINESS_ADMIN) qua `AuthzReadRepository`.
4. NẾU `isAdmin`: không giới hạn phạm vi (status draft/published/archived, mọi phòng ban).
5. NẾU KHÔNG (tức actor là `MANAGER`, vì `INTERNAL_USER` đã bị chặn ở bước 2): tính `managedDepartmentIds`, áp điều kiện `status IN (published, archived)` AND thuộc `managedDepartmentIds`.

### 6.3 Error
Thiếu permission → `403 FORBIDDEN` (guard). Không có case 403 nào khác ở tầng service (ngoài phạm vi phòng ban chỉ dẫn tới `data=[]`, không phải lỗi).

## 7. Business Logic Plan

### 7.1 Flow — Search
```text
1. Validate userId UUID (DTO) -> 400 nếu sai format
2. targetUser = SELECT users WHERE id = :userId AND deletedAt IS NULL
   -> không có -> 404 USER_NOT_FOUND
3. { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId)
   isAdmin = roles includes SYSTEM_ADMIN or BUSINESS_ADMIN
4. IF NOT isAdmin (tức là Manager, đã qua permission guard):
     managedDepartmentIds = SELECT id FROM departments
       WHERE manager_user_id = :authUserId AND deleted_at IS NULL AND is_active = true
     IF managedDepartmentIds rỗng -> return { items: [], total: 0 } ngay (short-circuit, khỏi query minutes)
5. Build QueryBuilder trên meeting_minutes:
   - LEFT JOIN meeting, room, host user (giống findMinutesList)
   - LEFT JOIN meeting.organizer (user) — CẦN THÊM (findMinutesList hiện tại KHÔNG join organizer)
   - .andWhere('minutes.deletedAt IS NULL')
   - Điều kiện "nhân sự liên quan":
     .andWhere(new Brackets(sub => sub
       .where('minutes.preparedBy = :targetUserId')
       .orWhere('EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = meeting.id AND mp.user_id = :targetUserId)')
     ), { targetUserId: userId })
   - IF isAdmin:
       .andWhere('minutes.status IN (:...statuses)', { statuses: ['draft','published','archived'] })
     ELSE (Manager):
       .andWhere('minutes.status IN (:...statuses)', { statuses: ['published','archived'] })
       .andWhere(new Brackets(sub => sub
         .where('host.departmentId IN (:...deptIds)')
         .orWhere('meeting.hostId IS NULL AND organizer.departmentId IN (:...deptIds)')
       ), { deptIds: managedDepartmentIds })
6. .orderBy('meeting.actualStartTime', 'DESC')
7. .skip(skip).take(limit) -- limit tối đa 20
8. getManyAndCount()
9. Map sang MinutesListItemDto[] (tái dùng nguyên format feat-list-meeting-minutes)
10. Trả { items, total, page, limit, person: { id: targetUser.id, fullName: targetUser.fullName, email: targetUser.email } }
```
Lưu ý bước 5: `findMinutesList` hiện tại chỉ `leftJoin('minutes.meeting', 'meeting')` + `leftJoin(RoomEntity, 'room', ...)` + `leftJoin(UserEntity, 'host', ...)` qua `meeting.hostId`, KHÔNG join `organizer`. Feature này cần thêm 1 `leftJoin(UserEntity, 'organizer', 'organizer.id = meeting.organizerId')` mới cho nhánh fallback ở FR-007.

### 7.2 Key Business Rules Implemented
Manager giới hạn theo phòng ban (không đệ quy) + chỉ published/archived; Admin không giới hạn; validate userId tồn tại; kết quả rỗng không phải lỗi.

## 8. Validation Plan

### 8.1 Input Validation (DTO)
- `userId`: `@IsUUID('4')`, required.
- `page`: `@IsOptional() @Type(() => Number) @Min(1)`.
- `limit`: `@IsOptional() @Type(() => Number) @Min(1) @Max(20)`.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: user tồn tại → xác định role → (Manager) tính scope phòng ban → build query theo đúng nhánh.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| `userId` không tồn tại/đã xóa | `NotFoundException` | `USER_NOT_FOUND` |
| `userId` không phải UUID | `BadRequestException` (ValidationPipe) | `VALIDATION_ERROR` |
| `limit` > 20 | `BadRequestException` (ValidationPipe) | `VALIDATION_ERROR` |

### 9.2 Transaction Error Handling
Không áp dụng (read-only, không transaction ghi).

### 9.3 Notification Error
Không áp dụng.

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts` (bổ sung case mới cho `searchMinutesByPerson`): happy path Manager đúng phòng ban (participant), happy path Manager đúng phòng ban (preparedBy, không phải participant), Manager sai phòng ban (không thấy), Manager không phụ trách phòng ban nào (`data=[]` ngay, không query minutes), Business Admin thấy cả draft, System Admin ngang Business Admin, Manager không thấy draft dù đúng phòng ban, `userId` không tồn tại → 404, `userId` đã xóa mềm → 404, `meta.person` đúng dữ liệu, `host` null fallback `organizer` đúng phòng ban, loại trừ status=deleted.

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test DB thật: 1 Manager thật với `departments.manager_user_id` set sẵn, 2 meeting ở 2 phòng ban khác nhau, assert chỉ thấy đúng 1 bên.

## 11. Implementation Phases

### Phase 1: Preparation
DTO request (`SearchMinutesByPersonQueryDto`), response type (tái dùng `MinutesListItemDto` cho `data[]`, thêm `PersonSummaryDto` cho `meta.person`).

### Phase 2: Service Logic
`MinutesService.searchMinutesByPerson`.

### Phase 3: Controller Endpoint
Thêm route `GET search-by-person` vào `MeetingMinutesListController` — đặt TRƯỚC bất kỳ route `GET :id` nào nếu đã/sẽ tồn tại (xem mục 2.2).

### Phase 4: Seed & Tests
Migration seed permission `meeting.minutes.search_by_person` (chỉ 3 role), unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Route `search-by-person` bị NestJS hiểu nhầm thành `:id` nếu route GET :id được thêm sau mà không để ý thứ tự khai báo | Ghi chú rõ trong code (comment) + trong plan.md mục 2.2; review kỹ khi implement UC-MKM-03 sau này |
| Suy luận phòng ban qua host/organizer không chính xác 100% (participant có thể khác phòng ban với host) | Đã ghi rõ là giả định có chủ đích trong spec.md mục 1.4, đúng theo yêu cầu Product Owner (dựa vào host/organizer, không dựa vào participant) |
| Quên thêm JOIN `organizer` (khác với `findMinutesList` hiện tại) | Checklist rõ trong plan.md mục 7.1 ghi chú riêng |
| Permission mới cấp nhầm cho `INTERNAL_USER` (copy-paste từ migration cũ) | Review kỹ danh sách roles trong migration mới, unit test AC-007 xác nhận `INTERNAL_USER` bị 403 |
| Nhầm lẫn với pattern `direct_manager_id` đã có ở `attendance` khi code (do tên biến `isManagerOf...` dễ liên tưởng) | Đặt tên method/biến rõ ràng gắn với `departments`/`managedDepartmentIds`, không dùng lại tên từ `AttendanceService` |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`.
