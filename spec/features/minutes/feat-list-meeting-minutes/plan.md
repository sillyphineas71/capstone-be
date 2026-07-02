# Implementation Plan - Xem danh sách biên bản họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo mới plan | Toàn bộ file |
| 2026-07-02 | Sửa 422 → 400 cho lỗi validation enum, khớp hành vi ValidationPipe mặc định của dự án | Mục 9 Error Handling Plan |

- **Feature ID**: MINUTES-LIST-001
- **Feature Name**: Xem danh sách biên bản họp
- **Module**: minutes
- **Status**: Draft Plan
- **Created Date**: 2026-07-02

---

## 1. Feature Summary

Feature này cung cấp API `GET /api/v1/meeting-minutes` cho Internal Employee (Host/Participant), Manager, Business Admin, System Admin xem danh sách biên bản họp (`meeting_minutes`). API read-only, áp dụng scope phân quyền theo role trước khi áp dụng filter của client.

Scope: Business Admin/System Admin thấy toàn bộ (mọi status trừ deleted). Host/Participant/Manager chỉ thấy bản Nháp do chính mình tạo, và biên bản published/archived của các meeting mình là host hoặc participant.

Hỗ trợ lọc theo: status, roomId, date range (from/to theo meeting.actual_start_time), tìm kiếm (q trên minutes.title/meeting.title/host.fullName). Phân trang tối đa 20/trang (BR2), sort theo allowlist.

---

## 2. Technical Context

### Framework & ORM

- **NestJS** với TypeORM
- Database: PostgreSQL (v3.2 Compact, 39 tables)
- Query pattern: TypeORM QueryBuilder với LEFT JOIN + EXISTS subquery + pagination

### Module hiện tại

| Module | Trạng thái | Vai trò |
|--------|-----------|---------|
| minutes/ | Có module, controller (chỉ create draft), service (chỉ createDraft) | Thêm method + controller mới tại đây |
| meetings/ | Có entities MeetingEntity, MeetingParticipantEntity | Dùng để JOIN + scope |
| rooms/ | Có RoomEntity | Dùng để JOIN room summary |
| accounts/ | UserEntity sẵn sàng | Dùng để JOIN host summary |
| auth/ | AuthzReadRepository, JwtAuthGuard, PermissionsGuard | Guard + scope role check |

### Entities có sẵn (không cần entity/migration schema mới)

- `MeetingMinutesEntity` — status, visibilityLevel, preparedBy, meetingId, title, versionNo, createdAt, deletedAt
- `MeetingEntity` — hostId, roomId, title, actualStartTime, actualEndTime, meetingMode
- `MeetingParticipantEntity` — meetingId, userId
- `RoomEntity` — roomName
- `UserEntity` — fullName, email

### Guard / Auth pattern

- `JwtAuthGuard` — kiểm tra JWT
- `PermissionsGuard` + `@RequirePermissions('meeting.minutes.read')` — RBAC
- `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)` — lấy `roles` để xác định `isAdmin`

---

## 3. Scope Confirmation

### Trong scope

1. `GET /api/v1/meeting-minutes` với pagination (max 20/trang theo BR2)
2. Scope filtering theo role: Admin (SYSTEM_ADMIN/BUSINESS_ADMIN) toàn bộ; còn lại: draft chỉ prepared_by=self, published/archived chỉ host/participant
3. Filter theo `status` (draft/published/archived/all) — áp dụng SAU scope
4. Filter theo `roomId`
5. Filter theo date range (`from`/`to` trên `meeting.actual_start_time`)
6. Search `q` theo `minutes.title` / `meeting.title` / `host.fullName`
7. Sort theo allowlist (`actual_start_time`, `created_at`), mặc định `actual_start_time DESC`
8. Response: id, title, status, versionNo, createdAt, meeting summary (id, title, actualStartTime, actualEndTime, meetingMode, room|null), host summary (id, fullName, email)|null
9. Loại trừ `status=deleted` khỏi mọi kết quả
10. Seed permission `meeting.minutes.read` (migration)

### Ngoài scope

- Tạo/sửa/publish/archive/xóa biên bản
- Xem chi tiết 1 biên bản (`GET /:id`), bao gồm nội dung đầy đủ
- Export danh sách
- Thống kê/dashboard
- Notification / audit log cho hành động đọc
- Migration thay đổi schema (chỉ seed permission)
- Định nghĩa đầy đủ hành vi `visibility_level=department/public_internal` (fail-closed tạm thời, xem research.md)

---

## 4. Data Model Impact

### Không thay đổi schema

Feature này **không thêm bảng mới, không thêm cột mới**. Chỉ thêm 1 migration seed permission `meeting.minutes.read`.

### Entities chính được READ

| Entity | Action | Ghi chú |
|--------|:------:|-------|
| meeting_minutes | READ + FILTER + SCOPE | Bảng chính |
| meetings | READ (JOIN) + SCOPE (host_id) | Relation meeting + điều kiện scope |
| meeting_participants | READ (EXISTS subquery) | Điều kiện scope participant |
| rooms | READ (LEFT JOIN) | Relation room |
| users | READ (LEFT JOIN qua meetings.host_id) | Relation host |

---

## 5. API / Contract Plan

### GET /api/v1/meeting-minutes

| Item | Value |
|------|-------|
| Auth | JwtAuthGuard + PermissionsGuard |
| Permission | meeting.minutes.read |
| Query | page, limit, status, roomId, from, to, q, sortBy, sortOrder |
| Success | 200 - { success, message, data: MinutesListItemDto[], meta: PaginationMeta } |
| Errors | 400, 401, 403, 422, 500 |

### DTOs

| DTO | Fields |
|-----|--------|
| MinutesQueryDto | page, limit, status, roomId, from, to, q, sortBy, sortOrder |
| MinutesListItemDto | id, title, status, versionNo, createdAt, meeting, host |
| MinutesMeetingSummaryDto | id, title, actualStartTime, actualEndTime, meetingMode, room (RoomSummaryDto \| null) |
| RoomSummaryDto | id, roomName (tái sử dụng từ `meetings/dto/room-summary.dto.ts`) |
| UserSummaryDto | id, fullName, email (tái sử dụng từ `meetings/dto/user-summary.dto.ts`) |

---

## 6. Authorization Plan

### Guard Stack

```ts
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting.minutes.read')
```

### Data scope filtering (Brackets trong QueryBuilder)

```ts
const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(authUser.userId);
const isAdmin = roles.some((r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN');

qb.andWhere('minutes.deletedAt IS NULL');

if (!isAdmin) {
  qb.andWhere(new Brackets((sub) => {
    sub
      .where('minutes.status = :draftStatus AND minutes.preparedBy = :userId', {
        draftStatus: MeetingMinutesStatus.DRAFT,
        userId: authUser.userId,
      })
      .orWhere(
        `minutes.status IN (:...visibleStatuses) AND (
          meeting.hostId = :userId
          OR EXISTS (
            SELECT 1 FROM meeting_participants mp
            WHERE mp.meeting_id = meeting.id AND mp.user_id = :userId
          )
        )`,
        {
          visibleStatuses: [MeetingMinutesStatus.PUBLISHED, MeetingMinutesStatus.ARCHIVED],
          userId: authUser.userId,
        },
      );
  }));
}
```

### Empty scope: trả 200 với data = []

---

## 7. Business Logic Plan

### List Flow

```text
1. Parse & validate query params (DTO, limit tối đa 20 theo BR2)
2. Check auth + permission (meeting.minutes.read)
3. Xác định isAdmin qua AuthzReadRepository
4. Build QueryBuilder:
   a. SELECT limited fields + LEFT JOIN meeting, room, host user
   b. Loại trừ deleted (minutes.deletedAt IS NULL)
   c. Áp dụng scope theo role (Brackets — xem mục 6)
   d. Áp dụng filter status (client) — AND thêm vào scope, không thay thế
   e. Áp dụng filter roomId
   f. Áp dụng filter date range (from/to trên meeting.actualStartTime)
   g. Áp dụng q search (ILIKE trên minutes.title OR meeting.title OR host.fullName)
5. Áp dụng sort (allowlist, default actual_start_time DESC)
6. Áp dụng pagination (skip/take, limit tối đa 20)
7. getManyAndCount
8. Map sang MinutesListItemDto (null-safe cho host, room)
9. Return response với meta
```

---

## 8. Validation Plan

| Parameter | Validator | Message |
|-----------|-----------|--------|
| page | @Min(1) | page >= 1 |
| limit | @Min(1) @Max(20) | limit 1..20 (BR2) |
| status | @IsIn(['draft','published','archived','all']) | Invalid enum |
| roomId | @IsUUID('4') | Invalid UUID |
| from/to | Custom: from <= to | Invalid date range |
| sortBy | @IsIn(['actual_start_time','created_at']) | Invalid sort field |
| sortOrder | @IsIn(['asc','desc']) | Invalid sort order |

Tái sử dụng validator `FromToConstraint` đã có tại `src/modules/meetings/validators/from-to.constraint.ts` (đã tạo cho `feat-pending-meeting-requests`), không viết lại.

---

## 9. Error Handling Plan

| Code | HTTP | Điều kiện |
|------|:----:|-----------|
| VALIDATION_ERROR | 400 | Input sai (page, limit, UUID, date range, enum status/sortBy — ValidationPipe mặc định của dự án không phân biệt 422) |
| UNAUTHORIZED | 401 | Không JWT |
| FORBIDDEN | 403 | Không permission |
| INTERNAL_ERROR | 500 | DB query fail |

---

## 10. Testing Strategy

### Unit Tests

| Test | Scope |
|------|-------|
| Host thấy draft của mình | Service |
| Participant không thấy draft của Host | Service |
| Participant thấy published của meeting mình tham dự | Service |
| Non-host/non-participant không thấy published/archived | Service |
| Business Admin thấy toàn bộ (draft người khác) | Service |
| System Admin ngang Business Admin | Service |
| Loại trừ status=deleted với mọi role kể cả admin | Service |
| Filter theo status | Service |
| Filter theo roomId | Service |
| Filter theo date range | Service |
| Search q (title/meeting.title/host.fullName) | Service |
| Meeting online (room=null) không lỗi | Service |
| Host null không lỗi | Service |
| Sort mặc định actualStartTime DESC | Service |
| Pagination tối đa 20 | Service |
| Scope rỗng → 200 data=[] | Service |
| Permission denied → 403 | Guard/Controller |
| limit > 20 → 400 | DTO |
| status invalid → 422 | DTO |

---

## 11. Implementation Phases

### Phase 1: Migration & DTOs

- `src/database/migrations/20260702010000-SeedMeetingMinutesReadPermission.ts`
- `src/modules/minutes/dto/minutes-query.dto.ts`
- `src/modules/minutes/dto/minutes-list-item.dto.ts`
- `src/modules/minutes/dto/minutes-meeting-summary.dto.ts`

### Phase 2: Service Logic

- Thêm method `findMinutesList(queryDto, authUser)` trong `src/modules/minutes/services/minutes.service.ts`

### Phase 3: Controller Registration

- Tạo `src/modules/minutes/controllers/minutes-list.controller.ts`
- Sửa `minutes.module.ts` thêm controller vào mảng `controllers`

### Phase 4: Tests

- `src/modules/minutes/services/minutes-list.service.spec.ts` (co-located, theo convention hiện có của module minutes)
- `src/modules/minutes/controllers/minutes-list.controller.spec.ts` (co-located)

### Phase 5: Verification

- Lint + build
- Verify API response match contract

---

## 12. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|:-----------:|-----------|
| Scope logic sai gây rò rỉ draft của người khác | High | Medium | Unit test riêng cho từng nhánh role, review kỹ Brackets logic |
| N+1 query khi check participant | Medium | Medium | Dùng EXISTS subquery trong cùng QueryBuilder, không query riêng trong loop |
| SortBy injection | High | Low | Allowlist validation |
| Limit vượt 20 do nhầm với convention chung (100) | Medium | Medium | Validator riêng @Max(20), test riêng AC-011 |
| Null relation (room/host) gây lỗi response | Medium | Low | LEFT JOIN + null check khi map DTO |
| Permission chưa seed đúng cơ chế (seeds/ vs migrations/) | High | Low | Dùng migrations/, đã xác nhận qua research.md |

---

## 13. Acceptance Criteria Traceability

| AC ID | Kịch bản | Service Method | Test |
|-------|----------|---------------|:----:|
| AC-001 | Host xem draft của mình | findMinutesList() | Unit |
| AC-002 | Participant không thấy draft người khác | findMinutesList() | Unit |
| AC-003 | Participant thấy published | findMinutesList() | Unit |
| AC-004 | Business Admin xem toàn bộ | findMinutesList() | Unit |
| AC-005 | System Admin ngang Business Admin | findMinutesList() | Unit |
| AC-006 | Không có permission | Guard -> 403 | Unit |
| AC-007 | Filter status | findMinutesList() | Unit |
| AC-008 | Search q | findMinutesList() | Unit |
| AC-009 | Meeting online null room | findMinutesList() | Unit |
| AC-010 | Pagination max 20 | findMinutesList() | Unit |
| AC-011 | Limit vượt 20 | DTO validation -> 400 | Unit |
| AC-012 | Sort mặc định | findMinutesList() | Unit |
| AC-013 | Scope rỗng | findMinutesList() | Unit |
| AC-014 | Invalid enum | DTO validation -> 422 | Unit |
