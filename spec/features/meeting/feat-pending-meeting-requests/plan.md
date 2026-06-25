# Implementation Plan - Lấy danh sách yêu cầu cuộc họp đang chờ duyệt

- **Feature ID**: MEETING-PENDING-REQUESTS-001
- **Feature Name**: Lấy danh sách yêu cầu cuộc họp đang chờ duyệt
- **Module**: meetings
- **Status**: Draft Plan
- **Created Date**: 2026-06-23

---

## 1. Feature Summary

Feature này cung cấp API `GET /api/v1/meeting-requests` cho Admin / Business Admin / System Admin / Manager / Approver xem danh sách các yêu cầu cuộc họp (meeting requests). Đây là API read-only, mặc định trả pending requests (approval queue).

Hỗ trợ lọc theo: approvalStatus, requestType, targetRoomId, requestedById, date range (from/to), tìm kiếm (q). Phân trang và sort theo allowlist.

Data scope: SYSTEM_ADMIN và BUSINESS_ADMIN thấy toàn bộ. Manager/Approver bị giới hạn theo directManagerId hoặc department manager_user_id.

---

## 2. Technical Context

### Framework & ORM

- **NestJS** với TypeORM
- Database: PostgreSQL (v3.2 Compact, 39 tables)
- Query pattern: TypeORM QueryBuilder với LEFT JOIN + pagination

### Module hiện tại

| Module | Trạng thái | Vai trò |
|--------|-----------|---------|
| meetings/ | Có controller, service, 8 entities | Đặt logic list meeting requests tại đây |
| scheduling/ | Module rỗng | Không dùng |
| accounts/ | UserEntity sẵn sàng | Relation requestedBy |

### Entities có sẵn

- `MeetingRequestEntity` - đầy đủ fields, enum ApprovalStatus, MeetingRequestType
- `UserEntity` - cho requestedBy relation
- `RoomEntity` - cho targetRoom relation
- `MeetingEntity` - cho meeting relation

### Guard / Auth pattern

- `JwtAuthGuard` - kiểm tra JWT
- `PermissionsGuard` + `@RequirePermissions('meeting_request.read')` - RBAC

---

## 3. Scope Confirmation

### Trong scope

1. GET /api/v1/meeting-requests với pagination
2. Filter theo approvalStatus (default pending, hoặc all)
3. Filter theo requestType
4. Filter theo targetRoomId, requestedById
5. Filter theo date range (from/to)
6. Search q theo request_code
7. Sort theo allowlist
8. Relation summary: requestedBy, targetRoom, meeting (nullable)
9. conflictSummary raw JSON
10. Data scope: SYSTEM_ADMIN/BUSINESS_ADMIN toàn bộ, Manager/Approver limited

### Ngoài scope

- Approve/reject meeting request (feat-review-meeting-request)
- Tạo meeting request mới
- Cập nhật meeting/booking
- Gửi notification
- Tạo migration database
- Thêm bảng/cột mới
- Ghi audit log (read-only)
- Xem chi tiết request (GET /:id)
- Export danh sách
- Summary/thống kê
- Room-manager-specific scope

---

## 4. Data Model Impact

### Không thay đổi schema

Feature này **không thêm bảng mới, không thêm cột mới, không tạo migration**.

### Entities chính được READ

| Entity | Action | Ghi chú |
|--------|:------:|-------|
| meeting_requests | READ + FILTER | Bảng chính |
| users | READ (LEFT JOIN) | Relation requestedBy |
| rooms | READ (LEFT JOIN) | Relation targetRoom |
| meetings | READ (LEFT JOIN) | Relation meeting |

---

## 5. API / Contract Plan

### GET /api/v1/meeting-requests

| Item | Value |
|------|-------|
| Auth | JwtAuthGuard + PermissionsGuard |
| Permission | meeting_request.read |
| Query | page, limit, approvalStatus, requestType, targetRoomId, requestedById, from, to, q, sortBy, sortOrder |
| Success | 200 - { success, message, data: MeetingRequestListItem[], meta: PaginationMeta } |
| Errors | 400, 401, 403, 422, 500 |

### DTOs

| DTO | Fields |
|-----|--------|
| MeetingRequestQueryDto | page, limit, approvalStatus, requestType, targetRoomId, requestedById, from, to, q, sortBy, sortOrder |
| MeetingRequestListItemDto | id, requestCode, requestType, approvalStatus, requestedAt, requestedStartTime, requestedEndTime, conflictCheckStatus, conflictSummary, decisionBy, decisionAt, rejectionReason, requestedBy, targetRoom, meeting |
| UserSummaryDto | id, fullName, email |
| RoomSummaryDto | id, roomName |

---

## 6. Authorization Plan

### Guard Stack

```
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting_request.read')
```

### Data scope filtering

```typescript
if (userRole === 'SYSTEM_ADMIN' || userRole === 'BUSINESS_ADMIN') {
  // No scope filter
} else {
  // Manager/Approver scope v1
  qb.andWhere(
    `(requester.direct_manager_id = :userId
      OR requester.department_id IN (
        SELECT d.id FROM departments d WHERE d.manager_user_id = :userId
      ))`,
    { userId: authUser.userId }
  );
}
```

### Empty scope: trả 200 với data = []

---

## 7. Business Logic Plan

### List Flow

```
1. Parse & validate query params (DTO)
2. Check auth + permission
3. Build QueryBuilder:
   a. SELECT limited fields + LEFT JOIN relations
   b. Apply approvalStatus filter (default pending)
   c. Apply requestType filter
   d. Apply targetRoomId filter
   e. Apply requestedById filter
   f. Apply date range filter (from/to)
   g. Apply q search (request_code ILIKE)
   h. Apply data scope filter
4. Apply sort (allowlist, default requested_at DESC)
5. Apply pagination (skip/take)
6. getManyAndCount
7. Map to DTOs (handle null relations)
8. Return response with meta
```

---

## 8. Validation Plan

| Parameter | Validator | Message |
|-----------|-----------|--------|
| page | @Min(1) | page >= 1 |
| limit | @Min(1) @Max(100) | limit 1..100 |
| approvalStatus | @IsIn enum | Invalid enum |
| requestType | @IsIn enum | Invalid enum |
| targetRoomId | @IsUUID('4') | Invalid UUID |
| requestedById | @IsUUID('4') | Invalid UUID |
| from/to | Custom: from <= to | Invalid date range |
| sortBy | @IsIn allowlist | Invalid sort field |
| sortOrder | @IsIn(['asc','desc']) | Invalid sort order |

---

## 9. Error Handling Plan

| Code | HTTP | Điều kiện |
|------|:----:|-----------|
| VALIDATION_ERROR | 400 | Input sai (page, limit, UUID, date range) |
| UNAUTHORIZED | 401 | Không JWT |
| FORBIDDEN | 403 | Không permission |
| VALIDATION_ERROR | 422 | Invalid enum/sortBy |
| INTERNAL_ERROR | 500 | DB query fail |

---

## 10. Testing Strategy

### Unit Tests

| Test | Scope |
|------|-------|
| List success flow | Service - mock QueryBuilder |
| Default filter pending | Service - verify WHERE |
| Filter by approvalStatus | Service - verify WHERE |
| Filter by requestType | Service - verify WHERE |
| Filter by targetRoomId | Service - verify WHERE |
| Filter by requestedById | Service - verify WHERE |
| Filter by date range | Service - verify BETWEEN |
| Search q | Service - verify ILIKE |
| Sort default | Service - verify ORDER BY |
| Sort invalid | Service/Guard - verify 422 |
| Pagination | Service - verify skip/take |
| Scope SYSTEM_ADMIN | Service - verify no filter |
| Scope Manager | Service - verify WHERE |
| Scope empty | Service - verify 200 data=[] |
| Null meeting relation | Service - verify null handling |
| Null targetRoom relation | Service - verify null handling |
| Permission denied | Guard - verify 403 |

---

## 11. Implementation Phases

### Phase 1: DTOs & Validation

- `src/modules/meetings/dto/meeting-request-query.dto.ts`
- `src/modules/meetings/dto/meeting-request-list-item.dto.ts`
- `src/modules/meetings/dto/user-summary.dto.ts`
- `src/modules/meetings/dto/room-summary.dto.ts`

### Phase 2: Service Logic

- Thêm method `findMeetingRequests(queryDto, authUser)` trong `meetings.service.ts`
- QueryBuilder + LEFT JOIN + filter + scope + sort + pagination

### Phase 3: Controller Registration

- Tạo `src/modules/meetings/controllers/meeting-requests.controller.ts`
- Sửa `meetings.module.ts` thêm controller

### Phase 4: Tests

- `src/modules/meetings/tests/meeting-requests.service.spec.ts`
- `src/modules/meetings/tests/meeting-requests.controller.spec.ts`

### Phase 5: Verification

- Lint + build
- Verify API response match contract

---

## 12. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|:-----------:|-----------|
| N+1 query | High | Medium | QueryBuilder LEFT JOIN |
| SortBy injection | High | Low | Allowlist validation |
| Scope filtering sai | Medium | Medium | Unit test coverage |
| Large dataset | Medium | Low | Pagination + index |
| Null relation error | High | Low | LEFT JOIN + null check |
| Permission chưa seed | High | Low | Giả định đã seed |

---

## 13. Acceptance Criteria Traceability

| AC ID | Kịch bản | Service Method | Test |
|-------|----------|---------------|:----:|
| AC-001 | Admin lấy pending requests | findMeetingRequests() | Unit + Integration |
| AC-002 | Default filter pending | findMeetingRequests() | Unit |
| AC-003 | Filter approvalStatus=approved | findMeetingRequests() | Unit |
| AC-004 | Filter requestType | findMeetingRequests() | Unit |
| AC-005 | No permission | Guard -> 403 | Unit |
| AC-006 | Manager scope v1 | findMeetingRequests() scope filter | Unit |
| AC-007 | Null meeting | findMeetingRequests() null handling | Unit |
| AC-008 | Null room | findMeetingRequests() null handling | Unit |
| AC-009 | Pagination | findMeetingRequests() skip/take | Unit |
| AC-010 | Sort default | findMeetingRequests() orderBy | Unit |
| AC-011 | Invalid enum | DTO validation -> 422 | Unit |
| AC-012 | Limit vượt max | DTO validation -> 400 | Unit |
