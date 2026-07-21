# Implementation Plan - Xem danh sach toan bo booking phong hien tai

- **Feature ID**: ROOM-BOOKING-LIST-001
- **Feature Name**: Xem danh sach toan bo booking phong hien tai (List Room Bookings)
- **Module**: rooms
- **Status**: Draft Plan
- **Created Date**: 2026-07-20

---

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-20 | Tao moi plan cho feature feat-list-room-bookings | Toan bo file |
| 2026-07-20 | Cap nhat Manager scope thanh da giai quyet (directManagerId + department.managerUserId), sua loi format "r" thua | Muc 1, 6, 12 |
| 2026-07-21 | Fix: data scope filter text resolved, service file quyet dinh room-bookings.service.ts, them AC-013 vao traceability | Muc 7, 11, 13 |

---

## 1. Feature Summary

Feature nay cung cap API GET /api/v1/room-bookings cho SYSTEM_ADMIN / BUSINESS_ADMIN / MANAGER xem danh sach toan bo room bookings tren he thong. Day la API read-only, tra tat ca booking khong gioi han theo user.

Ho tro loc theo: roomId, status, bookingType, date range (from/to), tim kiem (q). Phan trang va sort theo allowlist.

Data scope: SYSTEM_ADMIN va BUSINESS_ADMIN thay toan bo. Manager scope (da giai quyet): chi thay booking co bookedBy.directManagerId = currentUser.id hoac bookedBy thuoc department co managerUserId = currentUser.id (xem spec.md muc 1.5).

---

## 2. Technical Context

### Framework & ORM

- **NestJS** voi TypeORM
- Database: PostgreSQL (v3.2 Compact, 39 tables)
- Query pattern: TypeORM QueryBuilder voi LEFT JOIN + pagination

### Module hien tai

| Module | Trang thai | Vai tro |
|--------|-----------|---------|
| rooms/ | Co controller, service, entities (RoomEntity, RoomBookingEntity) | Dat logic list room bookings tai day |
| accounts/ | UserEntity san sang | Relation bookedByUser / approvedByUser |
| meetings/ | MeetingEntity san sang | Relation meeting |

### Entities co san

- RoomBookingEntity - day du fields, enum BookingType, RoomBookingStatus
- RoomEntity - cho room relation
- MeetingEntity - cho meeting relation
- UserEntity - cho bookedByUser / approvedByUser relation

### Guard / Auth pattern

- JwtAuthGuard - kiem tra JWT
- PermissionsGuard + @RequirePermissions('room.booking.read') - RBAC

---

## 3. Scope Confirmation

### Trong scope

1. GET /api/v1/room-bookings voi pagination
2. Filter theo roomId
3. Filter theo status
4. Filter theo bookingType
5. Filter theo date range (from/to) dua tren reservedStartTime
6. Search q theo booking_code
7. Sort theo allowlist
8. Relation summary: room, meeting, bookedByUser, approvedByUser (nullable)
9. Data scope: SYSTEM_ADMIN/BUSINESS_ADMIN toan bo, Manager limited theo bookedBy.directManagerId / department.managerUserId (da giai quyet, xem spec.md muc 1.5)

### Ngoai scope

- Tao booking moi
- Approve/cancel/release booking
- Xem chi tiet booking (GET /:id)
- Gui notification
- Tao migration database (permission seed rieng)
- Them bang/cot moi
- Ghi audit log (read-only)
- Export danh sach
- Summary/thong ke

---

## 4. Data Model Impact

### Khong thay doi schema

Feature nay **khong them bang moi, khong them cot moi, khong tao migration**.

### Entities chinh duoc READ

| Entity | Action | Ghi chu |
|--------|:------:|-------|
| room_bookings | READ + FILTER | Bang chinh |
| rooms | READ (LEFT JOIN) | Relation room |
| meetings | READ (LEFT JOIN) | Relation meeting |
| users | READ (LEFT JOIN) | Relation bookedByUser, approvedByUser |

---

## 5. API / Contract Plan

### GET /api/v1/room-bookings

| Item | Value |
|------|-------|
| Auth | JwtAuthGuard + PermissionsGuard |
| Permission | room.booking.read (MOI - can seed) |
| Query | page, limit, roomId, status, bookingType, from, to, q, sortBy, sortOrder |
| Success | 200 - { success, message, data: RoomBookingListItem[], meta: PaginationMeta } |
| Errors | 400, 401, 403, 422, 500 |

### DTOs

| DTO | Fields |
|-----|--------|
| RoomBookingQueryDto | page, limit, roomId, status, bookingType, from, to, q, sortBy, sortOrder |
| RoomBookingListItemDto | id, bookingCode, bookingType, status, roomId, meetingId, bookedBy, reservedStartTime, reservedEndTime, approvedBy, approvedAt, cancellationReason, createdAt, updatedAt, room, meeting, bookedByUser, approvedByUser |
| UserSummaryDto | id, fullName, email |
| RoomSummaryDto | id, roomName |
| MeetingSummaryDto | id, title |
---

## 6. Authorization Plan

### Guard Stack

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('room.booking.read')

### Data scope filtering

if (userRole === 'SYSTEM_ADMIN' || userRole === 'BUSINESS_ADMIN') {
  // No scope filter
} else {
  // Manager scope (da giai quyet - spec.md muc 1.5 / FR-012 / FR-029):
  // WHERE bookedByUser.directManagerId = currentUser.id
  //    OR bookedByUser.department.managerUserId = currentUser.id
  // Cung scope rule da dung o meeting-request-review cho meeting_requests.requested_by
}

### Empty scope: tra 200 voi data = []

---

## 7. Business Logic Plan

### List Flow

1. Parse & validate query params (DTO)
2. Check auth + permission
3. Build QueryBuilder:
   a. SELECT limited fields + LEFT JOIN relations
   b. Apply status filter (neu co)
   c. Apply bookingType filter (neu co)
   d. Apply roomId filter (neu co)
   e. Apply date range filter (from/to tren reservedStartTime)
   f. Apply q search (booking_code ILIKE)
   g. Apply data scope filter (da giai quyet: SYSTEM_ADMIN/BUSINESS_ADMIN khong filter, MANAGER chi thay booking co bookedBy.directManagerId = currentUser.id HOAC bookedBy.department.managerUserId = currentUser.id)
4. Apply sort (allowlist, default reserved_start_time DESC)
5. Apply pagination (skip/take)
6. getManyAndCount
7. Map to DTOs (handle null relations)
8. Return response with meta

---

## 8. Validation Plan

| Parameter | Validator | Message |
|-----------|-----------|--------|
| page | @Min(1) | page >= 1 |
| limit | @Min(1) @Max(100) | limit 1..100 |
| status | @IsIn enum | Invalid enum |
| bookingType | @IsIn enum | Invalid enum |
| roomId | @IsUUID('4') | Invalid UUID |
| from/to | Custom: from <= to | Invalid date range |
| sortBy | @IsIn allowlist | Invalid sort field |
| sortOrder | @IsIn(['asc','desc']) | Invalid sort order |

---

## 9. Error Handling Plan

| Code | HTTP | Dieu kien |
|------|:----:|-----------|
| VALIDATION_ERROR | 400 | Input sai (page, limit, UUID, date range) |
| UNAUTHORIZED | 401 | Khong JWT |
| FORBIDDEN | 403 | Khong permission |
| VALIDATION_ERROR | 422 | Invalid enum/sortBy |
| INTERNAL_ERROR | 500 | DB query fail |

---

## 10. Testing Strategy

### Unit Tests

| Test | Scope |
|------|-------|
| List success flow | Service - mock QueryBuilder |
| Filter by roomId | Service - verify WHERE |
| Filter by status | Service - verify WHERE |
| Filter by bookingType | Service - verify WHERE |
| Filter by date range | Service - verify BETWEEN |
| Search q | Service - verify ILIKE |
| Sort default | Service - verify ORDER BY |
| Sort invalid | Service/Guard - verify 422 |
| Pagination | Service - verify skip/take |
| Scope SYSTEM_ADMIN | Service - verify no filter |
| Null meeting relation | Service - verify null handling |
| Null approvedByUser relation | Service - verify null handling |
| Permission denied | Guard - verify 403 |

---

## 11. Implementation Phases

### Phase 1: DTOs & Validation

- src/modules/rooms/dto/room-booking-query.dto.ts
- src/modules/rooms/dto/room-booking-list-item.dto.ts
- src/modules/rooms/dto/user-summary.dto.ts
- src/modules/rooms/dto/room-summary.dto.ts
- src/modules/rooms/dto/meeting-summary.dto.ts
- src/modules/rooms/validators/from-to.constraint.ts

### Phase 2: Service Logic

- Tao file moi room-bookings.service.ts (RoomBookingsService) va implement method findRoomBookings(queryDto, authUser)
- QueryBuilder + LEFT JOIN + filter + scope + sort + pagination

### Phase 3: Controller Registration

- Tao src/modules/rooms/controllers/room-bookings.controller.ts
- Sua rooms.module.ts them controller

### Phase 4: Permission Seed

- Them migration seed cho permission room.booking.read
- Gan permission cho role SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER

### Phase 5: Tests

- src/modules/rooms/tests/room-bookings.service.spec.ts
- src/modules/rooms/tests/room-bookings.controller.spec.ts

### Phase 6: Verification

- Lint + build
- Verify API response match contract

---

## 12. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|:-----------:|-----------|
| N+1 query | High | Medium | QueryBuilder LEFT JOIN |
| SortBy injection | High | Low | Allowlist validation |
| Manager scope filtering | Medium | Low | Da giai quyet: tai su dung scope rule FR-032 cua feat-pending-meeting-requests (directManagerId + department.managerUserId) |
| Null relation error | High | Low | LEFT JOIN + null check |
| Permission room.booking.read chua seed | High | Low | Migration seed rieng |

---

## 13. Acceptance Criteria Traceability

| AC ID | Kich ban | Service Method | Test |
|-------|----------|---------------|:----:|
| AC-001 | Admin lay danh sach bookings | findRoomBookings() | Unit + Integration |
| AC-002 | Filter roomId | findRoomBookings() | Unit |
| AC-003 | Filter status | findRoomBookings() | Unit |
| AC-004 | Filter bookingType | findRoomBookings() | Unit |
| AC-005 | No permission | Guard -> 403 | Unit |
| AC-006 | Admin scope | findRoomBookings() no scope filter | Unit |
| AC-007 | Null meeting | findRoomBookings() null handling | Unit |
| AC-008 | Null approvedBy | findRoomBookings() null handling | Unit |
| AC-009 | Pagination | findRoomBookings() skip/take | Unit |
| AC-010 | Sort default | findRoomBookings() orderBy | Unit |
| AC-011 | Invalid enum | DTO validation -> 422 | Unit |
| AC-012 | Limit vuot max | DTO validation -> 400 | Unit |
| AC-013 | Manager scope | findRoomBookings() scope filter bookedBy.directManagerId / department.managerUserId | Unit |

